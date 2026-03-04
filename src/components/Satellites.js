import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from '../api';
import { useAuth } from '@clerk/clerk-react';

// Orbit type → accent color mapping
const orbitColor = (type) => {
  if (!type) return { bg: 'rgba(30,41,59,0.5)', border: 'rgba(51,65,85,0.5)', text: '#475569' };
  const t = type.toUpperCase();
  if (t.includes('LEO')) return { bg: 'rgba(5,46,37,0.5)',  border: 'rgba(52,211,153,0.25)', text: '#34d399' };
  if (t.includes('MEO')) return { bg: 'rgba(23,37,84,0.5)', border: 'rgba(99,102,241,0.25)', text: '#818cf8' };
  if (t.includes('GEO')) return { bg: 'rgba(69,26,3,0.5)',  border: 'rgba(251,146,60,0.25)', text: '#fb923c' };
  if (t.includes('HEO')) return { bg: 'rgba(49,10,10,0.5)', border: 'rgba(248,113,113,0.25)', text: '#f87171' };
  return { bg: 'rgba(30,41,59,0.5)', border: 'rgba(51,65,85,0.5)', text: '#475569' };
};

// Parse epoch date from TLE line 1 (characters 18-32)
const parseTleEpoch = (tle_line1) => {
  if (!tle_line1 || tle_line1.length < 32) return null;
  try {
    const year2    = parseInt(tle_line1.slice(18, 20));
    const day      = parseFloat(tle_line1.slice(20, 32));
    const fullYear = year2 < 57 ? 2000 + year2 : 1900 + year2;
    const date     = new Date(Date.UTC(fullYear, 0, 1));
    date.setUTCDate(date.getUTCDate() + Math.floor(day) - 1);
    date.setUTCSeconds(date.getUTCSeconds() + (day % 1) * 86400);
    return date;
  } catch { return null; }
};

// Human-readable "X ago" from a Date
const epochAgo = (date) => {
  if (!date) return null;
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
};

const StatPill = ({ label, value, unit }) => (
  <div className="flex flex-col gap-1">
    <span
      className="font-mono uppercase"
      style={{ fontSize: '9px', letterSpacing: '0.18em', color: '#64748b' }}
    >
      {label}
    </span>
    <span className="font-mono font-bold text-white leading-none" style={{ fontSize: '15px' }}>
      {value ?? '—'}
      {unit && <span style={{ fontSize: '10px', color: '#64748b', marginLeft: 3 }}>{unit}</span>}
    </span>
  </div>
);

