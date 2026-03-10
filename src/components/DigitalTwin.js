// src/components/DigitalTwin.js — Mission Control Viewer
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from '../api';
import { useAuth } from '@clerk/clerk-react';
import { Viewer, Entity } from 'resium';
import * as Cesium from 'cesium';
import { getSatelliteInfo } from 'tle.js';

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
// Returns array of Cartesian3 positions sampled over `durationMin` minutes
// starting from `startMs` epoch, every `stepSec` seconds.
// Positions are on the ellipsoid surface (height=0) for ground track rendering.
const computeGroundTrack = (tle, startMs, durationMin, stepSec = 30) => {
  const positions = [];
  const steps = Math.floor((durationMin * 60) / stepSec);

  for (let i = 0; i <= steps; i++) {
    const t = startMs + i * stepSec * 1000;
    try {
      const info = getSatelliteInfo(tle, t);
      if (info && typeof info.lat === 'number' && !isNaN(info.lat)) {
        // Use a small positive height to keep the line above terrain
        positions.push(
          Cesium.Cartesian3.fromDegrees(info.lng, info.lat, 8000)
        );
      }
    } catch {}
  }
  return positions;
};

// Split a polyline at antimeridian crossings to avoid wrap-around artifacts.
// Returns an array of position arrays (segments).
const splitAtAntimeridian = (positions) => {
  if (!positions.length) return [];
  const segments = [];
  let current = [positions[0]];

  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];

    const prevCart = Cesium.Cartographic.fromCartesian(prev);
    const currCart = Cesium.Cartographic.fromCartesian(curr);

    const prevLng = Cesium.Math.toDegrees(prevCart.longitude);
    const currLng = Cesium.Math.toDegrees(currCart.longitude);

    // If longitude jumps more than 180° it crossed the antimeridian
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
    <span className="text-[8px] font-mono tracking-[0.22em] uppercase text-slate-500">
      {label}
    </span>
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

