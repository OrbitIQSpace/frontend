// src/components/ReboostPlanner.js
// Reboost Planner — standalone page with own Cesium globe
// Route: /satellite/:noradId/reboost

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from '../api';
import { useAuth } from '@clerk/clerk-react';
import { Viewer, Entity } from 'resium';
import * as Cesium from 'cesium';
import { getSatelliteInfo } from 'tle.js';
import useGroundStations from '../hooks/useGroundStations';
import { sanitizeGeoJsonSource } from '../utils/cesiumUtils';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Filler, Legend);

Cesium.Ion.defaultAccessToken = process.env.REACT_APP_CESIUM_TOKEN || '';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const GM_KM = 3.986e5;   // km³/s²
const RE_KM = 6371.0;    // km
const G0    = 9.80665;   // m/s²

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

const utcClock = () => {
  const d = new Date();
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
};

const computeGroundTrack = (tle, startMs, durationMin, stepSec = 30) => {
  const positions = [];
  const steps = Math.floor((durationMin * 60) / stepSec);
  for (let i = 0; i <= steps; i++) {
    const t = startMs + i * stepSec * 1000;
    try {
      const info = getSatelliteInfo(tle, t);
      if (info && typeof info.lat === 'number' && !isNaN(info.lat)) {
        positions.push(Cesium.Cartesian3.fromDegrees(info.lng, info.lat, (info.height || 420) * 1000));
      }
    } catch {}
  }
  return positions;
};

const splitAtAntimeridian = (positions) => {
  if (positions.length < 2) return [positions];
  const segments = [];
  let current = [positions[0]];
  for (let i = 1; i < positions.length; i++) {
    const prev = Cesium.Cartographic.fromCartesian(positions[i - 1]);
    const curr = Cesium.Cartographic.fromCartesian(positions[i]);
    const prevLng = prev.longitude * 180 / Math.PI;
    const currLng = curr.longitude * 180 / Math.PI;
    if (Math.abs(currLng - prevLng) > 180) {
      segments.push(current);
      current = [positions[i]];
    } else {
      current.push(positions[i]);
    }
  }
  if (current.length) segments.push(current);
  return segments;
};

// ─────────────────────────────────────────────────────────────────────────────
// Orbital Math
// ─────────────────────────────────────────────────────────────────────────────

// Predict altitude decay over the next `daysAhead` days using mean_motion_dot
// (linear extrapolation — accurate enough for 90-day planning, faster than SGP4)
const predictDecay = (latestDerived, daysAhead = 90) => {
  const n0 = parseFloat(latestDerived.mean_motion);      // rev/day
  const nd = parseFloat(latestDerived.mean_motion_dot);  // rev/day²
  if (!isFinite(n0) || n0 <= 0) return null;
  const points = [];
  let reentryDate = null;

  for (let d = 0; d <= daysAhead; d++) {
    const n = n0 + nd * d;
    if (n <= 0) break;
    const T   = 86400 / n;                                              // seconds/rev
    const a   = Math.cbrt(GM_KM * Math.pow(T / (2 * Math.PI), 2));     // km
    const alt = a - RE_KM;                                              // km
    const date = new Date(Date.now() + d * 86400 * 1000);
    points.push({ dayOffset: d, date, altKm: Math.max(0, alt) });
    if (!reentryDate && alt < 100) reentryDate = date;
  }

  return { points, reentryDate };
};

// Hohmann transfer delta-v between two circular orbits
const computeHohmannDv = (currentAlt_km, targetAlt_km) => {
  const r1 = RE_KM + currentAlt_km;
  const r2 = RE_KM + targetAlt_km;
  const v1  = Math.sqrt(GM_KM / r1);                            // km/s
  const v2  = Math.sqrt(GM_KM / r2);                            // km/s
  const vTP = Math.sqrt(GM_KM * 2 * r2 / (r1 * (r1 + r2)));    // transfer perigee km/s
  const vTA = Math.sqrt(GM_KM * 2 * r1 / (r2 * (r1 + r2)));    // transfer apogee km/s
  const dv1 = vTP - v1;                                         // perigee kick km/s
  const dv2 = v2 - vTA;                                         // apogee kick km/s

  return {
    dv1_ms:     dv1 * 1000,
    dv2_ms:     dv2 * 1000,
    dvTotal_ms: (dv1 + dv2) * 1000,
  };
};

// Tsiolkovsky rocket equation
const computeFuelCost = (dvMs, wetMassKg, dryMassKg, ispS) => {
  if (!wetMassKg || !ispS || dvMs <= 0) return null;
  const exhaust      = ispS * G0;
  const mFinal       = wetMassKg / Math.exp(dvMs / exhaust);
  const deltaMass    = wetMassKg - mFinal;
  const propAvail    = dryMassKg ? wetMassKg - dryMassKg : null;
  const remaining    = propAvail != null ? Math.max(0, propAvail - deltaMass) : null;
  const feasible     = propAvail != null ? deltaMass <= propAvail : true;
  return { deltaMass_kg: deltaMass, remainingPropellant_kg: remaining, propAvail_kg: propAvail, feasible };
};

// Burn duration from thrust
const computeBurnDuration = (deltaMass_kg, thrustN, ispS) => {
  if (!thrustN || thrustN <= 0 || !ispS) return null;
  return deltaMass_kg / (thrustN / (ispS * G0));
};

// Elevation angle in degrees from ground station to satellite
const getElevDeg = (stLat, stLng, satLat, satLng, satHeightM) => {
  const Re = 6371000;
  const toR = d => d * Math.PI / 180;
  const φ1 = toR(stLat), λ1 = toR(stLng);
  const φ2 = toR(satLat), λ2 = toR(satLng);
  const Δφ = φ2 - φ1, Δλ = λ2 - λ1;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const ca = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const r  = Re + satHeightM;
  return Math.atan2(r * Math.cos(ca) - Re, r * Math.sin(ca)) * 180 / Math.PI;
};

