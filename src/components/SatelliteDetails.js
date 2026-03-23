import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from '../api';
import Upload from './Upload';
import { useAuth } from '@clerk/clerk-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// ── Shared chart config ───────────────────────────────────────────────────────
const getChartOptions = (title) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    title: {
      display: true,
      text: title,
      color: '#475569',
      align: 'start',
      font: { size: 10, weight: '600', family: '"JetBrains Mono", monospace' },
      padding: { bottom: 16 }
    },
    tooltip: {
      backgroundColor: '#020617',
      borderColor: 'rgba(34,211,238,0.15)',
      borderWidth: 1,
      padding: 12,
      cornerRadius: 6,
      titleColor: '#94a3b8',
      bodyColor: '#e2e8f0',
      titleFont: { family: '"JetBrains Mono", monospace', size: 10 },
      bodyFont: { family: '"JetBrains Mono", monospace', size: 11 },
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(30,41,59,0.8)' },
      ticks: { color: '#334155', font: { size: 9, family: '"JetBrains Mono", monospace' }, maxTicksLimit: 6 }
    },
    y: {
      grid: { color: 'rgba(30,41,59,0.8)' },
      ticks: { color: '#475569', font: { size: 9, family: '"JetBrains Mono", monospace' } }
    },
  },
});

// ── Small reusable components ─────────────────────────────────────────────────

const StatCard = ({ label, value, unit, accent = 'text-white', large = false }) => (
  <div className="flex flex-col gap-1">
    <span
      className="font-mono uppercase tracking-[0.2em]"
      style={{ fontSize: '9px', color: '#334155' }}
    >
      {label}
    </span>
    <span className={`font-mono font-bold leading-none ${large ? 'text-3xl' : 'text-lg'} ${accent}`}>
      {value ?? '—'}
      {unit && (
        <span className="text-xs font-normal text-slate-600 ml-1">{unit}</span>
      )}
    </span>
  </div>
);

const SectionCard = ({ children, className = '' }) => (
  <div
    className={`rounded-2xl p-6 ${className}`}
    style={{
      background: 'rgba(2,6,23,0.7)',
      border: '1px solid rgba(30,41,59,0.8)',
      backdropFilter: 'blur(10px)',
    }}
  >
    {children}
  </div>
);

const SectionLabel = ({ children }) => (
  <p
    className="font-mono uppercase tracking-[0.22em] mb-5"
    style={{ fontSize: '9px', color: '#22d3ee', opacity: 0.6 }}
  >
    {children}
  </p>
);

// ── Main component ────────────────────────────────────────────────────────────

