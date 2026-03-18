// src/pages/GroundStations.js
// Account-wide ground station management — /ground-stations

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import axios from '../api';
import { useAuth } from '@clerk/clerk-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Compute great-circle footprint radius in km for a given satellite altitude
// and elevation mask angle. This is the max slant-range projected to ground.
// rho = arccos(Re / (Re + h)) - elev_mask (in radians)
// footprint_radius = Re * rho
const footprintRadiusKm = (altKm, elevMaskDeg) => {
  const Re    = 6371;
  const rho   = Math.acos(Re / (Re + altKm)) - (elevMaskDeg * Math.PI / 180);
  return rho > 0 ? Re * rho : 0;
};

// Rough coverage % of Earth's surface for a single station at given alt + mask
const coveragePct = (altKm, elevMaskDeg) => {
  const r   = footprintRadiusKm(altKm, elevMaskDeg);
  const pct = (Math.PI * r * r) / (4 * Math.PI * 6371 * 6371) * 100;
  return Math.min(pct, 100).toFixed(1);
};

const ORBIT_ALTS = [
  { label: 'LEO 400 km',  alt: 400  },
  { label: 'LEO 600 km',  alt: 600  },
  { label: 'SSO 550 km',  alt: 550  },
  { label: 'MEO 2000 km', alt: 2000 },
];

// ── Sub-components ────────────────────────────────────────────────────────────

const Field = ({ label, children, hint }) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-[9px] tracking-[0.22em] uppercase font-mono" style={{ color: '#475569' }}>
      {label}
    </label>
    {children}
    {hint && <p className="text-[8px] font-mono" style={{ color: '#1e3a5f' }}>{hint}</p>}
  </div>
);

const Input = ({ value, onChange, placeholder, type = 'text', step }) => (
  <input
    type={type}
    step={step}
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    className="w-full rounded px-3 py-2 text-xs font-mono text-white placeholder-slate-700 outline-none transition-all"
    style={{
      background: 'rgba(2,6,23,0.9)',
      border: '1px solid rgba(30,41,59,0.8)',
    }}
    onFocus={e  => (e.target.style.borderColor = 'rgba(34,211,238,0.4)')}
    onBlur={e   => (e.target.style.borderColor = 'rgba(30,41,59,0.8)')}
  />
);

const Textarea = ({ value, onChange, placeholder }) => (
  <textarea
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    rows={2}
    className="w-full rounded px-3 py-2 text-xs font-mono text-white placeholder-slate-700 outline-none resize-none transition-all"
    style={{
      background: 'rgba(2,6,23,0.9)',
      border: '1px solid rgba(30,41,59,0.8)',
    }}
    onFocus={e => (e.target.style.borderColor = 'rgba(34,211,238,0.4)')}
    onBlur={e  => (e.target.style.borderColor = 'rgba(30,41,59,0.8)')}
  />
);

const StatusPill = ({ children, color }) => (
  <span
    className="text-[7px] tracking-[0.2em] uppercase font-mono px-2 py-0.5 rounded"
    style={{ background: `${color}18`, border: `1px solid ${color}40`, color }}
  >
    {children}
  </span>
);

const EmptyState = () => (
  <div
    className="col-span-full flex flex-col items-center justify-center py-24 rounded-lg"
    style={{ border: '1px dashed rgba(30,41,59,0.6)' }}
  >
    <div className="text-4xl mb-4" style={{ filter: 'grayscale(1) opacity(0.2)' }}>📡</div>
    <p className="text-xs font-mono text-slate-600 tracking-widest uppercase">No ground stations</p>
    <p className="text-[10px] font-mono mt-1" style={{ color: '#1e3a5f' }}>
      Add your first station to start planning contact windows
    </p>
  </div>
);

// ── Main ─────────────────────────────────────────────────────────────────────

const BLANK_FORM = {
  name: '', latitude: '', longitude: '',
  elevation_mask_deg: '5', notes: '',
};

