// src/pages/Landing.js
import React, { useEffect, useState } from 'react';
import { getSatelliteInfo } from 'tle.js';
import SatelliteMap from '../components/SatelliteMap';
import axios from '../api';

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

const Landing = () => {
  const [issPosition, setIssPosition]   = useState(null);
  const [issTle, setIssTle]             = useState(null);
  const [loadingTle, setLoadingTle]     = useState(true);
  const [issCoords, setIssCoords]       = useState({ lat: '—', lng: '—', alt: '—' });

  const [formData, setFormData] = useState({ name: '', company: '', message: '' });
  const [formStatus, setFormStatus] = useState(''); // sending | success | error

  // ── Fetch live ISS TLE ────────────────────────────────────────────────────
  useEffect(() => {
    const fetchIssTle = async () => {
      try {
        const res = await axios.get('/api/public/iss');
        if (res.data?.line1 && res.data?.line2) {
          setIssTle(res.data);
        } else throw new Error('bad TLE');
      } catch {
        setIssTle({
          name: 'ISS (ZARYA)',
          line1: '1 25544U 98067A   25360.53473604  .00013978  00000-0  25382-3 0  9999',
          line2: '2 25544  51.6320  74.1581 0003231 305.5588  54.5099 15.49844261544995',
        });
      } finally {
        setLoadingTle(false);
      }
    };
    fetchIssTle();
  }, []);

  // ── SGP4 live position tick ───────────────────────────────────────────────
  useEffect(() => {
    if (!issTle || loadingTle) return;
    const tle = [issTle.line1.trim(), issTle.line2.trim()];

    const tick = () => {
      try {
        const info = getSatelliteInfo(tle, Date.now());
        if (info && typeof info.lat === 'number') {
          setIssPosition({ lat: info.lat, lng: info.lng, altitude: Math.round(info.height || 420) });
          setIssCoords({
            lat: info.lat >= 0 ? `${info.lat.toFixed(4)}° N` : `${Math.abs(info.lat).toFixed(4)}° S`,
            lng: info.lng >= 0 ? `${info.lng.toFixed(4)}° E` : `${Math.abs(info.lng).toFixed(4)}° W`,
            alt: `${Math.round(info.height || 420)} km`,
          });
        }
      } catch {}
    };

    tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [issTle, loadingTle]);

  // ── Contact form ──────────────────────────────────────────────────────────
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

  // ── Capability cards ──────────────────────────────────────────────────────
  const capabilities = [
    {
      label: 'Live Now',
      title: 'Real-Time Tracking',
      body: 'SGP4-propagated position updated every 3 seconds. Lat, lng, altitude — always current.',
      color: '#34d399',
      live: true,
    },
    {
      label: 'Live Now',
      title: 'Orbital Analysis',
      body: 'TLE history charts showing apogee/perigee drift, eccentricity trends, and decay rate over time.',
      color: '#38bdf8',
      live: true,
    },
    {
      label: 'Live Now',
      title: 'System Health',
      body: 'Upload telemetry CSV packets to visualize battery and subsystem health across your mission.',
      color: '#a78bfa',
      live: true,
    },
    {
      label: 'Live Now',
      title: 'Mission Control',
      body: '3D globe viewer with live satellite position, state vector, and orbital parameters in one screen.',
      color: '#fb923c',
      live: true,
    },
    {
      label: 'Coming Soon',
      title: 'Decay Prediction',
      body: 'Model atmospheric drag and ballistic coefficient to forecast re-entry window months in advance.',
      color: '#f43f5e',
      live: false,
    },
    {
      label: 'Coming Soon',
      title: 'Reboost Planning',
      body: 'Calculate optimal ΔV maneuvers and timing windows to restore target orbit altitude.',
      color: '#f59e0b',
      live: false,
    },
    {
      label: 'Coming Soon',
      title: 'Orbit Simulation',
      body: 'Full numerical propagation with perturbation models — J2, drag, SRP — for high-fidelity planning.',
      color: '#22d3ee',
      live: false,
    },
    {
      label: 'Coming Soon',
      title: 'ΔV Optimizer',
      body: 'Multi-objective optimizer that minimizes fuel burn while meeting orbit maintenance constraints.',
      color: '#34d399',
      live: false,
    },
  ];

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

        {/* Radial glow behind hero text */}
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            background: 'radial-gradient(ellipse 70% 50% at 50% 40%, rgba(6,182,212,0.07) 0%, transparent 70%)',
          }}
        />

        {/* Animated orbit rings — decorative */}
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
              <p
                className="text-[9px] tracking-[0.35em] uppercase mb-6"
                style={{ color: '#0891b2' }}
              >
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
              <p
                className="text-lg mb-4 max-w-2xl leading-relaxed"
                style={{ color: '#64748b' }}
              >
                Satellites have a finite lifespan. Atmospheric drag, orbital decay, and unplanned fuel burns eat into mission time every day.
              </p>
              <p
                className="text-lg mb-10 max-w-2xl leading-relaxed"
                style={{ color: '#94a3b8' }}
              >
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
                  href="#demo"
                  className="px-8 py-3.5 rounded-lg font-bold text-sm tracking-widest uppercase transition-all"
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(30,41,59,0.8)',
                    color: '#475569',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                >
                  See Live Demo ↓
                </a>
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
          LIVE ISS DEMO
      ════════════════════════════════════════════════════════════════════ */}
      <section id="demo" className="px-6 py-24">
        <div className="max-w-7xl mx-auto">

          {/* Section label */}
          <div className="mb-10">
            <p className="text-[9px] tracking-[0.3em] uppercase mb-3" style={{ color: '#0891b2' }}>
              Live Demo · International Space Station
            </p>
            <h2
              className="font-black uppercase italic leading-none"
              style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: 'white', letterSpacing: '-0.02em' }}
            >
              Your satellites, tracked in real time.
            </h2>
            <p className="mt-3 text-sm max-w-xl" style={{ color: '#64748b' }}>
              Live SGP4 propagation from Space-Track TLE data. Position updates every 3 seconds.
            </p>
          </div>

          {/* Map + live stat strip */}
          <div className="relative rounded-2xl overflow-hidden" style={{ border: '1px solid rgba(30,41,59,0.7)' }}>

            {/* Live coordinate strip */}
            <div
              className="flex items-center justify-between px-6 py-3"
              style={{
                background: 'rgba(2,6,23,0.95)',
                borderBottom: '1px solid rgba(30,41,59,0.7)',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                <span className="text-[9px] tracking-[0.2em] uppercase font-mono" style={{ color: '#34d399' }}>
                  {issTle?.name || 'ISS (ZARYA)'}
                </span>
              </div>
              <div className="flex items-center gap-8">
                {[
                  { label: 'Lat', value: issCoords.lat },
                  { label: 'Lng', value: issCoords.lng },
                  { label: 'Alt', value: issCoords.alt },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-[8px] tracking-[0.2em] uppercase font-mono" style={{ color: '#334155' }}>{label}</span>
                    <span className="text-xs font-bold font-mono text-white">{value}</span>
                  </div>
                ))}
              </div>
              <span className="text-[8px] tracking-[0.2em] uppercase font-mono" style={{ color: '#1e3a5f' }}>SGP4 / TLE</span>
            </div>

            {/* Map */}
            <div style={{ height: 560 }}>
              {issPosition ? (
                <SatelliteMap position={issPosition} satelliteName={issTle?.name || 'ISS (ZARYA)'} />
              ) : (
                <div
                  className="h-full flex items-center justify-center"
                  style={{ background: 'rgba(2,6,23,0.9)' }}
                >
                  <p className="text-[9px] tracking-[0.3em] uppercase font-mono animate-pulse" style={{ color: '#0891b2' }}>
                    Establishing ground link…
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          CAPABILITIES GRID
      ════════════════════════════════════════════════════════════════════ */}
      <section
        className="px-6 py-24"
        style={{ borderTop: '1px solid rgba(30,41,59,0.5)' }}
      >
        <div className="max-w-7xl mx-auto">

          <div className="mb-14">
            <p className="text-[9px] tracking-[0.3em] uppercase mb-3" style={{ color: '#0891b2' }}>
              Platform Capabilities
            </p>
            <h2
              className="font-black uppercase italic leading-none"
              style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', color: 'white', letterSpacing: '-0.02em' }}
            >
              Built for the full mission lifecycle.
            </h2>
            <p className="mt-3 text-sm max-w-xl" style={{ color: '#64748b' }}>
              From launch to deorbit — OrbitIQ covers every phase of satellite operations.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {capabilities.map((cap) => (
              <div
                key={cap.title}
                className="rounded-xl p-5 transition-all duration-200 group"
                style={{
                  background: cap.live ? 'rgba(2,6,23,0.8)' : 'rgba(2,6,23,0.4)',
                  border: cap.live
                    ? `1px solid rgba(30,41,59,0.8)`
                    : '1px dashed rgba(30,41,59,0.5)',
                }}
                onMouseEnter={e => {
                  if (cap.live) e.currentTarget.style.borderColor = `${cap.color}30`;
                }}
                onMouseLeave={e => {
                  if (cap.live) e.currentTarget.style.borderColor = 'rgba(30,41,59,0.8)';
                }}
              >
                {/* Status badge */}
                <div className="flex items-center gap-1.5 mb-4">
                  {cap.live ? (
                    <>
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: cap.color }} />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: cap.color }} />
                      </span>
                      <span className="text-[8px] tracking-[0.2em] uppercase font-mono" style={{ color: cap.color }}>Live</span>
                    </>
                  ) : (
                    <span className="text-[8px] tracking-[0.2em] uppercase font-mono" style={{ color: '#1e3a5f' }}>Coming Soon</span>
                  )}
                </div>

                {/* Thin color accent line */}
                <div
                  className="w-6 h-0.5 mb-3 rounded-full"
                  style={{ background: cap.live ? cap.color : '#1e3a5f' }}
                />

                <h3
                  className="text-sm font-bold mb-2 uppercase tracking-wide"
                  style={{ color: cap.live ? 'white' : '#334155' }}
                >
                  {cap.title}
                </h3>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: cap.live ? '#475569' : '#1e3a5f' }}
                >
                  {cap.body}
                </p>
              </div>
            ))}
          </div>

          {/* Mission horizon note */}
          <div
            className="mt-8 rounded-xl px-6 py-4 flex items-center gap-4"
            style={{
              background: 'rgba(2,6,23,0.6)',
              border: '1px dashed rgba(34,211,238,0.08)',
            }}
          >
            <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: 'rgba(34,211,238,0.15)' }} />
            <p className="text-xs leading-relaxed" style={{ color: '#334155' }}>
              <span style={{ color: '#475569' }}>The mission of OrbitIQ</span> is to extend satellite operational lifespan through precision orbital intelligence.
              Decay prediction, reboost planning, and ΔV optimization are in active development —
              built to give operators the tools to keep their satellites flying longer.
            </p>
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
              Extend your mission.
            </h2>
            <p className="text-sm leading-relaxed mb-6" style={{ color: '#64748b' }}>
              We're onboarding a select group of satellite operators to shape the product roadmap.
              If your team operates LEO, MEO, or GEO satellites and wants to reduce fuel burn
              and maximize operational lifespan — we want to talk.
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

          {/* Right — form */}
          <div
            className="rounded-2xl p-8"
            style={{
              background: 'rgba(2,6,23,0.8)',
              border: '1px solid rgba(30,41,59,0.8)',
            }}
          >
            <div className="space-y-4">
              {[
                { name: 'name',    placeholder: 'Your name',               type: 'text',  required: true },
                { name: 'company', placeholder: 'Company / Organization',  type: 'text',  required: false },
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