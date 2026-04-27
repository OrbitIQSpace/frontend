// src/pages/Landing.js
import React, { useState } from 'react';

// ── Tiny animation helper — staggered fade-in on mount ───────────────────────
const Reveal = ({ children, delay = 0, className = '' }) => (
  <div
    className={className}
    style={{
      opacity: 0,
      animation: `revealUp 0.7s ease forwards`,
      animationDelay: `${delay}ms`,
    }}
  >
    {children}
  </div>
);

// ── Terminal-style data row ───────────────────────────────────────────────────
const DataRow = ({ label, value, unit, color = '#22d3ee', dimmed = false }) => (
  <div
    className="flex justify-between items-center py-2 px-3"
    style={{ borderBottom: '1px solid rgba(30,41,59,0.4)' }}
  >
    <span
      className="font-mono uppercase"
      style={{ fontSize: '8px', letterSpacing: '0.25em', color: '#334155' }}
    >
      {label}
    </span>
    <span
      className="font-mono font-bold text-xs"
      style={{ color: dimmed ? '#1e3a5f' : color }}
    >
      {value}
      {unit && <span style={{ color: '#475569', fontWeight: 400, marginLeft: 3 }}>{unit}</span>}
    </span>
  </div>
);

// ── Terminal-style card panel ─────────────────────────────────────────────────
const DataPanel = ({ label, children, accent = '#22d3ee', className = '' }) => (
  <div
    className={`rounded-xl overflow-hidden relative ${className}`}
    style={{
      background: 'rgba(2,6,23,0.8)',
      border: '1px solid rgba(30,41,59,0.8)',
    }}
  >
    {/* Top bar */}
    <div
      className="flex items-center justify-between px-4 py-2.5"
      style={{
        background: 'rgba(2,6,23,0.95)',
        borderBottom: '1px solid rgba(30,41,59,0.6)',
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#1e3a5f' }} />
        <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#1e3a5f' }} />
        <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#1e3a5f' }} />
      </div>
      <span
        className="font-mono uppercase absolute left-1/2 -translate-x-1/2"
        style={{ fontSize: '8px', letterSpacing: '0.3em', color: accent }}
      >
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: accent }} />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: accent }} />
        </span>
        <span className="font-mono" style={{ fontSize: '8px', color: '#334155' }}>LIVE</span>
      </div>
    </div>
    {/* Body */}
    <div className="relative">
      <div className="scan-line" />
      {children}
    </div>
  </div>
);

// ── Quick stats pill badge ────────────────────────────────────────────────────
const StatBadge = ({ label, color = '#22d3ee' }) => (
  <span
    className="px-4 py-2 rounded-lg font-mono uppercase"
    style={{
      fontSize: '9px',
      letterSpacing: '0.25em',
      background: 'rgba(2,6,23,0.6)',
      border: `1px solid ${color}25`,
      color,
    }}
  >
    {label}
  </span>
);

// ── Capabilities data ─────────────────────────────────────────────────────────
const capabilities = [
  { title: 'Real-Time Tracking',  color: '#34d399', spec: 'SGP4 · 3s position update · lat/lng/alt' },
  { title: 'Orbital Analysis',    color: '#22d3ee', spec: 'TLE history · apogee/perigee drift · eccentricity · B*' },
  { title: 'System Health',       color: '#a78bfa', spec: 'CSV telemetry · battery charting · subsystem trends' },
  { title: 'Mission Control',     color: '#f97316', spec: '3D Cesium globe · state vector · orbital params' },
  { title: 'Ground Stations',     color: '#22d3ee', spec: 'Account-wide network · footprint coverage · contact windows' },
  { title: 'Reboost Planner',     color: '#f97316', spec: 'Hohmann Δv · Tsiolkovsky fuel · 7-day burn window scan' },
  { title: 'Maneuver Sandbox',    color: '#818cf8', spec: 'First-order burn sim · prograde/retro/radial · Δv slider' },
  { title: 'Lifetime Forecaster', color: '#34d399', spec: 'AI optimizer · 1–3 yr simulation · 50+ strategies · reboost schedule' },
];

