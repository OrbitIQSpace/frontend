// src/hooks/useGroundStations.js
// Fetches account-wide ground stations and renders them on a Cesium globe.
// Used by MissionControl, ManeuverSandbox, and ReboostPlanner.
//
// Returns:
//   stations          — raw station array from the API
//   loading           — fetch in progress
//   checkVisibility   — fn(stationId, tleSatInfo) → bool: is satellite in view?

import { useEffect, useState, useRef, useCallback } from 'react';
import axios from '../api';
import { useAuth } from '@clerk/clerk-react';
import * as Cesium from 'cesium';

// ── Visibility math ───────────────────────────────────────────────────────────
// Returns true if the satellite at {lat, lng, heightM} is above the station's
// elevation mask as seen from the ground station at {lat, lng}.
export const isSatVisible = (stationLat, stationLng, satLat, satLng, satHeightM, elevMaskDeg) => {
  const Re = 6371000; // m
  const toRad = d => d * Math.PI / 180;

  const φ1 = toRad(stationLat), λ1 = toRad(stationLng);
  const φ2 = toRad(satLat),     λ2 = toRad(satLng);

  // Great-circle angle between station and satellite ground track
  const Δφ = φ2 - φ1;
  const Δλ = λ2 - λ1;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const centralAngle = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); // radians

  const r  = Re + satHeightM;
  // Ground range between station and satellite subpoint
  // Elevation angle from station to satellite
  const elevRad = Math.atan2(
    r * Math.cos(centralAngle) - Re,
    r * Math.sin(centralAngle)
  );
  const elevDeg = elevRad * 180 / Math.PI;

  return elevDeg >= elevMaskDeg;
};

// Build a solid circle polygon of positions around a lat/lng center
// at a given radius in km — for the footprint ring on the globe.
const buildCirclePositions = (centerLat, centerLng, radiusKm, numPoints = 64) => {
  const positions = [];
  const Re = 6371;
  const angularRadius = radiusKm / Re; // radians

  for (let i = 0; i <= numPoints; i++) {
    const bearing = (i / numPoints) * 2 * Math.PI;
    const φ1 = centerLat * Math.PI / 180;
    const λ1 = centerLng * Math.PI / 180;

    const φ2 = Math.asin(
      Math.sin(φ1) * Math.cos(angularRadius) +
      Math.cos(φ1) * Math.sin(angularRadius) * Math.cos(bearing)
    );
    const λ2 = λ1 + Math.atan2(
      Math.sin(bearing) * Math.sin(angularRadius) * Math.cos(φ1),
      Math.cos(angularRadius) - Math.sin(φ1) * Math.sin(φ2)
    );

    positions.push(Cesium.Cartesian3.fromRadians(λ2, φ2, 1000));
  }
  return positions;
};

