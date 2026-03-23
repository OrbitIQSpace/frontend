// src/components/MissionControl.js — Mission Control Viewer
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from '../api';
import { useAuth } from '@clerk/clerk-react';
import { Viewer, Entity } from 'resium';
import * as Cesium from 'cesium';
import { getSatelliteInfo } from 'tle.js';
import useGroundStations from '../hooks/useGroundStations';
import { sanitizeGeoJsonSource } from '../utils/cesiumUtils';

Cesium.Ion.defaultAccessToken = process.env.REACT_APP_CESIUM_TOKEN || '';

// ── Utilities ────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');

const utcClock = () => {
  const d = new Date();
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
};

const formatDeg = (rad, posLabel, negLabel) => {
  const deg = Cesium.Math.toDegrees(rad);
  return `${Math.abs(deg).toFixed(4)}° ${deg >= 0 ? posLabel : negLabel}`;
};

// ── SGP4 ground track computation ────────────────────────────────────────────
const computeGroundTrack = (tle, startMs, durationMin, stepSec = 30) => {
  const positions = [];
  const steps = Math.floor((durationMin * 60) / stepSec);
  for (let i = 0; i <= steps; i++) {
    const t = startMs + i * stepSec * 1000;
    try {
      const info = getSatelliteInfo(tle, t);
      if (info && typeof info.lat === 'number' && !isNaN(info.lat)) {
        positions.push(Cesium.Cartesian3.fromDegrees(info.lng, info.lat, 8000));
      }
    } catch {}
  }
  return positions;
};

// Split a polyline at antimeridian crossings
const splitAtAntimeridian = (positions) => {
  if (!positions.length) return [];
  const segments = [];
  let current = [positions[0]];
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    const prevLng = Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(prev).longitude);
    const currLng = Cesium.Math.toDegrees(Cesium.Cartographic.fromCartesian(curr).longitude);
    if (Math.abs(currLng - prevLng) > 180) {
      segments.push(current);
      current = [curr];
    } else {
      current.push(curr);
    }
  }
  segments.push(current);
  return segments;
};

// ── Sub-components ───────────────────────────────────────────────────────────

const StatusDot = ({ active }) => (
  <span className="relative flex h-2 w-2">
    {active && (
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
    )}
    <span className={`relative inline-flex rounded-full h-2 w-2 ${active ? 'bg-emerald-400' : 'bg-slate-600'}`} />
  </span>
);

const DataBlock = ({ label, value, unit, accent = 'text-white' }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[8px] font-mono tracking-[0.22em] uppercase text-slate-500">{label}</span>
    <span className={`text-sm font-mono font-semibold leading-none ${accent}`}>
      {value ?? '—'}
      {unit && <span className="text-[9px] font-normal text-slate-600 ml-0.5">{unit}</span>}
    </span>
  </div>
);

const VRule = () => <div className="w-px self-stretch bg-slate-800" />;

const Panel = ({ children, className = '', dashed = false }) => (
  <div
    className={`rounded px-3 py-3 ${className}`}
    style={{
      background: 'rgba(2,6,15,0.85)',
      border: `1px ${dashed ? 'dashed' : 'solid'} rgba(34,211,238,${dashed ? '0.08' : '0.14'})`,
      backdropFilter: 'blur(12px)',
    }}
  >
    {children}
  </div>
);

const PanelTitle = ({ children }) => (
  <div className="text-[8px] tracking-[0.28em] text-cyan-700 uppercase mb-3 pb-1.5 border-b border-cyan-900/40 font-mono">
    {children}
  </div>
);

const FullScreen = ({ children }) => (
  <div
    className="min-h-screen flex items-center justify-center bg-[#02060f]"
    style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
  >
    <div className="flex flex-col items-center gap-3">{children}</div>
  </div>
);

const ScanLine = () => (
  <div className="w-48 h-px bg-gradient-to-r from-transparent via-cyan-500/60 to-transparent" />
);

// ── Main ─────────────────────────────────────────────────────────────────────

