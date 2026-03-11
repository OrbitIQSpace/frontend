import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from '../api';
import Upload from './Upload';
import SatelliteMap from './SatelliteMap';
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

const TabButton = ({ active, onClick, children, accent }) => {
  const base = 'px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all font-mono';
  if (accent) {
    return (
      <button
        onClick={onClick}
        className={`${base} text-white`}
        style={{ background: 'rgba(124,58,237,0.7)', border: '1px solid rgba(167,139,250,0.3)' }}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      onClick={onClick}
      className={`${base} ${
        active
          ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/30'
          : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      {children}
    </button>
  );
};

// ── Main component ────────────────────────────────────────────────────────────

const SatelliteDetails = () => {
  const { noradId } = useParams();
  const { getToken } = useAuth();

  const [satellite, setSatellite]         = useState(null);
  const [telemetry, setTelemetry]         = useState([]);
  const [derivedHistory, setDerivedHistory] = useState([]);
  const [isLoading, setIsLoading]         = useState(true);
  const [error, setError]                 = useState(null);
  const [position, setPosition]           = useState(null);
  const [activeTab, setActiveTab]         = useState('overview');

  // ── Spacecraft params form state ─────────────────────────────────────────
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

        // Pre-populate spacecraft params form from saved values
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

  // Orbital params for overview — only show if populated
  const orbitType   = satellite.orbit_type   || null;
  const inclination = satellite.inclination  ? `${parseFloat(satellite.inclination).toFixed(2)}°` : null;
  const eccentricity = satellite.eccentricity ? parseFloat(satellite.eccentricity).toFixed(6) : null;
  const perigee     = satellite.perigee      ? `${parseFloat(satellite.perigee).toFixed(0)} km` : null;
  const apogee      = satellite.apogee       ? `${parseFloat(satellite.apogee).toFixed(0)} km` : null;
  const period      = satellite.period       ? `${parseFloat(satellite.period).toFixed(1)} min` : null;
  const velocity    = latestDerived?.velocity_kms
    ? parseFloat(latestDerived.velocity_kms).toFixed(3)
    : satellite.orbital_velocity_kms
      ? parseFloat(satellite.orbital_velocity_kms).toFixed(3)
      : null;

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
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-10 pb-8"
          style={{ borderBottom: '1px solid rgba(30,41,59,0.7)' }}
        >
          <div>
            {/* Breadcrumb */}
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
              {/* Live dot */}
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

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <div
          className="flex flex-wrap gap-1.5 mb-10 p-1.5 rounded-full w-fit"
          style={{ background: 'rgba(2,6,23,0.8)', border: '1px solid rgba(30,41,59,0.6)' }}
        >
          {[
            { id: 'overview',    label: 'Overview'          },
            { id: 'analysis',    label: 'Orbital Analysis'  },
            { id: 'health',      label: 'System Health'     },
            { id: 'spacecraft',  label: 'Spacecraft'        },
          ].map(tab => (
            <TabButton
              key={tab.id}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </TabButton>
          ))}
          {/* Mission Control — navigates to dedicated page */}
          <TabButton
            accent
            onClick={() => (window.location.href = `/satellite/${noradId}/digital-twin`)}
          >
            ⌖ Mission Control
          </TabButton>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            TAB 1 — OVERVIEW
            2D live map + key orbital stats merged into one view
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-5 animate-in fade-in duration-500">

            {/* Left column — live position + orbital params */}
            <div className="lg:col-span-1 flex flex-col gap-4">

              {/* Live position */}
              <SectionCard>
                <SectionLabel>Live Position · SGP4</SectionLabel>
                <div className="flex flex-col gap-5">
                  <StatCard label="Latitude"  value={position?.lat.toFixed(6)} unit="°" accent="text-white" />
                  <StatCard label="Longitude" value={position?.lng.toFixed(6)} unit="°" accent="text-white" />
                  <div style={{ borderTop: '1px solid rgba(30,41,59,0.7)', paddingTop: '1.25rem' }}>
                    <StatCard label="Altitude" value={position?.altitude.toFixed(1)} unit="km" accent="text-emerald-400" large />
                  </div>
                </div>
              </SectionCard>

              {/* Velocity — highlight card */}
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

              {/* Orbital parameters — only fields that exist */}
              {(inclination || eccentricity || perigee || apogee || period) && (
                <SectionCard>
                  <SectionLabel>Orbital Parameters</SectionLabel>
                  <div className="flex flex-col gap-4">
                    {inclination  && <StatCard label="Inclination"  value={inclination}  accent="text-slate-300" />}
                    {eccentricity && <StatCard label="Eccentricity" value={eccentricity} accent="text-slate-300" />}
                    {perigee      && <StatCard label="Perigee"      value={perigee}      accent="text-slate-300" />}
                    {apogee       && <StatCard label="Apogee"       value={apogee}       accent="text-slate-300" />}
                    {period       && <StatCard label="Period"       value={period}       accent="text-sky-400"   />}
                  </div>
                </SectionCard>
              )}
            </div>

            {/* Right — 2D map */}
            <div
              className="lg:col-span-3 rounded-2xl overflow-hidden"
              style={{
                height: 680,
                border: '1px solid rgba(30,41,59,0.7)',
                boxShadow: '0 0 40px rgba(34,211,238,0.04)',
              }}
            >
              {position ? (
                <SatelliteMap position={position} satelliteName={satellite.name} />
              ) : (
                <div className="h-full flex items-center justify-center" style={{ background: 'rgba(2,6,23,0.9)' }}>
                  <p className="text-[10px] tracking-[0.25em] text-cyan-700 uppercase font-mono animate-pulse">
                    Awaiting position fix…
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 2 — ORBITAL ANALYSIS
            TLE history charts — apogee/perigee, eccentricity, inclination, decay
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'analysis' && (
          <div className="animate-in fade-in duration-500">

            {sortedHistory.length === 0 ? (
              <SectionCard className="text-center py-20">
                <p className="text-[10px] tracking-[0.25em] text-slate-600 uppercase font-mono">
                  No orbital history recorded yet.
                </p>
                <p className="text-xs text-slate-700 mt-2 font-mono">
                  Data accumulates automatically as TLE epochs are ingested.
                </p>
              </SectionCard>
            ) : (
              <>
                {/* Summary strip — latest derived values */}
                {latestDerived && (
                  <div
                    className="rounded-2xl p-5 mb-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-5"
                    style={{
                      background: 'rgba(2,6,23,0.7)',
                      border: '1px solid rgba(30,41,59,0.8)',
                    }}
                  >
                    <StatCard label="Epoch"       value={new Date(latestDerived.epoch).toLocaleDateString()} accent="text-cyan-300" />
                    <StatCard label="Inclination" value={`${parseFloat(latestDerived.inclination).toFixed(3)}°`} accent="text-slate-300" />
                    <StatCard label="Eccentricity" value={parseFloat(latestDerived.eccentricity).toFixed(7)} accent="text-slate-300" />
                    <StatCard label="Perigee"     value={`${parseFloat(latestDerived.perigee_km).toFixed(0)} km`} accent="text-emerald-400" />
                    <StatCard label="Apogee"      value={`${parseFloat(latestDerived.apogee_km).toFixed(0)} km`} accent="text-rose-400" />
                    <StatCard label="Period"      value={`${parseFloat(latestDerived.orbital_period_minutes).toFixed(1)} min`} accent="text-sky-400" />
                    <StatCard label="Velocity"    value={`${parseFloat(latestDerived.velocity_kms).toFixed(3)} km/s`} accent="text-yellow-400" />
                  </div>
                )}

                {/* Charts grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                  {/* Apogee vs Perigee */}
                  <SectionCard>
                    <div style={{ height: 320 }}>
                      <Line
                        options={getChartOptions('ORBITAL ENVELOPE — APOGEE VS PERIGEE (KM)')}
                        data={{
                          labels: sortedHistory.map(d => new Date(d.epoch).toLocaleDateString()),
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
                    <div style={{ height: 320 }}>
                      <Line
                        options={getChartOptions('ECCENTRICITY TREND')}
                        data={{
                          labels: sortedHistory.map(d => new Date(d.epoch).toLocaleDateString()),
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
                    <div style={{ height: 280 }}>
                      <Line
                        options={getChartOptions('INCLINATION (°)')}
                        data={{
                          labels: sortedHistory.map(d => new Date(d.epoch).toLocaleDateString()),
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
                    <div style={{ height: 280 }}>
                      <Line
                        options={getChartOptions('ORBITAL DECAY — MEAN MOTION DOT')}
                        data={{
                          labels: sortedHistory.map(d => new Date(d.epoch).toLocaleDateString()),
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
              </>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 3 — SPACECRAFT PARAMS
            Propulsion parameters for Tsiolkovsky fuel cost calculations
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'spacecraft' && (
          <div className="max-w-lg animate-in fade-in duration-500">
            <SectionCard>
              <SectionLabel>Spacecraft · Propulsion Parameters</SectionLabel>
              <p className="text-[10px] text-slate-600 mb-8 leading-relaxed font-mono">
                Enter your spacecraft's propulsion specs. These are used to calculate fuel cost
                and burn duration in the Maneuver Sandbox.
              </p>

              <div className="flex flex-col gap-6">
                {[
                  { key: 'wet_mass_kg', label: 'Wet Mass',  unit: 'kg',  hint: 'Total mass including propellant'   },
                  { key: 'dry_mass_kg', label: 'Dry Mass',  unit: 'kg',  hint: 'Mass without propellant'           },
                  { key: 'isp_s',       label: 'Isp',       unit: 's',   hint: 'Specific impulse of your thruster' },
                  { key: 'thrust_n',    label: 'Thrust',    unit: 'N',   hint: 'Thruster output force'             },
                ].map(({ key, label, unit, hint }) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between">
                      <label
                        className="font-mono uppercase tracking-[0.2em]"
                        style={{ fontSize: '9px', color: '#22d3ee', opacity: 0.7 }}
                      >
                        {label} <span style={{ color: '#334155' }}>({unit})</span>
                      </label>
                      <span className="font-mono" style={{ fontSize: '9px', color: '#1e3a5f' }}>{hint}</span>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={scParams[key]}
                      onChange={e => setScParams(prev => ({ ...prev, [key]: e.target.value }))}
                      placeholder="—"
                      className="w-full bg-transparent font-mono text-sm text-white placeholder-slate-700 px-3 py-2.5 rounded-lg"
                      style={{
                        border: '1px solid rgba(30,41,59,0.8)',
                        outline: 'none',
                      }}
                      onFocus={e => { e.target.style.borderColor = 'rgba(34,211,238,0.4)'; }}
                      onBlur={e  => { e.target.style.borderColor = 'rgba(30,41,59,0.8)';   }}
                    />
                  </div>
                ))}
              </div>

              {/* Derived preview — fuel available */}
              {scParams.wet_mass_kg && scParams.dry_mass_kg && (
                <div
                  className="mt-6 px-4 py-3 rounded-lg"
                  style={{ background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.1)' }}
                >
                  <p className="font-mono uppercase tracking-[0.2em] mb-1" style={{ fontSize: '9px', color: '#334155' }}>
                    Propellant Available
                  </p>
                  <p className="font-mono font-bold text-lg text-white">
                    {(parseFloat(scParams.wet_mass_kg) - parseFloat(scParams.dry_mass_kg)).toFixed(1)}
                    <span className="text-xs font-normal text-slate-600 ml-1">kg</span>
                  </p>
                </div>
              )}

              {/* Save button + feedback */}
              <div className="mt-8 flex items-center gap-4">
                <button
                  onClick={saveScParams}
                  disabled={scSaving}
                  className="px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest font-mono transition-all"
                  style={{
                    background: scSaving ? 'rgba(34,211,238,0.05)' : 'rgba(34,211,238,0.15)',
                    border: '1px solid rgba(34,211,238,0.35)',
                    color: '#22d3ee',
                    opacity: scSaving ? 0.5 : 1,
                  }}
                >
                  {scSaving ? 'Saving…' : 'Save Parameters'}
                </button>
                {scSaved && (
                  <span className="font-mono text-[10px] tracking-[0.15em] text-emerald-400 uppercase">
                    ✓ Saved
                  </span>
                )}
                {scError && (
                  <span className="font-mono text-[10px] text-red-400">{scError}</span>
                )}
              </div>
            </SectionCard>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB 4 — SYSTEM HEALTH
            Manual CSV telemetry uplink + battery chart
        ══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'health' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 animate-in fade-in duration-500">

            {/* Upload panel */}
            <SectionCard className="md:col-span-1">
              <SectionLabel>Manual Telemetry Uplink</SectionLabel>
              <p className="text-[10px] text-slate-600 mb-6 leading-relaxed font-mono">
                Upload a .CSV packet to log battery and fuel telemetry for this satellite.
              </p>
              <Upload noradId={noradId} onUploadSuccess={() => {}} />
            </SectionCard>

            {/* Battery chart */}
            <SectionCard className="md:col-span-2">
              {telemetry.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-20 gap-3">
                  <p className="text-[10px] tracking-[0.25em] text-slate-600 uppercase font-mono">
                    No telemetry packets on record.
                  </p>
                  <p className="text-xs text-slate-700 font-mono">
                    Upload a CSV file to populate this chart.
                  </p>
                </div>
              ) : (
                <div style={{ height: 440 }}>
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
        )}

      </div>
    </div>
  );
};

export default SatelliteDetails;