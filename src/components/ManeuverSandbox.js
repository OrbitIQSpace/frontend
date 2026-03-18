// src/pages/ManeuverSandbox.js
// Maneuver Simulation Sandbox — standalone page with own Cesium globe
// Route: /satellite/:noradId/maneuver

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from '../api';
import { useAuth } from '@clerk/clerk-react';
import { Viewer, Entity } from 'resium';
import * as Cesium from 'cesium';
import { getSatelliteInfo } from 'tle.js';
import useGroundStations, { isSatVisible } from '../hooks/useGroundStations';

Cesium.Ion.defaultAccessToken = process.env.REACT_APP_CESIUM_TOKEN || '';

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

const utcClock = () => {
  const d = new Date();
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
};

// Compute ground track positions from a TLE starting at startMs,
// for durationMin minutes, sampling every stepSec seconds.
const computeGroundTrack = (tle, startMs, durationMin, stepSec = 30) => {
  const positions = [];
  const steps = Math.floor((durationMin * 60) / stepSec);
  for (let i = 0; i <= steps; i++) {
    const t = startMs + i * stepSec * 1000;
    try {
      const info = getSatelliteInfo(tle, t);
      if (info && typeof info.lat === 'number' && !isNaN(info.lat)) {
        positions.push(Cesium.Cartesian3.fromDegrees(info.lng, info.lat, 10000));
      }
    } catch {}
  }
  return positions;
};

// Split polyline at antimeridian crossings
const splitAtAntimeridian = (positions) => {
  if (!positions.length) return [];
  const segments = [];
  let current = [positions[0]];
  for (let i = 1; i < positions.length; i++) {
    const prevLng = Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(positions[i - 1]).longitude);
    const currLng = Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(positions[i]).longitude);
    if (Math.abs(currLng - prevLng) > 180) {
      segments.push(current);
      current = [positions[i]];
    } else {
      current.push(positions[i]);
    }
  }
  segments.push(current);
  return segments;
};

// ─────────────────────────────────────────────────────────────────────────────
// Maneuver math
// ─────────────────────────────────────────────────────────────────────────────

// Get the satellite's ECI velocity vector at a given time from TLE.
// tle.js doesn't expose raw ECI vectors directly, so we approximate the
// velocity direction by computing two positions 1 second apart.
const getVelocityVector = (tle, timeMs) => {
  try {
    const p1 = getSatelliteInfo(tle, timeMs);
    const p2 = getSatelliteInfo(tle, timeMs + 1000);
    if (!p1 || !p2) return null;

    const c1 = Cesium.Cartesian3.fromDegrees(p1.lng, p1.lat, (p1.height || 420) * 1000);
    const c2 = Cesium.Cartesian3.fromDegrees(p2.lng, p2.lat, (p2.height || 420) * 1000);

    const vel = Cesium.Cartesian3.subtract(c2, c1, new Cesium.Cartesian3());
    return Cesium.Cartesian3.normalize(vel, new Cesium.Cartesian3());
  } catch {
    return null;
  }
};

// Get radial unit vector (from Earth center toward satellite)
const getRadialVector = (tle, timeMs) => {
  try {
    const info = getSatelliteInfo(tle, timeMs);
    if (!info) return null;
    const pos = Cesium.Cartesian3.fromDegrees(info.lng, info.lat, (info.height || 420) * 1000);
    return Cesium.Cartesian3.normalize(pos, new Cesium.Cartesian3());
  } catch {
    return null;
  }
};