const DigitalTwin = () => {
  const { noradId } = useParams();
  const { getToken } = useAuth();

  const [satellite, setSatellite]             = useState(null);
  const [tle, setTle]                         = useState(null);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState(null);
  const [clockStr, setClockStr]               = useState(utcClock());
  const [uptime, setUptime]                   = useState(0);

  // View mode: '3d' | '2d'
  const [viewMode, setViewMode]               = useState('3d');

  // Track source data for the Cesium entities drawn imperatively
  const [trackEntities, setTrackEntities]     = useState([]);

  const viewerRef        = useRef(null);
  const bordersLoadedRef = useRef(false);
  const mountTimeRef     = useRef(Date.now());
  const trackRedrawTimer = useRef(null);

  // Stable provider refs
  const imageryProviderRef = useRef(
    new Cesium.TileMapServiceImageryProvider({
      url: '/cesium/Assets/Textures/NaturalEarthII',
    })
  );
  const terrainProviderRef = useRef(new Cesium.EllipsoidTerrainProvider({}));

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
  // Called on first position fix and every 60 s thereafter.
  // Draws:
  //   • Past track  — last 15 min, faint cyan
  //   • Future track — one full orbital period ahead, brighter cyan
  // Splits each at the antimeridian to avoid wrap-around lines.
  const drawGroundTrack = useCallback(() => {
    if (!tle || !viewerRef.current?.cesiumElement) return;
    const viewer  = viewerRef.current.cesiumElement;
    const now     = Date.now();

    // Derive orbital period from TLE mean motion (revs/day → minutes/rev)
    let periodMin = 90; // fallback
    try {
      const meanMotion = parseFloat(tle[1].slice(52, 63));
      if (meanMotion > 0) periodMin = 1440 / meanMotion;
    } catch {}

    // Past 15 min (step back from now)
    const pastPositions   = computeGroundTrack(tle, now - 15 * 60 * 1000, 15, 20);
    // Future one orbit ahead
    const futurePositions = computeGroundTrack(tle, now, periodMin, 30);

    const pastSegments   = splitAtAntimeridian(pastPositions);
    const futureSegments = splitAtAntimeridian(futurePositions);

    // Remove any previous track entities
    setTrackEntities(prev => {
      prev.forEach(e => { try { viewer.entities.remove(e); } catch {} });
      return [];
    });

    const added = [];

    // Draw past track segments — dimmer
    pastSegments.forEach(seg => {
      if (seg.length < 2) return;
      const e = viewer.entities.add({
        polyline: {
          positions:   seg,
          width:       1.2,
          material:    new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.1,
            color:     Cesium.Color.fromCssColorString('#22d3ee').withAlpha(0.18),
          }),
          arcType:     Cesium.ArcType.NONE,
          clampToGround: false,
        },
      });
      added.push(e);
    });

    // Draw future track segments — brighter
    futureSegments.forEach((seg, idx) => {
      if (seg.length < 2) return;

      // First segment (current orbit) is brightest, subsequent orbits dim slightly
      const alpha = idx === 0 ? 0.65 : 0.35;
      const e = viewer.entities.add({
        polyline: {
          positions:   seg,
          width:       idx === 0 ? 1.8 : 1.2,
          material:    new Cesium.PolylineGlowMaterialProperty({
            glowPower: idx === 0 ? 0.25 : 0.1,
            color:     Cesium.Color.fromCssColorString('#22d3ee').withAlpha(alpha),
          }),
          arcType:     Cesium.ArcType.NONE,
          clampToGround: false,
        },
      });
      added.push(e);
    });

    setTrackEntities(added);
  }, [tle]);

  // ── Trigger initial draw + 60 s redraw interval ───────────────────────────
  useEffect(() => {
    if (!tle || !currentPosition) return;

    // Small delay to ensure viewer is mounted
    const initialTimer = setTimeout(() => drawGroundTrack(), 800);

    trackRedrawTimer.current = setInterval(() => drawGroundTrack(), 60 * 1000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(trackRedrawTimer.current);
    };
  }, [tle, currentPosition, drawGroundTrack]);

  // ── GeoJSON borders + globe styling — once ────────────────────────────────
  useEffect(() => {
    if (!currentPosition || !viewerRef.current?.cesiumElement) return;
    if (bordersLoadedRef.current) return;
    bordersLoadedRef.current = true;

    const viewer = viewerRef.current.cesiumElement;

    const layers = viewer.imageryLayers;
    if (layers.length > 0) {
      layers.get(0).brightness = 0.52;
      layers.get(0).contrast   = 1.35;
      layers.get(0).saturation = 0.25;
    }

    const load = (url, color, width) =>
      Cesium.GeoJsonDataSource.load(url, {
        stroke:      Cesium.Color.fromCssColorString(color),
        fill:        Cesium.Color.TRANSPARENT,
        strokeWidth: width,
      });

    const sanitizeSource = (src, strokeColor) => {
      const toRemove = [];
      const toAdd    = [];

      src.entities.values.forEach(entity => {
        if (entity.polyline) {
          entity.polyline.clampToGround = false;
          entity.polyline.arcType       = new Cesium.ConstantProperty(Cesium.ArcType.NONE);
        }
        if (entity.polygon) {
          const hierarchyProp = entity.polygon.hierarchy;
          let positions = null;
          if (hierarchyProp) {
            const val = hierarchyProp.getValue
              ? hierarchyProp.getValue(Cesium.JulianDate.now())
              : hierarchyProp;
            positions = val?.positions ?? (Array.isArray(val) ? val : null);
          }
          if (Array.isArray(positions) && positions.length > 1) {
            toAdd.push(
              new Cesium.Entity({
                polyline: {
                  positions:     new Cesium.ConstantProperty([...positions, positions[0]]),
                  width:         new Cesium.ConstantProperty(1),
                  material:      new Cesium.ColorMaterialProperty(
                    Cesium.Color.fromCssColorString(strokeColor)
                  ),
                  clampToGround: new Cesium.ConstantProperty(false),
                  arcType:       new Cesium.ConstantProperty(Cesium.ArcType.NONE),
                },
              })
            );
          }
          toRemove.push(entity);
        }
      });

      toRemove.forEach(e => src.entities.remove(e));
      toAdd.forEach(e => src.entities.add(e));
    };

    Promise.all([
      load('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson', '#22d3ee90', 1.2),
      load('https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json', '#0e749080', 0.7),
    ])
      .then(([countries, states]) => {
        sanitizeSource(countries, '#22d3ee90');
        sanitizeSource(states,    '#0e749080');
        viewer.dataSources.add(countries);
        viewer.dataSources.add(states);
      })
      .catch(err => console.warn('GeoJSON border load failed:', err));
  }, [currentPosition]);

  // ── Camera: track satellite ───────────────────────────────────────────────
  const handleTrackSat = useCallback(() => {
    if (!currentPosition || !viewerRef.current?.cesiumElement) return;
    viewerRef.current.cesiumElement.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        currentPosition.lng,
        currentPosition.lat,
        currentPosition.height + 1400000
      ),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch:   Cesium.Math.toRadians(-28),
        roll:    0.0,
      },
      duration: 2.0,
    });
  }, [currentPosition]);

  // ── Camera: reset ─────────────────────────────────────────────────────────
  const handleResetView = useCallback(() => {
    viewerRef.current?.cesiumElement?.camera.flyHome(1.5);
  }, []);

  // ── View mode toggle — 3D ↔ 2D ───────────────────────────────────────────
  const handleToggleView = useCallback(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;

    if (viewMode === '3d') {
      // Morph to flat 2D
      viewer.scene.morphTo2D(1.0);
      setViewMode('2d');
    } else {
      // Morph back to 3D globe
      viewer.scene.morphTo3D(1.0);
      setViewMode('3d');
    }
  }, [viewMode]);

  // ── Derived display values ────────────────────────────────────────────────
  const altKm    = currentPosition ? Math.round(currentPosition.height / 1000) : null;
  const velKms   = currentPosition ? currentPosition.velocity.toFixed(2) : null;
  const latStr   = currentPosition ? formatDeg(currentPosition.lat, 'N', 'S') : null;
  const lngStr   = currentPosition ? formatDeg(currentPosition.lng, 'E', 'W') : null;
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
        skyBox={false}
        skyAtmosphere={false}
        requestRenderMode={false}
        backgroundColor={Cesium.Color.BLACK}
        imageryProvider={imageryProviderRef.current}
        terrainProvider={terrainProviderRef.current}
      >
        {/* Live satellite dot + label */}
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
          background:
            'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.025) 2px,rgba(0,0,0,0.025) 4px)',
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
        {/* Left */}
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

        {/* Centre */}
        <div className="absolute left-1/2 -translate-x-1/2 text-center">
          <div className="text-xs font-bold text-white tracking-[0.15em] uppercase font-mono">
            {satellite.name}
          </div>
          <div className="text-[9px] text-slate-600 tracking-[0.18em] font-mono">
            NORAD ID {noradId}
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-4">
          <DataBlock label="UTC"     value={clockStr} accent="text-cyan-300" />
          <VRule />
          <DataBlock label="Session" value={`${pad(Math.floor(uptime / 60))}:${pad(uptime % 60)}`} accent="text-slate-500" />
        </div>
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
              <div
                className="h-px flex-shrink-0"
                style={{ width: 20, background: 'rgba(34,211,238,0.65)', boxShadow: '0 0 4px rgba(34,211,238,0.4)' }}
              />
              <span className="text-[8px] text-slate-500 font-mono">Next orbit</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="h-px flex-shrink-0"
                style={{ width: 20, background: 'rgba(34,211,238,0.18)' }}
              />
              <span className="text-[8px] text-slate-600 font-mono">Past 15 min</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: '#34d399' }}
              />
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

        <Panel dashed>
          <PanelTitle>Upcoming Modules</PanelTitle>
          <div className="flex flex-col divide-y divide-slate-800/60">
            {['Orbit Simulation', 'Decay Prediction', 'Fuel Optimizer', 'Reboost Planner'].map((mod) => (
              <div key={mod} className="flex items-center justify-between py-2">
                <span className="text-[9px] text-slate-600 font-mono">{mod}</span>
                <span
                  className="text-[7px] tracking-widest px-1.5 py-0.5 rounded font-mono"
                  style={{
                    background: 'rgba(34,211,238,0.05)',
                    color:      'rgba(34,211,238,0.3)',
                    border:     '1px solid rgba(34,211,238,0.08)',
                  }}
                >
                  SOON
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* ── Bottom bar ───────────────────────────────────────────────────── */}
      <div className="absolute bottom-4 left-4 right-4 z-30 flex items-center justify-between">

        {/* Back */}
        <button
          onClick={() => window.history.back()}
          className="group flex items-center gap-2 px-4 py-2 rounded text-[10px] tracking-[0.18em] uppercase font-mono text-slate-500 hover:text-cyan-400 transition-colors"
          style={{ background: 'rgba(2,6,15,0.85)', border: '1px solid rgba(148,163,184,0.1)' }}
        >
          <span className="group-hover:-translate-x-0.5 transition-transform inline-block">←</span>
          Back
        </button>

        {/* Centre controls */}
        <div className="flex items-center gap-2">

          {/* 3D / 2D toggle */}
          <button
            onClick={handleToggleView}
            className="px-4 py-2 rounded text-[10px] tracking-[0.18em] uppercase font-mono transition-all"
            style={viewMode === '2d' ? {
              background: 'rgba(8,145,178,0.35)',
              border: '1px solid rgba(34,211,238,0.5)',
              color: '#22d3ee',
            } : {
              background: 'rgba(2,6,15,0.85)',
              border: '1px solid rgba(148,163,184,0.15)',
              color: '#64748b',
            }}
            onMouseEnter={e => {
              if (viewMode === '3d') e.currentTarget.style.color = '#94a3b8';
            }}
            onMouseLeave={e => {
              if (viewMode === '3d') e.currentTarget.style.color = '#64748b';
            }}
          >
            {viewMode === '3d' ? '⊞ Ground Track View' : '⊙ 3D Globe View'}
          </button>

          {/* Track satellite */}
          <button
            onClick={handleTrackSat}
            className="px-4 py-2 rounded text-[10px] tracking-[0.18em] uppercase font-mono transition-all"
            style={{
              background: 'rgba(6,78,59,0.55)',
              border: '1px solid rgba(52,211,153,0.28)',
              color: '#34d399',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(6,78,59,0.85)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(6,78,59,0.55)')}
          >
            ⌖ Track Satellite
          </button>

          {/* Reset view */}
          <button
            onClick={handleResetView}
            className="px-4 py-2 rounded text-[10px] tracking-[0.18em] uppercase font-mono transition-all"
            style={{
              background: 'rgba(2,6,15,0.85)',
              border: '1px solid rgba(148,163,184,0.1)',
              color: '#64748b',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
            onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
          >
            ⊙ Reset View
          </button>
        </div>

        {/* Propagation badge + view mode indicator */}
        <div
          className="px-3 py-2 rounded text-right"
          style={{ background: 'rgba(2,6,15,0.85)', border: '1px solid rgba(148,163,184,0.07)' }}
        >
          <div className="text-[8px] tracking-[0.2em] text-slate-700 uppercase font-mono">Model · View</div>
          <div className="text-[9px] text-slate-500 tracking-widest font-mono">
            SGP4 · {viewMode === '3d' ? '3D Globe' : '2D Flat'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DigitalTwin;