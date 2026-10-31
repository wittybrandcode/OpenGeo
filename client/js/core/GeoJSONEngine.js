/**
 * OpenGeo GeoJSON Engine (v1.1.0)
 * Mathematical, topological and spatial processing engine for uploaded GeoJSON datasets.
 * Implements:
 * 1. Curated Palette & Simplestyle metadata extraction
 * 2. Topological Grid Snapping & Sliver Hole Removal for seamless country/bloc unions
 * 3. Douglas-Peucker simplification in projected Web Mercator space (MAP_SIZE = 262144)
 * 4. Polylabel visual pole interior grid search for concave/island text label placement
 * 5. Automatic camera framing calculator
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.GeoJSONEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAP_SIZE = 262144;

  const OPENGEO_CURATED_PALETTE = [
    '#10b981', // Emerald
    '#3b82f6', // Royal Blue
    '#f43f5e', // Rose Crimson
    '#f59e0b', // Amber Gold
    '#8b5cf6', // Vivid Violet
    '#06b6d4', // Cyan Teal
    '#ec4899', // Magenta Pink
    '#84cc16', // Lime Green
    '#f97316', // Deep Orange
    '#6366f1'  // Indigo
  ];

  function clampNumber(val, min, max) {
    const num = Number(val);
    if (!Number.isFinite(num)) return min;
    return Math.max(min, Math.min(max, num));
  }

  function normalizeHexColor(input, fallback) {
    if (!input || typeof input !== 'string') return fallback || '#10b981';
    const clean = input.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(clean)) return clean.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
      return ('#' + clean[1] + clean[1] + clean[2] + clean[2] + clean[3] + clean[3]).toLowerCase();
    }
    return fallback || '#10b981';
  }

  function hexToRgb01(hex) {
    const clean = normalizeHexColor(hex, '#ffffff').replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) / 255;
    const g = parseInt(clean.substring(2, 4), 16) / 255;
    const b = parseInt(clean.substring(4, 6), 16) / 255;
    return [r, g, b];
  }

  function countGeometryVertices(geometry) {
    if (!geometry || !geometry.coordinates) return 0;
    let count = 0;
    function walk(coords) {
      if (!Array.isArray(coords) || coords.length === 0) return;
      if (typeof coords[0] === 'number') {
        count += 1;
        return;
      }
      for (let i = 0; i < coords.length; i++) walk(coords[i]);
    }
    walk(geometry.coordinates);
    return count;
  }

  function resolveFeatureMetadata(feature, index) {
    const props = (feature && feature.properties) || {};
    const name = String(
      props.name_ar || props['name:ar'] || props.NAME_AR ||
      props.name || props.NAME || props.Name ||
      props.admin || props.ADMIN || props.SOVEREIGNT ||
      props.title || props.label || props.id ||
      `Feature ${index + 1}`
    ).trim();

    const isoCode = String(
      props.iso_a2 || props.ISO_A2 || props.iso_a3 || props.ISO_A3 || props.adm0_a3 || ''
    ).trim().toUpperCase();

    const defaultColor = OPENGEO_CURATED_PALETTE[index % OPENGEO_CURATED_PALETTE.length];
    const fillColor = normalizeHexColor(props.fill || props.fillColor || props['fill-color'] || props.color, defaultColor);
    const strokeColor = normalizeHexColor(props.stroke || props.strokeColor || props['stroke-color'], '#ffffff');
    const fillOpacity = clampNumber(props['fill-opacity'] !== undefined ? props['fill-opacity'] * 100 : 65, 0, 100);
    const strokeWidth = clampNumber(props['stroke-width'] !== undefined ? props['stroke-width'] : 2.5, 0.5, 20);

    return {
      id: feature.id || `feat_${index}_${Date.now()}`,
      index,
      name,
      isoCode,
      geometryType: feature && feature.geometry ? feature.geometry.type : 'Unknown',
      vertexCount: countGeometryVertices(feature && feature.geometry),
      selected: true,
      fillColor,
      strokeColor,
      fillOpacity,
      strokeWidth
    };
  }

  // --- Topological Grid Snapping & Sliver Hole Removal ---

  function snapFeatureCoordinates(feature, precision) {
    if (!feature || !feature.geometry) return feature;
    const prec = precision || 1e-4;
    const decimals = Math.max(0, Math.min(10, Math.round(-Math.log10(prec))));
    const clone = JSON.parse(JSON.stringify(feature));
    function snapRing(coords) {
      if (!Array.isArray(coords)) return coords;
      if (typeof coords[0] === 'number') {
        const x = Math.round(coords[0] / prec) * prec;
        const y = Math.round(coords[1] / prec) * prec;
        return [
          Number(x.toFixed(decimals)),
          Number(y.toFixed(decimals))
        ];
      }
      return coords.map(snapRing);
    }
    clone.geometry.coordinates = snapRing(clone.geometry.coordinates);
    return clone;
  }

  function signedRingArea(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    let area = 0;
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    }
    return area / 2;
  }

  function ringPerimeter(ring) {
    if (!Array.isArray(ring) || ring.length < 2) return 0;
    let p = 0;
    for (let i = 1; i < ring.length; i++) {
      const dx = ring[i][0] - ring[i - 1][0];
      const dy = ring[i][1] - ring[i - 1][1];
      p += Math.sqrt(dx * dx + dy * dy);
    }
    return p;
  }

  function cleanInternalSliverHoles(feature, removeSlivers, maxSliverRatio) {
    if (!removeSlivers || !feature || !feature.geometry) return feature;
    const geom = feature.geometry;
    const ratioThreshold = maxSliverRatio || 0.015;

    function filterPolygonRings(rings) {
      if (!Array.isArray(rings) || rings.length <= 1) return rings;
      const outerRing = rings[0];
      const outerArea = Math.abs(signedRingArea(outerRing));
      if (outerArea <= 0) return [outerRing];

      const keptHoles = rings.slice(1).filter(hole => {
        const holeArea = Math.abs(signedRingArea(hole));
        const perimeter = ringPerimeter(hole);
        const compactness = perimeter > 0 ? (4 * Math.PI * holeArea) / (perimeter * perimeter) : 0;
        return (holeArea / outerArea) > ratioThreshold && compactness > 0.08;
      });
      return [outerRing].concat(keptHoles);
    }

    if (geom.type === 'Polygon') {
      geom.coordinates = filterPolygonRings(geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates = geom.coordinates.map(filterPolygonRings);
    }
    return feature;
  }

  function combineIntoMultiPolygonFallback(f1, f2) {
    const coords1 = f1.geometry.type === 'Polygon' ? [f1.geometry.coordinates] : f1.geometry.coordinates;
    const coords2 = f2.geometry.type === 'Polygon' ? [f2.geometry.coordinates] : f2.geometry.coordinates;
    return {
      type: 'Feature',
      properties: Object.assign({}, f1.properties, f2.properties),
      geometry: {
        type: 'MultiPolygon',
        coordinates: coords1.concat(coords2)
      }
    };
  }

  function resolveTurfUnion() {
    if (typeof window !== 'undefined' && window.turf && typeof window.turf.union === 'function') {
      return window.turf;
    }
    if (typeof global !== 'undefined' && global.turf && typeof global.turf.union === 'function') {
      return global.turf;
    }
    const req = typeof module !== 'undefined' && module.require ? module.require.bind(module) : (typeof require === 'function' ? require : null);
    if (req) {
      try {
        const unionPkg = ['@turf', 'union'].join('/');
        const turfUnionModule = req(unionPkg);
        const unionFn = (turfUnionModule && turfUnionModule.union) ||
          (turfUnionModule && turfUnionModule.default) ||
          (typeof turfUnionModule === 'function' ? turfUnionModule : null);
        if (unionFn) {
          return { union: unionFn };
        }
      } catch (err) {}
      try {
        const path = req('path');
        const localTurf = req(path.resolve(__dirname, '../../lib/turf.min.js'));
        if (localTurf && typeof localTurf.union === 'function') {
          return localTurf;
        }
      } catch (e2) {}
    }
    return null;
  }

  function mergeFeaturesAsUnifiedBloc(selectedFeatures, options) {
    const opts = options || {};
    const snapPrecision = opts.snapPrecision || 1e-4;
    const removeSlivers = opts.removeInternalSlivers !== false;
    const maxSliverRatio = opts.maxSliverAreaRatio || 0.015;

    const polygonFeatures = (selectedFeatures || [])
      .filter(f => f && f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
      .map(f => snapFeatureCoordinates(f, snapPrecision));

    if (polygonFeatures.length === 0) return null;
    if (polygonFeatures.length === 1) {
      return cleanInternalSliverHoles(polygonFeatures[0], removeSlivers, maxSliverRatio);
    }

    const turf = resolveTurfUnion();
    if (turf && typeof turf.union === 'function') {
      try {
        // Turf v7: pass all polygon features in a single FeatureCollection
        const fc = { type: 'FeatureCollection', features: polygonFeatures };
        const unionResult = turf.union(fc);
        if (unionResult && unionResult.geometry) {
          return cleanInternalSliverHoles(unionResult, removeSlivers, maxSliverRatio);
        }
      } catch (uErr) {
        // If bulk multi-geometry union fails, union iteratively pair by pair
        try {
          let accum = polygonFeatures[0];
          for (let i = 1; i < polygonFeatures.length; i++) {
            const pairFC = { type: 'FeatureCollection', features: [accum, polygonFeatures[i]] };
            const pairRes = turf.union(pairFC);
            if (pairRes && pairRes.geometry) accum = pairRes;
          }
          if (accum && accum.geometry) {
            return cleanInternalSliverHoles(accum, removeSlivers, maxSliverRatio);
          }
        } catch (pairErr) {}
      }
    }

    // Fallback if turf is unavailable
    let merged = polygonFeatures[0];
    for (let i = 1; i < polygonFeatures.length; i++) {
      merged = combineIntoMultiPolygonFallback(merged, polygonFeatures[i]);
    }
    return cleanInternalSliverHoles(merged, removeSlivers, maxSliverRatio);
  }

  // --- Douglas-Peucker Simplification in Projected Web Mercator Space ---

  function getSqSegDist(p, p1, p2) {
    let x = p1[0], y = p1[1];
    let dx = p2[0] - x, dy = p2[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = p2[0]; y = p2[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p[0] - x;
    dy = p[1] - y;
    return dx * dx + dy * dy;
  }

  function douglasPeucker(points, sqTolerance) {
    const len = points.length;
    if (len <= 2) return points;
    const markers = new Uint8Array(len);
    let first = 0;
    let last = len - 1;
    const stack = [];
    const newPoints = [];
    markers[first] = markers[last] = 1;

    while (last) {
      let maxSqDist = 0;
      let index = 0;
      for (let i = first + 1; i < last; i++) {
        const sqDist = getSqSegDist(points[i], points[first], points[last]);
        if (sqDist > maxSqDist) {
          index = i;
          maxSqDist = sqDist;
        }
      }
      if (maxSqDist > sqTolerance) {
        markers[index] = 1;
        stack.push(first, index, index, last);
      }
      last = stack.pop();
      first = stack.pop();
    }

    for (let i = 0; i < len; i++) {
      if (markers[i]) newPoints.push(points[i]);
    }
    return newPoints;
  }

  function simplifyMercatorRing(ring, toleranceWorldUnits) {
    if (!Array.isArray(ring) || ring.length <= 4 || !toleranceWorldUnits || toleranceWorldUnits <= 0) {
      return ring;
    }
    const sqTolerance = toleranceWorldUnits * toleranceWorldUnits;
    const isClosed = (ring.length > 1 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]);

    const openPoints = isClosed ? ring.slice(0, ring.length - 1) : ring.slice();
    const simplified = douglasPeucker(openPoints, sqTolerance);
    if (simplified.length < 3) return ring;
    if (isClosed) {
      simplified.push([simplified[0][0], simplified[0][1]]);
    }
    return simplified;
  }

  // --- Visual Interior Grid Search (Polylabel / Pole of Inaccessibility) ---

  function isPointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointToRingDistSq(px, py, ring) {
    let minDistSq = Infinity;
    for (let i = 1; i < ring.length; i++) {
      const dSq = getSqSegDist([px, py], ring[i - 1], ring[i]);
      if (dSq < minDistSq) minDistSq = dSq;
    }
    return minDistSq;
  }

  function computeFeatureVisualLabelPosition(geometry) {
    if (!geometry) return null;
    if (geometry.type === 'Point') {
      return { lon: geometry.coordinates[0], lat: geometry.coordinates[1] };
    }
    if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') {
      const coords = geometry.coordinates;
      const mid = coords[Math.floor(coords.length / 2)];
      return { lon: mid[0], lat: mid[1] };
    }

    let bestOuterRing = null;
    let maxArea = -1;

    if (geometry.type === 'Polygon') {
      bestOuterRing = geometry.coordinates[0];
    } else if (geometry.type === 'MultiPolygon') {
      for (const poly of geometry.coordinates) {
        if (!poly || !poly[0]) continue;
        const area = Math.abs(signedRingArea(poly[0]));
        if (area > maxArea) {
          maxArea = area;
          bestOuterRing = poly[0];
        }
      }
    }
    if (!bestOuterRing || bestOuterRing.length < 3) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of bestOuterRing) {
      if (pt[0] < minX) minX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] > maxY) maxY = pt[1];
    }

    let bestPoint = [(minX + maxX) / 2, (minY + maxY) / 2];
    let bestDistSq = pointToRingDistSq(bestPoint[0], bestPoint[1], bestOuterRing);
    if (!isPointInRing(bestPoint[0], bestPoint[1], bestOuterRing)) bestDistSq = -1;

    const steps = 12;
    const stepX = (maxX - minX) / steps;
    const stepY = (maxY - minY) / steps;
    if (stepX > 0 && stepY > 0) {
      for (let ix = 1; ix < steps; ix++) {
        for (let iy = 1; iy < steps; iy++) {
          const px = minX + ix * stepX;
          const py = minY + iy * stepY;
          if (isPointInRing(px, py, bestOuterRing)) {
            const dSq = pointToRingDistSq(px, py, bestOuterRing);
            if (dSq > bestDistSq) {
              bestDistSq = dSq;
              bestPoint = [px, py];
            }
          }
        }
      }
    }
    return { lon: bestPoint[0], lat: bestPoint[1] };
  }

  // --- Automatic Camera Framing ---

  function computeCameraFramingForFeatures(selectedFeatures, compWidth, compHeight, paddingRatio) {
    const pad = paddingRatio !== undefined ? paddingRatio : 0.15;
    let minWX = Infinity, minWY = Infinity, maxWX = -Infinity, maxWY = -Infinity;

    function visitCoord(lon, lat) {
      const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat) || 0));
      const rad = (safeLat * Math.PI) / 180;
      const mN = Math.log(Math.tan(Math.PI / 4 + rad / 2));
      const normLon = ((((Number(lon) || 0) + 180) % 360 + 360) % 360) - 180;
      const wx = ((normLon + 180) / 360) * MAP_SIZE;
      const wy = ((1 - mN / Math.PI) / 2) * MAP_SIZE;
      if (wx < minWX) minWX = wx;
      if (wy < minWY) minWY = wy;
      if (wx > maxWX) maxWX = wx;
      if (wy > maxWY) maxWY = wy;
    }

    for (const feat of (selectedFeatures || [])) {
      const geom = feat && feat.geometry;
      if (!geom || !geom.coordinates) continue;
      (function walk(c) {
        if (!Array.isArray(c) || c.length === 0) return;
        if (typeof c[0] === 'number') visitCoord(c[0], c[1]);
        else for (let i = 0; i < c.length; i++) walk(c[i]);
      })(geom.coordinates);
    }

    if (!Number.isFinite(minWX)) return null;

    const midWX = (minWX + maxWX) / 2;
    const midWY = (minWY + maxWY) / 2;
    const spanWX = Math.max(1e-3, maxWX - minWX);
    const spanWY = Math.max(1e-3, maxWY - minWY);

    const usableW = Math.max(256, (compWidth || 1920) * (1 - 2 * pad));
    const usableH = Math.max(256, (compHeight || 1080) * (1 - 2 * pad));
    const scaleFactor = Math.min(usableW / spanWX, usableH / spanWY);
    const targetZoom = Math.max(1, Math.min(18, Math.log2((scaleFactor * MAP_SIZE) / 256)));

    const lon = (midWX / MAP_SIZE) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * midWY) / MAP_SIZE;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));

    return {
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      zoom: Number(targetZoom.toFixed(2))
    };
  }

  // --- Projection Helpers ---

  function latLngToWorldPoint(lat, lng) {
    const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat) || 0));
    const rad = (safeLat * Math.PI) / 180;
    const mN = Math.log(Math.tan(Math.PI / 4 + rad / 2));
    const normLng = ((((Number(lng) || 0) + 180) % 360 + 360) % 360) - 180;
    const wx = ((normLng + 180) / 360) * MAP_SIZE;
    const wy = ((1 - mN / Math.PI) / 2) * MAP_SIZE;
    return [wx, wy];
  }

  function worldPointToLatLng(wx, wy) {
    const normWx = ((wx % MAP_SIZE) + MAP_SIZE) % MAP_SIZE;
    const lng = (normWx / MAP_SIZE) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * wy) / MAP_SIZE;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat, lng };
  }

  return {
    MAP_SIZE,
    OPENGEO_CURATED_PALETTE,
    clampNumber,
    normalizeHexColor,
    hexToRgb01,
    countGeometryVertices,
    resolveFeatureMetadata,
    snapFeatureCoordinates,
    signedRingArea,
    ringPerimeter,
    cleanInternalSliverHoles,
    combineIntoMultiPolygonFallback,
    mergeFeaturesAsUnifiedBloc,
    getSqSegDist,
    douglasPeucker,
    simplifyMercatorRing,
    isPointInRing,
    pointToRingDistSq,
    computeFeatureVisualLabelPosition,
    computeCameraFramingForFeatures,
    latLngToWorldPoint,
    worldPointToLatLng
  };
});