// Apply a ΔV burn to the current orbit at burnTimeMs.
// Returns a synthetic "post-burn" TLE approximation by computing the
// new position/velocity and deriving new orbital elements.
// Since tle.js doesn't accept arbitrary state vectors, we simulate the
// post-burn orbit by computing offset ground track positions directly.
const simulateManeuver = (tle, burnTimeMs, dvMs, direction) => {
  const results = [];
  const periodMin = (() => {
    try {
      const mm = parseFloat(tle[1].slice(52, 63));
      return mm > 0 ? 1440 / mm : 90;
    } catch { return 90; }
  })();

  // Get velocity and radial unit vectors at burn time
  const velUnit    = getVelocityVector(tle, burnTimeMs);
  const radUnit    = getRadialVector(tle, burnTimeMs);
  if (!velUnit || !radUnit) return null;


  // For each point in the post-burn ground track, offset the height
  // proportionally to simulate the new orbit shape.
  // This is a first-order approximation: prograde/retrograde raises/lowers
  // the opposite side of the orbit (apogee/perigee effect).
  const burnInfo = getSatelliteInfo(tle, burnTimeMs);
  if (!burnInfo) return null;
  const burnAlt = (burnInfo.height || 420) * 1000; // m

  // ΔV → Δv/v → fractional semi-major axis change via vis-viva
  // v_circ ≈ sqrt(GM/r), Δa/a ≈ 2*Δv/v for prograde
  const GM = 3.986e14;
  const r  = 6371000 + burnAlt;
  const vCirc = Math.sqrt(GM / r); // m/s
  const scaledDv = dvMs; // already in m/s

  // For prograde: raises apogee by ~2*Δv/v * r on opposite side
  const altChangeMagnitude = (2 * scaledDv / vCirc) * r; // meters

  // Compute the post-burn ground track by walking forward from burn time
  const stepSec = 30;
  const steps = Math.floor((periodMin * 60) / stepSec);

  for (let i = 0; i <= steps; i++) {
    const t = burnTimeMs + i * stepSec * 1000;
    try {
      const info = getSatelliteInfo(tle, t);
      if (!info || typeof info.lat !== 'number' || isNaN(info.lat)) continue;

      // Compute the angular position in the orbit (0=burn point, π=opposite)
      // We approximate this using the fraction of the period elapsed
      const fraction = (i * stepSec) / (periodMin * 60); // 0→1 over one orbit
      const angle    = fraction * 2 * Math.PI;

      // Height offset: sin(angle) peaks at quarter-orbit, creating the
      // classic elliptical shape change for prograde/retrograde burns
      let heightOffset = 0;
      if (direction === 'prograde') {
        heightOffset = altChangeMagnitude * Math.sin(angle);
      } else if (direction === 'retrograde') {
        heightOffset = -altChangeMagnitude * Math.sin(angle);
      } else if (direction === 'radial+' || direction === 'radial-') {
        // Radial burns primarily change eccentricity, smaller altitude effect
        const sign = direction === 'radial+' ? 1 : -1;
        heightOffset = sign * (altChangeMagnitude * 0.5) * Math.cos(angle);
      }

      const newHeight = Math.max(200000, (info.height || 420) * 1000 + heightOffset);
      results.push(Cesium.Cartesian3.fromDegrees(info.lng, info.lat, newHeight + 10000));
    } catch {}
  }

  // Compute result metrics
  const currentAltKm = (burnInfo.height || 420);

  const perigeeChange = direction === 'prograde'  ? 0
                      : direction === 'retrograde' ? -altChangeMagnitude / 1000
                      : 0;
  const apogeeChange  = direction === 'prograde'  ? altChangeMagnitude / 1000
                      : direction === 'retrograde' ? 0
                      : (altChangeMagnitude * 0.5) / 1000;

  const newPeriodMin = periodMin * Math.pow(1 + (direction === 'prograde' ? 1 : -1) * scaledDv / vCirc, 3);

  return {
    positions: results,
    metrics: {
      dvMs,
      direction,
      apogeeChangekm:    apogeeChange.toFixed(1),
      perigeeChangekm:   perigeeChange.toFixed(1),
      newApogeeKm:       (currentAltKm + apogeeChange).toFixed(0),
      newPerigeeKm:      (currentAltKm + perigeeChange).toFixed(0),
      currentAltKm:      currentAltKm.toFixed(0),
      newPeriodMin:      newPeriodMin.toFixed(1),
      originalPeriodMin: periodMin.toFixed(1),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const VRule = () => <div className="w-px self-stretch" style={{ background: 'rgba(30,41,59,0.8)' }} />;

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
      {value ?? '—'}{unit && <span className="text-[9px] font-normal ml-0.5" style={{ color: '#334155' }}>{unit}</span>}
    </span>
  </div>
);

const SliderInput = ({ label, value, min, max, step, unit, onChange }) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center justify-between">
      <span className="text-[8px] tracking-[0.2em] uppercase font-mono" style={{ color: '#475569' }}>
        {label}
      </span>
      <span className="text-xs font-bold font-mono tabular-nums text-white">
        {value}<span className="text-[9px] font-normal ml-0.5" style={{ color: '#334155' }}>{unit}</span>
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="w-full h-1 rounded-full appearance-none cursor-pointer"
      style={{
        background: `linear-gradient(to right, #0891b2 0%, #0891b2 ${((value - min) / (max - min)) * 100}%, rgba(30,41,59,0.8) ${((value - min) / (max - min)) * 100}%, rgba(30,41,59,0.8) 100%)`,
        outline: 'none',
      }}
    />
  </div>
);

const DirectionButton = ({ label, sub, value, active, onClick }) => (
  <button
    onClick={() => onClick(value)}
    className="flex-1 py-2 px-1 rounded text-center transition-all"
    style={active ? {
      background: 'rgba(8,145,178,0.25)',
      border: '1px solid rgba(34,211,238,0.45)',
      color: '#22d3ee',
    } : {
      background: 'rgba(2,6,23,0.6)',
      border: '1px solid rgba(30,41,59,0.6)',
      color: '#475569',
    }}
  >
    <div className="text-[9px] font-bold font-mono tracking-wide">{label}</div>
    {sub && <div className="text-[7px] font-mono mt-0.5" style={{ color: active ? '#0891b2' : '#1e3a5f' }}>{sub}</div>}
  </button>
);

const StatusDot = ({ active, color }) => (
  <span className="relative flex h-2 w-2">
    {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: color || '#34d399' }} />}
    <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: active ? (color || '#34d399') : '#1e3a5f' }} />
  </span>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

