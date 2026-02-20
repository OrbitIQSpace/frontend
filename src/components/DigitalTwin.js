// src/components/DigitalTwin.js — Phase 1: 3D Mission Control Viewer
import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from '../api';
import { useAuth } from '@clerk/clerk-react';
import { Viewer, Entity } from 'resium';
import * as Cesium from 'cesium';
import { getSatelliteInfo } from 'tle.js';

Cesium.Ion.defaultAccessToken = process.env.REACT_APP_CESIUM_TOKEN || '';

const DigitalTwin = () => {
  const { noradId } = useParams();
  const { getToken } = useAuth();

  const [satellite, setSatellite] = useState(null);
  const [tle, setTle] = useState(null);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const viewerRef = useRef(null);
  // Guard so the camera only flies once on initial position load,
  // instead of re-flying every 1.5s and causing jitter + excess Ion requests
  const hasFlownRef = useRef(false);

  // Fetch satellite data (TLE lines)
  useEffect(() => {
    const fetchSatellite = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const res = await axios.get(`/api/satellite/${noradId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSatellite(res.data);

        if (res.data.tle_line1 && res.data.tle_line2) {
          setTle([res.data.tle_line1.trim(), res.data.tle_line2.trim()]);
        } else {
          setError('No TLE data available for this satellite');
        }
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'Failed to load satellite');
      } finally {
        setLoading(false);
      }
    };

    fetchSatellite();
  }, [noradId, getToken]);

  // Real-time SGP4 propagation
  useEffect(() => {
    if (!tle) return;

    const updatePosition = () => {
      try {
        // tle.js expects either a TLE object or an array [line1, line2]
        // Pass the array directly — works with tle.js v4+
        const info = getSatelliteInfo(tle, Date.now());
        if (info && typeof info.lat === 'number' && !isNaN(info.lat)) {
          setCurrentPosition({
            lat: Cesium.Math.toRadians(info.lat),
            lng: Cesium.Math.toRadians(info.lng),
            height: (info.height || 420) * 1000, // km → meters
            velocity: info.velocity || 7.66        // km/s fallback
          });
        }
      } catch (err) {
        console.error('SGP4 propagation error:', err);
      }
    };

    updatePosition();
    const interval = setInterval(updatePosition, 1500);
    return () => clearInterval(interval);
  }, [tle]);

  // Auto-follow camera — only flies ONCE on first valid position.
  // After that the globe stays in place and the satellite dot moves naturally.
  // Re-flying every 1.5s was causing the "Request has failed" Ion errors
  // because Cesium fires off new tile/asset requests on every flyTo call.
  useEffect(() => {
    if (!currentPosition || !viewerRef.current?.cesiumElement) return;
    if (hasFlownRef.current) return; // skip after first fly

    hasFlownRef.current = true;
    const viewer = viewerRef.current.cesiumElement;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        currentPosition.lng,
        currentPosition.lat,
        currentPosition.height + 800000 // zoom distance in meters
      ),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-35),
        roll: 0.0
      },
      duration: 2.5
    });
  }, [currentPosition]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-cyan-400 text-2xl font-mono animate-pulse">
          Loading Digital Twin...
        </div>
      </div>
    );
  }

  if (error || !satellite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <div className="text-red-400 text-xl font-mono text-center">
            {error || 'No satellite data available'}
          </div>
          <button
            onClick={() => window.history.back()}
            className="px-6 py-3 bg-slate-800/80 hover:bg-slate-700 rounded-full text-white font-medium shadow-lg transition-all"
          >
            ← Back to Details
          </button>
        </div>
      </div>
    );
  }

  // Show a loading state while we wait for the first position fix
  // instead of a hard error — TLE propagation can take a moment
  if (!currentPosition) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-cyan-400 text-xl font-mono animate-pulse">
          Calculating orbital position...
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-black text-white overflow-hidden">
      {/* Full-screen Cesium Viewer
          KEY FIXES:
          - imageryProvider: Use OpenStreetMap (no Ion asset required) to eliminate
            the "Request has failed" Ion tile errors.
          - terrainProvider: Use EllipsoidTerrainProvider (flat ellipsoid, no Ion
            terrain requests) to further cut down on Ion asset calls.
          These two props are the primary cause of the runtime errors you were seeing. */}
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
        requestRenderMode={true}
        backgroundColor={Cesium.Color.BLACK}
        imageryProvider={
          new Cesium.OpenStreetMapImageryProvider({
            url: 'https://tile.openstreetmap.org/'
          })
        }
        terrainProvider={new Cesium.EllipsoidTerrainProvider({})}
      >
        {/* Satellite entity — point marker + label */}
        <Entity
          name={satellite.name}
          position={Cesium.Cartesian3.fromRadians(
            currentPosition.lng,
            currentPosition.lat,
            currentPosition.height
          )}
          point={{
            pixelSize: 14,
            color: Cesium.Color.CYAN,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2
          }}
          label={{
            text: `${satellite.name}\nAlt: ${Math.round(currentPosition.height / 1000)} km`,
            font: 'bold 18px Arial',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -30)
          }}
        />
      </Viewer>

      {/* Floating HUD */}
      <div className="fixed top-6 left-6 right-6 max-w-5xl mx-auto z-10 pointer-events-none">
        <div className="bg-slate-900/75 backdrop-blur-lg border border-cyan-800/40 rounded-2xl p-6 shadow-2xl">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-6 text-center">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest">NORAD ID</p>
              <p className="text-2xl font-bold text-cyan-300">{noradId}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest">Satellite</p>
              <p className="text-lg font-bold text-cyan-200 truncate">{satellite.name}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest">Latitude</p>
              <p className="text-2xl font-bold text-white">
                {Cesium.Math.toDegrees(currentPosition.lat).toFixed(4)}°
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest">Longitude</p>
              <p className="text-2xl font-bold text-white">
                {Cesium.Math.toDegrees(currentPosition.lng).toFixed(4)}°
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest">Altitude</p>
              <p className="text-2xl font-bold text-green-400">
                {Math.round(currentPosition.height / 1000)} km
              </p>
            </div>
          </div>

          {/* Velocity row */}
          <div className="mt-4 pt-4 border-t border-cyan-900/40 flex justify-center gap-8 text-center">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest">Velocity</p>
              <p className="text-xl font-bold text-yellow-300">
                {currentPosition.velocity.toFixed(2)} km/s
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest">Live Tracking</p>
              <p className="text-xl font-bold text-green-400 flex items-center gap-1 justify-center">
                <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-ping" />
                ACTIVE
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Back button */}
      <div className="fixed bottom-6 left-6 z-10">
        <button
          onClick={() => window.history.back()}
          className="px-6 py-3 bg-slate-800/80 hover:bg-slate-700 rounded-full text-white font-medium shadow-lg transition-all"
        >
          ← Back to Details
        </button>
      </div>
    </div>
  );
};

export default DigitalTwin;