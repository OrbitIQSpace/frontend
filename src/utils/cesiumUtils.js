// src/utils/cesiumUtils.js
// Shared Cesium utility helpers used across globe components.

import * as Cesium from 'cesium';

// Sanitizes a GeoJsonDataSource after load so that all entities bypass Cesium's
// asynchronous geometry worker.
//
// Problem: GeoJsonDataSource creates entity.polygon objects for Polygon/MultiPolygon
// GeoJSON features. Cesium queues polygon tessellation in a Web Worker; large country
// polygons (Russia, Canada, Antarctica) have thousands of boundary vertices which can
// exceed V8's enumerable-property limit when Cesium's PolylinePipeline processes them
// minutes later → "RangeError: Too many properties to enumerate".
//
// Fix: convert every polygon entity to a polyline entity with ArcType.NONE.
// PolylineCollection (used for orbit tracks) already bypasses the worker; this does
// the same for GeoJSON borders.
export const sanitizeGeoJsonSource = (src, strokeColor) => {
  const toRemove = [];
  const toAdd    = [];

  src.entities.values.forEach(entity => {
    if (entity.polyline) {
      entity.polyline.clampToGround = false;
      entity.polyline.arcType       = new Cesium.ConstantProperty(Cesium.ArcType.NONE);
    }
    if (entity.polygon) {
      const hierarchyProp = entity.polygon.hierarchy;
      let positions = null;
      if (hierarchyProp) {
        const val = hierarchyProp.getValue
          ? hierarchyProp.getValue(Cesium.JulianDate.now())
          : hierarchyProp;
        positions = val?.positions ?? (Array.isArray(val) ? val : null);
      }
      if (Array.isArray(positions) && positions.length > 1) {
        toAdd.push(new Cesium.Entity({
          polyline: {
            positions:     new Cesium.ConstantProperty([...positions, positions[0]]),
            width:         new Cesium.ConstantProperty(1),
            material:      new Cesium.ColorMaterialProperty(
              Cesium.Color.fromCssColorString(strokeColor)
            ),
            clampToGround: new Cesium.ConstantProperty(false),
            arcType:       new Cesium.ConstantProperty(Cesium.ArcType.NONE),
          },
        }));
      }
      toRemove.push(entity);
    }
  });

  toRemove.forEach(e => src.entities.remove(e));
  toAdd.forEach(e => src.entities.add(e));
};
