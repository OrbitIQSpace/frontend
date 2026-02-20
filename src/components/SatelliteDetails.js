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

const SatelliteDetails = () => {
  const { noradId } = useParams();
  const { getToken } = useAuth();

  const [satellite, setSatellite] = useState(null);
  const [telemetry, setTelemetry] = useState([]);
  const [derivedHistory, setDerivedHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [position, setPosition] = useState(null);
  const [activeTab, setActiveTab] = useState('tracking'); 

  // DATA FETCHING
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

        try {
          const derivedRes = await axios.get(`/api/tle_derived/${noradId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          setDerivedHistory(derivedRes.data);
        } catch (err) {
          setDerivedHistory([]);
        }
      } catch (err) {
        const msg = err.response?.data?.error || err.message || "Unknown error";
        setError("Failed to load satellite data: " + msg);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [noradId, getToken]);

  // LIVE TLE TRACKING
  useEffect(() => {
    const line1 = satellite?.tle_line1?.trim();
    const line2 = satellite?.tle_line2?.trim();

    if (!line1 || !line2) {
      if (!isLoading) console.warn('TLE lines missing for:', satellite?.name);
      setPosition(null);
      return;
    }

    const { getSatelliteInfo } = require('tle.js');
    const tle = [line1, line2];

    const updatePosition = () => {
      try {
        const info = getSatelliteInfo(tle, Date.now());
        if (info && typeof info.lat === 'number') {
          setPosition({
            lat: info.lat,
            lng: info.lng,
            altitude: info.height || 0,
          });
        }
      } catch (err) {
        console.error('Tracking calculation error:', err);
      }
    };

    updatePosition();
    const interval = setInterval(updatePosition, 2000);
    return () => clearInterval(interval);
  }, [satellite, isLoading]);

  // ORBITAL DATA SORTING
  const sortedHistory = useMemo(() => {
    return [...derivedHistory].sort((a, b) => new Date(a.epoch) - new Date(b.epoch));
  }, [derivedHistory]);

  const latestDerived = sortedHistory[sortedHistory.length - 1];

  // CHART CONFIGURATION
  const getChartOptions = (title) => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      title: { 
        display: true, 
        text: title, 
        color: '#94a3b8', 
        align: 'start',
        font: { size: 12, weight: 'bold', family: 'monospace' } 
      },
      tooltip: { backgroundColor: '#0f172a', padding: 12, cornerRadius: 8 }
    },
    scales: {
      x: { grid: { color: '#1e293b' }, ticks: { color: '#64748b', font: { size: 10 } } },
      y: { grid: { color: '#1e293b' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
    },
  });

  if (isLoading) return <div className="pt-32 text-center text-cyan-400 font-mono animate-pulse text-2xl tracking-tighter">ESTABLISHING UPLINK...</div>;
  if (error) return <div className="pt-32 text-center text-red-400 font-mono text-xl">{error}</div>;

  return (
    <div className="pt-24 min-h-screen bg-[#020617] text-white px-6 pb-20 selection:bg-cyan-500/30">
      <div className="max-w-7xl mx-auto">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-10 border-b border-slate-800/60 pb-8">
          <div>
            <h1 className="text-7xl font-black tracking-tighter text-white uppercase italic leading-none">
              {satellite.name}
            </h1>
            <p className="mt-4 text-slate-500 font-mono text-sm">
              NORAD ID: <span className="text-cyan-400">{noradId}</span>
            </p>
          </div>
          <Link to="/dashboard" className="px-8 py-3 bg-white text-black hover:bg-cyan-400 transition-all rounded-full font-black uppercase text-xs tracking-widest">
            RETURN TO DASHBOARD
          </Link>
        </div>

        {/* NAVIGATION TABS */}
        <div className="flex flex-wrap gap-2 mb-10 bg-slate-950 p-1.5 rounded-full border border-slate-800/50 w-fit">
          {[
            { id: 'tracking', label: 'Global Tracking' },
            { id: 'history', label: 'Orbital Analysis' },
            { id: 'telemetry', label: 'System Health' },
            { id: 'digital-twin', label: 'Digital Twin' }
          ].map((tab) => (
            <button 
              key={tab.id}
              onClick={() => {
                if (tab.id === 'digital-twin') {
                  // Navigate to dedicated Digital Twin page
                  window.location.href = `/satellite/${noradId}/digital-twin`;
                } else {
                  setActiveTab(tab.id);
                }
              }}
              className={`px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id && tab.id !== 'digital-twin' 
                  ? 'bg-cyan-600 text-white shadow-xl shadow-cyan-900/20' 
                  : tab.id === 'digital-twin'
                    ? 'bg-purple-600 text-white hover:bg-purple-500 shadow-lg shadow-purple-500/30'
                    : 'text-slate-500 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB CONTENT */}
        {activeTab === 'tracking' && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-in fade-in duration-700">
            <div className="lg:col-span-1 space-y-4">
              <div className="bg-slate-900/40 border border-slate-800/50 rounded-3xl p-6 backdrop-blur-sm">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-6">Current Coordinates</h3>
                <div className="space-y-6">
                  <div><p className="text-slate-500 text-[9px] font-mono mb-1">LATITUDE</p><p className="text-3xl font-light text-white font-mono">{position?.lat.toFixed(6) || '—'}°</p></div>
                  <div><p className="text-slate-500 text-[9px] font-mono mb-1">LONGITUDE</p><p className="text-3xl font-light text-white font-mono">{position?.lng.toFixed(6) || '—'}°</p></div>
                  <div className="pt-4 border-t border-slate-800"><p className="text-slate-500 text-[9px] font-mono mb-1">ALTITUDE (MSL)</p><p className="text-3xl font-black text-green-400 font-mono">{position?.altitude.toFixed(2) || '—'} <span className="text-xs">KM</span></p></div>
                </div>
              </div>
              <div className="bg-cyan-600 rounded-3xl p-6 shadow-2xl shadow-cyan-900/20">
                <h3 className="text-[10px] font-black text-cyan-200 uppercase tracking-[0.2em] mb-2">Orbital Velocity</h3>
                <p className="text-4xl font-black text-white font-mono leading-none">
                  {parseFloat(latestDerived?.velocity_kms || 0).toFixed(3)}
                </p>
                <p className="text-[10px] font-bold text-cyan-200 mt-1 font-mono">KILOMETERS / SECOND</p>
              </div>
            </div>
            <div className="lg:col-span-3 h-[650px] rounded-3xl overflow-hidden border border-slate-800/80 shadow-2xl relative">
              {position ? (
                <SatelliteMap position={position} satelliteName={satellite.name} />
              ) : (
                <div className="h-full flex items-center justify-center bg-slate-900/80">
                  <p className="text-cyan-400 text-xl">Waiting for TLE data...</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: ORBITAL ANALYSIS */}
        {activeTab === 'history' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in zoom-in-95 duration-500">
            {/* Apogee vs Perigee Chart */}
            <div className="bg-slate-900/40 border border-slate-800/50 rounded-3xl p-8 h-[400px]">
              <Line 
                options={getChartOptions('ORBITAL ENVELOPE: APOGEE VS PERIGEE (KM)')}
                data={{
                  labels: sortedHistory.map(d => new Date(d.epoch).toLocaleDateString()),
                  datasets: [
                    { label: 'Apogee', data: sortedHistory.map(d => d.apogee_km), borderColor: '#f43f5e', borderWidth: 2, pointRadius: 0, tension: 0.3 },
                    { label: 'Perigee', data: sortedHistory.map(d => d.perigee_km), borderColor: '#10b981', borderWidth: 2, pointRadius: 0, tension: 0.3 }
                  ]
                }}
              />
            </div>

            {/* Eccentricity Chart */}
            <div className="bg-slate-900/40 border border-slate-800/50 rounded-3xl p-8 h-[400px]">
              <Line 
                options={getChartOptions('ECCENTRICITY (ORBITAL ROUNDNESS)')}
                data={{
                  labels: sortedHistory.map(d => new Date(d.epoch).toLocaleDateString()),
                  datasets: [{ 
                    label: 'Eccentricity', 
                    data: sortedHistory.map(d => d.eccentricity), 
                    borderColor: '#f59e0b', 
                    backgroundColor: 'rgba(245, 158, 11, 0.05)',
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 2
                  }]
                }}
              />
            </div>

            {/* Inclination Chart */}
            <div className="bg-slate-900/40 border border-slate-800/50 rounded-3xl p-8 h-[350px]">
              <Line 
                options={getChartOptions('INCLINATION TREND (°) ')}
                data={{
                  labels: sortedHistory.map(d => new Date(d.epoch).toLocaleDateString()),
                  datasets: [{ label: 'Inclination', data: sortedHistory.map(d => d.inclination), borderColor: '#8b5cf6', borderWidth: 2, tension: 0.4 }]
                }}
              />
            </div>

            {/* Decay / Drag Chart */}
            <div className="bg-slate-900/40 border border-slate-800/50 rounded-3xl p-8 h-[350px]">
              <Line 
                options={getChartOptions('ORBITAL DECAY (MEAN MOTION DOT)')}
                data={{
                  labels: sortedHistory.map(d => new Date(d.epoch).toLocaleDateString()),
                  datasets: [{ label: 'Decay', data: sortedHistory.map(d => d.mean_motion_dot), borderColor: '#ef4444', borderWidth: 2, tension: 0.4 }]
                }}
              />
            </div>
          </div>
        )}

        {/* TAB 3: TELEMETRY & SYSTEM HEALTH */}
        {activeTab === 'telemetry' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 animate-in slide-in-from-right-8 duration-500">
             <div className="md:col-span-1 bg-slate-900/40 border border-slate-800/50 rounded-3xl p-8">
               <h3 className="text-lg font-bold mb-2 uppercase tracking-tight text-cyan-400">Manual Telemetry Uplink</h3>
               <p className="text-slate-500 text-xs mb-8">Upload .CSV telemetry packets for processing.</p>
               <Upload noradId={noradId} onUploadSuccess={() => {}} />
             </div>
             <div className="md:col-span-2 bg-slate-900/40 border border-slate-800/50 rounded-3xl p-8 h-[500px]">
               <Line 
                options={getChartOptions('BATTERY POWER BUS (PERCENTAGE)')}
                data={{
                  labels: telemetry.slice().reverse().map(t => new Date(t.timestamp).toLocaleTimeString()),
                  datasets: [{ 
                    label: 'Battery %', 
                    data: telemetry.slice().reverse().map(t => t.battery_level), 
                    borderColor: '#06b6d4',
                    backgroundColor: 'rgba(6, 182, 212, 0.1)',
                    fill: true,
                    tension: 0.4,
                    borderWidth: 3
                  }]
               }} />
             </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default SatelliteDetails;