const SatelliteDetails = () => {
  const { noradId } = useParams();
  const { getToken } = useAuth();

  const [satellite, setSatellite]           = useState(null);
  const [telemetry, setTelemetry]           = useState([]);
  const [derivedHistory, setDerivedHistory] = useState([]);
  const [isLoading, setIsLoading]           = useState(true);
  const [error, setError]                   = useState(null);
  const [position, setPosition]             = useState(null);

  // ── Spacecraft params form state ──────────────────────────────────────────
  const [scParams, setScParams] = useState({ wet_mass_kg: '', dry_mass_kg: '', isp_s: '', thrust_n: '' });
  const [scSaving, setScSaving] = useState(false);
  const [scSaved,  setScSaved]  = useState(false);
  const [scError,  setScError]  = useState(null);

  // ── Data fetch ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const [satRes, telRes] = await Promise.all([
          axios.get(`/api/satellite/${noradId}`, {
            headers: { Authorization: `Bearer ${token}` }
          }),
          axios.get(`/api/telemetry/${noradId}`, {
            headers: { Authorization: `Bearer ${token}` }
          }).catch(() => ({ data: [] })),
        ]);

        setSatellite(satRes.data);
        setTelemetry(telRes.data);

        const s = satRes.data;
        setScParams({
          wet_mass_kg: s.wet_mass_kg ?? '',
          dry_mass_kg: s.dry_mass_kg ?? '',
          isp_s:       s.isp_s       ?? '',
          thrust_n:    s.thrust_n    ?? '',
        });

        try {
          const derivedRes = await axios.get(`/api/tle_derived/${noradId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          setDerivedHistory(derivedRes.data);
        } catch {
          setDerivedHistory([]);
        }
      } catch (err) {
        setError('Failed to load satellite data: ' + (err.response?.data?.error || err.message));
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [noradId, getToken]);

  // ── Live TLE tracking ───────────────────────────────────────────────────────
  useEffect(() => {
    const line1 = satellite?.tle_line1?.trim();
    const line2 = satellite?.tle_line2?.trim();
    if (!line1 || !line2) { setPosition(null); return; }

    const { getSatelliteInfo } = require('tle.js');
    const tle = [line1, line2];

    const update = () => {
      try {
        const info = getSatelliteInfo(tle, Date.now());
        if (info && typeof info.lat === 'number') {
          setPosition({ lat: info.lat, lng: info.lng, altitude: info.height || 0 });
        }
      } catch (e) {
        console.error('TLE tracking error:', e);
      }
    };

    update();
    const id = setInterval(update, 2000);
    return () => clearInterval(id);
  }, [satellite, isLoading]);

  // ── Derived values ──────────────────────────────────────────────────────────
  const sortedHistory = useMemo(
    () => [...derivedHistory].sort((a, b) => new Date(a.epoch) - new Date(b.epoch)),
    [derivedHistory]
  );
  const latestDerived = sortedHistory[sortedHistory.length - 1];

  // ── Save spacecraft params ───────────────────────────────────────────────
  const saveScParams = async () => {
    setScSaving(true);
    setScError(null);
    setScSaved(false);
    try {
      const token = await getToken();
      await axios.patch(`/api/satellite/${noradId}/spacecraft-params`, scParams, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSatellite(prev => ({ ...prev, ...scParams }));
      setScSaved(true);
      setTimeout(() => setScSaved(false), 3000);
    } catch (err) {
      setScError(err.response?.data?.error || 'Save failed');
    } finally {
      setScSaving(false);
    }
  };

  // ── Loading / error states ──────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        className="pt-32 min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: '#020617', fontFamily: '"JetBrains Mono", monospace' }}
      >
        <div className="w-48 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
        <p className="text-[10px] tracking-[0.3em] text-cyan-600 uppercase animate-pulse">
          Establishing uplink · {noradId}
        </p>
        <div className="w-48 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="pt-32 min-h-screen flex items-center justify-center" style={{ background: '#020617' }}>
        <p className="text-red-400 font-mono text-sm">{error}</p>
      </div>
    );
  }

  // Computed values — prefer latestDerived, fallback to satellite record
  const orbitType    = satellite.orbit_type   || null;
  const altKm        = position ? position.altitude.toFixed(1) : (satellite.altitude ? parseFloat(satellite.altitude).toFixed(1) : null);
  const inclination  = latestDerived?.inclination  ? `${parseFloat(latestDerived.inclination).toFixed(2)}`  : satellite.inclination  ? `${parseFloat(satellite.inclination).toFixed(2)}`  : null;
  const eccentricity = latestDerived?.eccentricity ? parseFloat(latestDerived.eccentricity).toFixed(6)      : satellite.eccentricity ? parseFloat(satellite.eccentricity).toFixed(6)      : null;
  const perigee      = latestDerived?.perigee_km   ? parseFloat(latestDerived.perigee_km).toFixed(0)        : satellite.perigee      ? parseFloat(satellite.perigee).toFixed(0)            : null;
  const apogee       = latestDerived?.apogee_km    ? parseFloat(latestDerived.apogee_km).toFixed(0)         : satellite.apogee       ? parseFloat(satellite.apogee).toFixed(0)             : null;
  const period       = latestDerived?.orbital_period_minutes ? parseFloat(latestDerived.orbital_period_minutes).toFixed(1) : satellite.period ? parseFloat(satellite.period).toFixed(1) : null;
  const velocity     = latestDerived?.velocity_kms
    ? parseFloat(latestDerived.velocity_kms).toFixed(3)
    : satellite.orbital_velocity_kms
      ? parseFloat(satellite.orbital_velocity_kms).toFixed(3)
      : null;

  const propellantAvail = scParams.wet_mass_kg && scParams.dry_mass_kg
    ? (parseFloat(scParams.wet_mass_kg) - parseFloat(scParams.dry_mass_kg)).toFixed(1)
    : null;

  const chartLabels = sortedHistory.map(d => new Date(d.epoch).toLocaleDateString());

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div
      className="pt-24 min-h-screen pb-20 px-6"
      style={{
        background: '#020617',
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        color: 'white',
      }}
    >
      {/* Subtle grid texture */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(34,211,238,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.02) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8 pb-8"
          style={{ borderBottom: '1px solid rgba(30,41,59,0.7)' }}
        >
          <div>
            <p className="text-[9px] tracking-[0.25em] text-slate-600 uppercase mb-3 font-mono">
              OrbitIQ / Fleet / {noradId}
            </p>
            <h1
              className="font-black tracking-tighter text-white uppercase italic leading-none"
              style={{ fontSize: 'clamp(2.5rem, 6vw, 5rem)' }}
            >
              {satellite.name}
            </h1>
            <div className="flex items-center gap-4 mt-3">
              {orbitType && (
                <span
                  className="text-[9px] tracking-[0.2em] uppercase font-mono px-2.5 py-1 rounded-full"
                  style={{
                    background: 'rgba(34,211,238,0.07)',
                    border: '1px solid rgba(34,211,238,0.15)',
                    color: '#22d3ee',
                  }}
                >
                  {orbitType}
                </span>
              )}
              <span className="text-slate-600 font-mono text-xs">
                NORAD <span className="text-cyan-500">{noradId}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
                <span className="text-[9px] tracking-[0.2em] text-emerald-500 uppercase font-mono">Live</span>
              </span>
            </div>
          </div>

          <Link
            to="/dashboard"
            className="px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all font-mono text-slate-400 hover:text-white"
            style={{ border: '1px solid rgba(51,65,85,0.6)' }}
          >
            ← Dashboard
          </Link>
        </div>

        {/* ── Action Bar ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-3 mb-8">
          <button
            onClick={() => (window.location.href = `/satellite/${noradId}/digital-twin`)}
            className="flex-1 min-w-[180px] px-6 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all font-mono text-white flex items-center justify-center gap-2"
            style={{ background: 'rgba(124,58,237,0.5)', border: '1px solid rgba(167,139,250,0.3)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.75)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.5)')}
          >
            <span style={{ fontSize: '16px' }}>⌖</span> Mission Control
          </button>
          <button
            onClick={() => (window.location.href = `/satellite/${noradId}/reboost`)}
            className="flex-1 min-w-[180px] px-6 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all font-mono text-white flex items-center justify-center gap-2"
            style={{ background: 'rgba(194,65,12,0.5)', border: '1px solid rgba(249,115,22,0.35)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(194,65,12,0.75)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(194,65,12,0.5)')}
          >
            <span style={{ fontSize: '16px' }}>↑</span> Reboost Planner
          </button>
          <button
            onClick={() => (window.location.href = `/satellite/${noradId}/maneuver`)}
            className="flex-1 min-w-[180px] px-6 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all font-mono text-white flex items-center justify-center gap-2"
            style={{ background: 'rgba(8,145,178,0.25)', border: '1px solid rgba(34,211,238,0.35)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(8,145,178,0.45)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(8,145,178,0.25)')}
          >
            <span style={{ fontSize: '16px' }}>◎</span> Maneuver Sandbox
          </button>
          <button
            onClick={() => (window.location.href = `/satellite/${noradId}/lifetime`)}
            className="flex-1 min-w-[180px] px-6 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all font-mono text-white flex items-center justify-center gap-2"
            style={{ background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(52,211,153,0.3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(52,211,153,0.15)')}
          >
            <span style={{ fontSize: '16px' }}>⟳</span> Lifetime Forecast
          </button>
        </div>

        {/* ── Stats Strip ────────────────────────────────────────────────── */}
        <div
          className="rounded-2xl p-5 mb-8 grid grid-cols-3 md:grid-cols-6 gap-5"
          style={{
            background: 'rgba(2,6,23,0.7)',
            border: '1px solid rgba(30,41,59,0.8)',
          }}
        >
          <StatCard label="Altitude"    value={altKm}        unit="km"  accent="text-emerald-400" />
          <StatCard label="Period"      value={period}        unit="min" accent="text-sky-400"     />
          <StatCard label="Inclination" value={inclination}   unit="°"   accent="text-slate-300"   />
          <StatCard label="Eccentricity" value={eccentricity}           accent="text-slate-300"   />
          <StatCard label="Perigee"     value={perigee}       unit="km"  accent="text-slate-300"   />
          <StatCard label="Apogee"      value={apogee}        unit="km"  accent="text-rose-400"    />
        </div>

        {/* ── Main Grid: Live State + Charts ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-8">

          {/* Left column — Live Position + Spacecraft Params */}
          <div className="lg:col-span-1 flex flex-col gap-5">

            {/* Live position */}
            <SectionCard>
              <SectionLabel>Live Position · SGP4</SectionLabel>
              <div className="flex flex-col gap-5">
                <StatCard label="Latitude"  value={position?.lat.toFixed(6)} unit="°" />
                <StatCard label="Longitude" value={position?.lng.toFixed(6)} unit="°" />
                <div style={{ borderTop: '1px solid rgba(30,41,59,0.7)', paddingTop: '1.25rem' }}>
                  <StatCard label="Altitude" value={position?.altitude.toFixed(1)} unit="km" accent="text-emerald-400" large />
                </div>
              </div>
            </SectionCard>

            {/* Orbital velocity */}
            {velocity && (
              <div
                className="rounded-2xl p-6"
                style={{
                  background: 'linear-gradient(135deg, rgba(6,78,59,0.6) 0%, rgba(5,46,37,0.8) 100%)',
                  border: '1px solid rgba(52,211,153,0.2)',
                }}
              >
                <SectionLabel>Orbital Velocity</SectionLabel>
                <p className="text-4xl font-black text-white font-mono leading-none">{velocity}</p>
                <p className="text-[9px] font-bold text-emerald-500 mt-1.5 tracking-[0.2em] uppercase font-mono">
                  km / second
                </p>
              </div>
            )}

            {/* Spacecraft params */}
            <SectionCard>
              <SectionLabel>Spacecraft · Propulsion</SectionLabel>
              <div className="flex flex-col gap-4">
                {[
                  { key: 'wet_mass_kg', label: 'Wet Mass', unit: 'kg' },
                  { key: 'dry_mass_kg', label: 'Dry Mass', unit: 'kg' },
                  { key: 'isp_s',       label: 'Isp',      unit: 's'  },
                  { key: 'thrust_n',    label: 'Thrust',   unit: 'N'  },
                ].map(({ key, label, unit }) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label
                      className="font-mono uppercase tracking-[0.2em]"
                      style={{ fontSize: '9px', color: '#22d3ee', opacity: 0.7 }}
                    >
                      {label} <span style={{ color: '#334155' }}>({unit})</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={scParams[key]}
                      onChange={e => setScParams(prev => ({ ...prev, [key]: e.target.value }))}
                      placeholder="—"
                      className="w-full bg-transparent font-mono text-sm text-white placeholder-slate-700 px-3 py-2 rounded-lg"
                      style={{ border: '1px solid rgba(30,41,59,0.8)', outline: 'none' }}
                      onFocus={e => { e.target.style.borderColor = 'rgba(34,211,238,0.4)'; }}
                      onBlur={e  => { e.target.style.borderColor = 'rgba(30,41,59,0.8)';   }}
                    />
                  </div>
                ))}

                {propellantAvail && (
                  <div
                    className="px-3 py-2.5 rounded-lg"
                    style={{ background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.1)' }}
                  >
                    <p className="font-mono uppercase tracking-[0.2em] mb-1" style={{ fontSize: '9px', color: '#334155' }}>
                      Propellant Available
                    </p>
                    <p className="font-mono font-bold text-lg text-white">
                      {propellantAvail}<span className="text-xs font-normal text-slate-600 ml-1">kg</span>
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-3 mt-1">
                  <button
                    onClick={saveScParams}
                    disabled={scSaving}
                    className="px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest font-mono transition-all"
                    style={{
                      background: scSaving ? 'rgba(34,211,238,0.05)' : 'rgba(34,211,238,0.15)',
                      border: '1px solid rgba(34,211,238,0.35)',
                      color: '#22d3ee',
                      opacity: scSaving ? 0.5 : 1,
                    }}
                  >
                    {scSaving ? 'Saving…' : 'Save'}
                  </button>
                  {scSaved  && <span className="font-mono text-[10px] tracking-[0.15em] text-emerald-400 uppercase">✓ Saved</span>}
                  {scError  && <span className="font-mono text-[10px] text-red-400">{scError}</span>}
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Right column — Orbital History Charts */}
          <div className="lg:col-span-2">
            {sortedHistory.length === 0 ? (
              <SectionCard className="h-full flex flex-col items-center justify-center py-20 text-center">
                <p className="text-[10px] tracking-[0.25em] text-slate-600 uppercase font-mono">
                  No orbital history recorded yet.
                </p>
                <p className="text-xs text-slate-700 mt-2 font-mono">
                  Data accumulates automatically as TLE epochs are ingested.
                </p>
              </SectionCard>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

                {/* Apogee vs Perigee */}
                <SectionCard>
                  <div style={{ height: 260 }}>
                    <Line
                      options={getChartOptions('APOGEE VS PERIGEE (KM)')}
                      data={{
                        labels: chartLabels,
                        datasets: [
                          {
                            label: 'Apogee',
                            data: sortedHistory.map(d => d.apogee_km),
                            borderColor: '#f43f5e',
                            borderWidth: 1.5,
                            pointRadius: 0,
                            tension: 0.3,
                          },
                          {
                            label: 'Perigee',
                            data: sortedHistory.map(d => d.perigee_km),
                            borderColor: '#10b981',
                            borderWidth: 1.5,
                            pointRadius: 0,
                            tension: 0.3,
                          },
                        ],
                      }}
                    />
                  </div>
                </SectionCard>

                {/* Eccentricity */}
                <SectionCard>
                  <div style={{ height: 260 }}>
                    <Line
                      options={getChartOptions('ECCENTRICITY')}
                      data={{
                        labels: chartLabels,
                        datasets: [{
                          label: 'Eccentricity',
                          data: sortedHistory.map(d => d.eccentricity),
                          borderColor: '#f59e0b',
                          backgroundColor: 'rgba(245,158,11,0.04)',
                          fill: true,
                          borderWidth: 1.5,
                          pointRadius: 2,
                          pointBackgroundColor: '#f59e0b',
                        }],
                      }}
                    />
                  </div>
                </SectionCard>

                {/* Inclination */}
                <SectionCard>
                  <div style={{ height: 260 }}>
                    <Line
                      options={getChartOptions('INCLINATION (°)')}
                      data={{
                        labels: chartLabels,
                        datasets: [{
                          label: 'Inclination',
                          data: sortedHistory.map(d => d.inclination),
                          borderColor: '#8b5cf6',
                          borderWidth: 1.5,
                          tension: 0.4,
                          pointRadius: 0,
                        }],
                      }}
                    />
                  </div>
                </SectionCard>

                {/* Orbital decay */}
                <SectionCard>
                  <div style={{ height: 260 }}>
                    <Line
                      options={getChartOptions('ORBITAL DECAY — MEAN MOTION DOT')}
                      data={{
                        labels: chartLabels,
                        datasets: [{
                          label: 'Decay',
                          data: sortedHistory.map(d => d.mean_motion_dot),
                          borderColor: '#ef4444',
                          backgroundColor: 'rgba(239,68,68,0.04)',
                          fill: true,
                          borderWidth: 1.5,
                          tension: 0.4,
                          pointRadius: 0,
                        }],
                      }}
                    />
                  </div>
                </SectionCard>
              </div>
            )}
          </div>
        </div>

        {/* ── Telemetry ───────────────────────────────────────────────────── */}
        <div
          className="mb-6 pb-4"
          style={{ borderTop: '1px solid rgba(30,41,59,0.5)', paddingTop: '2rem' }}
        >
          <p className="font-mono uppercase tracking-[0.22em] mb-5" style={{ fontSize: '9px', color: '#22d3ee', opacity: 0.6 }}>
            Telemetry
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

            <SectionCard className="md:col-span-1">
              <SectionLabel>Manual Uplink · CSV</SectionLabel>
              <p className="text-[10px] text-slate-600 mb-6 leading-relaxed font-mono">
                Upload a .CSV packet to log battery and fuel telemetry.
              </p>
              <Upload noradId={noradId} onUploadSuccess={() => {}} />
            </SectionCard>

            <SectionCard className="md:col-span-2">
              {telemetry.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-16 gap-3">
                  <p className="text-[10px] tracking-[0.25em] text-slate-600 uppercase font-mono">
                    No telemetry packets on record.
                  </p>
                  <p className="text-xs text-slate-700 font-mono">
                    Upload a CSV file to populate this chart.
                  </p>
                </div>
              ) : (
                <div style={{ height: 320 }}>
                  <Line
                    options={getChartOptions('BATTERY POWER BUS (%)')}
                    data={{
                      labels: telemetry.slice().reverse().map(t =>
                        new Date(t.timestamp).toLocaleTimeString()
                      ),
                      datasets: [{
                        label: 'Battery %',
                        data: telemetry.slice().reverse().map(t => t.battery_level),
                        borderColor: '#06b6d4',
                        backgroundColor: 'rgba(6,182,212,0.06)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 2,
                        pointRadius: 0,
                      }],
                    }}
                  />
                </div>
              )}
            </SectionCard>

          </div>
        </div>

      </div>
    </div>
  );
};

export default SatelliteDetails;
