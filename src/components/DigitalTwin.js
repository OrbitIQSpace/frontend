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

// ── Full-screen wrappers ─────────────────────────────────────────────────────

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

  const viewerRef        = useRef(null);
  const bordersLoadedRef = useRef(false);
  const mountTimeRef     = useRef(Date.now());

  // Stable provider refs — recreating inline causes Cesium RangeError on re-render
  const imageryProviderRef = useRef(
    new Cesium.TileMapServiceImageryProvider({
      url: '/cesium/Assets/Textures/NaturalEarthII',
    })
  );
  const terrainProviderRef = useRef(new Cesium.EllipsoidTerrainProvider({}));

  // UTC clock + session timer
  useEffect(() => {
    const t = setInterval(() => {
      setClockStr(utcClock());
      setUptime(Math.floor((Date.now() - mountTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch satellite + TLE
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

  // SGP4 propagation — 1.5 s tick
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

  // Load GeoJSON borders — once, after first position fix
  useEffect(() => {
    if (!currentPosition || !viewerRef.current?.cesiumElement) return;
    if (bordersLoadedRef.current) return;
    bordersLoadedRef.current = true;

    const viewer = viewerRef.current.cesiumElement;

    // Darken base map for ops feel
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
      toAdd.forEach(e    => src.entities.add(e));
    };

    Promise.all([
      load(
        'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
        '#22d3ee90', 1.2
      ),
      load(
        'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json',
        '#0e749080', 0.7
      ),
    ])
      .then(([countries, states]) => {
        sanitizeSource(countries, '#22d3ee90');
        sanitizeSource(states,    '#0e749080');
        viewer.dataSources.add(countries);
        viewer.dataSources.add(states);
      })
      .catch(err => console.warn('GeoJSON border load failed:', err));
  }, [currentPosition]);

  // Camera: fly to satellite
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

  // Camera: reset to full globe
  const handleResetView = useCallback(() => {
    viewerRef.current?.cesiumElement?.camera.flyHome(1.5);
  }, []);

  // ── Derived display values — all from real TLE/SGP4 data ─────────────────
  const altKm    = currentPosition ? Math.round(currentPosition.height / 1000) : null;
  const velKms   = currentPosition ? currentPosition.velocity.toFixed(2) : null;
  const latStr   = currentPosition ? formatDeg(currentPosition.lat, 'N', 'S') : null;
  const lngStr   = currentPosition ? formatDeg(currentPosition.lng, 'E', 'W') : null;
  const orbPeriod = altKm
    ? ((2 * Math.PI * Math.sqrt(Math.pow((6371 + altKm) * 1000, 3) / 3.986e14)) / 60).toFixed(1)
    : null;

  // TLE-derived orbital params from DB — only shown if non-null
  const inclination  = satellite?.inclination  ? `${parseFloat(satellite.inclination).toFixed(2)}°`  : null;
  const eccentricity = satellite?.eccentricity ? parseFloat(satellite.eccentricity).toFixed(6)        : null;
  const perigee      = satellite?.perigee      ? `${parseFloat(satellite.perigee).toFixed(0)} km`     : null;
  const apogee       = satellite?.apogee       ? `${parseFloat(satellite.apogee).toFixed(0)} km`      : null;
  const orbitType    = satellite?.orbit_type   || null;

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <FullScreen>
        <span className="text-[9px] tracking-[0.3em] text-cyan-700 uppercase font-mono">
          OrbitIQ · Digital Twin
        </span>
        <ScanLine />
        <span className="text-xs text-cyan-400 animate-pulse tracking-[0.2em] font-mono">
          ESTABLISHING UPLINK · {noradId}
        </span>
        <ScanLine />
      </FullScreen>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (error || !satellite) {
    return (
      <FullScreen>
        <span className="text-[9px] tracking-[0.3em] text-red-700 uppercase font-mono">
          UPLINK FAILURE
        </span>
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

  // ── Propagating ──────────────────────────────────────────────────────────
  if (!currentPosition) {
    return (
      <FullScreen>
        <span className="text-[9px] tracking-[0.3em] text-cyan-700 uppercase font-mono">
          TLE Acquired
        </span>
        <ScanLine />
        <span className="text-xs text-cyan-400 animate-pulse tracking-[0.2em] font-mono">
          PROPAGATING ORBIT…
        </span>
      </FullScreen>
    );
  }

  // ── Main view ────────────────────────────────────────────────────────────
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

      {/* Subtle scanline overlay */}
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
          <span className="text-[9px] tracking-[0.18em] text-slate-600 uppercase font-mono">Digital Twin v1</span>
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

      {/* ── Left panel: State Vector (live SGP4) ─────────────────────────── */}
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
      </div>

      {/* ── Right panel: Orbital params (TLE-derived from DB) ────────────── */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-2" style={{ width: 176 }}>

        {/* Only render orbital params panel if we have at least one value */}
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

        {/* Upcoming modules — clearly marked as coming soon, no fake data */}
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
          style={{
            background: 'rgba(2,6,15,0.85)',
            border: '1px solid rgba(148,163,184,0.1)',
          }}
        >
          <span className="group-hover:-translate-x-0.5 transition-transform inline-block">←</span>
          Back
        </button>

        {/* View controls */}
        <div className="flex items-center gap-2">
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

        {/* Propagation badge */}
        <div
          className="px-3 py-2 rounded text-right"
          style={{
            background: 'rgba(2,6,15,0.85)',
            border: '1px solid rgba(148,163,184,0.07)',
          }}
        >
          <div className="text-[8px] tracking-[0.2em] text-slate-700 uppercase font-mono">Model</div>
          <div className="text-[9px] text-slate-500 tracking-widest font-mono">SGP4 / TLE</div>
        </div>
      </div>
    </div>
  );
};

export default DigitalTwin;