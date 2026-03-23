// src/components/LifetimeForecaster.js
// Satellite Lifetime Forecaster — AI-powered reboost schedule optimizer
// Route: /satellite/:noradId/lifetime

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from '../api';
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
  Filler,
  Annotation,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import {
  optimizeLifetime,
  simulateLifetime,
  computeHohmannDv,
  fmtDate,
  fmtMonths,
} from '../utils/orbitPhysics';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');
const utcClock = () => {
  const d = new Date();
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
};

const getOrbitTypeBadge = (orbitType) => {
  const labels = { LEO: 'LEO', MEO: 'MEO', GEO: 'GEO', HEO: 'HEO' };
  return labels[orbitType?.toUpperCase()] ?? 'LEO';
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const MetricCard = ({ label, value, sub, accent = '#22d3ee', wide = false }) => (
  <div
    className={`flex flex-col justify-between p-4 rounded-xl ${wide ? 'col-span-2' : ''}`}
    style={{ background: 'rgba(2,6,23,0.8)', border: '1px solid rgba(30,41,59,0.7)' }}
  >
    <span className="font-mono uppercase tracking-[0.2em]" style={{ fontSize: '8px', color: '#334155' }}>
      {label}
    </span>
    <div className="mt-2">
      <span className="font-mono font-bold text-lg leading-none" style={{ color: accent }}>
        {value ?? '—'}
      </span>
      {sub && (
        <span className="font-mono text-xs ml-2" style={{ color: '#475569' }}>{sub}</span>
      )}
    </div>
  </div>
);

const SectionLabel = ({ children }) => (
  <p className="font-mono uppercase tracking-[0.22em] mb-4" style={{ fontSize: '9px', color: '#22d3ee', opacity: 0.6 }}>
    {children}
  </p>
);

// ─── Main Component ───────────────────────────────────────────────────────────

const LifetimeForecaster = () => {
  const { noradId }  = useParams();
  const { getToken } = useAuth();

  const [satellite,     setSatellite]     = useState(null);
  const [latestDerived, setLatestDerived] = useState(null);
  const [latestFuelKg,  setLatestFuelKg]  = useState(null); // from telemetry
  const [isLoading,     setIsLoading]     = useState(true);
  const [isOptimizing,  setIsOptimizing]  = useState(false);
  const [error,         setError]         = useState(null);
  const [clockStr,      setClockStr]      = useState(utcClock());

  // Optimizer results
  const [optimized, setOptimized] = useState(null);  // best reboost strategy result
  const [baseline,  setBaseline]  = useState(null);  // no-reboost result
  const [scenarioCount, setScenarioCount] = useState(0);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setClockStr(utcClock()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Data fetch ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const [satRes, telRes, derivedRes] = await Promise.all([
          axios.get(`/api/satellite/${noradId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          axios.get(`/api/telemetry/${noradId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => ({ data: [] })),
          axios.get(`/api/tle_derived/${noradId}`, {
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => ({ data: [] })),
        ]);

        const sat = satRes.data;
        setSatellite(sat);

        // Use the most recent tle_derived row (ordered ASC, so last = most recent)
        const derivedRows = derivedRes.data ?? [];
        const latestRow   = derivedRows.length > 0 ? derivedRows[derivedRows.length - 1] : null;
        // Fallback: use satellite columns if tle_derived is empty
        const derived = latestRow ?? (sat.mean_motion ? {
          mean_motion:     sat.mean_motion,
          mean_motion_dot: 0,
          altitude_km:     sat.altitude,
        } : null);
        setLatestDerived(derived);

        // Most recent telemetry fuel_remaining
        const tel = telRes.data ?? [];
        if (tel.length > 0 && tel[0].fuel_remaining != null) {
          setLatestFuelKg(parseFloat(tel[0].fuel_remaining));
        }
      } catch (err) {
        setError('Failed to load satellite: ' + (err.response?.data?.error || err.message));
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [noradId, getToken]);

  // ── Run optimizer when data is ready ─────────────────────────────────────────
  useEffect(() => {
    if (!satellite || !latestDerived) return;

    const wet  = parseFloat(satellite.wet_mass_kg);
    const dry  = parseFloat(satellite.dry_mass_kg);
    const isp  = parseFloat(satellite.isp_s);
    const alt  = parseFloat(latestDerived.altitude_km ?? satellite.altitude ?? 420);

    // Need at least wet mass + isp to compute anything meaningful
    if (!wet || !isp || isNaN(wet) || isNaN(isp)) {
      setOptimized(null);
      setBaseline(null);
      return;
    }

    const spacecraft  = { wet_mass_kg: wet, dry_mass_kg: dry || 0, isp_s: isp };
    const fuelKg      = latestFuelKg ?? (wet - (dry || 0));

    setIsOptimizing(true);

    // Small delay for UX — optimizer is fast but we want to give a "computing" feel
    const timer = setTimeout(() => {
      const results = optimizeLifetime(alt, latestDerived, spacecraft, fuelKg);
      setScenarioCount(results.length);

      // Last element is always the no-reboost baseline (triggerAlt = 0)
      const base = results.find(r => r.strategy.triggerAltKm === 0) ?? results[results.length - 1];
      // Best result is first (sorted by lifetime desc), skip if it's also the baseline
      const best = results[0].strategy.triggerAltKm === 0 ? results[1] ?? results[0] : results[0];

      setBaseline(base);
      setOptimized(best);
      setIsOptimizing(false);
    }, 600);

    return () => clearTimeout(timer);
  }, [satellite, latestDerived, latestFuelKg]);

  // ── Computed values ──────────────────────────────────────────────────────────
  const hasSpacecraftParams = satellite &&
    satellite.wet_mass_kg != null && !isNaN(parseFloat(satellite.wet_mass_kg)) &&
    satellite.isp_s       != null && !isNaN(parseFloat(satellite.isp_s));

  const currentAlt = latestDerived
    ? parseFloat(latestDerived.altitude_km ?? satellite?.altitude ?? 420)
    : (satellite ? parseFloat(satellite.altitude ?? 420) : null);

  const fuelAvailable = latestFuelKg
    ?? (satellite?.wet_mass_kg && satellite?.dry_mass_kg
      ? parseFloat(satellite.wet_mass_kg) - parseFloat(satellite.dry_mass_kg)
      : null);

  const extensionDays = (optimized && baseline && optimized.lifetimeDays > baseline.lifetimeDays)
    ? optimized.lifetimeDays - baseline.lifetimeDays
    : null;

  // ── Chart data ────────────────────────────────────────────────────────────────
  const chartData = (() => {
    if (!optimized || !baseline) return null;

    // Build aligned label set from the optimized result's history (denser)
    // Only include every 4th point for chart readability
    const maxPoints = 120;
    const optHistory = optimized.altHistory;
    const baseHistory = baseline.altHistory;

    // Build a day-indexed map for baseline
    const baseMap = {};
    baseHistory.forEach(p => { baseMap[p.day] = p.altKm; });

    // Use optimized history as the x-axis spine
    const step = Math.max(1, Math.floor(optHistory.length / maxPoints));
    const filtered = optHistory.filter((_, i) => i % step === 0 || i === optHistory.length - 1);

    const labels     = filtered.map(p => fmtDate(p.date));
    const optAlts    = filtered.map(p => p.altKm);
    const baseAlts   = filtered.map(p => {
      // Find closest baseline point
      const closest = baseHistory.reduce((best, bp) =>
        Math.abs(bp.day - p.day) < Math.abs(best.day - p.day) ? bp : best
      , baseHistory[0]);
      return closest ? closest.altKm : null;
    });

    return {
      labels,
      datasets: [
        {
          label:           'Optimized',
          data:            optAlts,
          borderColor:     '#22d3ee',
          backgroundColor: 'rgba(34,211,238,0.05)',
          borderWidth:     2,
          pointRadius:     0,
          tension:         0.2,
          fill:            false,
        },
        {
          label:           'No reboosts',
          data:            baseAlts,
          borderColor:     'rgba(248,113,113,0.5)',
          backgroundColor: 'transparent',
          borderWidth:     1.5,
          borderDash:      [4, 4],
          pointRadius:     0,
          tension:         0.2,
          fill:            false,
        },
      ],
    };
  })();

  const chartOptions = {
    responsive:          true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: {
          color: '#475569',
          font: { family: '"JetBrains Mono", monospace', size: 9 },
          boxWidth: 20,
          padding: 16,
        },
      },
      tooltip: {
        backgroundColor:  '#020617',
        borderColor:      'rgba(34,211,238,0.15)',
        borderWidth:      1,
        padding:          10,
        cornerRadius:     6,
        titleColor:       '#94a3b8',
        bodyColor:        '#e2e8f0',
        titleFont: { family: '"JetBrains Mono", monospace', size: 9 },
        bodyFont:  { family: '"JetBrains Mono", monospace', size: 10 },
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)} km`,
        },
      },
    },
    scales: {
      x: {
        grid:  { color: 'rgba(30,41,59,0.6)' },
        ticks: {
          color:          '#334155',
          font:           { size: 8, family: '"JetBrains Mono", monospace' },
          maxTicksLimit:  10,
          maxRotation:    0,
        },
      },
      y: {
        grid:  { color: 'rgba(30,41,59,0.6)' },
        ticks: {
          color:    '#475569',
          font:     { size: 9, family: '"JetBrains Mono", monospace' },
          callback: (v) => `${v} km`,
        },
        min: 80,
        suggestedMax: currentAlt ? currentAlt + 60 : 500,
      },
    },
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#020617' }}>
        <div className="font-mono text-sm" style={{ color: '#22d3ee' }}>Loading satellite data…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#020617' }}>
        <div className="font-mono text-sm" style={{ color: '#f87171' }}>{error}</div>
      </div>
    );
  }

  const orbitBadge = getOrbitTypeBadge(satellite?.orbit_type);

  return (
    <div className="min-h-screen" style={{ background: '#020617', fontFamily: '"JetBrains Mono", monospace' }}>

      {/* ── Top bar ── */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-6 py-3"
        style={{ background: 'rgba(2,6,15,0.95)', borderBottom: '1px solid rgba(30,41,59,0.7)', backdropFilter: 'blur(12px)' }}
      >
        <div className="flex items-center gap-4">
          <Link
            to={`/satellite/${noradId}`}
            className="font-mono text-xs transition-colors"
            style={{ color: '#475569' }}
            onMouseEnter={e => e.target.style.color = '#22d3ee'}
            onMouseLeave={e => e.target.style.color = '#475569'}
          >
            ← BACK
          </Link>
          <div className="w-px h-4" style={{ background: 'rgba(30,41,59,0.8)' }} />
          <span className="font-black tracking-tighter uppercase italic text-white" style={{ fontSize: '15px' }}>
            {satellite?.name ?? `SAT ${noradId}`}
          </span>
          <span
            className="font-mono text-xs px-2 py-0.5 rounded"
            style={{ color: '#22d3ee', background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.2)' }}
          >
            {orbitBadge}
          </span>
          {currentAlt && (
            <span className="font-mono text-xs" style={{ color: '#334155' }}>
              {Math.round(currentAlt)} km
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono" style={{ fontSize: '10px', color: '#1e3a5f' }}>
            {clockStr}
          </span>
          <span
            className="font-mono uppercase tracking-[0.2em] px-2 py-1 rounded"
            style={{ fontSize: '8px', color: '#22d3ee', background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.15)' }}
          >
            LIFETIME FORECASTER
          </span>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">

        {/* ── Spacecraft params warning ── */}
        {!hasSpacecraftParams && (
          <div
            className="rounded-xl p-5 flex items-start gap-4"
            style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.2)' }}
          >
            <span style={{ color: '#fbbf24', fontSize: '18px' }}>⚠</span>
            <div>
              <p className="font-mono font-bold text-sm" style={{ color: '#fbbf24' }}>
                Spacecraft parameters required
              </p>
              <p className="font-mono text-xs mt-1" style={{ color: '#475569' }}>
                Wet mass and Isp must be configured before the optimizer can run.
                Fuel cost and lifetime calculations are disabled until then.
              </p>
              <Link
                to={`/satellite/${noradId}#spacecraft-params`}
                className="font-mono text-xs mt-3 inline-block"
                style={{ color: '#22d3ee' }}
              >
                Configure spacecraft parameters →
              </Link>
            </div>
          </div>
        )}

        {/* ── Metrics bar ── */}
        {hasSpacecraftParams && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCard
              label="Natural Deorbit"
              value={baseline?.reentryDate ? fmtDate(baseline.reentryDate) : `>${fmtMonths((3*365)|0)}`}
              accent="#f87171"
            />
            <MetricCard
              label="Optimized Lifetime"
              value={optimized?.reentryDate ? fmtDate(optimized.reentryDate) : `>${fmtMonths((3*365)|0)}`}
              accent="#22d3ee"
            />
            <MetricCard
              label="Lifetime Extension"
              value={extensionDays ? `+${fmtMonths(extensionDays)}` : (isOptimizing ? '…' : '—')}
              accent="#34d399"
            />
            <MetricCard
              label="Reboosts Planned"
              value={optimized ? optimized.events.length : '—'}
              sub={optimized?.events.length === 1 ? 'burn' : 'burns'}
              accent="#fbbf24"
            />
            <MetricCard
              label="Fuel Available"
              value={fuelAvailable != null ? fuelAvailable.toFixed(1) : '—'}
              sub="kg"
              accent="#a78bfa"
            />
            <MetricCard
              label="Scenarios Tested"
              value={isOptimizing ? '…' : (scenarioCount || '—')}
              sub="strategies"
              accent="#475569"
            />
          </div>
        )}

        {/* ── Computing state ── */}
        {isOptimizing && (
          <div
            className="rounded-xl p-5 flex items-center gap-4"
            style={{ background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.12)' }}
          >
            <div
              className="w-4 h-4 rounded-full animate-pulse"
              style={{ background: 'rgba(34,211,238,0.5)' }}
            />
            <span className="font-mono text-xs" style={{ color: '#22d3ee' }}>
              Computing optimal reboost schedule — simulating {scenarioCount || '50+'} lifetime scenarios…
            </span>
          </div>
        )}

        {/* ── Chart ── */}
        {hasSpacecraftParams && !isOptimizing && chartData && (
          <div
            className="rounded-2xl p-6"
            style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(30,41,59,0.8)' }}
          >
            <SectionLabel>Altitude Forecast</SectionLabel>

            {/* Reentry threshold legend */}
            <div className="flex items-center gap-6 mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-px" style={{ background: '#22d3ee', height: '2px' }} />
                <span className="font-mono text-xs" style={{ color: '#475569' }}>Optimized schedule</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8" style={{ borderTop: '1.5px dashed rgba(248,113,113,0.5)' }} />
                <span className="font-mono text-xs" style={{ color: '#475569' }}>No reboosts</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-8" style={{ borderTop: '1px dashed rgba(248,113,113,0.3)' }} />
                <span className="font-mono text-xs" style={{ color: '#334155' }}>100 km reentry threshold</span>
              </div>
            </div>

            {/* Reboost event markers above chart */}
            {optimized?.events.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {optimized.events.map((ev, i) => (
                  <span
                    key={i}
                    className="font-mono px-2 py-0.5 rounded text-xs"
                    style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', color: '#fbbf24' }}
                  >
                    ↑ {fmtDate(ev.date)}
                  </span>
                ))}
              </div>
            )}

            <div style={{ height: '280px' }}>
              <Line data={chartData} options={chartOptions} />
            </div>

            {/* Strategy summary */}
            {optimized?.strategy && optimized.strategy.triggerAltKm > 0 && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(30,41,59,0.6)' }}>
                <span className="font-mono text-xs" style={{ color: '#334155' }}>
                  Optimal strategy: reboost when altitude drops to{' '}
                  <span style={{ color: '#fbbf24' }}>{optimized.strategy.triggerAltKm} km</span>
                  {' → '}
                  restore to{' '}
                  <span style={{ color: '#22d3ee' }}>{optimized.strategy.targetAltKm} km</span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── No spacecraft params placeholder chart ── */}
        {!hasSpacecraftParams && (
          <div
            className="rounded-2xl p-6 flex items-center justify-center"
            style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(30,41,59,0.8)', height: '320px' }}
          >
            <div className="text-center">
              <p className="font-mono text-xs" style={{ color: '#1e3a5f' }}>ALTITUDE FORECAST</p>
              <p className="font-mono text-xs mt-3" style={{ color: '#334155' }}>
                Configure spacecraft parameters to enable simulation
              </p>
            </div>
          </div>
        )}

        {/* ── Reboost schedule table ── */}
        {hasSpacecraftParams && !isOptimizing && optimized?.events.length > 0 && (
          <div
            className="rounded-2xl p-6"
            style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(30,41,59,0.8)' }}
          >
            <SectionLabel>Optimal Reboost Schedule</SectionLabel>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(30,41,59,0.8)' }}>
                    {['#', 'Date', 'From Alt', 'To Alt', 'Δv', 'Fuel Used', 'Fuel After'].map(h => (
                      <th
                        key={h}
                        className="pb-3 text-left pr-6 uppercase tracking-[0.15em]"
                        style={{ fontSize: '8px', color: '#334155', fontWeight: '600' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {optimized.events.map((ev, i) => (
                    <tr
                      key={i}
                      style={{ borderBottom: '1px solid rgba(30,41,59,0.4)' }}
                    >
                      <td className="py-3 pr-6" style={{ color: '#334155' }}>{i + 1}</td>
                      <td className="py-3 pr-6" style={{ color: '#94a3b8' }}>{fmtDate(ev.date)}</td>
                      <td className="py-3 pr-6" style={{ color: '#fbbf24' }}>{ev.fromAlt} km</td>
                      <td className="py-3 pr-6" style={{ color: '#22d3ee' }}>{ev.toAlt} km</td>
                      <td className="py-3 pr-6" style={{ color: '#e2e8f0' }}>{ev.dvMs} m/s</td>
                      <td className="py-3 pr-6" style={{ color: '#f87171' }}>{ev.fuelUsed} kg</td>
                      <td className="py-3 pr-6" style={{ color: '#34d399' }}>{ev.fuelAfter} kg</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '1px solid rgba(30,41,59,0.8)' }}>
                    <td colSpan={5} className="pt-3" style={{ color: '#334155' }}>Total</td>
                    <td className="pt-3 pr-6 font-bold" style={{ color: '#f87171' }}>
                      {optimized.events.reduce((s, ev) => s + ev.fuelUsed, 0).toFixed(2)} kg
                    </td>
                    <td className="pt-3 pr-6" style={{ color: '#34d399' }}>
                      {optimized.finalFuelKg.toFixed(2)} kg remaining
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* ── No reboosts message ── */}
        {hasSpacecraftParams && !isOptimizing && optimized?.events.length === 0 && (
          <div
            className="rounded-xl p-5"
            style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(30,41,59,0.7)' }}
          >
            <p className="font-mono text-xs" style={{ color: '#475569' }}>
              No reboosts possible — insufficient fuel or orbit too high to decay within forecast window.
            </p>
          </div>
        )}

        {/* ── Physics disclaimer + navigation ── */}
        <div className="flex items-center justify-between">
          <p className="font-mono" style={{ fontSize: '9px', color: '#1e3a5f' }}>
            Exponential atmosphere model · Hohmann Δv · Tsiolkovsky propellant · First-order approximation
          </p>
          <div className="flex gap-3">
            <Link
              to={`/satellite/${noradId}/reboost`}
              className="font-mono text-xs px-4 py-2 rounded transition-colors"
              style={{
                color: '#475569', background: 'rgba(30,41,59,0.3)',
                border: '1px solid rgba(30,41,59,0.7)',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#22d3ee'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.3)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.borderColor = 'rgba(30,41,59,0.7)'; }}
            >
              ← Reboost Planner
            </Link>
            <Link
              to={`/satellite/${noradId}/maneuver`}
              className="font-mono text-xs px-4 py-2 rounded transition-colors"
              style={{
                color: '#475569', background: 'rgba(30,41,59,0.3)',
                border: '1px solid rgba(30,41,59,0.7)',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#22d3ee'; e.currentTarget.style.borderColor = 'rgba(34,211,238,0.3)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.borderColor = 'rgba(30,41,59,0.7)'; }}
            >
              Maneuver Sandbox →
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
};

export default LifetimeForecaster;