// Scan next `daysAhead` days for ground station contact passes
const findBurnWindows = (tle, stations, daysAhead = 7) => {
  const windows  = [];
  const now      = Date.now();
  const endTime  = now + daysAhead * 86400 * 1000;
  const stepMs   = 60 * 1000;
  const inWindow = {}; // stationId -> { start, maxElev }

  for (let t = now; t <= endTime; t += stepMs) {
    let info;
    try {
      info = getSatelliteInfo(tle, t);
      if (!info || typeof info.lat !== 'number') continue;
    } catch { continue; }

    for (const station of stations) {
      const stLat   = parseFloat(station.latitude);
      const stLng   = parseFloat(station.longitude);
      const mask    = parseFloat(station.elevation_mask_deg);
      const satHM   = (info.height || 420) * 1000;
      const elevDeg = getElevDeg(stLat, stLng, info.lat, info.lng, satHM);
      const visible = elevDeg >= mask;

      if (visible && !inWindow[station.id]) {
        inWindow[station.id] = { start: t, maxElev: elevDeg };
      } else if (visible && inWindow[station.id]) {
        if (elevDeg > inWindow[station.id].maxElev) inWindow[station.id].maxElev = elevDeg;
      } else if (!visible && inWindow[station.id]) {
        const durationMin = (t - inWindow[station.id].start) / 60000;
        if (durationMin >= 2) {
          windows.push({
            stationId:   station.id,
            stationName: station.name,
            riseTime:    inWindow[station.id].start,
            setTime:     t,
            durationMin,
            maxElevDeg:  inWindow[station.id].maxElev,
          });
        }
        delete inWindow[station.id];
      }
    }
  }

  return windows.sort((a, b) => a.riseTime - b.riseTime).slice(0, 15);
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const VRule = () => (
  <div className="w-px self-stretch" style={{ background: 'rgba(30,41,59,0.8)' }} />
);

const PanelTitle = ({ children, accent }) => (
  <div
    className="text-[8px] tracking-[0.3em] uppercase mb-3 pb-2 font-mono"
    style={{
      color: accent || '#0891b2',
      borderBottom: `1px solid ${accent ? accent + '30' : 'rgba(8,145,178,0.2)'}`,
    }}
  >
    {children}
  </div>
);

const DataRow = ({ label, value, unit, accent, dim }) => (
  <div className="flex items-baseline justify-between gap-2">
    <span className="text-[8px] tracking-[0.18em] uppercase font-mono" style={{ color: '#334155' }}>
      {label}
    </span>
    <span
      className="text-xs font-bold font-mono tabular-nums"
      style={{ color: dim ? '#475569' : (accent || 'white') }}
    >
      {value ?? '—'}
      {unit && <span className="text-[9px] font-normal ml-0.5" style={{ color: '#334155' }}>{unit}</span>}
    </span>
  </div>
);

const StatusDot = ({ active, color }) => (
  <span className="relative flex h-2 w-2">
    {active && (
      <span
        className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
        style={{ background: color || '#34d399' }}
      />
    )}
    <span
      className="relative inline-flex rounded-full h-2 w-2"
      style={{ background: active ? (color || '#34d399') : '#1e3a5f' }}
    />
  </span>
);

const WindowCard = ({ win }) => {
  const quality = win.maxElevDeg >= 30 ? 'HIGH QUALITY' : win.maxElevDeg >= 10 ? 'MARGINAL' : 'LOW ELEV';
  const qColor  = win.maxElevDeg >= 30 ? '#34d399' : win.maxElevDeg >= 10 ? '#fbbf24' : '#475569';
  const qBg     = win.maxElevDeg >= 30 ? 'rgba(52,211,153,0.08)' : win.maxElevDeg >= 10 ? 'rgba(251,191,36,0.08)' : 'rgba(71,85,105,0.1)';
  const qBorder = win.maxElevDeg >= 30 ? 'rgba(52,211,153,0.2)' : win.maxElevDeg >= 10 ? 'rgba(251,191,36,0.2)' : 'rgba(71,85,105,0.2)';
  const d = new Date(win.riseTime);
  const p = n => String(n).padStart(2, '0');

  return (
    <div className="rounded px-2 py-2" style={{ background: 'rgba(2,6,15,0.6)', border: '1px solid rgba(30,41,59,0.6)' }}>
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[9px] font-bold font-mono text-white truncate" style={{ maxWidth: 120 }}>
          {win.stationName}
        </span>
        <span
          className="text-[7px] tracking-[0.1em] uppercase font-mono px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: qBg, border: `1px solid ${qBorder}`, color: qColor }}
        >
          {quality}
        </span>
      </div>
      <div className="text-[8px] font-mono" style={{ color: '#475569' }}>
        {d.getUTCFullYear()}-{p(d.getUTCMonth()+1)}-{p(d.getUTCDate())} {p(d.getUTCHours())}:{p(d.getUTCMinutes())} UTC
      </div>
      <div className="flex gap-3 mt-1">
        <span className="text-[8px] font-mono" style={{ color: '#334155' }}>{win.durationMin.toFixed(1)} min</span>
        <span className="text-[8px] font-mono" style={{ color: '#334155' }}>max {win.maxElevDeg.toFixed(1)}°</span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const ReboostPlanner = () => {
  const { noradId } = useParams();
  const { getToken } = useAuth();

  // ── Data state ─────────────────────────────────────────────────────────────
  const [satellite, setSatellite]       = useState(null);
  const [tle, setTle]                   = useState(null);
  const [tleDerived, setTleDerived]     = useState(null);
  const [currentPosition, setCurrentPos] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [clockStr, setClockStr]         = useState(utcClock());

  // ── Planning inputs ────────────────────────────────────────────────────────
  const [targetAltKm, setTargetAltKm]     = useState('');
  const [targetAltError, setTargetAltError] = useState('');

  // ── View mode ──────────────────────────────────────────────────────────────
  const [viewMode, setViewMode]           = useState('3d');

  // ── Plan results ───────────────────────────────────────────────────────────
  const [planResult, setPlanResult]     = useState(null);
  const [isPlanning, setIsPlanning]     = useState(false);
  const [hasPlan, setHasPlan]           = useState(false);

  // ── Decay data ─────────────────────────────────────────────────────────────
  const [decayData, setDecayData]       = useState(null);

  // ── Burn windows ───────────────────────────────────────────────────────────
  const [burnWindows, setBurnWindows]       = useState([]);
  const [windowsLoading, setWindowsLoading] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const viewerRef          = useRef(null);
  const imageryLoadedRef   = useRef(false);
  const bordersLoadedRef   = useRef(false);
  const currentTrackRef    = useRef(null); // PolylineCollection primitive
  const reboostTrackRef    = useRef(null); // PolylineCollection primitive
  const burnMarkerRef      = useRef(null);
  const hasAutoCenteredRef = useRef(false);

  // ── Ground stations ────────────────────────────────────────────────────────
  const { stations } = useGroundStations(viewerRef, currentPosition);

  // ── UTC clock ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setClockStr(utcClock()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Imagery — imperative load, run once on mount ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    const tryLoad = () => {
      if (cancelled || imageryLoadedRef.current) return;
      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer) { setTimeout(tryLoad, 100); return; }
      imageryLoadedRef.current = true;
      viewer.imageryLayers.removeAll();
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          credit: 'Tiles © Esri',
          maximumLevel: 19,
        })
      );
      const layer = viewer.imageryLayers.get(0);
      if (layer) {
        layer.brightness = 0.45;
        layer.contrast   = 1.2;
        layer.saturation = 0.4;
        layer.gamma      = 1.1;
      }
    };
    tryLoad();
    return () => { cancelled = true; };
  }, []); // run once on mount only

  // ── Fetch satellite + TLE + tle_derived ────────────────────────────────────
  useEffect(() => {
    const fetch_ = async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const [satRes, derivedRes] = await Promise.all([
          axios.get(`/api/satellite/${noradId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          axios.get(`/api/tle_derived/${noradId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => ({ data: [] })),
        ]);

        const sat = satRes.data;
        setSatellite(sat);

        if (sat.tle_line1 && sat.tle_line2) {
          setTle([sat.tle_line1.trim(), sat.tle_line2.trim()]);
        } else {
          setError('No TLE data available for this satellite.');
          setLoading(false);
          return;
        }

        // Use the most recent tle_derived row for decay prediction
        if (derivedRes.data && derivedRes.data.length > 0) {
          const sorted = [...derivedRes.data].sort((a, b) => new Date(a.epoch) - new Date(b.epoch));
          const latest = sorted[sorted.length - 1];
          setTleDerived(latest);

          const decay = predictDecay(latest, 90);
          if (decay) setDecayData(decay);

          // Pre-populate target altitude = current + 20 km
          const curAlt = parseFloat(latest.altitude_km) || parseFloat(sat.altitude) || 420;
          setTargetAltKm(String(Math.round(curAlt + 20)));
        } else if (sat.altitude) {
          setTargetAltKm(String(Math.round(parseFloat(sat.altitude) + 20)));
        }
      } catch (err) {
        setError(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [noradId, getToken]);

  // ── SGP4 live position — 2s tick ───────────────────────────────────────────
  useEffect(() => {
    if (!tle) return;
    const tick = () => {
      try {
        const info = getSatelliteInfo(tle, Date.now());
        if (info && typeof info.lat === 'number' && !isNaN(info.lat)) {
          setCurrentPos({
            lat:    Cesium.Math.toRadians(info.lat),
            lng:    Cesium.Math.toRadians(info.lng),
            height: (info.height || 420) * 1000,
          });
        }
      } catch {}
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [tle]);

  // ── Draw current orbit track ───────────────────────────────────────────────
  const drawCurrentTrack = useCallback(() => {
    if (!tle || !viewerRef.current?.cesiumElement) return;
    const viewer = viewerRef.current.cesiumElement;

    const periodMin = (() => {
      try {
        const mm = parseFloat(tle[1].slice(52, 63));
        return mm > 0 ? 1440 / mm : 90;
      } catch { return 90; }
    })();

    const positions = computeGroundTrack(tle, Date.now(), periodMin, 30);
    const segments  = splitAtAntimeridian(positions);

    // Remove old primitive collection
    if (currentTrackRef.current) {
      try { viewer.scene.primitives.remove(currentTrackRef.current); } catch {}
      currentTrackRef.current = null;
    }

    // PolylineCollection: direct GPU submit, no async geometry worker
    const col = new Cesium.PolylineCollection();
    viewer.scene.primitives.add(col);
    currentTrackRef.current = col;

    segments.forEach(seg => {
      if (seg.length < 2) return;
      col.add({
        positions: seg,
        width:     2.5,
        material:  Cesium.Material.fromType('PolylineGlow', {
          glowPower: 0.2,
          color:     Cesium.Color.fromCssColorString('#22d3ee').withAlpha(0.6),
        }),
      });
    });
  }, [tle]);

  // ── Initial draw: poll until viewer + scene are ready, then draw ─────────
  useEffect(() => {
    if (!tle) return;
    let cancelled = false;
    const tryDraw = () => {
      if (cancelled) return;
      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer || !viewer.scene) { setTimeout(tryDraw, 200); return; }
      drawCurrentTrack();
    };
    const t = setTimeout(tryDraw, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [tle, drawCurrentTrack]);

  // ── Auto-center once when position first becomes available ─────────────────
  useEffect(() => {
    if (!currentPosition || hasAutoCenteredRef.current) return;
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    hasAutoCenteredRef.current = true;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        currentPosition.lng,
        currentPosition.lat,
        currentPosition.height + 9000000
      ),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch:   Cesium.Math.toRadians(-90),
        roll:    0,
      },
      duration: 1.5,
    });
  }, [currentPosition]);

  // ── GeoJSON coastlines ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentPosition || !viewerRef.current?.cesiumElement) return;
    if (bordersLoadedRef.current) return;
    bordersLoadedRef.current = true;
    const viewer = viewerRef.current.cesiumElement;

    Cesium.GeoJsonDataSource.load(
      'https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson',
      { stroke: Cesium.Color.fromCssColorString('rgba(180,180,180,0.15)'), fill: Cesium.Color.TRANSPARENT, strokeWidth: 0.8 }
    ).then(src => {
      sanitizeGeoJsonSource(src, 'rgba(180,180,180,0.15)');
      viewer.dataSources.add(src);
    }).catch(() => {});
  }, [currentPosition]);

  // ── Plan reboost ───────────────────────────────────────────────────────────
  const handlePlanReboost = useCallback(() => {
    if (!tle || !currentPosition) return;

    const targetAlt  = parseFloat(targetAltKm);
    const currentAlt = currentPosition.height / 1000; // km

    if (isNaN(targetAlt) || targetAlt <= currentAlt) {
      setTargetAltError('Target must be greater than current altitude.');
      return;
    }
    if (targetAlt > 2000) {
      setTargetAltError('Target must be below 2000 km (LEO).');
      return;
    }

    setTargetAltError('');
    setIsPlanning(true);

    setTimeout(() => {
      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer) { setIsPlanning(false); return; }

      // 1. Compute Hohmann delta-v
      const dvResult = computeHohmannDv(currentAlt, targetAlt);

      // 2. Fuel cost (if spacecraft params are set)
      const wet = satellite?.wet_mass_kg ? parseFloat(satellite.wet_mass_kg) : null;
      const dry = satellite?.dry_mass_kg ? parseFloat(satellite.dry_mass_kg) : null;
      const isp = satellite?.isp_s       ? parseFloat(satellite.isp_s)       : null;
      const thr = satellite?.thrust_n    ? parseFloat(satellite.thrust_n)    : null;

      const fuelResult   = (wet && isp) ? computeFuelCost(dvResult.dvTotal_ms, wet, dry, isp) : null;
      const burnDuration = (fuelResult && thr && isp) ? computeBurnDuration(fuelResult.deltaMass_kg, thr, isp) : null;

      // 3. Draw post-reboost orbit on globe (amber at target altitude)
      if (reboostTrackRef.current) {
        try { viewer.scene.primitives.remove(reboostTrackRef.current); } catch {}
        reboostTrackRef.current = null;
      }
      if (burnMarkerRef.current) {
        try { viewer.entities.remove(burnMarkerRef.current); } catch {}
        burnMarkerRef.current = null;
      }

      const periodMin = (() => {
        try { const mm = parseFloat(tle[1].slice(52, 63)); return mm > 0 ? 1440 / mm : 90; }
        catch { return 90; }
      })();

      const trackPositions   = computeGroundTrack(tle, Date.now(), periodMin, 30);
      const reboostPositions = trackPositions.map(p => {
        const cart = Cesium.Cartographic.fromCartesian(p);
        return Cesium.Cartesian3.fromRadians(cart.longitude, cart.latitude, targetAlt * 1000);
      });

      // PolylineCollection: direct GPU submit, no async geometry worker
      const reboostCol = new Cesium.PolylineCollection();
      viewer.scene.primitives.add(reboostCol);
      reboostTrackRef.current = reboostCol;
      splitAtAntimeridian(reboostPositions).forEach(seg => {
        if (seg.length < 2) return;
        reboostCol.add({
          positions: seg,
          width:     2.5,
          material:  Cesium.Material.fromType('PolylineGlow', {
            glowPower: 0.3,
            color:     Cesium.Color.fromCssColorString('#f97316').withAlpha(0.75),
          }),
        });
      });

      // Burn point marker at current position
      try {
        burnMarkerRef.current = viewer.entities.add({
          position: Cesium.Cartesian3.fromRadians(
            currentPosition.lng, currentPosition.lat, currentPosition.height
          ),
          point: {
            pixelSize:    14,
            color:        Cesium.Color.fromCssColorString('#f97316'),
            outlineColor: Cesium.Color.fromCssColorString('#431407'),
            outlineWidth: 2,
          },
          label: {
            text:              `Δv ${dvResult.dv1_ms.toFixed(1)} m/s`,
            font:              'bold 11px "JetBrains Mono", monospace',
            fillColor:         Cesium.Color.fromCssColorString('#fed7aa'),
            outlineColor:      Cesium.Color.BLACK,
            outlineWidth:      2,
            style:             Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin:    Cesium.VerticalOrigin.BOTTOM,
            pixelOffset:       new Cesium.Cartesian2(0, -18),
            showBackground:    true,
            backgroundColor:   Cesium.Color.fromCssColorString('#02060fcc'),
            backgroundPadding: new Cesium.Cartesian2(6, 4),
          },
        });
      } catch {}

      setPlanResult({ dvResult, fuelResult, burnDuration });
      setHasPlan(true);

      // 4. Find burn windows (run in next tick to avoid blocking)
      if (stations.length > 0) {
        setWindowsLoading(true);
        setTimeout(() => {
          try {
            const windows = findBurnWindows(tle, stations, 7);
            setBurnWindows(windows);
          } catch {}
          setWindowsLoading(false);
          setIsPlanning(false);
        }, 50);
      } else {
        setIsPlanning(false);
      }
    }, 100);
  }, [tle, currentPosition, targetAltKm, satellite, stations]);

  // ── Clear plan ─────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (viewer) {
      if (reboostTrackRef.current) {
        try { viewer.scene.primitives.remove(reboostTrackRef.current); } catch {}
        reboostTrackRef.current = null;
      }
      if (burnMarkerRef.current) {
        try { viewer.entities.remove(burnMarkerRef.current); } catch {}
        burnMarkerRef.current = null;
      }
    }
    setPlanResult(null);
    setHasPlan(false);
    setBurnWindows([]);
    drawCurrentTrack();
  }, [drawCurrentTrack]);

  const handleToggleView = useCallback(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;
    if (viewMode === '3d') {
      viewer.scene.morphTo2D(1.0);
      setViewMode('2d');
    } else {
      viewer.scene.morphTo3D(1.0);
      setViewMode('3d');
    }
  }, [viewMode]);

  const handleCenterView = useCallback(() => {
    if (!currentPosition || !viewerRef.current?.cesiumElement) return;
    viewerRef.current.cesiumElement.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        currentPosition.lng,
        currentPosition.lat,
        currentPosition.height + 9000000
      ),
      orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-90), roll: 0.0 },
      duration: 1.8,
    });
  }, [currentPosition]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const altKm = currentPosition ? Math.round(currentPosition.height / 1000) : null;

  const periodMin = tle ? (() => {
    try { const mm = parseFloat(tle[1].slice(52, 63)); return mm > 0 ? (1440 / mm).toFixed(1) : '—'; }
    catch { return '—'; }
  })() : '—';

  const meanMotionDot = tleDerived?.mean_motion_dot ? parseFloat(tleDerived.mean_motion_dot) : null;
  const decayRateLabel = meanMotionDot === null ? '—'
    : Math.abs(meanMotionDot) < 1e-7 ? 'Minimal drag'
    : Math.abs(meanMotionDot) < 1e-5 ? 'Nominal decay'
    : 'Elevated drag';

  // ── Decay chart config ─────────────────────────────────────────────────────
  const decayChartData = decayData ? {
    labels: decayData.points
      .filter((_, i) => i % 6 === 0 || i === decayData.points.length - 1)
      .map(p => `Day ${p.dayOffset}`),
    datasets: [{
      label: 'Altitude (km)',
      data: decayData.points
        .filter((_, i) => i % 6 === 0 || i === decayData.points.length - 1)
        .map(p => parseFloat(p.altKm.toFixed(1))),
      borderColor: '#f97316',
      backgroundColor: 'rgba(249,115,22,0.06)',
      fill: true,
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 0,
    }],
  } : null;

  const decayChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#020617',
        borderColor: 'rgba(249,115,22,0.2)',
        borderWidth: 1,
        titleColor: '#94a3b8',
        bodyColor: '#fbbf24',
        titleFont: { family: '"JetBrains Mono", monospace', size: 9 },
        bodyFont:  { family: '"JetBrains Mono", monospace', size: 10 },
      },
    },
    scales: {
      x: {
        grid:  { color: 'rgba(30,41,59,0.5)' },
        ticks: { color: '#334155', font: { size: 8, family: '"JetBrains Mono", monospace' }, maxTicksLimit: 5 },
      },
      y: {
        grid:  { color: 'rgba(30,41,59,0.5)' },
        ticks: { color: '#475569', font: { size: 8, family: '"JetBrains Mono", monospace' } },
        suggestedMin: 100,
      },
    },
  };

  // ── Loading / error screens ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#02060f]"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        <p className="text-[9px] tracking-[0.3em] text-cyan-700 uppercase animate-pulse">
          Loading reboost planner · {noradId}
        </p>
      </div>
    );
  }

  if (error || !satellite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#02060f]"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        <div className="flex flex-col items-center gap-4">
          <p className="text-sm text-red-400 font-mono">{error || 'No satellite data.'}</p>
          <Link to={`/satellite/${noradId}`}
            className="px-4 py-2 border border-slate-700 rounded text-[10px] font-mono text-slate-400 hover:text-cyan-400 transition-all tracking-widest uppercase">
            ← Back
          </Link>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div
      className="relative w-full h-screen overflow-hidden"
      style={{ background: '#02060f', fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
    >
      {/* Slider thumb style */}
      <style>{`
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #f97316;
          border: 2px solid #02060f;
          cursor: pointer;
          box-shadow: 0 0 6px rgba(249,115,22,0.5);
        }
      `}</style>

      {/* ── Globe ──────────────────────────────────────────────────────────── */}
      <Viewer
        ref={viewerRef}
        full
        infoBox={false}
        selectionIndicator={false}
        baseLayerPicker={false}
        geocoder={false}
        homeButton={false}
        sceneModePicker={false}
        navigationHelpButton={false}
        timeline={false}
        animation={false}
        requestRenderMode={false}
        backgroundColor={Cesium.Color.BLACK}
      >
        {currentPosition && (
          <Entity
            name={satellite.name}
            position={Cesium.Cartesian3.fromRadians(
              currentPosition.lng, currentPosition.lat, currentPosition.height
            )}
            point={{
              pixelSize:    11,
              color:        Cesium.Color.fromCssColorString('#34d399'),
              outlineColor: Cesium.Color.fromCssColorString('#052e16'),
              outlineWidth: 2,
            }}
            label={{
              text:              satellite.name,
              font:              'bold 11px "JetBrains Mono", monospace',
              fillColor:         Cesium.Color.fromCssColorString('#a7f3d0'),
              outlineColor:      Cesium.Color.BLACK,
              outlineWidth:      2,
              style:             Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin:    Cesium.VerticalOrigin.BOTTOM,
              pixelOffset:       new Cesium.Cartesian2(0, -16),
              showBackground:    true,
              backgroundColor:   Cesium.Color.fromCssColorString('#02060fcc'),
              backgroundPadding: new Cesium.Cartesian2(6, 4),
            }}
          />
        )}
      </Viewer>

      {/* Scanline overlay */}
      <div className="pointer-events-none absolute inset-0 z-10" style={{
        background: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.02) 2px,rgba(0,0,0,0.02) 4px)',
      }} />

      {/* Corner brackets */}
      {['top-0 left-0','top-0 right-0','bottom-0 left-0','bottom-0 right-0'].map(pos => (
        <div key={pos} className={`pointer-events-none absolute ${pos} z-20`}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            {pos.includes('left')  && pos.includes('top')    && (<><line x1="0" y1="0" x2="20" y2="0" stroke="#22d3ee" strokeOpacity="0.25" strokeWidth="1"/><line x1="0" y1="0" x2="0" y2="20" stroke="#22d3ee" strokeOpacity="0.25" strokeWidth="1"/></>)}
            {pos.includes('right') && pos.includes('top')    && (<><line x1="0" y1="0" x2="20" y2="0" stroke="#22d3ee" strokeOpacity="0.25" strokeWidth="1"/><line x1="20" y1="0" x2="20" y2="20" stroke="#22d3ee" strokeOpacity="0.25" strokeWidth="1"/></>)}
            {pos.includes('left')  && pos.includes('bottom') && (<><line x1="0" y1="20" x2="20" y2="20" stroke="#22d3ee" strokeOpacity="0.25" strokeWidth="1"/><line x1="0" y1="0" x2="0" y2="20" stroke="#22d3ee" strokeOpacity="0.25" strokeWidth="1"/></>)}
            {pos.includes('right') && pos.includes('bottom') && (<><line x1="0" y1="20" x2="20" y2="20" stroke="#22d3ee" strokeOpacity="0.25" strokeWidth="1"/><line x1="20" y1="0" x2="20" y2="20" stroke="#22d3ee" strokeOpacity="0.25" strokeWidth="1"/></>)}
          </svg>
        </div>
      ))}

      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div
        className="absolute top-0 left-0 right-0 z-30 px-5 pt-3.5 pb-3 flex items-center justify-between"
        style={{ background: 'rgba(2,6,23,0.7)', borderBottom: '1px solid rgba(30,41,59,0.5)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3">
          <StatusDot active color="#f97316" />
          <span className="text-[9px] tracking-[0.22em] uppercase font-mono" style={{ color: '#f97316' }}>Reboost</span>
          <VRule />
          <span className="text-[9px] tracking-[0.18em] uppercase font-mono" style={{ color: '#334155' }}>OrbitIQ</span>
          <VRule />
          <span className="text-[9px] tracking-[0.18em] uppercase font-mono" style={{ color: '#334155' }}>Reboost Planner</span>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 text-center">
          <div className="text-xs font-bold text-white tracking-[0.15em] uppercase font-mono">{satellite.name}</div>
          <div className="text-[9px] tracking-[0.18em] font-mono" style={{ color: '#334155' }}>NORAD {noradId}</div>
        </div>

        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[8px] tracking-[0.2em] uppercase font-mono" style={{ color: '#1e3a5f' }}>UTC</span>
          <span className="text-xs font-bold font-mono" style={{ color: '#22d3ee' }}>{clockStr.replace(' UTC', '')}</span>
        </div>
      </div>

      {/* ── Viewer Nav ───────────────────────────────────────────────────── */}
      <div
        className="absolute z-30 flex items-center gap-1"
        style={{
          top: 52,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(2,6,15,0.85)',
          border: '1px solid rgba(30,41,59,0.6)',
          borderRadius: 8,
          padding: '4px',
          backdropFilter: 'blur(12px)',
        }}
      >
        <Link
          to={`/satellite/${noradId}`}
          className="px-3 py-1.5 rounded text-[9px] tracking-[0.18em] uppercase font-mono transition-all"
          style={{ color: '#475569' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
        >
          ← Overview
        </Link>
        <div style={{ width: 1, height: 14, background: 'rgba(30,41,59,0.8)' }} />
        <Link
          to={`/satellite/${noradId}/digital-twin`}
          className="px-3 py-1.5 rounded text-[9px] tracking-[0.18em] uppercase font-mono transition-all"
          style={{ color: '#475569' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
        >
          ⌖ Mission Control
        </Link>
        <Link
          to={`/satellite/${noradId}/reboost`}
          className="px-3 py-1.5 rounded text-[9px] tracking-[0.18em] uppercase font-mono"
          style={{ background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.35)', color: '#f97316' }}
        >
          ↑ Reboost Planner
        </Link>
        <Link
          to={`/satellite/${noradId}/maneuver`}
          className="px-3 py-1.5 rounded text-[9px] tracking-[0.18em] uppercase font-mono transition-all"
          style={{ color: '#475569' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
        >
          ◎ Maneuver Sim
        </Link>
        <Link
          to={`/satellite/${noradId}/lifetime`}
          className="px-3 py-1.5 rounded text-[9px] tracking-[0.18em] uppercase font-mono transition-all"
          style={{ color: '#475569' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#34d399')}
          onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
        >
          ⟳ Lifetime Forecast
        </Link>
      </div>

      {/* ── Left panel ─────────────────────────────────────────────────────── */}
      <div
        className="absolute left-4 z-30 flex flex-col gap-2"
        style={{ top: '60px', width: 220, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}
      >
        {/* Orbital state */}
        <div className="rounded-lg px-3 py-3" style={{
          background: 'rgba(2,6,23,0.88)', border: '1px solid rgba(34,211,238,0.12)', backdropFilter: 'blur(12px)',
        }}>
          <PanelTitle>Orbital State</PanelTitle>
          <div className="flex flex-col gap-2">
            <DataRow label="Altitude"   value={altKm}     unit="km"  accent="#34d399" />
            <DataRow label="Period"     value={periodMin} unit="min" accent="#38bdf8" />
            <DataRow label="Orbit Type" value={satellite.orbit_type || '—'} accent="#a78bfa" />
          </div>
        </div>

        {/* Decay status */}
        {(() => {
          const soonReentry = decayData?.reentryDate && (decayData.reentryDate - Date.now()) < 30 * 86400 * 1000;
          return (
            <div className="rounded-lg px-3 py-3" style={{
              background: 'rgba(2,6,23,0.88)',
              border: soonReentry ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(30,41,59,0.6)',
              backdropFilter: 'blur(12px)',
            }}>
              <PanelTitle accent={soonReentry ? '#ef4444' : undefined}>Decay Status</PanelTitle>
              <div className="flex flex-col gap-2">
                <DataRow
                  label="Mean Motion Dot"
                  value={meanMotionDot != null ? meanMotionDot.toExponential(2) : '—'}
                  accent="#f97316"
                />
                <DataRow label="Drag Rate" value={decayRateLabel} accent="#f97316" />
                {decayData ? (
                  decayData.reentryDate ? (
                    <div className="mt-1">
                      <div className="text-[7px] tracking-[0.2em] uppercase font-mono mb-0.5" style={{ color: '#334155' }}>
                        Projected Reentry
                      </div>
                      <div className="text-xs font-bold font-mono" style={{ color: soonReentry ? '#ef4444' : '#fbbf24' }}>
                        {decayData.reentryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      {soonReentry && (
                        <div className="mt-1.5 px-2 py-1 rounded text-[7px] tracking-[0.12em] uppercase font-mono"
                          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                          ⚠ Reentry within 30 days
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-[8px] font-mono mt-1" style={{ color: '#334155' }}>
                      Stable — no reentry in 90 days
                    </div>
                  )
                ) : (
                  <div className="text-[8px] font-mono mt-1" style={{ color: '#1e3a5f' }}>
                    No orbital history available
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Reboost parameters input */}
        <div className="rounded-lg px-3 py-3" style={{
          background: 'rgba(2,6,23,0.88)', border: '1px solid rgba(249,115,22,0.18)', backdropFilter: 'blur(12px)',
        }}>
          <PanelTitle accent="#f97316">Reboost Parameters</PanelTitle>
          <div className="flex flex-col gap-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[8px] tracking-[0.2em] uppercase font-mono" style={{ color: '#475569' }}>
                  Target Altitude
                </span>
                <span className="text-[8px] font-mono" style={{ color: '#334155' }}>km</span>
              </div>
              <input
                type="number"
                min={altKm ? altKm + 1 : 200}
                max={2000}
                step={1}
                value={targetAltKm}
                onChange={e => { setTargetAltKm(e.target.value); setTargetAltError(''); }}
                className="w-full bg-transparent font-mono text-sm text-white placeholder-slate-700 px-3 py-2 rounded"
                style={{
                  border: targetAltError ? '1px solid rgba(239,68,68,0.5)' : '1px solid rgba(30,41,59,0.8)',
                  outline: 'none',
                }}
                onFocus={e  => { e.target.style.borderColor = 'rgba(249,115,22,0.4)'; }}
                onBlur={e   => { e.target.style.borderColor = targetAltError ? 'rgba(239,68,68,0.5)' : 'rgba(30,41,59,0.8)'; }}
              />
              {targetAltError && (
                <p className="text-[8px] font-mono mt-1" style={{ color: '#ef4444' }}>{targetAltError}</p>
              )}
              {altKm && targetAltKm && !targetAltError && parseFloat(targetAltKm) > altKm && (
                <p className="text-[8px] font-mono mt-1" style={{ color: '#334155' }}>
                  +{(parseFloat(targetAltKm) - altKm).toFixed(0)} km raise
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handlePlanReboost}
                disabled={isPlanning}
                className="flex-1 py-2 rounded text-[10px] tracking-[0.15em] uppercase font-mono font-bold transition-all"
                style={isPlanning ? {
                  background: 'rgba(2,6,23,0.6)',
                  border: '1px solid rgba(30,41,59,0.4)',
                  color: '#1e3a5f',
                  cursor: 'not-allowed',
                } : {
                  background: 'rgba(249,115,22,0.2)',
                  border: '1px solid rgba(249,115,22,0.4)',
                  color: '#f97316',
                }}
                onMouseEnter={e => { if (!isPlanning) e.currentTarget.style.background = 'rgba(249,115,22,0.35)'; }}
                onMouseLeave={e => { if (!isPlanning) e.currentTarget.style.background = 'rgba(249,115,22,0.2)'; }}
              >
                {isPlanning ? '◌ Planning…' : '↑ Plan Reboost'}
              </button>
              {hasPlan && (
                <button
                  onClick={handleClear}
                  className="px-3 py-2 rounded text-[10px] font-mono transition-all"
                  style={{ background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(30,41,59,0.6)', color: '#475569' }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Track legend */}
        <div className="rounded-lg px-3 py-2.5" style={{
          background: 'rgba(2,6,23,0.88)', border: '1px solid rgba(30,41,59,0.6)', backdropFilter: 'blur(12px)',
        }}>
          <PanelTitle>Track Legend</PanelTitle>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="h-px flex-shrink-0" style={{ width: 18, background: 'rgba(34,211,238,0.6)', boxShadow: '0 0 4px rgba(34,211,238,0.3)' }} />
              <span className="text-[8px] font-mono" style={{ color: '#475569' }}>Current orbit</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-px flex-shrink-0" style={{ width: 18, background: 'rgba(249,115,22,0.75)', boxShadow: '0 0 4px rgba(249,115,22,0.3)' }} />
              <span className="text-[8px] font-mono" style={{ color: hasPlan ? '#475569' : '#1e3a5f' }}>Post-reboost orbit</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#34d399' }} />
              <span className="text-[8px] font-mono" style={{ color: '#475569' }}>Current position</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#f97316' }} />
              <span className="text-[8px] font-mono" style={{ color: hasPlan ? '#475569' : '#1e3a5f' }}>Burn point</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────────────── */}
      <div
        className="absolute right-4 z-30 flex flex-col gap-2"
        style={{ top: '60px', width: 280, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}
      >
        {/* 90-day decay forecast chart */}
        <div className="rounded-lg px-3 py-3" style={{
          background: 'rgba(2,6,23,0.88)', border: '1px solid rgba(249,115,22,0.12)', backdropFilter: 'blur(12px)',
        }}>
          <PanelTitle accent="#f97316">90-Day Altitude Forecast</PanelTitle>
          {decayChartData ? (
            <div style={{ height: 160, position: 'relative' }}>
              <Line data={decayChartData} options={decayChartOptions} />
              <div style={{
                position: 'absolute', bottom: 8, right: 4,
                fontSize: '8px', fontFamily: '"JetBrains Mono", monospace',
                color: 'rgba(239,68,68,0.4)',
              }}>
                — Kármán 100 km
              </div>
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-[8px] font-mono" style={{ color: '#1e3a5f' }}>
                No orbital history — forecast unavailable.
              </p>
              <p className="text-[8px] font-mono mt-1" style={{ color: '#0f172a' }}>
                History accumulates over time as TLEs are ingested.
              </p>
            </div>
          )}
        </div>

        {/* Delta-v budget */}
        <div className="rounded-lg px-3 py-3" style={{
          background: 'rgba(2,6,23,0.88)',
          border: `1px solid ${hasPlan ? 'rgba(249,115,22,0.25)' : 'rgba(30,41,59,0.6)'}`,
          backdropFilter: 'blur(12px)',
          transition: 'border-color 0.3s',
        }}>
          <PanelTitle accent={hasPlan ? '#f97316' : undefined}>
            {hasPlan ? 'Delta-v Budget' : 'Awaiting Plan'}
          </PanelTitle>

          {!hasPlan ? (
            <p className="text-[9px] font-mono" style={{ color: '#1e3a5f' }}>
              Enter a target altitude and press Plan Reboost.
            </p>
          ) : planResult ? (
            <div className="flex flex-col gap-2">
              <div className="rounded px-2 py-1.5 mb-1" style={{
                background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.15)',
              }}>
                <div className="text-[7px] tracking-[0.2em] uppercase font-mono mb-1" style={{ color: '#7c2d12' }}>
                  Hohmann Transfer
                </div>
                <div className="text-xs font-black font-mono" style={{ color: '#f97316' }}>
                  +{(parseFloat(targetAltKm) - altKm).toFixed(0)}
                  <span className="text-[10px] font-normal ml-1" style={{ color: '#7c2d12' }}>km</span>
                </div>
              </div>

              <DataRow label="Δv₁ Perigee Kick"     value={planResult.dvResult.dv1_ms.toFixed(2)}     unit="m/s" accent="#fbbf24" />
              <DataRow label="Δv₂ Apogee Kick"      value={planResult.dvResult.dv2_ms.toFixed(2)}     unit="m/s" accent="#fbbf24" />
              <DataRow label="Δv Total (Hohmann)"   value={planResult.dvResult.dvTotal_ms.toFixed(2)} unit="m/s" accent="#f97316" />

              <div style={{ height: 1, background: 'rgba(30,41,59,0.6)' }} />

              {planResult.fuelResult ? (
                <>
                  <DataRow label="Fuel Required"  value={planResult.fuelResult.deltaMass_kg.toFixed(3)} unit="kg" accent="#fbbf24" />
                  {planResult.fuelResult.remainingPropellant_kg != null && (
                    <DataRow
                      label="Fuel Remaining"
                      value={planResult.fuelResult.remainingPropellant_kg.toFixed(3)}
                      unit="kg"
                      accent={planResult.fuelResult.feasible ? '#34d399' : '#ef4444'}
                    />
                  )}
                  {planResult.burnDuration != null && (
                    <DataRow label="Burn Duration" value={planResult.burnDuration.toFixed(1)} unit="s" accent="#fbbf24" />
                  )}
                  <div className="mt-1">
                    <span
                      className="text-[7px] tracking-[0.15em] uppercase font-mono px-2 py-1 rounded"
                      style={planResult.fuelResult.feasible ? {
                        background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', color: '#34d399',
                      } : {
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444',
                      }}
                    >
                      {planResult.fuelResult.feasible ? '✓ FEASIBLE' : '✗ INSUFFICIENT PROPELLANT'}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <DataRow label="Fuel Cost" value="—" dim />
                  <p className="text-[7px] font-mono mt-0.5" style={{ color: '#1e3a5f' }}>
                    <Link to={`/satellite/${noradId}`} style={{ color: '#0891b2' }}>
                      Add spacecraft params →
                    </Link>
                  </p>
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Burn contact windows */}
        <div className="rounded-lg px-3 py-3" style={{
          background: 'rgba(2,6,23,0.88)',
          border: `1px solid ${burnWindows.length > 0 ? 'rgba(52,211,153,0.15)' : 'rgba(30,41,59,0.6)'}`,
          backdropFilter: 'blur(12px)',
          transition: 'border-color 0.3s',
        }}>
          <PanelTitle accent={burnWindows.length > 0 ? '#34d399' : undefined}>
            Contact Windows · 7 Days
          </PanelTitle>

          {windowsLoading ? (
            <p className="text-[9px] font-mono animate-pulse" style={{ color: '#0891b2' }}>
              Scanning 7-day window…
            </p>
          ) : stations.length === 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[9px] font-mono" style={{ color: '#1e3a5f' }}>
                No ground stations configured.
              </p>
              <Link
                to="/ground-stations"
                className="text-[8px] font-mono tracking-widest uppercase transition-colors"
                style={{ color: '#0891b2' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#22d3ee')}
                onMouseLeave={e => (e.currentTarget.style.color = '#0891b2')}
              >
                Configure stations →
              </Link>
            </div>
          ) : !hasPlan ? (
            <p className="text-[9px] font-mono" style={{ color: '#1e3a5f' }}>
              Plan a reboost to scan contact windows.
            </p>
          ) : burnWindows.length === 0 ? (
            <p className="text-[9px] font-mono" style={{ color: '#1e3a5f' }}>
              No passes found in the next 7 days.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5" style={{ maxHeight: 280, overflowY: 'auto' }}>
              {burnWindows.map((win, i) => <WindowCard key={i} win={win} />)}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom bar ─────────────────────────────────────────────────────── */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
        <button
          onClick={handleToggleView}
          className="px-4 py-2 rounded text-[10px] tracking-[0.18em] uppercase font-mono transition-all"
          style={viewMode === '2d' ? {
            background: 'rgba(34,211,238,0.2)',
            border: '1px solid rgba(34,211,238,0.5)',
            color: '#22d3ee',
          } : {
            background: 'rgba(2,6,15,0.85)',
            border: '1px solid rgba(30,41,59,0.6)',
            color: '#475569',
          }}
          onMouseEnter={e => { if (viewMode === '3d') e.currentTarget.style.color = '#94a3b8'; }}
          onMouseLeave={e => { if (viewMode === '3d') e.currentTarget.style.color = '#475569'; }}
        >
          {viewMode === '3d' ? '⊞ Ground Track' : '⊙ 3D Globe'}
        </button>
        <button
          onClick={handleCenterView}
          className="px-4 py-2 rounded text-[10px] tracking-[0.18em] uppercase font-mono transition-all"
          style={{ background: 'rgba(2,6,15,0.85)', border: '1px solid rgba(30,41,59,0.6)', color: '#475569' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
        >
          ⊕ Center View
        </button>
      </div>
    </div>
  );
};

export default ReboostPlanner;