// ── Hook ──────────────────────────────────────────────────────────────────────
const useGroundStations = (viewerRef, currentSatPosition) => {
  const { getToken }      = useAuth();
  const [stations, setStations] = useState([]);
  const [loading, setLoading]   = useState(true);
  const stationEntitiesRef      = useRef([]);

  // ── Fetch stations ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const fetch_ = async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const res   = await axios.get('/api/ground-stations', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setStations(res.data);
      } catch (err) {
        console.error('useGroundStations fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch_();
    return () => { cancelled = true; };
  }, [getToken]);

  // ── Draw stations on globe ────────────────────────────────────────────
  // Redraws whenever stations list or satellite position changes — footprint
  // color flips green/red based on current visibility.
  const drawStations = useCallback(() => {
    if (!viewerRef.current?.cesiumElement || !stations.length) return;
    const viewer = viewerRef.current.cesiumElement;

    // Determine current satellite altitude for footprint radius calculation
    const satHeightM  = currentSatPosition?.height ?? 420000;
    const satAltKm    = satHeightM / 1000;
    const satLat      = currentSatPosition ? currentSatPosition.lat * 180 / Math.PI : null;
    const satLng      = currentSatPosition ? currentSatPosition.lng * 180 / Math.PI : null;

    // Remove old station entities
    stationEntitiesRef.current.forEach(e => { try { viewer.entities.remove(e); } catch {} });
    stationEntitiesRef.current = [];

    const added = [];

    stations.forEach(station => {
      const lat  = parseFloat(station.latitude);
      const lng  = parseFloat(station.longitude);
      const mask = parseFloat(station.elevation_mask_deg);

      // Visibility check
      const visible = satLat !== null
        ? isSatVisible(lat, lng, satLat, satLng, satHeightM, mask)
        : false;

      // Colors
      const dotColor      = visible ? '#34d399' : '#64748b';
      const ringColor     = visible ? '#34d399' : '#475569';
      const ringAlpha     = visible ? 0.18      : 0.07;
      const outlineAlpha  = visible ? 0.55      : 0.2;

      // Footprint radius at current satellite altitude
      const Re            = 6371;
      const rho           = Math.acos(Re / (Re + satAltKm)) - (mask * Math.PI / 180);
      const radiusKm      = rho > 0 ? Re * rho : 0;

      // ── Filled footprint circle ──────────────────────────────────────
      if (radiusKm > 0) {
        const circlePositions = buildCirclePositions(lat, lng, radiusKm);

        // Filled polygon (solid circle footprint)
        added.push(viewer.entities.add({
          polygon: {
            hierarchy:       new Cesium.PolygonHierarchy(circlePositions),
            material:        Cesium.Color.fromCssColorString(ringColor).withAlpha(ringAlpha),
            outline:         true,
            outlineColor:    Cesium.Color.fromCssColorString(ringColor).withAlpha(outlineAlpha),
            outlineWidth:    1.5,
            height:          500,
            perPositionHeight: false,
          },
        }));
      }

      // ── Station marker dot ────────────────────────────────────────────
      added.push(viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lng, lat, 500),
        point: {
          pixelSize:    10,
          color:        Cesium.Color.fromCssColorString(dotColor),
          outlineColor: Cesium.Color.fromCssColorString('#020617'),
          outlineWidth: 2,
        },
        label: {
          text:              station.name,
          font:              'bold 10px "JetBrains Mono", monospace',
          fillColor:         Cesium.Color.fromCssColorString(visible ? '#a7f3d0' : '#64748b'),
          outlineColor:      Cesium.Color.BLACK,
          outlineWidth:      2,
          style:             Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin:    Cesium.VerticalOrigin.BOTTOM,
          pixelOffset:       new Cesium.Cartesian2(0, -14),
          showBackground:    true,
          backgroundColor:   Cesium.Color.fromCssColorString('#02060fcc'),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }));

      // ── Visibility badge label ────────────────────────────────────────
      if (satLat !== null) {
        added.push(viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lng, lat, 500),
          label: {
            text:              visible ? '● IN RANGE' : '○ OUT OF RANGE',
            font:              'bold 8px "JetBrains Mono", monospace',
            fillColor:         Cesium.Color.fromCssColorString(visible ? '#34d399' : '#475569'),
            outlineColor:      Cesium.Color.BLACK,
            outlineWidth:      2,
            style:             Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin:    Cesium.VerticalOrigin.BOTTOM,
            pixelOffset:       new Cesium.Cartesian2(0, -28),
            showBackground:    true,
            backgroundColor:   Cesium.Color.fromCssColorString('#02060fcc'),
            backgroundPadding: new Cesium.Cartesian2(4, 2),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }));
      }
    });

    stationEntitiesRef.current = added;
  }, [stations, currentSatPosition, viewerRef]);

  // Redraw when stations or satellite position changes
  useEffect(() => {
    if (!stations.length || !viewerRef.current?.cesiumElement) return;
    drawStations();
  }, [stations, currentSatPosition, drawStations, viewerRef]);

  // ── Visibility helper for external use ───────────────────────────────
  const checkVisibility = useCallback((stationId, satInfo) => {
    const station = stations.find(s => s.id === stationId);
    if (!station || !satInfo) return false;
    return isSatVisible(
      parseFloat(station.latitude),
      parseFloat(station.longitude),
      satInfo.lat,
      satInfo.lng,
      (satInfo.height || 420) * 1000,
      parseFloat(station.elevation_mask_deg)
    );
  }, [stations]);

  return { stations, loading, checkVisibility, drawStations };
};

export default useGroundStations;