const GroundStations = () => {
  const { getToken } = useAuth();

  const [stations, setStations]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [showForm, setShowForm]       = useState(false);
  const [form, setForm]               = useState(BLANK_FORM);
  const [formError, setFormError]     = useState(null);
  const [saving, setSaving]           = useState(false);
  const [deletingId, setDeletingId]   = useState(null);
  const [editingId, setEditingId]     = useState(null);
  const [expandedId, setExpandedId]   = useState(null);

  // ── Map refs ─────────────────────────────────────────────────────────────
  const mapContainerRef = useRef(null);  // DOM div for Leaflet
  const leafletMapRef   = useRef(null);  // Leaflet Map instance
  const pinMarkerRef    = useRef(null);  // Draggable "new station" pin
  const stationLayerRef = useRef(null);  // LayerGroup for existing markers
  const isDraggingRef   = useRef(false); // True while pin is being dragged

  // ── Fetch ───────────────────────────────────────────────────────────────
  const fetchStations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res   = await axios.get('/api/ground-stations', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStations(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { fetchStations(); }, [fetchStations]);

  // ── Map: initialize Leaflet once on mount ────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || leafletMapRef.current) return;
    const map = L.map(mapContainerRef.current, { preferCanvas: true, zoomControl: true })
      .setView([20, 0], 2);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
      maxZoom: 18,
    }).addTo(map);
    stationLayerRef.current = L.layerGroup().addTo(map);
    leafletMapRef.current = map;
    return () => { map.remove(); leafletMapRef.current = null; };
  }, []);

  // ── Map: redraw existing station markers when stations list changes ───────
  useEffect(() => {
    if (!stationLayerRef.current) return;
    stationLayerRef.current.clearLayers();
    stations.forEach(st => {
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:10px;height:10px;background:#34d399;border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px #34d399;"></div>',
        iconAnchor: [5, 5],
      });
      L.marker([st.latitude, st.longitude], { icon })
        .bindTooltip(st.name, { direction: 'top', offset: [0, -8] })
        .addTo(stationLayerRef.current);
    });
  }, [stations]);

  // ── Map: click handler — place/move pin when form open, open form when not
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    const pinIcon = L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;background:#22d3ee;border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px #22d3ee;cursor:grab;"></div>',
      iconAnchor: [7, 7],
    });

    const placePin = (latlng) => {
      const lat = parseFloat(latlng.lat.toFixed(4));
      const lng = parseFloat(latlng.lng.toFixed(4));
      setForm(f => ({ ...f, latitude: String(lat), longitude: String(lng) }));
      if (pinMarkerRef.current) {
        pinMarkerRef.current.setLatLng(latlng);
      } else {
        const pin = L.marker(latlng, { icon: pinIcon, draggable: true }).addTo(map);
        pin.on('dragstart', () => { isDraggingRef.current = true; });
        pin.on('drag', e => {
          const p = e.latlng;
          setForm(f => ({ ...f,
            latitude:  String(parseFloat(p.lat.toFixed(4))),
            longitude: String(parseFloat(p.lng.toFixed(4))),
          }));
        });
        pin.on('dragend', () => { isDraggingRef.current = false; });
        pinMarkerRef.current = pin;
      }
    };

    const onClick = (e) => {
      if (!showForm) {
        setForm({ ...BLANK_FORM,
          latitude:  String(parseFloat(e.latlng.lat.toFixed(4))),
          longitude: String(parseFloat(e.latlng.lng.toFixed(4))),
        });
        setEditingId(null);
        setFormError('');
        setShowForm(true);
      }
      placePin(e.latlng);
    };

    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [showForm]);

  // ── Map: sync pin position when lat/lon typed manually in form ───────────
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !showForm || isDraggingRef.current) return;

    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);

    // Remove pin if values are cleared or out of range
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      if (pinMarkerRef.current) { pinMarkerRef.current.remove(); pinMarkerRef.current = null; }
      return;
    }

    if (pinMarkerRef.current) {
      // Move existing pin only if position actually changed (avoids feedback loop)
      const cur = pinMarkerRef.current.getLatLng();
      if (Math.abs(cur.lat - lat) > 0.00005 || Math.abs(cur.lng - lng) > 0.00005) {
        pinMarkerRef.current.setLatLng([lat, lng]);
        map.panTo([lat, lng]);
      }
    } else {
      // Create pin when operator types valid coords with no existing pin
      const pinIcon = L.divIcon({
        className: '',
        html: '<div style="width:14px;height:14px;background:#22d3ee;border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px #22d3ee;cursor:grab;"></div>',
        iconAnchor: [7, 7],
      });
      const pin = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(map);
      pin.on('dragstart', () => { isDraggingRef.current = true; });
      pin.on('drag', e => {
        const p = e.latlng;
        setForm(f => ({ ...f,
          latitude:  String(parseFloat(p.lat.toFixed(4))),
          longitude: String(parseFloat(p.lng.toFixed(4))),
        }));
      });
      pin.on('dragend', () => { isDraggingRef.current = false; });
      pinMarkerRef.current = pin;
      map.panTo([lat, lng]);
    }
  }, [form.latitude, form.longitude, showForm]);

  // ── Save (create or update) ─────────────────────────────────────────────
  const handleSave = async () => {
    setFormError(null);
    const { name, latitude, longitude, elevation_mask_deg, notes } = form;
    if (!name.trim())       return setFormError('Station name is required.');
    if (latitude === '')    return setFormError('Latitude is required.');
    if (longitude === '')   return setFormError('Longitude is required.');
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || lat < -90  || lat > 90)   return setFormError('Latitude must be between -90 and 90.');
    if (isNaN(lng) || lng < -180 || lng > 180)  return setFormError('Longitude must be between -180 and 180.');

    setSaving(true);
    try {
      const token   = await getToken();
      const payload = { name: name.trim(), latitude: lat, longitude: lng,
                        elevation_mask_deg: parseFloat(elevation_mask_deg) || 5, notes };
      if (editingId) {
        const res = await axios.patch(`/api/ground-stations/${editingId}`, payload, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setStations(prev => prev.map(s => s.id === editingId ? res.data : s));
      } else {
        const res = await axios.post('/api/ground-stations', payload, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setStations(prev => [...prev, res.data]);
      }
      if (pinMarkerRef.current) { pinMarkerRef.current.remove(); pinMarkerRef.current = null; }
      setShowForm(false);
      setEditingId(null);
      setForm(BLANK_FORM);
    } catch (err) {
      setFormError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      const token = await getToken();
      await axios.delete(`/api/ground-stations/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStations(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setDeletingId(null);
    }
  };

  // ── Edit ────────────────────────────────────────────────────────────────
  const handleEdit = (station) => {
    setForm({
      name:               station.name,
      latitude:           String(station.latitude),
      longitude:          String(station.longitude),
      elevation_mask_deg: String(station.elevation_mask_deg),
      notes:              station.notes || '',
    });
    setEditingId(station.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelForm = () => {
    if (pinMarkerRef.current) { pinMarkerRef.current.remove(); pinMarkerRef.current = null; }
    setShowForm(false);
    setEditingId(null);
    setForm(BLANK_FORM);
    setFormError(null);
  };

  const setField = (key) => (val) => setForm(prev => ({ ...prev, [key]: val }));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen pt-28 pb-24 px-6 max-w-5xl mx-auto"
      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
    >
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="mb-10 flex items-end justify-between">
        <div>
          <p className="text-[9px] tracking-[0.3em] uppercase mb-2" style={{ color: '#475569' }}>
            OrbitIQ · Fleet Command
          </p>
          <h1
            className="font-black tracking-tighter uppercase italic leading-none"
            style={{ fontSize: 'clamp(2rem,4vw,3rem)', color: 'white' }}
          >
            Ground Stations
          </h1>
          <p className="mt-2 text-[10px] tracking-[0.2em] uppercase" style={{ color: '#334155' }}>
            Account-wide · {stations.length} station{stations.length !== 1 ? 's' : ''} configured
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="px-4 py-2 rounded text-[10px] tracking-[0.15em] uppercase font-mono transition-colors"
            style={{ border: '1px solid rgba(30,41,59,0.7)', color: '#475569' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
            onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
          >
            ← Fleet
          </Link>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 rounded text-[10px] tracking-[0.15em] uppercase font-mono font-bold transition-all"
              style={{
                background: 'rgba(34,211,238,0.15)',
                border: '1px solid rgba(34,211,238,0.35)',
                color: '#22d3ee',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,211,238,0.25)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(34,211,238,0.15)')}
            >
              + Add Station
            </button>
          )}
        </div>
      </div>

      {/* ── Interactive map ───────────────────────────────────────────────── */}
      <div
        className="relative rounded-xl overflow-hidden mb-6"
        style={{ border: '1px solid rgba(30,41,59,0.8)' }}
      >
        <div ref={mapContainerRef} style={{ height: 288 }} />
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
          {showForm ? (
            <span
              className="px-3 py-1 rounded-full text-[10px] font-mono tracking-widest uppercase"
              style={{ background: 'rgba(2,6,15,0.85)', border: '1px solid rgba(34,211,238,0.3)', color: '#22d3ee' }}
            >
              Click map to place station
            </span>
          ) : (
            <span
              className="px-3 py-1 rounded-full text-[10px] font-mono tracking-widest uppercase"
              style={{ background: 'rgba(2,6,15,0.85)', border: '1px solid rgba(30,41,59,0.6)', color: '#475569' }}
            >
              Click map to add a station
            </span>
          )}
        </div>
      </div>

      {/* ── Add / Edit form ───────────────────────────────────────────────── */}
      {showForm && (
        <div
          className="mb-8 rounded-lg p-6"
          style={{
            background: 'rgba(2,6,23,0.95)',
            border: `1px solid ${editingId ? 'rgba(251,191,36,0.3)' : 'rgba(34,211,238,0.25)'}`,
          }}
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[8px] tracking-[0.3em] uppercase font-mono mb-1" style={{ color: editingId ? '#fbbf24' : '#0891b2' }}>
                {editingId ? 'Editing Station' : 'New Ground Station'}
              </p>
              <h2 className="text-sm font-bold text-white font-mono tracking-wide">
                {editingId ? form.name || 'Untitled' : 'Add to your network'}
              </h2>
            </div>
            <button
              onClick={handleCancelForm}
              className="text-xs font-mono px-3 py-1.5 rounded transition-colors"
              style={{ border: '1px solid rgba(30,41,59,0.8)', color: '#475569' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
              onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="col-span-2">
              <Field label="Station Name" hint="e.g. AWS Ground Station — Ohio, KSAT Svalbard">
                <Input value={form.name} onChange={setField('name')} placeholder="Kongsberg Svalbard" />
              </Field>
            </div>
            <Field label="Latitude (°)" hint="-90 to +90, positive = North">
              <Input value={form.latitude} onChange={setField('latitude')} placeholder="78.2294" type="number" step="0.0001" />
            </Field>
            <Field label="Longitude (°)" hint="-180 to +180, positive = East">
              <Input value={form.longitude} onChange={setField('longitude')} placeholder="15.3947" type="number" step="0.0001" />
            </Field>
            <Field label="Elevation Mask (°)" hint="Min satellite elevation for contact — typically 5–10°">
              <Input value={form.elevation_mask_deg} onChange={setField('elevation_mask_deg')} placeholder="5" type="number" step="0.5" />
            </Field>
            <Field label="Notes (optional)">
              <Textarea value={form.notes} onChange={setField('notes')} placeholder="Commercial network, $X/pass, max 2 concurrent sessions..." />
            </Field>
          </div>

          {/* Footprint preview */}
          {form.latitude !== '' && form.longitude !== '' && (
            <div
              className="mb-4 rounded px-4 py-3"
              style={{ background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.1)' }}
            >
              <p className="text-[8px] tracking-[0.25em] uppercase font-mono mb-2" style={{ color: '#0891b2' }}>
                Footprint Preview — at elevation mask {form.elevation_mask_deg || 5}°
              </p>
              <div className="grid grid-cols-4 gap-3">
                {ORBIT_ALTS.map(({ label, alt }) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-[7px] font-mono" style={{ color: '#334155' }}>{label}</span>
                    <span className="text-xs font-bold font-mono text-white">
                      {footprintRadiusKm(alt, parseFloat(form.elevation_mask_deg) || 5).toFixed(0)}
                      <span className="text-[8px] font-normal ml-0.5" style={{ color: '#334155' }}>km r</span>
                    </span>
                    <span className="text-[8px] font-mono" style={{ color: '#475569' }}>
                      {coveragePct(alt, parseFloat(form.elevation_mask_deg) || 5)}% Earth
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {formError && (
            <p className="text-[10px] font-mono mb-3" style={{ color: '#f87171' }}>{formError}</p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 rounded text-[10px] tracking-[0.18em] uppercase font-mono font-bold transition-all"
            style={saving ? {
              background: 'rgba(2,6,23,0.6)', border: '1px solid rgba(30,41,59,0.4)', color: '#1e3a5f', cursor: 'not-allowed',
            } : {
              background: editingId ? 'rgba(251,191,36,0.2)' : 'rgba(34,211,238,0.2)',
              border: editingId ? '1px solid rgba(251,191,36,0.4)' : '1px solid rgba(34,211,238,0.4)',
              color: editingId ? '#fbbf24' : '#22d3ee',
            }}
            onMouseEnter={e => { if (!saving) e.currentTarget.style.opacity = '0.8'; }}
            onMouseLeave={e => { if (!saving) e.currentTarget.style.opacity = '1'; }}
          >
            {saving ? '◌ Saving…' : editingId ? '✓ Update Station' : '+ Save Station'}
          </button>
        </div>
      )}

      {/* ── Station list ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <p className="text-[9px] tracking-[0.3em] uppercase font-mono animate-pulse" style={{ color: '#0891b2' }}>
            Loading stations…
          </p>
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-xs font-mono" style={{ color: '#f87171' }}>{error}</p>
          <button onClick={fetchStations} className="mt-3 text-[10px] font-mono text-cyan-600 hover:text-cyan-400 transition-colors">
            Retry
          </button>
        </div>
      ) : stations.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {stations.map((station) => {
            const isExpanded = expandedId === station.id;
            const lat = parseFloat(station.latitude);
            const lng = parseFloat(station.longitude);
            const mask = parseFloat(station.elevation_mask_deg);
            const latStr = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
            const lngStr = `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;

            return (
              <div
                key={station.id}
                className="rounded-lg overflow-hidden transition-all"
                style={{
                  background: 'rgba(2,6,23,0.9)',
                  border: `1px solid ${editingId === station.id ? 'rgba(251,191,36,0.35)' : 'rgba(30,41,59,0.7)'}`,
                }}
              >
                {/* Station header row */}
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : station.id)}
                >
                  <div className="flex items-center gap-4">
                    {/* Antenna icon */}
                    <div
                      className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
                      style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.15)' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <circle cx="7" cy="10" r="1.5" fill="#22d3ee" fillOpacity="0.8" />
                        <line x1="7" y1="10" x2="7" y2="14" stroke="#22d3ee" strokeOpacity="0.5" strokeWidth="1.2" />
                        <path d="M3 7 Q7 2 11 7" stroke="#22d3ee" strokeOpacity="0.6" strokeWidth="1" fill="none" />
                        <path d="M1 5 Q7 -1 13 5" stroke="#22d3ee" strokeOpacity="0.3" strokeWidth="1" fill="none" />
                      </svg>
                    </div>

                    <div>
                      <div className="flex items-center gap-2.5 mb-0.5">
                        <span className="text-sm font-bold text-white font-mono">{station.name}</span>
                        <StatusPill color="#22d3ee">Active</StatusPill>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[9px] font-mono" style={{ color: '#475569' }}>{latStr}</span>
                        <span className="text-[9px] font-mono" style={{ color: '#1e3a5f' }}>·</span>
                        <span className="text-[9px] font-mono" style={{ color: '#475569' }}>{lngStr}</span>
                        <span className="text-[9px] font-mono" style={{ color: '#1e3a5f' }}>·</span>
                        <span className="text-[9px] font-mono" style={{ color: '#334155' }}>
                          {mask}° mask
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={e => { e.stopPropagation(); handleEdit(station); }}
                      className="px-3 py-1.5 rounded text-[9px] tracking-widest uppercase font-mono transition-colors"
                      style={{ border: '1px solid rgba(30,41,59,0.7)', color: '#334155' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#fbbf24')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
                    >
                      Edit
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(station.id); }}
                      disabled={deletingId === station.id}
                      className="px-3 py-1.5 rounded text-[9px] tracking-widest uppercase font-mono transition-colors"
                      style={{ border: '1px solid rgba(30,41,59,0.7)', color: '#334155' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#f87171')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
                    >
                      {deletingId === station.id ? '…' : 'Remove'}
                    </button>
                    <span className="text-[10px] font-mono ml-1" style={{ color: '#1e3a5f' }}>
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </div>
                </div>

                {/* Expanded footprint detail */}
                {isExpanded && (
                  <div
                    className="px-5 pb-5 pt-1"
                    style={{ borderTop: '1px solid rgba(30,41,59,0.5)' }}
                  >
                    {station.notes && (
                      <p className="text-[9px] font-mono mb-4 leading-relaxed" style={{ color: '#475569' }}>
                        {station.notes}
                      </p>
                    )}

                    <p className="text-[8px] tracking-[0.25em] uppercase font-mono mb-3" style={{ color: '#0891b2' }}>
                      Coverage Footprint at {mask}° Elevation Mask
                    </p>
                    <div className="grid grid-cols-4 gap-4">
                      {ORBIT_ALTS.map(({ label, alt }) => {
                        const r   = footprintRadiusKm(alt, mask);
                        const pct = coveragePct(alt, mask);
                        return (
                          <div
                            key={label}
                            className="rounded px-3 py-2.5 flex flex-col gap-1"
                            style={{ background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.1)' }}
                          >
                            <span className="text-[7px] tracking-[0.15em] uppercase font-mono" style={{ color: '#0891b2' }}>
                              {label}
                            </span>
                            <span className="text-sm font-black font-mono text-white">
                              {r.toFixed(0)}<span className="text-[8px] font-normal ml-0.5" style={{ color: '#334155' }}>km</span>
                            </span>
                            <span className="text-[8px] font-mono" style={{ color: '#475569' }}>
                              radius · {pct}% Earth
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-[7px] font-mono mt-3" style={{ color: '#1e3a5f' }}>
                      Added {new Date(station.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer note ───────────────────────────────────────────────────── */}
      {stations.length > 0 && (
        <div className="mt-10 pt-6" style={{ borderTop: '1px solid rgba(15,23,42,0.8)' }}>
          <p className="text-[8px] tracking-[0.22em] uppercase font-mono text-center" style={{ color: '#1e3a5f' }}>
            Stations are shared across your entire fleet · Visible in Mission Control &amp; Maneuver Sandbox
          </p>
        </div>
      )}
    </div>
  );
};

export default GroundStations;