const Satellites = ({ refreshKey }) => {
  const [satellites, setSatellites]   = useState([]);
  const [error, setError]             = useState(null);
  const [isLoading, setIsLoading]     = useState(false);
  const [menuId, setMenuId]           = useState(null);   // which card's menu is open
  const [renamingId, setRenamingId]   = useState(null);   // which card is in rename mode
  const [newName, setNewName]         = useState('');

  const { getToken } = useAuth();

  const fetchSatellites = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await axios.get('/api/satellites', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSatellites(res.data);
    } catch (err) {
      setError('Failed to load satellites: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchSatellites();
  }, [refreshKey, fetchSatellites]);

  // Close menus on outside click
  useEffect(() => {
    const handler = () => { setMenuId(null); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const handleDelete = async (noradId) => {
    const name = satellites.find(s => s.norad_id === noradId)?.name || noradId;
    if (!window.confirm(`Remove "${name}" from your fleet?`)) return;
    try {
      const token = await getToken();
      await axios.delete(`/delete-satellite/${noradId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchSatellites();
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleRename = async (noradId) => {
    if (!newName.trim()) return;
    try {
      const token = await getToken();
      await axios.patch(
        `/api/satellite/${noradId}/rename`,
        { name: newName },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setRenamingId(null);
      setNewName('');
      fetchSatellites();
    } catch (err) {
      alert('Rename failed: ' + (err.response?.data?.error || err.message));
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 gap-3"
        style={{ fontFamily: '"JetBrains Mono", monospace' }}
      >
        <div className="w-32 h-px bg-gradient-to-r from-transparent via-cyan-600/40 to-transparent" />
        <p className="text-[9px] tracking-[0.28em] text-cyan-700 uppercase animate-pulse">
          Loading fleet…
        </p>
        <div className="w-32 h-px bg-gradient-to-r from-transparent via-cyan-600/40 to-transparent" />
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (!error && satellites.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 gap-3"
        style={{ fontFamily: '"JetBrains Mono", monospace' }}
      >
        <p className="text-[9px] tracking-[0.28em] text-slate-600 uppercase">No satellites tracked yet</p>
        <p className="text-xs text-slate-700">Add a satellite by NORAD ID to begin.</p>
      </div>
    );
  }

  // ── Main ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="w-full"
      style={{ fontFamily: '"JetBrains Mono", "Fira Code", monospace' }}
    >
      {error && (
        <p className="text-red-400 text-xs font-mono mb-4 tracking-wide">{error}</p>
      )}

      {/* Fleet count header */}
      <div className="flex items-center justify-between mb-5 pb-4"
        style={{ borderBottom: '1px solid rgba(30,41,59,0.6)' }}
      >
        <p className="text-[10px] tracking-[0.22em] uppercase font-mono" style={{ color: '#64748b' }}>
          Fleet · <span style={{ color: '#22d3ee' }}>{satellites.length}</span> satellite{satellites.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="text-[10px] tracking-[0.18em] uppercase font-mono" style={{ color: '#34d399' }}>Live SGP4</span>
        </div>
      </div>

      {/* Satellite cards */}
      <div className="flex flex-col gap-2">
        {satellites.map((sat) => {
          const colors = orbitColor(sat.orbit_type);
          const isMenuOpen    = menuId    === sat.norad_id;
          const isRenaming    = renamingId === sat.norad_id;
          const altDisplay    = sat.altitude   ? `${parseFloat(sat.altitude).toFixed(0)} km`    : null;
          const velDisplay    = sat.orbital_velocity_kms
            ? `${parseFloat(sat.orbital_velocity_kms).toFixed(2)} km/s`
            : null;
          const inclDisplay   = sat.inclination ? `${parseFloat(sat.inclination).toFixed(1)}°` : null;

          return (
            <div
              key={sat.norad_id}
              className="group relative rounded-xl transition-all duration-200"
              style={{
                background: 'rgba(2,6,23,0.7)',
                border: '1px solid rgba(30,41,59,0.7)',
                backdropFilter: 'blur(8px)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.border = '1px solid rgba(34,211,238,0.18)';
                e.currentTarget.style.background = 'rgba(2,6,23,0.9)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.border = '1px solid rgba(30,41,59,0.7)';
                e.currentTarget.style.background = 'rgba(2,6,23,0.7)';
              }}
            >
              {/* Thin left accent bar — color coded by orbit type */}
              <div
                className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full"
                style={{ background: colors.border }}
              />

              <div className="px-5 py-4 pl-6 flex items-center justify-between gap-4">

                {/* Left — name + NORAD + orbit badge */}
                <Link
                  to={`/satellite/${sat.norad_id}`}
                  className="flex-1 min-w-0"
                  onClick={() => setMenuId(null)}
                >
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <p className="text-lg font-bold text-white truncate group-hover:text-cyan-200 transition-colors">
                      {sat.name || 'Unknown Satellite'}
                    </p>
                    {sat.orbit_type && (
                      <span
                        className="shrink-0 text-[7px] tracking-[0.2em] uppercase px-2 py-0.5 rounded-full font-mono"
                        style={{
                          background: colors.bg,
                          border: `1px solid ${colors.border}`,
                          color: colors.text,
                        }}
                      >
                        {sat.orbit_type}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] tracking-[0.15em] font-mono" style={{ color: '#475569' }}>
                    NORAD <span style={{ color: '#0891b2' }}>{sat.norad_id}</span>
                    {sat.tle_line1 && (() => {
                      const epoch = parseTleEpoch(sat.tle_line1);
                      const ago   = epochAgo(epoch);
                      return ago
                        ? <span style={{ color: '#334155' }}> · TLE {ago}</span>
                        : null;
                    })()}
                  </p>
                </Link>

                {/* Centre — stat pills (only render if data exists) */}
                {(altDisplay || velDisplay || inclDisplay) && (
                  <div className="hidden md:flex items-center gap-6 shrink-0">
                    {altDisplay  && <StatPill label="Altitude"    value={altDisplay}  />}
                    {velDisplay  && <StatPill label="Velocity"    value={velDisplay}  />}
                    {inclDisplay && <StatPill label="Inclination" value={inclDisplay} />}
                  </div>
                )}

                {/* Right — quick actions + 3-dot menu */}
                <div
                  className="flex items-center gap-2 shrink-0"
                  onClick={e => e.stopPropagation()}
                >
                  {/* Quick: Mission Control */}
                  <a
                    href={`/satellite/${sat.norad_id}/digital-twin`}
                    className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] tracking-[0.15em] uppercase font-mono transition-all"
                    style={{
                      background: 'rgba(124,58,237,0.15)',
                      border: '1px solid rgba(167,139,250,0.2)',
                      color: '#a78bfa',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(124,58,237,0.3)';
                      e.currentTarget.style.borderColor = 'rgba(167,139,250,0.4)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(124,58,237,0.15)';
                      e.currentTarget.style.borderColor = 'rgba(167,139,250,0.2)';
                    }}
                  >
                    ⌖ Mission Control
                  </a>

                  {/* 3-dot menu */}
                  <div className="relative">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setMenuId(isMenuOpen ? null : sat.norad_id);
                        setRenamingId(null);
                      }}
                      className="p-2 rounded-lg transition-colors"
                      style={{ color: '#475569' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                      aria-label="More options"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                      </svg>
                    </button>

                    {/* Dropdown menu */}
                    {isMenuOpen && !isRenaming && (
                      <div
                        className="absolute right-0 bottom-full mb-1.5 w-40 rounded-lg shadow-2xl z-50 overflow-hidden"
                        style={{
                          background: 'rgba(2,6,23,0.98)',
                          border: '1px solid rgba(30,41,59,0.9)',
                          backdropFilter: 'blur(16px)',
                        }}
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setRenamingId(sat.norad_id);
                            setNewName(sat.name || '');
                            setMenuId(null);
                          }}
                          className="w-full text-left px-4 py-2.5 text-[10px] tracking-[0.15em] uppercase font-mono transition-colors"
                          style={{ color: '#94a3b8' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#e2e8f0')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#94a3b8')}
                        >
                          Rename
                        </button>
                        <div style={{ height: 1, background: 'rgba(30,41,59,0.8)' }} />
                        <button
                          onClick={() => { handleDelete(sat.norad_id); setMenuId(null); }}
                          className="w-full text-left px-4 py-2.5 text-[10px] tracking-[0.15em] uppercase font-mono transition-colors"
                          style={{ color: '#ef4444' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#fca5a5')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#ef4444')}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Inline rename row — slides in below the card content */}
              {isRenaming && (
                <div
                  className="px-5 pb-4 pl-6 flex items-center gap-2"
                  onClick={e => e.stopPropagation()}
                >
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter')  handleRename(sat.norad_id);
                      if (e.key === 'Escape') { setRenamingId(null); setNewName(''); }
                    }}
                    className="flex-1 px-3 py-1.5 rounded text-xs font-mono text-white outline-none"
                    style={{
                      background: 'rgba(15,23,42,0.9)',
                      border: '1px solid rgba(34,211,238,0.3)',
                    }}
                    placeholder="New name…"
                    autoFocus
                  />
                  <button
                    onClick={() => handleRename(sat.norad_id)}
                    className="px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-widest transition-colors"
                    style={{ background: 'rgba(8,145,178,0.7)', color: '#e2e8f0' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(8,145,178,1)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(8,145,178,0.7)')}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setRenamingId(null); setNewName(''); }}
                    className="px-3 py-1.5 rounded text-[10px] font-mono uppercase tracking-widest transition-colors"
                    style={{ background: 'rgba(30,41,59,0.6)', color: '#64748b' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Satellites;