const ManeuverSandbox = () => {
  const { noradId } = useParams();
  const { getToken } = useAuth();

  // ── Data state ─────────────────────────────────────────────────────────────
  const [satellite, setSatellite]         = useState(null);
  const [tle, setTle]                     = useState(null);
  const [currentPosition, setCurrentPos] = useState(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [clockStr, setClockStr]           = useState(utcClock());

  // ── Maneuver inputs ────────────────────────────────────────────────────────
  const [burnTimeMin, setBurnTimeMin]     = useState(15);  // T+ minutes from now
  const [dvMs, setDvMs]                   = useState(10);   // m/s
  const [direction, setDirection]         = useState('prograde');

  // ── Simulation state ───────────────────────────────────────────────────────
  const [simResult, setSimResult]         = useState(null);  // { positions, metrics }
  const [isSimulating, setIsSimulating]   = useState(false);
  const [hasSimulated, setHasSimulated]   = useState(false);

  // ── View mode ──────────────────────────────────────────────────────────────
  const [viewMode, setViewMode]           = useState('3d');

  // ── Refs ───────────────────────────────────────────────────────────────────
  const viewerRef          = useRef(null);
  const imageryLoadedRef   = useRef(false);
  const bordersLoadedRef   = useRef(false);
  const currentTrackRef    = useRef(null); // PolylineCollection primitive
  const simTrackRef        = useRef(null); // PolylineCollection primitive
  const burnMarkerRef      = useRef(null);
  const hasAutoCenteredRef = useRef(false);

  // ── Ground stations ───────────────────────────────────────────────────────
  const { stations } = useGroundStations(viewerRef, currentPosition);

  // Burn-window visibility: which stations can see the satellite at burn time?
  const [burnVisibility, setBurnVisibility] = useState([]); // [{ station, visible }]

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

  // ── Fetch satellite + TLE ──────────────────────────────────────────────────
  useEffect(() => {
    const fetch_ = async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const res   = await axios.get(`/api/satellite/${noradId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSatellite(res.data);
        if (res.data.tle_line1 && res.data.tle_line2) {
          setTle([res.data.tle_line1.trim(), res.data.tle_line2.trim()]);
        } else {
          setError('No TLE data available.');
        }
      } catch (err) {
        setError(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [noradId, getToken]);

  // ── SGP4 live position — 2 s tick ─────────────────────────────────────────
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
      src.entities.values.forEach(e => {
        if (e.polyline) {
          e.polyline.clampToGround = false;
          e.polyline.arcType = new Cesium.ConstantProperty(Cesium.ArcType.NONE);
        }
      });
      viewer.dataSources.add(src);
    }).catch(() => {});
  }, [currentPosition]);

  // ── Run simulation ─────────────────────────────────────────────────────────
  const handleSimulate = useCallback(() => {
    if (!tle || !viewerRef.current?.cesiumElement) return;
    setIsSimulating(true);

    setTimeout(() => {
      const viewer     = viewerRef.current.cesiumElement;
      const burnTimeMs = Date.now() + burnTimeMin * 60 * 1000;

      // Always redraw current orbit first so both tracks are visible
      drawCurrentTrack();

      // Remove old sim collection
      if (simTrackRef.current) {
        try { viewer.scene.primitives.remove(simTrackRef.current); } catch {}
        simTrackRef.current = null;
      }
      if (burnMarkerRef.current) {
        try { viewer.entities.remove(burnMarkerRef.current); } catch {}
        burnMarkerRef.current = null;
      }

      // Run simulation
      const result = simulateManeuver(tle, burnTimeMs, dvMs, direction);
      if (!result) { setIsSimulating(false); return; }

      const segments = splitAtAntimeridian(result.positions);

      // Draw simulated orbit in red (PolylineCollection: direct GPU, no worker)
      const simCol = new Cesium.PolylineCollection();
      viewer.scene.primitives.add(simCol);
      simTrackRef.current = simCol;
      segments.forEach((seg, idx) => {
        if (seg.length < 2) return;
        simCol.add({
          positions: seg,
          width:     idx === 0 ? 3 : 2,
          material:  Cesium.Material.fromType('PolylineGlow', {
            glowPower: 0.4,
            color:     Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.85),
          }),
        });
      });

      // Draw burn point marker
      try {
        const burnInfo = getSatelliteInfo(tle, burnTimeMs);
        if (burnInfo) {
          burnMarkerRef.current = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(
              burnInfo.lng, burnInfo.lat, (burnInfo.height || 420) * 1000
            ),
            point: {
              pixelSize:    14,
              color:        Cesium.Color.fromCssColorString('#f97316'),
              outlineColor: Cesium.Color.fromCssColorString('#431407'),
              outlineWidth: 2,
            },
            label: {
              text:              `ΔV ${dvMs} m/s`,
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
        }
      } catch {}

      setSimResult(result);
      setHasSimulated(true);

      // Compute which ground stations have visibility at burn time
      if (stations.length > 0) {
        try {
          const burnInfo = getSatelliteInfo(tle, burnTimeMs);
          if (burnInfo) {
            const visibility = stations.map(station => ({
              station,
              visible: isSatVisible(
                parseFloat(station.latitude),
                parseFloat(station.longitude),
                burnInfo.lat,
                burnInfo.lng,
                (burnInfo.height || 420) * 1000,
                parseFloat(station.elevation_mask_deg)
              ),
            }));
            setBurnVisibility(visibility);
          }
        } catch {}
      }

      setIsSimulating(false);
    }, 300); // small delay for the "calculating" feel
  }, [tle, burnTimeMin, dvMs, direction, drawCurrentTrack, stations]);

  // ── Clear simulation ───────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    if (!viewerRef.current?.cesiumElement) return;
    const viewer = viewerRef.current.cesiumElement;
    if (simTrackRef.current) {
      try { viewer.scene.primitives.remove(simTrackRef.current); } catch {}
      simTrackRef.current = null;
    }
    if (burnMarkerRef.current) {
      try { viewer.entities.remove(burnMarkerRef.current); } catch {}
      burnMarkerRef.current = null;
    }
    setSimResult(null);
    setHasSimulated(false);
    setBurnVisibility([]);
    // Ensure current orbit track is still visible after clearing
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
    try {
      const mm = parseFloat(tle[1].slice(52, 63));
      return mm > 0 ? (1440 / mm).toFixed(1) : '—';
    } catch { return '—'; }
  })() : '—';

  const burnTimeLabel = (() => {
    const d = new Date(Date.now() + burnTimeMin * 60 * 1000);
    return `T+${burnTimeMin}min · ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  })();

  // ── Loading / error screens ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#02060f]"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        <div className="flex flex-col items-center gap-3">
          <p className="text-[9px] tracking-[0.3em] text-cyan-700 uppercase animate-pulse">
            Loading maneuver sandbox · {noradId}
          </p>
        </div>
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
          background: #22d3ee;
          border: 2px solid #02060f;
          cursor: pointer;
          box-shadow: 0 0 6px rgba(34,211,238,0.5);
        }
        input[type=range]::-moz-range-thumb {
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #22d3ee;
          border: 2px solid #02060f;
          cursor: pointer;
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
        {/* Live satellite dot */}
        {currentPosition && (
          <Entity
            name={satellite.name}
            position={Cesium.Cartesian3.fromRadians(
              currentPosition.lng,
              currentPosition.lat,
              currentPosition.height
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
          <span className="text-[9px] tracking-[0.22em] uppercase font-mono" style={{ color: '#f97316' }}>Sandbox</span>
          <VRule />
          <span className="text-[9px] tracking-[0.18em] uppercase font-mono" style={{ color: '#334155' }}>OrbitIQ</span>
          <VRule />
          <span className="text-[9px] tracking-[0.18em] uppercase font-mono" style={{ color: '#334155' }}>Maneuver Simulation</span>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 text-center">
          <div className="text-xs font-bold text-white tracking-[0.15em] uppercase font-mono">
            {satellite.name}
          </div>
          <div className="text-[9px] tracking-[0.18em] font-mono" style={{ color: '#334155' }}>
            NORAD {noradId}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-[8px] tracking-[0.2em] uppercase font-mono" style={{ color: '#1e3a5f' }}>UTC</span>
            <span className="text-xs font-bold font-mono" style={{ color: '#22d3ee' }}>{clockStr.replace(' UTC','')}</span>
          </div>
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
          className="px-3 py-1.5 rounded text-[9px] tracking-[0.18em] uppercase font-mono transition-all"
          style={{ color: '#475569' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
        >
          ↑ Reboost Planner
        </Link>
        <Link
          to={`/satellite/${noradId}/maneuver`}
          className="px-3 py-1.5 rounded text-[9px] tracking-[0.18em] uppercase font-mono"
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444' }}
        >
          ◎ Maneuver Sim
        </Link>
      </div>

      {/* ── Left panel: Maneuver Inputs ────────────────────────────────────── */}
      <div
        className="absolute left-4 z-30 flex flex-col gap-2"
        style={{ top: '60px', width: 210, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}
      >
        {/* Current orbit stats */}
        <div className="rounded-lg px-3 py-3" style={{
          background: 'rgba(2,6,23,0.88)',
          border: '1px solid rgba(34,211,238,0.12)',
          backdropFilter: 'blur(12px)',
        }}>
          <PanelTitle>Current Orbit</PanelTitle>
          <div className="flex flex-col gap-2">
            <DataRow label="Altitude"   value={altKm}      unit="km"  accent="#34d399" />
            <DataRow label="Period"     value={periodMin}  unit="min" accent="#38bdf8" />
            <DataRow label="Orbit Type" value={satellite.orbit_type || '—'} accent="#a78bfa" />
          </div>
        </div>

        {/* Burn parameters */}
        <div className="rounded-lg px-3 py-3" style={{
          background: 'rgba(2,6,23,0.88)',
          border: '1px solid rgba(249,115,22,0.18)',
          backdropFilter: 'blur(12px)',
        }}>
          <PanelTitle accent="#f97316">Burn Parameters</PanelTitle>
          <div className="flex flex-col gap-4">

            <SliderInput
              label="Burn Time"
              value={burnTimeMin}
              min={1} max={120} step={1}
              unit="min"
              onChange={v => { setBurnTimeMin(v); handleClear(); }}
            />
            <div className="text-[8px] font-mono -mt-2" style={{ color: '#1e3a5f' }}>
              {burnTimeLabel}
            </div>

            <SliderInput
              label="ΔV Magnitude"
              value={dvMs}
              min={1} max={100} step={1}
              unit="m/s"
              onChange={v => { setDvMs(v); handleClear(); }}
            />

            <div>
              <span className="text-[8px] tracking-[0.2em] uppercase font-mono block mb-2" style={{ color: '#475569' }}>
                Burn Direction
              </span>
              <div className="flex gap-1">
                <DirectionButton label="PRO"  sub="Raise"  value="prograde"   active={direction==='prograde'}   onClick={d => { setDirection(d); handleClear(); }} />
                <DirectionButton label="RETRO" sub="Lower" value="retrograde" active={direction==='retrograde'} onClick={d => { setDirection(d); handleClear(); }} />
                <DirectionButton label="RAD+"  sub="Ecc↑"  value="radial+"    active={direction==='radial+'}    onClick={d => { setDirection(d); handleClear(); }} />
                <DirectionButton label="RAD-"  sub="Ecc↓"  value="radial-"    active={direction==='radial-'}    onClick={d => { setDirection(d); handleClear(); }} />
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="rounded-lg px-3 py-2.5" style={{
          background: 'rgba(2,6,23,0.88)',
          border: '1px solid rgba(30,41,59,0.6)',
          backdropFilter: 'blur(12px)',
        }}>
          <PanelTitle>Track Legend</PanelTitle>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="h-px flex-shrink-0" style={{ width: 18, background: 'rgba(34,211,238,0.6)', boxShadow: '0 0 4px rgba(34,211,238,0.3)' }} />
              <span className="text-[8px] font-mono" style={{ color: '#475569' }}>Current orbit</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-px flex-shrink-0" style={{ width: 18, background: 'rgba(239,68,68,0.85)', boxShadow: '0 0 4px rgba(239,68,68,0.4)' }} />
              <span className="text-[8px] font-mono" style={{ color: hasSimulated ? '#475569' : '#1e3a5f' }}>
                Post-maneuver orbit
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#34d399' }} />
              <span className="text-[8px] font-mono" style={{ color: '#475569' }}>Current position</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#f97316' }} />
              <span className="text-[8px] font-mono" style={{ color: hasSimulated ? '#475569' : '#1e3a5f' }}>
                Burn point
              </span>
            </div>
          </div>
        </div>

        {/* Run Simulation + Clear */}
        <div className="flex flex-col gap-2 mt-1">
          {hasSimulated && (
            <button
              onClick={handleClear}
              className="w-full px-4 py-2 rounded text-[10px] tracking-[0.18em] uppercase font-mono transition-all"
              style={{ background: 'rgba(2,6,23,0.88)', border: '1px solid rgba(30,41,59,0.6)', color: '#475569' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
              onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
            >
              ✕ Clear Simulation
            </button>
          )}
          <button
            onClick={handleSimulate}
            disabled={isSimulating}
            className="w-full px-4 py-2 rounded text-[10px] tracking-[0.18em] uppercase font-mono font-bold transition-all"
            style={isSimulating ? {
              background: 'rgba(2,6,23,0.6)',
              border: '1px solid rgba(30,41,59,0.4)',
              color: '#1e3a5f',
              cursor: 'not-allowed',
            } : {
              background: 'rgba(239,68,68,0.2)',
              border: '1px solid rgba(239,68,68,0.4)',
              color: '#ef4444',
            }}
            onMouseEnter={e => { if (!isSimulating) e.currentTarget.style.background = 'rgba(239,68,68,0.35)'; }}
            onMouseLeave={e => { if (!isSimulating) e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; }}
          >
            {isSimulating ? '◌ Calculating…' : '▶ Run Simulation'}
          </button>
        </div>
      </div>

      {/* ── Right panel: Simulation Results ────────────────────────────────── */}
      <div
        className="absolute right-4 z-30 flex flex-col gap-2"
        style={{ top: '60px', width: 200 }}
      >
        <div className="rounded-lg px-3 py-3" style={{
          background: 'rgba(2,6,23,0.88)',
          border: `1px solid ${hasSimulated ? 'rgba(239,68,68,0.25)' : 'rgba(30,41,59,0.6)'}`,
          backdropFilter: 'blur(12px)',
          transition: 'border-color 0.3s',
        }}>
          <PanelTitle accent={hasSimulated ? '#ef4444' : undefined}>
            {hasSimulated ? 'Simulation Results' : 'Awaiting Simulation'}
          </PanelTitle>

          {!hasSimulated ? (
            <div className="flex flex-col gap-2 py-2">
              <p className="text-[9px] font-mono leading-relaxed" style={{ color: '#1e3a5f' }}>
                Configure burn parameters and press Run Simulation to see the projected post-maneuver orbit.
              </p>
            </div>
          ) : simResult ? (
            <div className="flex flex-col gap-2.5">
              {/* Burn summary chip */}
              <div
                className="rounded px-2 py-1.5 mb-1"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}
              >
                <div className="text-[7px] tracking-[0.2em] uppercase font-mono mb-1" style={{ color: '#7f1d1d' }}>
                  Burn · {direction.toUpperCase()}
                </div>
                <div className="text-sm font-black font-mono" style={{ color: '#ef4444' }}>
                  {dvMs} <span className="text-[10px] font-normal" style={{ color: '#7f1d1d' }}>m/s</span>
                </div>
              </div>

              {/* Current altitude reference */}
              <DataRow label="Burn Alt." value={simResult.metrics.currentAltKm} unit="km" dim />

              <div style={{ height: 1, background: 'rgba(30,41,59,0.6)' }} />

              {/* Apogee — new absolute + delta */}
              <div className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[8px] tracking-[0.18em] uppercase font-mono" style={{ color: '#334155' }}>Apogee</span>
                  <span className="text-xs font-bold font-mono tabular-nums" style={{ color: '#34d399' }}>
                    {simResult.metrics.newApogeeKm}<span className="text-[9px] font-normal ml-0.5" style={{ color: '#334155' }}>km</span>
                  </span>
                </div>
                <div className="flex justify-end">
                  <span className="text-[8px] font-mono tabular-nums" style={{
                    color: parseFloat(simResult.metrics.apogeeChangekm) >= 0 ? '#166534' : '#991b1b'
                  }}>
                    {parseFloat(simResult.metrics.apogeeChangekm) >= 0 ? '▲' : '▼'} {Math.abs(simResult.metrics.apogeeChangekm)} km
                  </span>
                </div>
              </div>

              {/* Perigee — new absolute + delta */}
              <div className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[8px] tracking-[0.18em] uppercase font-mono" style={{ color: '#334155' }}>Perigee</span>
                  <span className="text-xs font-bold font-mono tabular-nums" style={{ color: '#38bdf8' }}>
                    {simResult.metrics.newPerigeeKm}<span className="text-[9px] font-normal ml-0.5" style={{ color: '#334155' }}>km</span>
                  </span>
                </div>
                <div className="flex justify-end">
                  <span className="text-[8px] font-mono tabular-nums" style={{
                    color: parseFloat(simResult.metrics.perigeeChangekm) >= 0 ? '#166534' : '#991b1b'
                  }}>
                    {parseFloat(simResult.metrics.perigeeChangekm) !== 0
                      ? `${parseFloat(simResult.metrics.perigeeChangekm) >= 0 ? '▲' : '▼'} ${Math.abs(simResult.metrics.perigeeChangekm)} km`
                      : '— unchanged'}
                  </span>
                </div>
              </div>

              <div style={{ height: 1, background: 'rgba(30,41,59,0.6)' }} />

              {/* Period */}
              <DataRow label="New Period"   value={simResult.metrics.newPeriodMin}      unit="min" accent="#a78bfa" />
              <DataRow label="Orig. Period" value={simResult.metrics.originalPeriodMin} unit="min" dim />

              <div style={{ height: 1, background: 'rgba(30,41,59,0.6)' }} />
              {(() => {
                const { wet_mass_kg, isp_s, thrust_n } = satellite || {};
                if (wet_mass_kg && isp_s) {
                  const G0 = 9.80665;
                  const dv = simResult.metrics.dvMs;
                  const fuelKg = parseFloat(wet_mass_kg) * (1 - Math.exp(-dv / (parseFloat(isp_s) * G0)));
                  const massFlowKgs = thrust_n ? parseFloat(thrust_n) / (parseFloat(isp_s) * G0) : null;
                  const burnSec = massFlowKgs ? fuelKg / massFlowKgs : null;
                  return (
                    <>
                      <DataRow label="Fuel Cost" value={fuelKg.toFixed(3)} unit="kg" accent="#fbbf24" />
                      {burnSec != null && (
                        <DataRow label="Burn Duration" value={burnSec.toFixed(1)} unit="s" accent="#fbbf24" />
                      )}
                    </>
                  );
                }
                return (
                  <>
                    <DataRow label="Fuel Cost" value="—" dim />
                    <p className="text-[7px] font-mono" style={{ color: '#1e3a5f' }}>
                      Add spacecraft params to enable fuel calculation
                    </p>
                  </>
                );
              })()}
            </div>
          ) : null}
        </div>

        {/* Spacecraft params */}
        <div className="rounded-lg px-3 py-3" style={{
          background: 'rgba(2,6,23,0.6)',
          border: satellite?.wet_mass_kg
            ? '1px solid rgba(34,211,238,0.15)'
            : '1px dashed rgba(30,41,59,0.5)',
          backdropFilter: 'blur(12px)',
        }}>
          <PanelTitle>Spacecraft Params</PanelTitle>
          <div className="flex flex-col gap-2">
            <DataRow label="Wet Mass" value={satellite?.wet_mass_kg  ?? '—'} unit={satellite?.wet_mass_kg  ? 'kg' : ''} dim={!satellite?.wet_mass_kg} />
            <DataRow label="Dry Mass" value={satellite?.dry_mass_kg  ?? '—'} unit={satellite?.dry_mass_kg  ? 'kg' : ''} dim={!satellite?.dry_mass_kg} />
            <DataRow label="Isp"      value={satellite?.isp_s        ?? '—'} unit={satellite?.isp_s        ? 's'  : ''} dim={!satellite?.isp_s} />
            <DataRow label="Thrust"   value={satellite?.thrust_n     ?? '—'} unit={satellite?.thrust_n     ? 'N'  : ''} dim={!satellite?.thrust_n} />
            {!satellite?.wet_mass_kg && (
              <p className="text-[7px] font-mono mt-1" style={{ color: '#1e3a5f' }}>
                Set params in Satellite Details → Spacecraft tab
              </p>
            )}
          </div>
        </div>

        {/* Ground station burn-window visibility */}
        <div className="rounded-lg px-3 py-3" style={{
          background: 'rgba(2,6,23,0.88)',
          border: `1px solid ${hasSimulated && burnVisibility.some(b => b.visible) ? 'rgba(52,211,153,0.2)' : 'rgba(30,41,59,0.6)'}`,
          backdropFilter: 'blur(12px)',
          transition: 'border-color 0.3s',
        }}>
          <PanelTitle accent="#22d3ee">Ground Contact · Burn</PanelTitle>

          {stations.length === 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-[9px] font-mono leading-relaxed" style={{ color: '#1e3a5f' }}>
                No ground stations configured.
              </p>
              <Link
                to="/ground-stations"
                className="text-[8px] font-mono tracking-widest uppercase transition-colors"
                style={{ color: '#0891b2' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#22d3ee')}
                onMouseLeave={e => (e.currentTarget.style.color = '#0891b2')}
              >
                Add stations →
              </Link>
            </div>
          ) : !hasSimulated ? (
            <p className="text-[9px] font-mono" style={{ color: '#1e3a5f' }}>
              Run simulation to check ground contact at burn time.
            </p>
          ) : burnVisibility.length === 0 ? (
            <p className="text-[9px] font-mono" style={{ color: '#1e3a5f' }}>
              Could not compute visibility.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {burnVisibility.map(({ station, visible }) => (
                <div key={station.id} className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-mono truncate" style={{ color: '#64748b', maxWidth: 110 }}>
                    {station.name}
                  </span>
                  <span
                    className="text-[7px] tracking-[0.15em] uppercase font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                    style={visible ? {
                      background: 'rgba(52,211,153,0.12)',
                      border: '1px solid rgba(52,211,153,0.3)',
                      color: '#34d399',
                    } : {
                      background: 'rgba(100,116,139,0.1)',
                      border: '1px solid rgba(100,116,139,0.2)',
                      color: '#475569',
                    }}
                  >
                    {visible ? '● In Range' : '○ No Contact'}
                  </span>
                </div>
              ))}
              <p className="text-[7px] font-mono mt-1" style={{ color: '#1e3a5f' }}>
                At T+{burnTimeMin}min · {burnTimeLabel.split(' · ')[1]}
              </p>
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

export default ManeuverSandbox;