const MissionControl = () => {
  const { noradId } = useParams();
  const { getToken } = useAuth();

  const [satellite, setSatellite]             = useState(null);
  const [tle, setTle]                         = useState(null);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState(null);
  const [clockStr, setClockStr]               = useState(utcClock());
  const [uptime, setUptime]                   = useState(0);
  const [viewMode, setViewMode]               = useState('3d');

  const trackEntitiesRef   = useRef([]);
  const viewerRef          = useRef(null);
  const bordersLoadedRef   = useRef(false);
  const mountTimeRef       = useRef(Date.now());
  const hasAutoCenteredRef = useRef(false);
  const imageryLoadedRef   = useRef(false);

  // ── Ground stations ───────────────────────────────────────────────────────
  const { stations } = useGroundStations(viewerRef, currentPosition);

  // ── Imagery: imperative load after viewer mounts ──────────────────────────
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
          credit: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
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

  // ── UTC clock + session timer ─────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setClockStr(utcClock());
      setUptime(Math.floor((Date.now() - mountTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // ── Fetch satellite + TLE ─────────────────────────────────────────────────
  useEffect(() => {
    const fetch_ = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const res = await axios.get(`/api/satellite/${noradId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setSatellite(res.data);
        if (res.data.tle_line1 && res.data.tle_line2) {
          setTle([res.data.tle_line1.trim(), res.data.tle_line2.trim()]);
        } else {
          setError('No TLE data available for this satellite.');
        }
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'Failed to load satellite.');
      } finally {
        setLoading(false);
      }
    };
    fetch_();
  }, [noradId, getToken]);

  // ── SGP4 live position — 1.5 s tick ──────────────────────────────────────
  useEffect(() => {
    if (!tle) return;
    const tick = () => {
      try {
        const info = getSatelliteInfo(tle, Date.now());
        if (info && typeof info.lat === 'number' && !isNaN(info.lat)) {
          setCurrentPosition({
            lat:      Cesium.Math.toRadians(info.lat),
            lng:      Cesium.Math.toRadians(info.lng),
            height:   (info.height || 420) * 1000,
            velocity: info.velocity || 7.66,
          });
        }
      } catch (e) {
        console.error('SGP4 error:', e);
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => clearInterval(id);
  }, [tle]);

  // ── Ground track computation + redraw ─────────────────────────────────────
  const drawGroundTrack = useCallback(() => {
    if (!tle || !viewerRef.current?.cesiumElement) return;
    const viewer = viewerRef.current.cesiumElement;
    const now    = Date.now();

    let periodMin = 90;
    try {
      const meanMotion = parseFloat(tle[1].slice(52, 63));
      if (meanMotion > 0) periodMin = 1440 / meanMotion;
    } catch {}

    const pastPositions   = computeGroundTrack(tle, now - 15 * 60 * 1000, 15, 20);
    const futurePositions = computeGroundTrack(tle, now, periodMin, 30);

    const pastSegments   = splitAtAntimeridian(pastPositions);
    const futureSegments = splitAtAntimeridian(futurePositions);

    // Remove old primitive collections — bypasses geometry worker entirely
    trackEntitiesRef.current.forEach(col => { try { viewer.scene.primitives.remove(col); } catch {} });
    trackEntitiesRef.current = [];

    // Past track — yellow (PolylineCollection: direct GPU, no async worker)
    const pastCol = new Cesium.PolylineCollection();
    viewer.scene.primitives.add(pastCol);
    pastSegments.forEach(seg => {
      if (seg.length < 2) return;
      pastCol.add({
        positions: seg,
        width:     3.5,
        material:  Cesium.Material.fromType('PolylineGlow', {
          glowPower: 0.3,
          color:     Cesium.Color.fromCssColorString('#fbbf24').withAlpha(0.75),
        }),
      });
    });
    trackEntitiesRef.current.push(pastCol);

    // Future track — bright cyan
    const futureCol = new Cesium.PolylineCollection();
    viewer.scene.primitives.add(futureCol);
    futureSegments.forEach((seg, idx) => {
      if (seg.length < 2) return;
      futureCol.add({
        positions: seg,
        width:     idx === 0 ? 3.5 : 2.5,
        material:  Cesium.Material.fromType('PolylineGlow', {
          glowPower: idx === 0 ? 0.45 : 0.2,
          color:     Cesium.Color.fromCssColorString('#22d3ee').withAlpha(idx === 0 ? 0.92 : 0.55),
        }),
      });
    });
    trackEntitiesRef.current.push(futureCol);
  }, [tle]);

  // ── GeoJSON coastlines — once ─────────────────────────────────────────────
  useEffect(() => {
    if (!currentPosition || !viewerRef.current?.cesiumElement) return;
    if (bordersLoadedRef.current) return;
    bordersLoadedRef.current = true;

    const viewer = viewerRef.current.cesiumElement;

    Cesium.GeoJsonDataSource.load(
      'https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson',
      { stroke: Cesium.Color.fromCssColorString('rgba(180,180,180,0.18)'), fill: Cesium.Color.TRANSPARENT, strokeWidth: 0.8 }
    ).then(coastlines => {
      sanitizeGeoJsonSource(coastlines, 'rgba(180,180,180,0.18)');
      viewer.dataSources.add(coastlines);
    }).catch(err => console.warn('GeoJSON load failed:', err));
  }, [currentPosition]);

  // ── Camera: center on satellite from directly above ───────────────────────
  const handleCenterView = useCallback(() => {
    if (!currentPosition || !viewerRef.current?.cesiumElement) return;
    viewerRef.current.cesiumElement.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        currentPosition.lng,
        currentPosition.lat,
        currentPosition.height + 9000000
      ),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch:   Cesium.Math.toRadians(-90),
        roll:    0.0,
      },
      duration: 1.8,
    });
  }, [currentPosition]);

  // ── Initial draw: poll until viewer + scene are ready, then draw ─────────
  useEffect(() => {
    if (!tle) return;
    let cancelled = false;
    const tryDraw = () => {
      if (cancelled) return;
      const viewer = viewerRef.current?.cesiumElement;
      if (!viewer || !viewer.scene) { setTimeout(tryDraw, 200); return; }
      drawGroundTrack();
    };
    const t = setTimeout(tryDraw, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [tle, drawGroundTrack]);

  // ── Periodic ground track redraw every 60 s ────────────────────────────────
  useEffect(() => {
    if (!tle) return;
    const id = setInterval(() => drawGroundTrack(), 60 * 1000);
    return () => clearInterval(id);
  }, [tle, drawGroundTrack]);

  // ── Auto-center once when position first becomes available ─────────────────
  useEffect(() => {
    if (!currentPosition || hasAutoCenteredRef.current) return;
    if (!viewerRef.current?.cesiumElement) return;
    hasAutoCenteredRef.current = true;
    handleCenterView();
  }, [currentPosition, handleCenterView]);

  // ── View mode toggle — 3D ↔ 2D ───────────────────────────────────────────
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

  // ── Derived display values ────────────────────────────────────────────────
  const altKm     = currentPosition ? Math.round(currentPosition.height / 1000) : null;
  const velKms    = currentPosition ? currentPosition.velocity.toFixed(2) : null;
  const latStr    = currentPosition ? formatDeg(currentPosition.lat, 'N', 'S') : null;
  const lngStr    = currentPosition ? formatDeg(currentPosition.lng, 'E', 'W') : null;
  const orbPeriod = altKm
    ? ((2 * Math.PI * Math.sqrt(Math.pow((6371 + altKm) * 1000, 3) / 3.986e14)) / 60).toFixed(1)
    : null;

  const inclination  = satellite?.inclination  ? `${parseFloat(satellite.inclination).toFixed(2)}°`  : null;
  const eccentricity = satellite?.eccentricity ? parseFloat(satellite.eccentricity).toFixed(6)        : null;
  const perigee      = satellite?.perigee      ? `${parseFloat(satellite.perigee).toFixed(0)} km`     : null;
  const apogee       = satellite?.apogee       ? `${parseFloat(satellite.apogee).toFixed(0)} km`      : null;
  const orbitType    = satellite?.orbit_type   || null;

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <FullScreen>
        <span className="text-[9px] tracking-[0.3em] text-cyan-700 uppercase font-mono">
          OrbitIQ · Mission Control
        </span>
        <ScanLine />
        <span className="text-xs text-cyan-400 animate-pulse tracking-[0.2em] font-mono">
          ESTABLISHING UPLINK · {noradId}
        </span>
        <ScanLine />
      </FullScreen>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !satellite) {
    return (
      <FullScreen>
        <span className="text-[9px] tracking-[0.3em] text-red-700 uppercase font-mono">UPLINK FAILURE</span>
        <p className="text-sm text-red-400 font-mono text-center max-w-xs">
          {error || 'No satellite data available.'}
        </p>
        <button
          onClick={() => window.history.back()}
          className="mt-4 px-5 py-2 border border-slate-700 hover:border-cyan-700 rounded text-[10px] font-mono text-slate-400 hover:text-cyan-400 transition-all tracking-[0.2em] uppercase"
        >
          ← Back
        </button>
      </FullScreen>
    );
  }

  // ── Propagating ───────────────────────────────────────────────────────────
  if (!currentPosition) {
    return (
      <FullScreen>
        <span className="text-[9px] tracking-[0.3em] text-cyan-700 uppercase font-mono">TLE Acquired</span>
        <ScanLine />
        <span className="text-xs text-cyan-400 animate-pulse tracking-[0.2em] font-mono">PROPAGATING ORBIT…</span>
      </FullScreen>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div
      className="relative w-full h-screen bg-[#02060f] overflow-hidden"
      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace" }}
    >
      {/* Globe */}
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
            font:              'bold 12px "JetBrains Mono", monospace',
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
      </Viewer>

      {/* Scanline overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.025) 2px,rgba(0,0,0,0.025) 4px)',
        }}
      />

      {/* Corner brackets */}
      {['top-0 left-0', 'top-0 right-0', 'bottom-0 left-0', 'bottom-0 right-0'].map((pos) => (
        <div key={pos} className={`pointer-events-none absolute ${pos} z-20`}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            {pos.includes('left')  && pos.includes('top')    && (<><line x1="0"  y1="0"  x2="20" y2="0"  stroke="#22d3ee" strokeOpacity="0.35" strokeWidth="1" /><line x1="0" y1="0" x2="0" y2="20" stroke="#22d3ee" strokeOpacity="0.35" strokeWidth="1" /></>)}
            {pos.includes('right') && pos.includes('top')    && (<><line x1="0"  y1="0"  x2="20" y2="0"  stroke="#22d3ee" strokeOpacity="0.35" strokeWidth="1" /><line x1="20" y1="0" x2="20" y2="20" stroke="#22d3ee" strokeOpacity="0.35" strokeWidth="1" /></>)}
            {pos.includes('left')  && pos.includes('bottom') && (<><line x1="0"  y1="20" x2="20" y2="20" stroke="#22d3ee" strokeOpacity="0.35" strokeWidth="1" /><line x1="0" y1="0" x2="0" y2="20" stroke="#22d3ee" strokeOpacity="0.35" strokeWidth="1" /></>)}
            {pos.includes('right') && pos.includes('bottom') && (<><line x1="0"  y1="20" x2="20" y2="20" stroke="#22d3ee" strokeOpacity="0.35" strokeWidth="1" /><line x1="20" y1="0" x2="20" y2="20" stroke="#22d3ee" strokeOpacity="0.35" strokeWidth="1" /></>)}
          </svg>
        </div>
      ))}

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-30 px-5 pt-3.5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <StatusDot active />
            <span className="text-[9px] tracking-[0.22em] text-emerald-500 uppercase font-mono">Live</span>
          </div>
          <VRule />
          <span className="text-[9px] tracking-[0.18em] text-slate-600 uppercase font-mono">OrbitIQ</span>
          <VRule />
          <span className="text-[9px] tracking-[0.18em] text-slate-600 uppercase font-mono">Mission Control</span>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2 text-center">
          <div className="text-xs font-bold text-white tracking-[0.15em] uppercase font-mono">
            {satellite.name}
          </div>
          <div className="text-[9px] text-slate-600 tracking-[0.18em] font-mono">
            NORAD ID {noradId}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <DataBlock label="UTC"     value={clockStr} accent="text-cyan-300" />
          <VRule />
          <DataBlock label="Session" value={`${pad(Math.floor(uptime / 60))}:${pad(uptime % 60)}`} accent="text-slate-500" />
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
          className="px-3 py-1.5 rounded text-[9px] tracking-[0.18em] uppercase font-mono"
          style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399' }}
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
          className="px-3 py-1.5 rounded text-[9px] tracking-[0.18em] uppercase font-mono transition-all"
          style={{ color: '#475569' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
        >
          ◎ Maneuver Sim
        </Link>
      </div>

      {/* ── Left panel: State Vector ─────────────────────────────────────── */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-30" style={{ width: 176 }}>
        <Panel>
          <PanelTitle>State Vector · SGP4</PanelTitle>
          <div className="flex flex-col gap-3.5">
            <DataBlock label="Latitude"    value={latStr}    accent="text-white" />
            <DataBlock label="Longitude"   value={lngStr}    accent="text-white" />
            <DataBlock label="Altitude"    value={altKm}     unit="km"   accent="text-emerald-400" />
            <DataBlock label="Velocity"    value={velKms}    unit="km/s" accent="text-yellow-400" />
            <DataBlock label="Orb. Period" value={orbPeriod} unit="min"  accent="text-sky-400" />
          </div>
        </Panel>

        {/* Ground track legend */}
        <div
          className="mt-2 rounded px-3 py-2.5"
          style={{
            background: 'rgba(2,6,15,0.85)',
            border: '1px solid rgba(34,211,238,0.14)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div className="text-[8px] tracking-[0.28em] text-cyan-700 uppercase mb-2.5 pb-1.5 border-b border-cyan-900/40 font-mono">
            Ground Track
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="h-px flex-shrink-0" style={{ width: 20, background: 'rgba(34,211,238,0.65)', boxShadow: '0 0 4px rgba(34,211,238,0.4)' }} />
              <span className="text-[8px] text-slate-500 font-mono">Next orbit</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-px flex-shrink-0" style={{ width: 20, background: 'rgba(251,191,36,0.75)', boxShadow: '0 0 4px rgba(251,191,36,0.4)' }} />
              <span className="text-[8px] text-slate-500 font-mono">Past 15 min</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#34d399' }} />
              <span className="text-[8px] text-slate-500 font-mono">Current position</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel: Orbital params + upcoming ───────────────────────── */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2" style={{ width: 176 }}>
        {(inclination || eccentricity || perigee || apogee || orbitType) && (
          <Panel>
            <PanelTitle>Orbital Parameters</PanelTitle>
            <div className="flex flex-col gap-3.5">
              {orbitType    && <DataBlock label="Orbit Type"   value={orbitType}    accent="text-cyan-300" />}
              {inclination  && <DataBlock label="Inclination"  value={inclination}  accent="text-slate-300" />}
              {eccentricity && <DataBlock label="Eccentricity" value={eccentricity} accent="text-slate-300" />}
              {perigee      && <DataBlock label="Perigee"      value={perigee}      accent="text-slate-300" />}
              {apogee       && <DataBlock label="Apogee"       value={apogee}       accent="text-slate-300" />}
            </div>
          </Panel>
        )}

        {/* Ground stations indicator */}
        <div
          className="rounded px-3 py-2.5"
          style={{ background: 'rgba(2,6,15,0.85)', border: '1px solid rgba(34,211,238,0.14)', backdropFilter: 'blur(12px)' }}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[8px] tracking-[0.28em] text-cyan-700 uppercase mb-0.5 font-mono">Ground Stations</div>
              <div className="text-xs font-bold text-white font-mono">
                {stations.length}
                <span className="text-[9px] font-normal text-slate-600 ml-1">configured</span>
              </div>
            </div>
            <Link
              to="/ground-stations"
              className="text-[8px] tracking-widest uppercase font-mono transition-colors px-2 py-1 rounded"
              style={{ border: '1px solid rgba(30,41,59,0.7)', color: '#334155' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#22d3ee')}
              onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
            >
              Manage →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Bottom bar ───────────────────────────────────────────────────── */}
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

export default MissionControl;