// ── Main component ────────────────────────────────────────────────────────────
const Landing = () => {
  const [formData, setFormData]   = useState({ name: '', company: '', message: '' });
  const [formStatus, setFormStatus] = useState('');

  const handleFormSubmit = (e) => {
    e.preventDefault();
    setFormStatus('sending');
    try {
      const subject = encodeURIComponent(`OrbitIQ Inquiry from ${formData.name}${formData.company ? ` (${formData.company})` : ''}`);
      const body    = encodeURIComponent(`Name: ${formData.name}\nCompany: ${formData.company || 'Not provided'}\n\nMessage:\n${formData.message}`);
      window.location.href = `mailto:tyler@orbitiqspace.com?subject=${subject}&body=${body}`;
      setFormStatus('success');
      setFormData({ name: '', company: '', message: '' });
    } catch {
      setFormStatus('error');
    }
  };

  const handleInputChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  return (
    <div
      className="min-h-screen text-white"
      style={{
        background: '#020617',
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      }}
    >

      {/* ── CSS keyframes ──────────────────────────────────────────────────── */}
      <style>{`
        @keyframes revealUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        @keyframes orbit-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes blink-cursor {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        @keyframes scan {
          from { transform: translateY(-100%); }
          to   { transform: translateY(100vh); }
        }
        .orbit-ring {
          animation: orbit-spin 18s linear infinite;
          transform-origin: center;
        }
        .orbit-ring-slow {
          animation: orbit-spin 32s linear infinite reverse;
          transform-origin: center;
        }
        .grid-bg {
          background-image:
            linear-gradient(rgba(34,211,238,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(34,211,238,0.025) 1px, transparent 1px);
          background-size: 48px 48px;
        }
        .terminal-cursor {
          display: inline-block;
          width: 7px;
          height: 13px;
          background: #22d3ee;
          animation: blink-cursor 1s step-end infinite;
          vertical-align: middle;
          margin-left: 3px;
        }
        .scan-line {
          position: absolute;
          width: 100%;
          height: 2px;
          background: linear-gradient(transparent, rgba(34,211,238,0.08), transparent);
          animation: scan 4s linear infinite;
          pointer-events: none;
          z-index: 0;
          top: 0;
        }
        input::placeholder, textarea::placeholder { color: #334155; }
        input:focus, textarea:focus {
          outline: none;
          border-color: rgba(34,211,238,0.4) !important;
        }
      `}</style>

      {/* ════════════════════════════════════════════════════════════════════
          HERO
      ════════════════════════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex flex-col justify-center grid-bg overflow-hidden pt-28 pb-20 px-6">

        {/* Radial glow */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background: 'radial-gradient(ellipse 70% 50% at 50% 40%, rgba(6,182,212,0.07) 0%, transparent 70%)',
          }}
        />

        {/* Animated orbit rings */}
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center opacity-20">
          <svg width="800" height="800" viewBox="0 0 800 800">
            <ellipse cx="400" cy="400" rx="320" ry="120" fill="none" stroke="#22d3ee" strokeWidth="0.8" strokeDasharray="6 8" className="orbit-ring" />
            <ellipse cx="400" cy="400" rx="220" ry="80"  fill="none" stroke="#22d3ee" strokeWidth="0.5" strokeDasharray="4 10" className="orbit-ring-slow" />
            <circle cx="400" cy="400" r="12" fill="#22d3ee" opacity="0.6" />
            <circle cx="400" cy="400" r="22" fill="none" stroke="#22d3ee" strokeWidth="0.5" opacity="0.4" />
          </svg>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto w-full">
          <div className="max-w-4xl">

            <Reveal delay={0}>
              <p className="text-[9px] tracking-[0.35em] uppercase mb-6" style={{ color: '#0891b2' }}>
                Satellite Operations Intelligence
              </p>
            </Reveal>

            <Reveal delay={100}>
              <h1
                className="font-black uppercase italic leading-none mb-6"
                style={{
                  fontSize: 'clamp(3rem, 8vw, 7rem)',
                  letterSpacing: '-0.03em',
                  lineHeight: 0.92,
                }}
              >
                <span style={{ color: 'white' }}>Every orbit</span>
                <br />
                <span style={{ color: '#22d3ee' }}>counts.</span>
              </h1>
            </Reveal>

            <Reveal delay={220}>
              <p className="text-lg mb-4 max-w-2xl leading-relaxed" style={{ color: '#64748b' }}>
                Satellites have a finite lifespan. Atmospheric drag, orbital decay, and unplanned fuel burns eat into mission time every day.
              </p>
              <p className="text-lg mb-10 max-w-2xl leading-relaxed" style={{ color: '#94a3b8' }}>
                OrbitIQ gives operators the intelligence to track degradation, predict decay, and execute precision reboost maneuvers — extending satellite lifespan and maximising mission ROI.
              </p>
            </Reveal>

            <Reveal delay={340}>
              <div className="flex flex-wrap gap-3 items-center">
                <a
                  href="#contact"
                  className="px-8 py-3.5 rounded-lg font-bold text-sm tracking-widest uppercase transition-all"
                  style={{
                    background: 'rgba(8,145,178,0.25)',
                    border: '1px solid rgba(34,211,238,0.4)',
                    color: '#22d3ee',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(8,145,178,0.45)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(8,145,178,0.25)')}
                >
                  Request Access
                </a>
                <a
                  href="#showcase"
                  className="px-8 py-3.5 rounded-lg font-bold text-sm tracking-widest uppercase transition-all"
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(30,41,59,0.8)',
                    color: '#475569',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                >
                  See the Platform ↓
                </a>
              </div>

              {/* Quick stats strip */}
              <div className="mt-8 flex flex-wrap gap-2">
                <StatBadge label="SGP4 Propagation · 3s"   color="#22d3ee" />
                <StatBadge label="Hohmann Transfer Δv"     color="#f97316" />
                <StatBadge label="1–3 yr Lifetime Forecast" color="#34d399" />
                <StatBadge label="AI Reboost Optimizer"    color="#a78bfa" />
              </div>
            </Reveal>

          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          MISSION STATEMENT STRIP
      ════════════════════════════════════════════════════════════════════ */}
      <section
        className="px-6 py-16 text-center"
        style={{ borderTop: '1px solid rgba(30,41,59,0.5)', borderBottom: '1px solid rgba(30,41,59,0.5)' }}
      >
        <div className="max-w-4xl mx-auto">
          <p
            className="font-black uppercase italic leading-tight"
            style={{ fontSize: 'clamp(1.4rem, 3vw, 2.2rem)', color: 'rgba(255,255,255,0.12)', letterSpacing: '-0.02em' }}
          >
            Every satellite that stays in orbit longer means more science completed, more data collected, more value returned.{' '}
            <span style={{ color: 'rgba(34,211,238,0.6)' }}>
              We build the tools to make that happen.
            </span>
          </p>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          FEATURE SHOWCASE
      ════════════════════════════════════════════════════════════════════ */}
      <section
        id="showcase"
        className="px-6 py-24"
        style={{ borderTop: '1px solid rgba(30,41,59,0.5)' }}
      >
        <div className="max-w-7xl mx-auto">

          <div className="mb-10">
            <p className="text-[9px] tracking-[0.3em] uppercase mb-3" style={{ color: '#0891b2' }}>
              Platform · Feature Showcase
            </p>
            <h2
              className="font-black uppercase italic leading-none"
              style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: 'white', letterSpacing: '-0.02em' }}
            >
              The full picture. Every orbit.
            </h2>
            <p className="mt-3 text-sm max-w-xl" style={{ color: '#64748b' }}>
              Eight integrated modules covering every phase of LEO satellite operations.
            </p>
          </div>

          {/* 2-column grid: left has 2 stacked panels, right has 1 tall panel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Left column */}
            <div className="flex flex-col gap-4">

              {/* Panel A — Mission Control + Orbital Analysis */}
              <DataPanel label="Mission Control · Orbital Analysis" accent="#22d3ee">
                {/* State vector */}
                <div className="px-4 pt-4 pb-2">
                  <p
                    className="font-mono uppercase mb-2"
                    style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#0891b2' }}
                  >
                    State Vector · UTC 14:32:07
                  </p>
                </div>
                <DataRow label="Lat"      value="51.6420"  unit="° N"  color="#22d3ee" />
                <DataRow label="Lng"      value="142.8814" unit="° E"  color="#22d3ee" />
                <DataRow label="Alt"      value="421.3"    unit="km"   color="#34d399" />
                <DataRow label="Velocity" value="7.662"    unit="km/s" color="white" />
                <DataRow label="Period"   value="92.7"     unit="min"  color="white" />
                <DataRow label="Inc"      value="51.64"    unit="°"    color="white" />
                <div className="px-3 py-2">
                  <span className="font-mono" style={{ fontSize: '8px', color: '#1e3a5f' }}>
                    NORAD 25544 · ISS (ZARYA) · SGP4
                  </span>
                </div>

                {/* Divider */}
                <div
                  className="flex items-center gap-3 px-4 py-2"
                  style={{ borderTop: '1px solid rgba(30,41,59,0.6)', borderBottom: '1px solid rgba(30,41,59,0.6)' }}
                >
                  <div className="flex-1 h-px" style={{ background: 'rgba(30,41,59,0.4)' }} />
                  <span className="font-mono uppercase" style={{ fontSize: '7px', letterSpacing: '0.3em', color: '#1e3a5f' }}>
                    Orbital Analysis
                  </span>
                  <div className="flex-1 h-px" style={{ background: 'rgba(30,41,59,0.4)' }} />
                </div>

                {/* Sparkline SVG */}
                <div className="px-4 pt-3 pb-1">
                  <svg viewBox="0 0 280 60" width="100%" height="60" style={{ overflow: 'visible' }}>
                    {/* Grid lines */}
                    {[12, 25, 38, 51].map(y => (
                      <line key={y} x1="0" y1={y} x2="280" y2={y} stroke="rgba(30,41,59,0.4)" strokeWidth="0.5" />
                    ))}
                    {/* Apogee line — gentle downward slope */}
                    <polyline
                      points="0,8 40,11 80,13 120,16 160,19 200,22 240,25 280,28"
                      fill="none" stroke="#22d3ee" strokeWidth="1.2" opacity="0.7"
                    />
                    {/* Perigee line — slightly lower */}
                    <polyline
                      points="0,18 40,21 80,24 120,27 160,30 200,33 240,36 280,39"
                      fill="none" stroke="#f97316" strokeWidth="1.2" opacity="0.7"
                    />
                    {/* End dots */}
                    <circle cx="280" cy="28" r="2" fill="#22d3ee" />
                    <circle cx="280" cy="39" r="2" fill="#f97316" />
                  </svg>
                </div>

                {/* Legend */}
                <div className="flex items-center gap-6 px-4 pb-4">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 inline-block rounded-full" style={{ background: '#22d3ee' }} />
                    <span className="font-mono" style={{ fontSize: '8px', color: '#22d3ee' }}>Apogee · 421.3 km</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 inline-block rounded-full" style={{ background: '#f97316' }} />
                    <span className="font-mono" style={{ fontSize: '8px', color: '#f97316' }}>Perigee · 407.2 km</span>
                  </div>
                </div>
              </DataPanel>

              {/* Panel C — Maneuver Sandbox */}
              <DataPanel label="Maneuver Sandbox" accent="#818cf8">
                <div className="grid grid-cols-2 divide-x" style={{ borderColor: 'rgba(30,41,59,0.4)' }}>

                  {/* Left — Burn Parameters */}
                  <div className="p-4">
                    <p className="font-mono uppercase mb-4" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#818cf8' }}>
                      Burn Parameters
                    </p>

                    {/* Burn Time */}
                    <div className="mb-4">
                      <div className="flex justify-between mb-1">
                        <span className="font-mono" style={{ fontSize: '8px', color: '#334155', letterSpacing: '0.2em' }}>BURN TIME</span>
                        <span className="font-mono font-bold" style={{ fontSize: '9px', color: '#818cf8' }}>T+45 min</span>
                      </div>
                      <div className="w-full h-1 rounded-full" style={{ background: 'rgba(30,41,59,0.6)' }}>
                        <div className="h-1 rounded-full" style={{ width: '37%', background: 'rgba(129,140,248,0.5)' }} />
                      </div>
                    </div>

                    {/* Δv Magnitude */}
                    <div className="mb-4">
                      <div className="flex justify-between mb-1">
                        <span className="font-mono" style={{ fontSize: '8px', color: '#334155', letterSpacing: '0.2em' }}>Δv MAG</span>
                        <span className="font-mono font-bold" style={{ fontSize: '9px', color: '#818cf8' }}>28 m/s</span>
                      </div>
                      <div className="w-full h-1 rounded-full" style={{ background: 'rgba(30,41,59,0.6)' }}>
                        <div className="h-1 rounded-full" style={{ width: '28%', background: 'rgba(129,140,248,0.5)' }} />
                      </div>
                    </div>

                    {/* Direction pills */}
                    <div className="mb-4">
                      <span className="font-mono block mb-2" style={{ fontSize: '8px', color: '#334155', letterSpacing: '0.2em' }}>DIRECTION</span>
                      <div className="flex gap-1 flex-wrap">
                        {[
                          { label: 'PRO',   active: true },
                          { label: 'RETRO', active: false },
                          { label: 'RAD+',  active: false },
                          { label: 'RAD-',  active: false },
                        ].map(({ label, active }) => (
                          <span
                            key={label}
                            className="px-2 py-0.5 rounded font-mono"
                            style={{
                              fontSize: '8px',
                              background: active ? 'rgba(129,140,248,0.2)' : 'transparent',
                              border: active ? '1px solid rgba(129,140,248,0.5)' : '1px solid rgba(30,41,59,0.5)',
                              color: active ? '#818cf8' : '#334155',
                            }}
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>

                    <DataRow label="Fuel Cost" value="2.1" unit="kg" color="#818cf8" />
                  </div>

                  {/* Right — Predicted Result */}
                  <div className="p-4">
                    <p className="font-mono uppercase mb-4" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#818cf8' }}>
                      Predicted Result
                    </p>
                    <DataRow label="New Apogee"   value="+31 km"    color="#34d399" />
                    <DataRow label="New Perigee"  value="+28 km"    color="#34d399" />
                    <DataRow label="Period Δ"     value="+0.8 min"  color="white" />
                    <DataRow label="Eccentricity" value="0.00041"   color="white" />
                    <DataRow label="New Orbit"    value="449×435 km" color="#818cf8" />

                    {/* Mini orbit diagram */}
                    <div className="mt-3">
                      <svg viewBox="0 0 140 80" width="100%" height="70">
                        {/* Current orbit */}
                        <ellipse cx="70" cy="40" rx="52" ry="28" fill="none" stroke="#22d3ee" strokeWidth="1" opacity="0.4" />
                        {/* Post-burn orbit */}
                        <ellipse cx="70" cy="40" rx="60" ry="34" fill="none" stroke="#ef4444" strokeWidth="1" opacity="0.6" strokeDasharray="3 3" />
                        {/* Center body */}
                        <circle cx="70" cy="40" r="5" fill="rgba(2,6,23,0.9)" stroke="rgba(34,211,238,0.3)" strokeWidth="0.5" />
                        <circle cx="70" cy="40" r="3" fill="#22d3ee" opacity="0.6" />
                        {/* Burn point */}
                        <circle cx="122" cy="40" r="2.5" fill="#f97316" opacity="0.8" />
                        {/* Labels */}
                        <text x="20" y="68" fill="#475569" fontSize="6" fontFamily="monospace">CURRENT</text>
                        <text x="80" y="14" fill="#ef444470" fontSize="6" fontFamily="monospace">POST-BURN</text>
                      </svg>
                    </div>
                  </div>

                </div>
              </DataPanel>

            </div>{/* end left column */}

            {/* Right column — Reboost Planner (full height) */}
            <DataPanel label="Reboost Planner" accent="#f97316" className="lg:row-span-2">

              {/* Sub-section 1 — Header */}
              <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(30,41,59,0.5)' }}>
                <p className="font-mono uppercase mb-1" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#f97316' }}>
                  90-Day Altitude Forecast · Active
                </p>
                <p className="font-mono" style={{ fontSize: '8px', color: '#1e3a5f' }}>
                  SATELLITE: DEMO-SAT-1 · NORAD: 55XXX · ORBIT: LEO 418km
                </p>
              </div>

              {/* Sub-section 2 — Decay Chart */}
              <div className="px-4 pt-4 pb-2" style={{ borderBottom: '1px solid rgba(30,41,59,0.5)' }}>
                <svg viewBox="0 0 320 100" width="100%" height="100">
                  {/* Background tint */}
                  <rect x="0" y="0" width="320" height="100" fill="rgba(249,115,22,0.02)" />

                  {/* Grid lines */}
                  {[10, 30, 50, 70, 90].map(y => (
                    <line key={y} x1="32" y1={y} x2="320" y2={y} stroke="rgba(30,41,59,0.35)" strokeWidth="0.5" />
                  ))}

                  {/* Y-axis labels */}
                  {[
                    { y: 10, label: '420' },
                    { y: 30, label: '415' },
                    { y: 50, label: '410' },
                    { y: 70, label: '405' },
                    { y: 90, label: '400' },
                  ].map(({ y, label }) => (
                    <text key={label} x="28" y={y + 3} fill="#334155" fontSize="7" fontFamily="monospace" textAnchor="end">{label}</text>
                  ))}

                  {/* Reboost recommended zone */}
                  <rect x="32" y="72" width="288" height="28" fill="rgba(249,115,22,0.06)" />
                  <text x="36" y="88" fill="#f9731640" fontSize="7" fontFamily="monospace">REBOOST RECOMMENDED</text>

                  {/* Minimum safe altitude line */}
                  <line x1="32" y1="90" x2="320" y2="90" stroke="rgba(239,68,68,0.4)" strokeWidth="0.8" strokeDasharray="4 3" />

                  {/* Main decay curve (bezier) */}
                  <path
                    d="M 32,12 C 80,14 140,20 200,32 S 280,55 320,72"
                    fill="none" stroke="#f97316" strokeWidth="1.5"
                  />

                  {/* Current position dot */}
                  <circle cx="32" cy="12" r="3" fill="#f97316" />

                  {/* Projected end dot */}
                  <circle cx="320" cy="72" r="2" fill="rgba(239,68,68,0.7)" />
                </svg>

                {/* X-axis label */}
                <p className="font-mono text-center" style={{ fontSize: '7px', color: '#334155', letterSpacing: '0.1em' }}>
                  NOW · · · · · · · · · · · · · DAY 30 · · · · · · · · · · · DAY 60 · · · · · · · · DAY 90
                </p>
              </div>

              {/* Sub-section 3 — Hohmann Calculator */}
              <div className="px-4 py-4" style={{ borderBottom: '1px solid rgba(30,41,59,0.5)' }}>
                <p className="font-mono uppercase mb-3" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#f97316' }}>
                  Hohmann Transfer · Δv Budget
                </p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {/* Current orbit */}
                  <div>
                    <p className="font-mono uppercase mb-2" style={{ fontSize: '7px', letterSpacing: '0.2em', color: '#475569' }}>Current Orbit</p>
                    <DataRow label="Apogee"    value="421.3"  unit="km"  color="#22d3ee" />
                    <DataRow label="Perigee"   value="407.2"  unit="km"  color="#22d3ee" />
                    <DataRow label="Semi-major a" value="6,785" unit="km" color="white" />
                  </div>
                  {/* Target orbit */}
                  <div>
                    <p className="font-mono uppercase mb-2" style={{ fontSize: '7px', letterSpacing: '0.2em', color: '#475569' }}>Target Orbit</p>
                    <DataRow label="Target Alt" value="450"    unit="km"   color="#f97316" />
                    <DataRow label="Δv₁"        value="+12.4"  unit="m/s"  color="#f97316" />
                    <DataRow label="Δv₂"        value="+11.8"  unit="m/s"  color="#f97316" />
                  </div>
                </div>

                {/* Result row */}
                <div
                  className="rounded-lg px-3 py-3 flex items-center justify-between"
                  style={{
                    background: 'rgba(249,115,22,0.08)',
                    border: '1px solid rgba(249,115,22,0.2)',
                  }}
                >
                  <div>
                    <p className="font-mono uppercase" style={{ fontSize: '7px', letterSpacing: '0.2em', color: '#94a3b8' }}>Total Δv</p>
                    <p className="font-mono font-bold text-sm" style={{ color: '#f97316' }}>24.2 m/s</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono uppercase" style={{ fontSize: '7px', letterSpacing: '0.2em', color: '#94a3b8' }}>Fuel Cost</p>
                    <p className="font-mono font-bold text-sm" style={{ color: '#f97316' }}>1.8 kg</p>
                  </div>
                  <div className="absolute" style={{ display: 'none' }} />
                </div>
                <p className="font-mono mt-2" style={{ fontSize: '7px', color: '#334155' }}>
                  Based on 80kg wet mass · Isp 220s
                </p>
              </div>

              {/* Sub-section 4 — Burn Window Scanner */}
              <div className="px-4 py-4">
                <p className="font-mono uppercase mb-3" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#f97316' }}>
                  7-Day Burn Window Scan
                </p>

                {[
                  { date: 'MAR 14 · 09:42 UTC', dur: '4.2 min', dv: '24.2 m/s', status: 'OPTIMAL',  statusColor: '#34d399', pulse: true },
                  { date: 'MAR 15 · 11:18 UTC', dur: '3.8 min', dv: '25.1 m/s', status: 'GOOD',     statusColor: '#22d3ee', pulse: false },
                  { date: 'MAR 16 · 08:55 UTC', dur: '2.1 min', dv: '27.6 m/s', status: 'MARGINAL', statusColor: '#f97316', pulse: false },
                  { date: 'MAR 18 · 14:03 UTC', dur: '4.6 min', dv: '24.0 m/s', status: 'GOOD',     statusColor: '#22d3ee', pulse: false },
                ].map((w, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg mb-1.5 px-3 py-2"
                    style={{
                      background: 'rgba(2,6,23,0.6)',
                      border: '1px solid rgba(30,41,59,0.5)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {w.pulse ? (
                        <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: w.statusColor }} />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: w.statusColor }} />
                        </span>
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: w.statusColor, opacity: 0.6 }} />
                      )}
                      <span className="font-mono" style={{ fontSize: '9px', color: '#64748b' }}>{w.date}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono" style={{ fontSize: '8px', color: '#475569' }}>{w.dur}</span>
                      <span className="font-mono font-bold" style={{ fontSize: '9px', color: '#94a3b8' }}>{w.dv}</span>
                      <span
                        className="px-2 py-0.5 rounded font-mono"
                        style={{
                          fontSize: '7px',
                          letterSpacing: '0.15em',
                          background: `${w.statusColor}18`,
                          border: `1px solid ${w.statusColor}40`,
                          color: w.statusColor,
                        }}
                      >
                        {w.status}
                      </span>
                    </div>
                  </div>
                ))}

                <p className="font-mono mt-3" style={{ fontSize: '7px', letterSpacing: '0.3em', color: '#0891b2', textTransform: 'uppercase' }}>
                  Ground contact windows cross-referenced with ground station network
                </p>
              </div>

            </DataPanel>

          </div>{/* end 2-col grid */}

          {/* Second row — Ground Stations + Lifetime Forecaster */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">

            {/* Panel D — Ground Stations */}
            <DataPanel label="Ground Station Network · Coverage" accent="#22d3ee">

              {/* Sub-section header */}
              <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(30,41,59,0.5)' }}>
                <p className="font-mono uppercase mb-1" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#22d3ee' }}>
                  Ground Station Network · Coverage
                </p>
                <p className="font-mono" style={{ fontSize: '8px', color: '#1e3a5f' }}>
                  ACCOUNT-WIDE · 3 STATIONS ACTIVE · FOOTPRINT LIVE
                </p>
              </div>

              <div className="grid grid-cols-2 divide-x" style={{ borderColor: 'rgba(30,41,59,0.4)' }}>

                {/* Left — metrics + globe SVG */}
                <div className="p-4">
                  <DataRow label="Station Count"   value="3 active"  color="#22d3ee" />
                  <DataRow label="Total Coverage"  value="~38%"       color="#34d399" />
                  <DataRow label="Elevation Mask"  value="5°"         color="white" />

                  {/* Globe with footprint arcs */}
                  <div className="mt-4">
                    <svg viewBox="0 0 120 100" width="100%" height="90">
                      {/* Globe */}
                      <circle cx="60" cy="50" r="38" fill="rgba(2,6,23,0.8)" stroke="rgba(34,211,238,0.15)" strokeWidth="0.8" />
                      {/* Lat lines */}
                      {[-20, 0, 20].map((lat, i) => {
                        const cy = 50 - lat * 0.55;
                        const rx = Math.sqrt(Math.max(0, 38 * 38 - (cy - 50) * (cy - 50)));
                        return <ellipse key={i} cx="60" cy={cy} rx={rx} ry="4" fill="none" stroke="rgba(34,211,238,0.08)" strokeWidth="0.5" />;
                      })}
                      {/* Lng lines */}
                      {[-1, 0, 1].map((i) => (
                        <ellipse key={i} cx="60" cy="50" rx={i === 0 ? 0 : 15} ry="38" fill="none" stroke="rgba(34,211,238,0.08)" strokeWidth="0.5" transform={`rotate(${i * 45} 60 50)`} />
                      ))}
                      {/* Footprint circles */}
                      <circle cx="48" cy="36" r="14" fill="rgba(52,211,153,0.08)" stroke="#34d399" strokeWidth="0.8" opacity="0.7" />
                      <circle cx="72" cy="44" r="13" fill="rgba(34,211,238,0.06)" stroke="#22d3ee" strokeWidth="0.8" opacity="0.7" />
                      <circle cx="56" cy="62" r="12" fill="rgba(52,211,153,0.06)" stroke="#34d399" strokeWidth="0.8" opacity="0.6" />
                      {/* Station dots */}
                      <circle cx="48" cy="36" r="2" fill="#34d399" />
                      <circle cx="72" cy="44" r="2" fill="#22d3ee" />
                      <circle cx="56" cy="62" r="2" fill="#34d399" />
                    </svg>
                  </div>
                </div>

                {/* Right — station status rows */}
                <div className="p-4">
                  <p className="font-mono uppercase mb-3" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#22d3ee' }}>
                    Station Status
                  </p>
                  {[
                    { name: 'ALPHA-1 · Kennedy SC', range: true },
                    { name: 'BRAVO-2 · Vandenberg',  range: true },
                    { name: 'CHARLIE-3 · Fairbanks', range: false },
                    { name: 'DELTA-4 · McMurdo',     range: false },
                  ].map(({ name, range }) => (
                    <div
                      key={name}
                      className="flex items-center justify-between rounded mb-1.5 px-2 py-1.5"
                      style={{ background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(30,41,59,0.5)' }}
                    >
                      <span className="font-mono" style={{ fontSize: '8px', color: '#475569' }}>{name}</span>
                      <span
                        className="font-mono px-1.5 py-0.5 rounded"
                        style={{
                          fontSize: '7px',
                          letterSpacing: '0.15em',
                          background: range ? 'rgba(52,211,153,0.12)' : 'rgba(71,85,105,0.12)',
                          border: `1px solid ${range ? 'rgba(52,211,153,0.3)' : 'rgba(71,85,105,0.3)'}`,
                          color: range ? '#34d399' : '#475569',
                        }}
                      >
                        {range ? 'IN RANGE' : 'OUT OF RANGE'}
                      </span>
                    </div>
                  ))}
                  <p className="font-mono mt-3" style={{ fontSize: '7px', color: '#334155', letterSpacing: '0.1em' }}>
                    Coverage footprints recalculate live as satellite position updates
                  </p>
                </div>

              </div>
            </DataPanel>

            {/* Panel E — Lifetime Forecaster */}
            <DataPanel label="AI Lifetime Optimizer · Active" accent="#34d399">

              {/* Sub-section header */}
              <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(30,41,59,0.5)' }}>
                <p className="font-mono uppercase mb-1" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#34d399' }}>
                  AI Lifetime Optimizer · Active
                </p>
                <p className="font-mono" style={{ fontSize: '8px', color: '#1e3a5f' }}>
                  DEMO-SAT-1 · LEO 421km · 80kg wet · Isp 220s
                </p>
              </div>

              {/* Key metrics 2×2 grid */}
              <div className="grid grid-cols-2 gap-0" style={{ borderBottom: '1px solid rgba(30,41,59,0.5)' }}>
                {[
                  { label: 'Natural Deorbit', value: '2026-08-12', color: '#f87171' },
                  { label: 'Optimized',       value: '2028-03-22', color: '#34d399' },
                  { label: 'Extension',       value: '+19 months', color: '#34d399' },
                  { label: 'Reboosts',        value: '4 burns',    color: '#22d3ee' },
                ].map(({ label, value, color }, i) => (
                  <div
                    key={label}
                    className="px-4 py-3"
                    style={{
                      borderRight: i % 2 === 0 ? '1px solid rgba(30,41,59,0.4)' : 'none',
                      borderBottom: i < 2 ? '1px solid rgba(30,41,59,0.4)' : 'none',
                    }}
                  >
                    <p className="font-mono uppercase mb-1" style={{ fontSize: '7px', letterSpacing: '0.2em', color: '#334155' }}>{label}</p>
                    <p className="font-mono font-bold text-xs" style={{ color }}>{value}</p>
                  </div>
                ))}
              </div>

              {/* Dual-line altitude chart */}
              <div className="px-4 pt-4 pb-2" style={{ borderBottom: '1px solid rgba(30,41,59,0.5)' }}>
                <svg viewBox="0 0 300 90" width="100%" height="90">
                  {/* Background */}
                  <rect x="0" y="0" width="300" height="90" fill="rgba(52,211,153,0.01)" />
                  {/* Grid lines */}
                  {[10, 28, 46, 64, 82].map(y => (
                    <line key={y} x1="32" y1={y} x2="300" y2={y} stroke="rgba(30,41,59,0.35)" strokeWidth="0.5" />
                  ))}
                  {/* Y-axis labels */}
                  {[
                    { y: 10, label: '430' },
                    { y: 28, label: '420' },
                    { y: 46, label: '410' },
                    { y: 64, label: '400' },
                    { y: 82, label: '390' },
                  ].map(({ y, label }) => (
                    <text key={label} x="28" y={y + 3} fill="#334155" fontSize="7" fontFamily="monospace" textAnchor="end">{label}</text>
                  ))}
                  {/* Natural decay curve — smooth downward bezier (red dashed) */}
                  <path
                    d="M 32,12 C 80,16 130,28 180,46 S 250,68 300,82"
                    fill="none" stroke="#f87171" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7"
                  />
                  {/* Optimized staircase curve (cyan solid) — 3 reboost jumps */}
                  <polyline
                    points="32,12 90,22 90,11 150,20 150,10 210,19 210,10 300,22"
                    fill="none" stroke="#34d399" strokeWidth="1.5" opacity="0.9"
                  />
                  {/* Reboost jump dots */}
                  {[[90,11],[150,10],[210,10]].map(([cx,cy],i) => (
                    <circle key={i} cx={cx} cy={cy} r="2.5" fill="#34d399" opacity="0.8" />
                  ))}
                  {/* Start dot */}
                  <circle cx="32" cy="12" r="2.5" fill="#34d399" />
                  {/* Reentry threshold dashed line */}
                  <line x1="32" y1="85" x2="300" y2="85" stroke="rgba(239,68,68,0.35)" strokeWidth="0.8" strokeDasharray="3 4" />
                  <text x="34" y="83" fill="rgba(239,68,68,0.4)" fontSize="6" fontFamily="monospace">REENTRY</text>
                </svg>
                {/* Legend */}
                <div className="flex items-center gap-5 mt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 inline-block rounded-full" style={{ background: '#34d399' }} />
                    <span className="font-mono" style={{ fontSize: '7px', color: '#34d399' }}>Optimized</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <svg width="16" height="4" viewBox="0 0 16 4"><line x1="0" y1="2" x2="16" y2="2" stroke="#f87171" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" /></svg>
                    <span className="font-mono" style={{ fontSize: '7px', color: '#f87171' }}>Natural decay</span>
                  </div>
                </div>
              </div>

              {/* Reboost schedule table */}
              <div className="px-4 py-4">
                <p className="font-mono uppercase mb-3" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#34d399' }}>
                  Optimal Reboost Schedule
                </p>
                {[
                  { date: 'JUN 2026', from: '408', to: '421', dv: '10.2 m/s', fuel: '0.7 kg' },
                  { date: 'DEC 2026', from: '409', to: '421', dv: '9.8 m/s',  fuel: '0.7 kg' },
                  { date: 'AUG 2027', from: '407', to: '421', dv: '10.5 m/s', fuel: '0.8 kg' },
                ].map((row, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded mb-1.5 px-3 py-2"
                    style={{ background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(30,41,59,0.5)' }}
                  >
                    <span className="font-mono" style={{ fontSize: '8px', color: '#475569' }}>{row.date}</span>
                    <span className="font-mono" style={{ fontSize: '8px', color: '#334155' }}>{row.from}→{row.to} km</span>
                    <span className="font-mono font-bold" style={{ fontSize: '8px', color: '#34d399' }}>{row.dv}</span>
                    <span className="font-mono" style={{ fontSize: '8px', color: '#475569' }}>{row.fuel}</span>
                  </div>
                ))}
                <p className="font-mono mt-3" style={{ fontSize: '7px', color: '#0891b2', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                  50 scenarios simulated · Exponential atmosphere model · Tsiolkovsky propellant
                </p>
              </div>

            </DataPanel>

          </div>{/* end second row */}

        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          HOW IT WORKS
      ════════════════════════════════════════════════════════════════════ */}
      <section
        className="px-6 py-24"
        style={{ borderTop: '1px solid rgba(30,41,59,0.5)' }}
      >
        <div className="max-w-7xl mx-auto">

          <div className="mb-14">
            <p className="text-[9px] tracking-[0.3em] uppercase mb-3" style={{ color: '#0891b2' }}>
              Workflow
            </p>
            <h2
              className="font-black uppercase italic leading-none"
              style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: 'white', letterSpacing: '-0.02em' }}
            >
              Up and running in minutes.
            </h2>
            <p className="mt-3 text-sm max-w-xl" style={{ color: '#64748b' }}>
              No orbital mechanics degree required. If you have a NORAD ID, you have everything you need.
            </p>
          </div>

          {/* Steps — 5-col on md (step · arrow · step · arrow · step) */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-4 items-center">

            {/* Step 01 */}
            <div
              className="rounded-xl p-6 relative overflow-hidden"
              style={{
                background: 'rgba(2,6,23,0.8)',
                border: '1px solid rgba(30,41,59,0.8)',
              }}
            >
              <span
                className="font-black italic absolute top-3 right-4 pointer-events-none select-none"
                style={{ fontSize: '4rem', color: 'rgba(34,211,238,0.06)', lineHeight: 1 }}
              >
                01
              </span>
              <p className="font-mono uppercase mb-4" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#22d3ee' }}>
                Add Your Satellite
              </p>
              <div
                className="px-3 py-2 rounded-lg mb-4 font-mono text-xs text-white"
                style={{
                  background: 'rgba(2,6,23,0.95)',
                  border: '1px solid rgba(34,211,238,0.3)',
                }}
              >
                NORAD ID: 25544<span className="terminal-cursor" />
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#64748b' }}>
                Enter any NORAD catalog number. OrbitIQ fetches the latest TLE from Space-Track and begins propagating position immediately.
              </p>
            </div>

            {/* Arrow */}
            <div className="hidden md:flex items-center justify-center text-xl" style={{ color: '#1e3a5f' }}>→</div>

            {/* Step 02 */}
            <div
              className="rounded-xl p-6 relative overflow-hidden"
              style={{
                background: 'rgba(2,6,23,0.8)',
                border: '1px solid rgba(30,41,59,0.8)',
              }}
            >
              <span
                className="font-black italic absolute top-3 right-4 pointer-events-none select-none"
                style={{ fontSize: '4rem', color: 'rgba(249,115,22,0.06)', lineHeight: 1 }}
              >
                02
              </span>
              <p className="font-mono uppercase mb-4" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#f97316' }}>
                Monitor Orbital Decay
              </p>
              <div
                className="rounded-lg mb-4"
                style={{
                  background: 'rgba(2,6,23,0.95)',
                  border: '1px solid rgba(30,41,59,0.6)',
                }}
              >
                <div className="flex justify-between items-center px-3 py-2" style={{ borderBottom: '1px solid rgba(30,41,59,0.4)' }}>
                  <span className="font-mono" style={{ fontSize: '8px', color: '#334155' }}>APOGEE</span>
                  <span className="font-mono font-bold" style={{ fontSize: '9px', color: '#f97316' }}>↓ 0.12 km/day</span>
                </div>
                <div className="flex justify-between items-center px-3 py-2">
                  <span className="font-mono" style={{ fontSize: '8px', color: '#334155' }}>PERIGEE</span>
                  <span className="font-mono font-bold" style={{ fontSize: '9px', color: '#f97316' }}>↓ 0.09 km/day</span>
                </div>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#64748b' }}>
                Track apogee and perigee drift over TLE history. Visualize decay rate, eccentricity trend, and B* drag coefficient.
              </p>
            </div>

            {/* Arrow */}
            <div className="hidden md:flex items-center justify-center text-xl" style={{ color: '#1e3a5f' }}>→</div>

            {/* Step 03 */}
            <div
              className="rounded-xl p-6 relative overflow-hidden"
              style={{
                background: 'rgba(2,6,23,0.8)',
                border: '1px solid rgba(30,41,59,0.8)',
              }}
            >
              <span
                className="font-black italic absolute top-3 right-4 pointer-events-none select-none"
                style={{ fontSize: '4rem', color: 'rgba(52,211,153,0.06)', lineHeight: 1 }}
              >
                03
              </span>
              <p className="font-mono uppercase mb-4" style={{ fontSize: '8px', letterSpacing: '0.3em', color: '#34d399' }}>
                Forecast and Optimize
              </p>
              <div
                className="rounded-lg p-3 mb-4 font-mono"
                style={{
                  background: 'rgba(2,6,23,0.95)',
                  border: '1px solid rgba(30,41,59,0.6)',
                }}
              >
                <p style={{ fontSize: '9px', color: '#34d399' }}>{'>'} LIFETIME FORECAST COMPLETE</p>
                <p style={{ fontSize: '9px', color: '#94a3b8' }}>{'>'} Natural deorbit:  2026-08-12</p>
                <p style={{ fontSize: '9px', color: '#94a3b8' }}>{'>'} Optimized:        2028-03-22</p>
                <p style={{ fontSize: '9px', color: '#34d399' }}>
                  {'>'} Extension:        +19 months ✓<span className="terminal-cursor" style={{ background: '#34d399' }} />
                </p>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: '#64748b' }}>
                The Lifetime Forecaster simulates 50+ reboost strategies and returns the optimal schedule — exactly when to burn, how much Δv, and how much fuel each maneuver costs.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          CAPABILITIES
      ════════════════════════════════════════════════════════════════════ */}
      <section
        className="px-6 py-24"
        style={{ borderTop: '1px solid rgba(30,41,59,0.5)' }}
      >
        <div className="max-w-7xl mx-auto">

          <div className="mb-14">
            <p className="text-[9px] tracking-[0.3em] uppercase mb-3" style={{ color: '#0891b2' }}>
              Full Capability Stack
            </p>
            <h2
              className="font-black uppercase italic leading-none"
              style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: 'white', letterSpacing: '-0.02em' }}
            >
              Everything operators need.
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">

            {/* Left — live capability list */}
            <div>
              {/* Header */}
              <div className="flex items-center gap-2 mb-6">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
                <span className="font-mono uppercase" style={{ fontSize: '9px', letterSpacing: '0.3em', color: '#34d399' }}>
                  Live · 8 Modules Active
                </span>
              </div>

              {/* Capability rows */}
              {capabilities.map((cap, i) => (
                <div
                  key={cap.title}
                  className="flex items-center gap-4 py-4"
                  style={{
                    borderBottom: i < capabilities.length - 1 ? '1px solid rgba(30,41,59,0.5)' : 'none',
                  }}
                >
                  {/* Accent bar */}
                  <div
                    className="w-0.5 self-stretch rounded-full flex-shrink-0"
                    style={{ background: cap.color, minHeight: '36px' }}
                  />
                  {/* Content */}
                  <div className="flex-1">
                    <p className="text-sm font-bold uppercase tracking-wide text-white mb-0.5">{cap.title}</p>
                    <p className="font-mono" style={{ fontSize: '9px', color: '#475569', letterSpacing: '0.05em' }}>{cap.spec}</p>
                  </div>
                  {/* Live badge */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: cap.color }} />
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: cap.color }} />
                    </span>
                    <span className="font-mono" style={{ fontSize: '8px', letterSpacing: '0.2em', color: cap.color }}>LIVE</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Right — value proposition */}
            <div
              className="rounded-xl p-6"
              style={{
                background: 'rgba(2,6,23,0.6)',
                border: '1px solid rgba(30,41,59,0.6)',
              }}
            >
              <p className="font-mono uppercase mb-6" style={{ fontSize: '9px', letterSpacing: '0.3em', color: '#0891b2' }}>
                What You Get
              </p>

              {[
                { color: '#34d399', text: 'Extend mission lifespan through precision altitude maintenance — every reboost adds months.' },
                { color: '#f97316', text: 'Know your Δv budget before you burn. Tsiolkovsky-calculated fuel cost for every maneuver.' },
                { color: '#34d399', text: 'AI-optimized lifetime forecast: simulate 50+ reboost strategies and get the schedule that maximizes remaining mission life.' },
                { color: '#818cf8', text: 'Simulate before you commit. Test burn parameters in the Sandbox, then execute with confidence.' },
              ].map(({ color, text }, i) => (
                <div key={i} className="flex items-start gap-3 mb-5 last:mb-0">
                  <span className="font-mono font-bold flex-shrink-0 mt-0.5" style={{ fontSize: '12px', color }}>→</span>
                  <p className="text-xs leading-relaxed" style={{ color: '#475569' }}>{text}</p>
                </div>
              ))}

              {/* Stat strip */}
              <div
                className="grid grid-cols-3 gap-3 mt-6 pt-6"
                style={{ borderTop: '1px solid rgba(30,41,59,0.5)' }}
              >
                {[
                  { value: '8',    label: 'live modules',      color: '#22d3ee' },
                  { value: '3s',   label: 'position update',   color: '#34d399' },
                  { value: '3 yr', label: 'lifetime forecast', color: '#f97316' },
                ].map(({ value, label, color }) => (
                  <div key={label} className="text-center">
                    <p className="font-black italic" style={{ fontSize: '1.5rem', color, lineHeight: 1 }}>{value}</p>
                    <p className="font-mono uppercase mt-1" style={{ fontSize: '8px', letterSpacing: '0.2em', color: '#334155' }}>{label}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          CONTACT
      ════════════════════════════════════════════════════════════════════ */}
      <section
        id="contact"
        className="px-6 py-24"
        style={{ borderTop: '1px solid rgba(30,41,59,0.5)' }}
      >
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-start">

          {/* Left — copy */}
          <div>
            <p className="text-[9px] tracking-[0.3em] uppercase mb-4" style={{ color: '#0891b2' }}>
              Early Access
            </p>
            <h2
              className="font-black uppercase italic leading-none mb-6"
              style={{ fontSize: 'clamp(2rem, 4vw, 3.2rem)', color: 'white', letterSpacing: '-0.02em' }}
            >
              Your first paying orbit starts here.
            </h2>
            <p className="text-sm leading-relaxed mb-6" style={{ color: '#64748b' }}>
              We're onboarding a select group of commercial satellite operators for early access. OrbitIQ is built for teams running 1–20 satellites that want to reduce unplanned fuel burns and maximize operational mission lifespan.
            </p>
            <p className="text-sm leading-relaxed mb-10" style={{ color: '#475569' }}>
              Every inquiry goes directly to the founding team. No automated replies.
            </p>

            {/* Orbit types */}
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'LEO', color: '#34d399' },
                { label: 'MEO', color: '#818cf8' },
                { label: 'GEO', color: '#fb923c' },
                { label: 'HEO', color: '#f87171' },
              ].map(({ label, color }) => (
                <span
                  key={label}
                  className="px-3 py-1 rounded-full text-[9px] tracking-[0.2em] uppercase font-mono"
                  style={{
                    background: 'rgba(2,6,23,0.8)',
                    border: `1px solid ${color}30`,
                    color,
                  }}
                >
                  {label}
                </span>
              ))}
              <span
                className="px-3 py-1 rounded-full text-[9px] tracking-[0.2em] uppercase font-mono"
                style={{
                  background: 'rgba(2,6,23,0.8)',
                  border: '1px solid rgba(51,65,85,0.5)',
                  color: '#475569',
                }}
              >
                All orbit types
              </span>
            </div>
          </div>

          {/* Right — form (unchanged) */}
          <div
            className="rounded-2xl p-8"
            style={{
              background: 'rgba(2,6,23,0.8)',
              border: '1px solid rgba(30,41,59,0.8)',
            }}
          >
            <div className="space-y-4">
              {[
                { name: 'name',    placeholder: 'Your name',              type: 'text', required: true },
                { name: 'company', placeholder: 'Company / Organization', type: 'text', required: false },
              ].map(({ name, placeholder, type, required }) => (
                <input
                  key={name}
                  type={type}
                  name={name}
                  value={formData[name]}
                  onChange={handleInputChange}
                  placeholder={placeholder}
                  required={required}
                  className="w-full px-4 py-3 rounded-lg text-sm text-white font-mono transition-all"
                  style={{
                    background: 'rgba(2,6,23,0.9)',
                    border: '1px solid rgba(30,41,59,0.8)',
                    caretColor: '#22d3ee',
                  }}
                />
              ))}
              <textarea
                name="message"
                value={formData.message}
                onChange={handleInputChange}
                placeholder="Tell us about your mission — fleet size, orbit types, key challenges..."
                rows={5}
                required
                className="w-full px-4 py-3 rounded-lg text-sm text-white font-mono transition-all resize-none"
                style={{
                  background: 'rgba(2,6,23,0.9)',
                  border: '1px solid rgba(30,41,59,0.8)',
                  caretColor: '#22d3ee',
                }}
              />

              <button
                onClick={handleFormSubmit}
                disabled={formStatus === 'sending' || !formData.name || !formData.message}
                className="w-full py-3 rounded-lg text-[11px] tracking-[0.25em] uppercase font-bold font-mono transition-all"
                style={
                  formStatus === 'sending' || !formData.name || !formData.message
                    ? { background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(30,41,59,0.5)', color: '#1e3a5f', cursor: 'not-allowed' }
                    : { background: 'rgba(8,145,178,0.2)', border: '1px solid rgba(34,211,238,0.35)', color: '#22d3ee', cursor: 'pointer' }
                }
                onMouseEnter={e => {
                  if (formStatus !== 'sending' && formData.name && formData.message)
                    e.currentTarget.style.background = 'rgba(8,145,178,0.35)';
                }}
                onMouseLeave={e => {
                  if (formStatus !== 'sending' && formData.name && formData.message)
                    e.currentTarget.style.background = 'rgba(8,145,178,0.2)';
                }}
              >
                {formStatus === 'sending' ? 'Sending…' : 'Send Message'}
              </button>

              {formStatus === 'success' && (
                <p className="text-[10px] tracking-[0.2em] uppercase text-center font-mono" style={{ color: '#34d399' }}>
                  ✓ Message sent — we'll be in touch soon.
                </p>
              )}
              {formStatus === 'error' && (
                <p className="text-[10px] tracking-[0.2em] uppercase text-center font-mono" style={{ color: '#f87171' }}>
                  ✕ Failed — email tyler@orbitiqspace.com directly.
                </p>
              )}
            </div>
          </div>

        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════════════════════════ */}
      <footer
        className="px-6 py-10"
        style={{ borderTop: '1px solid rgba(30,41,59,0.5)' }}
      >
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase italic tracking-tight" style={{ color: '#0891b2' }}>
              OrbitIQ
            </p>
            <p className="text-[8px] tracking-[0.2em] uppercase mt-0.5" style={{ color: '#1e3a5f' }}>
              Satellite Operations Intelligence
            </p>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="mailto:tyler@orbitiqspace.com"
              className="text-[9px] tracking-[0.18em] uppercase font-mono transition-colors"
              style={{ color: '#334155' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#64748b')}
              onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
            >
              tyler@orbitiqspace.com
            </a>
            <span className="text-[8px] tracking-[0.2em] uppercase font-mono" style={{ color: '#1e3a5f' }}>
              © {new Date().getFullYear()} OrbitIQ LLC
            </span>
          </div>
        </div>
      </footer>

    </div>
  );
};

export default Landing;
