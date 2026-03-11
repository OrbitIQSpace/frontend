import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { SignedIn, SignedOut, UserButton, SignInButton } from '@clerk/clerk-react';
import AddSatellite from './components/AddSatellite';
import Satellites from './components/Satellites';
import SatelliteDetails from './components/SatelliteDetails';
import DigitalTwin from './components/DigitalTwin';
import ManeuverSandbox from './components/ManeuverSandbox';
import ReboostPlanner from './components/ReboostPlanner';
import GroundStations from './pages/GroundStations';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';

function App() {
  const [refreshTelemetry, setRefreshTelemetry] = useState(0);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const handleSatelliteAdded = () => {
    setRefreshTelemetry(prev => prev + 1);
    setIsAddModalOpen(false);
  };

  return (
    <Router>
      <AppContent
        isAddModalOpen={isAddModalOpen}
        setIsAddModalOpen={setIsAddModalOpen}
        handleSatelliteAdded={handleSatelliteAdded}
        refreshTelemetry={refreshTelemetry}
        setRefreshTelemetry={setRefreshTelemetry}
      />
    </Router>
  );
}

const AppContent = ({ isAddModalOpen, setIsAddModalOpen, handleSatelliteAdded, refreshTelemetry, setRefreshTelemetry }) => {
  const location = useLocation();

  const showAddButton = location.pathname === '/dashboard';
  const isLandingPage = location.pathname === '/';

  return (
    <div
      className="min-h-screen text-white"
      style={{ background: '#020617' }}
    >

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <header
        className="fixed inset-x-0 top-0 z-[9999] backdrop-blur-2xl"
        style={{
          background: 'rgba(2,6,23,0.92)',
          borderBottom: '1px solid rgba(30,41,59,0.7)',
        }}
      >
        <div className="max-w-7xl mx-auto px-6 py-2 flex justify-between items-center">

          {/* Logo */}
          <Link to="/" className="flex items-center space-x-5 group select-none">
            <div className="relative">
              <svg width="160" height="50" viewBox="0 0 220 70" className="drop-shadow-xl group-hover:drop-shadow-cyan-400/80 transition">
                <path d="M 28 38 Q 50 -4 92 20" fill="none" stroke="#06b6d4" strokeWidth="3" opacity="0.7"/>
                <defs>
                  <linearGradient id="trail" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity="0" />
                    <stop offset="30%" stopColor="#06b6d4" stopOpacity="0.9" />
                    <stop offset="70%" stopColor="#06b6d4" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d="M 28 38 Q 50 -4 92 20" fill="none" stroke="url(#trail)" strokeWidth="7" opacity="0.6"/>
                <circle cx="92" cy="20" r="8" fill="#06b6d4">
                  <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite" />
                </circle>
                <circle cx="92" cy="20" r="12" fill="#06b6d4" opacity="0.3" />
                <text x="130" y="55" fontFamily="system-ui, sans-serif" fontWeight="900" fontSize="48" fill="#06b6d4" textAnchor="middle" className="tracking-tight">
                  OrbitIQ
                </text>
              </svg>
            </div>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-4">
            <SignedIn>
              {isLandingPage && (
                <Link to="/dashboard">
                  <button
                    className="px-5 py-2 rounded-lg font-medium text-sm transition-all"
                    style={{
                      background: 'rgba(8,145,178,0.2)',
                      border: '1px solid rgba(34,211,238,0.3)',
                      color: '#22d3ee',
                    }}
                  >
                    Dashboard
                  </button>
                </Link>
              )}
            </SignedIn>

            <SignedOut>
              {isLandingPage && (
                <SignInButton mode="modal">
                  <button
                    className="px-5 py-2 rounded-lg font-medium text-sm transition-all"
                    style={{ background: 'rgba(30,41,59,0.6)', border: '1px solid rgba(51,65,85,0.5)', color: '#94a3b8' }}
                  >
                    Login
                  </button>
                </SignInButton>
              )}
            </SignedOut>

            {/* Add Satellite — dashboard only */}
            {showAddButton && (
              <>
                <Link
                  to="/ground-stations"
                  className="px-4 py-2 rounded-lg text-sm transition-all"
                  style={{
                    border: '1px solid rgba(30,41,59,0.7)',
                    color: '#475569',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '11px',
                    letterSpacing: '0.12em',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                >
                  📡 Ground Stations
                </Link>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className="px-5 py-2 rounded-lg font-medium text-sm transition-all"
                  style={{
                    background: 'rgba(8,145,178,0.25)',
                    border: '1px solid rgba(34,211,238,0.35)',
                    color: '#22d3ee',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '11px',
                    letterSpacing: '0.15em',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(8,145,178,0.4)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(8,145,178,0.25)')}
                >
                  + Add Satellite
                </button>
              </>
            )}

            <SignedIn>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </div>
      </header>

      {/* ── MAIN ────────────────────────────────────────────────────────── */}
      <main className="relative pt-28 min-h-screen max-w-7xl mx-auto px-6 pb-20">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* DASHBOARD */}
          <Route path="/dashboard" element={
            <SignedIn>
              <div
                className="pt-8 pb-20"
                style={{ fontFamily: '"JetBrains Mono", "Fira Code", monospace' }}
              >

                {/* Page header */}
                <div className="mb-12">
                  <p
                    className="text-[9px] tracking-[0.3em] uppercase mb-3"
                    style={{ color: '#475569' }}
                  >
                    OrbitIQ · Fleet Command
                  </p>
                  <h2
                    className="font-black tracking-tighter uppercase italic leading-none"
                    style={{
                      fontSize: 'clamp(2.5rem, 5vw, 4rem)',
                      color: 'white',
                    }}
                  >
                    Satellite Fleet
                  </h2>
                  <p
                    className="mt-2 text-xs tracking-[0.2em] uppercase"
                    style={{ color: '#475569' }}
                  >
                    Live tracking · Telemetry · Command
                  </p>
                </div>

                {/* Satellite list — no wrapper box, just the list */}
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => setRefreshTelemetry(prev => prev + 1)}
                    className="text-[9px] tracking-[0.2em] uppercase font-mono transition-colors px-3 py-1.5 rounded"
                    style={{
                      color: '#334155',
                      border: '1px solid rgba(30,41,59,0.5)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#64748b')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
                  >
                    ↻ Refresh
                  </button>
                </div>

                <Satellites refreshKey={refreshTelemetry} />

                {/* Footer */}
                <div
                  className="mt-16 pt-6 text-center"
                  style={{ borderTop: '1px solid rgba(15,23,42,0.8)' }}
                >
                  <p className="text-[8px] tracking-[0.3em] uppercase"
                    style={{ color: '#334155' }}
                  >
                    OrbitIQ · Real-Time Satellite Command & Control · {new Date().getFullYear()}
                  </p>
                </div>

              </div>
            </SignedIn>
          } />

          {/* SATELLITE DETAILS */}
          <Route path="/satellite/:noradId" element={
            <SignedIn>
              <SatelliteDetails />
            </SignedIn>
          } />

          {/* MISSION CONTROL (Digital Twin) */}
          <Route path="/satellite/:noradId/digital-twin" element={
            <SignedIn>
              <DigitalTwin />
            </SignedIn>
          } />

          {/* MANEUVER SIMULATION SANDBOX */}
          <Route path="/satellite/:noradId/maneuver" element={
            <SignedIn>
              <ManeuverSandbox />
            </SignedIn>
          } />

          {/* REBOOST PLANNER */}
          <Route path="/satellite/:noradId/reboost" element={
            <SignedIn>
              <ReboostPlanner />
            </SignedIn>
          } />

          {/* GROUND STATIONS */}
          <Route path="/ground-stations" element={
            <SignedIn>
              <GroundStations />
            </SignedIn>
          } />
        </Routes>
      </main>

      {/* ── ADD SATELLITE MODAL ──────────────────────────────────────────── */}
      {isAddModalOpen && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
          onClick={() => setIsAddModalOpen(false)}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-2xl p-6 shadow-2xl"
            style={{
              background: 'rgba(2,6,23,0.98)',
              border: '1px solid rgba(34,211,238,0.15)',
              backdropFilter: 'blur(20px)',
              fontFamily: '"JetBrains Mono", monospace',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div
              className="flex justify-between items-center mb-6 pb-4"
              style={{ borderBottom: '1px solid rgba(30,41,59,0.7)' }}
            >
              <div>
                <p className="text-[8px] tracking-[0.25em] uppercase mb-1" style={{ color: '#164e63' }}>
                  Fleet Management
                </p>
                <h3 className="text-sm font-bold text-white tracking-wide">Add Satellite</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded transition-colors"
                style={{ color: '#334155', border: '1px solid rgba(30,41,59,0.6)' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
                onMouseLeave={e => (e.currentTarget.style.color = '#334155')}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <AddSatellite onSatelliteAdded={handleSatelliteAdded} />
          </div>
        </div>
      )}

    </div>
  );
};

export default App;