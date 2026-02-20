// src/components/DigitalTwin.js — Phase 1: 3D Mission Control Viewer
import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import axios from '../api';
import { useAuth } from '@clerk/clerk-react';
import { Viewer, Entity, CameraFlyTo } from 'resium';
import * as Cesium from 'cesium';
import { getSatelliteInfo } from 'tle.js';

Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJiYWQ4MDMxMi0wYTcxLTQxMDYtYWUxZi1mOTdmOGY3OGFkZGQiLCJpZCI6MzU1Njc1LCJpYXQiOjE3NzE1NTMxODB9.ghh9VL3LJS6JJCcg_3NYWI0ho49aTl8XKIb2Qtxt98w';

const DigitalTwin = () => {
  const { noradId } = useParams();
  const { getToken } = useAuth();

  const [satellite, setSatellite] = useState(null);
  const [tle, setTle] = useState(null);
  const [currentPosition, setCurrentPosition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const viewerRef = useRef(null);

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
        const info = getSatelliteInfo(tle, Date.now());
        if (info && typeof info.lat === 'number' && !isNaN(info.lat)) {
          setCurrentPosition({
            lat: Cesium.Math.toRadians(info.lat),
            lng: Cesium.Math.toRadians(info.lng),
            height: (info.height || 420) * 1000, // convert km to meters
            velocity: info.velocity || 7.66 // km/s fallback
          });
        }
      } catch (err) {
        console.error('SGP4 error:', err);
      }
    };

    updatePosition();
    const interval = setInterval(updatePosition, 1500);
    return () => clearInterval(interval);
  }, [tle]);

  // Auto-follow camera
  useEffect(() => {
    if (!currentPosition || !viewerRef.current?.cesiumElement) return;

    const viewer = viewerRef.current.cesiumElement;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        currentPosition.lng,
        currentPosition.lat,
        currentPosition.height + 800000 // zoom distance in meters
      ),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-35), // look slightly down
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

  if (error || !satellite || !currentPosition) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-red-400 text-xl font-mono">
          {error || 'No valid TLE / position available'}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-black text-white overflow-hidden">
      {/* Full-screen Cesium Viewer */}
      <Viewer
        ref={viewerRef}
        full
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
      >
        {/* Satellite entity with point + label */}
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

      {/* Floating HUD – current state */}
      <div className="fixed top-6 left-6 right-6 max-w-5xl mx-auto z-10 pointer-events-none">
        <div className="bg-slate-900/75 backdrop-blur-lg border border-cyan-800/40 rounded-2xl p-6 shadow-2xl">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest">NORAD ID</p>
              <p className="text-2xl font-bold text-cyan-300">{noradId}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest">Latitude</p>
              <p className="text-2xl font-bold text-white">{Cesium.Math.toDegrees(currentPosition.lat).toFixed(4)}°</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest">Longitude</p>
              <p className="text-2xl font-bold text-white">{Cesium.Math.toDegrees(currentPosition.lng).toFixed(4)}°</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest">Altitude</p>
              <p className="text-2xl font-bold text-green-400">{Math.round(currentPosition.height / 1000)} km</p>
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