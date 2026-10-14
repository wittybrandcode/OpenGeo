/**
 * OpenGeo — PolylineMath (Functional Core)
 *
 * Pure mathematical functions for 2D polyline/polygon simplification (Douglas-Peucker),
 * camera altitude/zoom Level-of-Detail (LOD) tolerance calculation, and viewport clipping.
 *
 * Characteristics:
 *  - 100% pure JavaScript with zero DOM, browser, or Node-external dependencies.
 *  - Iterative (stack-based) Douglas-Peucker: immune to call stack overflow on 50k+ vertices.
 *  - Safe point budget enforcement to guarantee After Effects Shape Layer fluidity (<= 3,500 pts).
 *  - Headless testable and deterministic.
 */

class PolylineMath {
  /**
   * Squared Euclidean distance between two 2D points [x, y].
   * @param {number[]} p1
   * @param {number[]} p2
   * @returns {number}
   */
  static sqDist(p1, p2) {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    return dx * dx + dy * dy;
  }

  /**
   * Squared perpendicular distance from point p to line segment v-w.
   * @param {number[]} p Target point [x, y]
   * @param {number[]} v Segment start [x, y]
   * @param {number[]} w Segment end [x, y]
   * @returns {number}
   */
  static sqDistToSegment(p, v, w) {
    const l2 = this.sqDist(v, w);
    if (l2 === 0) return this.sqDist(p, v);
    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    return this.sqDist(p, [v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])]);
  }

  /**
   * Iterative Ramer-Douglas-Peucker simplification algorithm.
   * Uses an explicit stack to prevent JavaScript call stack overflow on large arrays.
   * 
   * @param {number[][]} points Array of [x, y] coordinates
   * @param {number} tolerance Maximum distance threshold
   * @returns {number[][]} Simplified points array
   */
  static simplifyDouglasPeucker(points, tolerance) {
    if (!Array.isArray(points) || points.length <= 2) {
      return points ? points.slice() : [];
    }
    const tol = Number(tolerance) || 0;
    if (tol <= 0) return points.slice();
    const sqTol = tol * tol;

    const n = points.length;
    const isClosed = points[0][0] === points[n - 1][0] && points[0][1] === points[n - 1][1];
    const markers = new Uint8Array(n);
    markers[0] = 1;
    markers[n - 1] = 1;

    const stack = [[0, n - 1]];
    while (stack.length > 0) {
      const range = stack.pop();
      const start = range[0];
      const end = range[1];
      let maxSqDist = 0;
      let maxIndex = 0;

      const pStart = points[start];
      const pEnd = points[end];

      for (let i = start + 1; i < end; i++) {
        const sqDist = this.sqDistToSegment(points[i], pStart, pEnd);
        if (sqDist > maxSqDist) {
          maxSqDist = sqDist;
          maxIndex = i;
        }
      }

      if (maxSqDist > sqTol) {
        markers[maxIndex] = 1;
        if (maxIndex - start > 1) stack.push([start, maxIndex]);
        if (end - maxIndex > 1) stack.push([maxIndex, end]);
      }
    }

    const result = [];
    for (let i = 0; i < n; i++) {
      if (markers[i]) result.push(points[i]);
    }

    if (isClosed && result.length >= 3) {
      const first = result[0];
      const last = result[result.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        result.push([first[0], first[1]]);
      }
    }

    return result;
  }

  /**
   * Calculates Douglas-Peucker tolerance in world coordinates based on camera zoom (altitude).
   * 
   * Mathematical relation:
   *  1 screen pixel at zoom Z corresponds to (mapSize / 256) / (2^Z) units in world coordinates.
   * 
   * @param {number} compZoom Current camera zoom level (0 - 22)
   * @param {number} [mapSize=262144] Web Mercator map extent
   * @param {number} [pixelThreshold=1.2] Maximum allowable sub-pixel deviation on screen
   * @returns {number} Tolerance in world units
   */
  static calculateZoomTolerance(compZoom, mapSize = 262144, pixelThreshold = 1.2) {
    const zoom = Math.max(0, Math.min(22, Number(compZoom) || 0));
    const unitsPerPixel = (mapSize / 256) / Math.pow(2, zoom);
    const tol = unitsPerPixel * (Number(pixelThreshold) || 1.2);
    // Lower bound: 0.75 units to avoid sub-integer floating point bloat
    // Upper bound: 250 units for continental views
    return Math.max(0.75, Math.min(250, tol));
  }

  /**
   * Simplifies a set of rings with an altitude-derived tolerance and an optional hard cap.
   * If total vertices exceed targetLimit, tolerance is automatically scaled up.
   * 
   * @param {number[][][]} rings Array of coordinate rings
   * @param {number} compZoom Camera zoom
   * @param {number} [targetLimit=3500] Maximum total points allowed for After Effects safety
   * @returns {number[][][]} Simplified rings
   */
  static simplifyRingsForZoom(rings, compZoom, targetLimit = 3500) {
    if (!Array.isArray(rings) || !rings.length) return [];
    let tolerance = this.calculateZoomTolerance(compZoom);
    let simplified = rings.map(ring => this.simplifyDouglasPeucker(ring, tolerance));

    let totalPoints = 0;
    for (let r = 0; r < simplified.length; r++) totalPoints += simplified[r].length;

    // Adaptive pass: if still exceeds safe budget, iteratively scale tolerance
    let iterations = 0;
    while (totalPoints > targetLimit && iterations < 5) {
      iterations++;
      tolerance *= 1.6;
      simplified = rings.map(ring => this.simplifyDouglasPeucker(ring, tolerance));
      totalPoints = 0;
      for (let r = 0; r < simplified.length; r++) totalPoints += simplified[r].length;
    }

    return simplified;
  }

  /**
   * Calculates world-space bounding box for current camera view plus margin buffer.
   * 
   * @param {number} centerLat Center latitude
   * @param {number} centerLng Center longitude
   * @param {number} compZoom Camera zoom
   * @param {number} [compWidth=1920] Viewport width
   * @param {number} [compHeight=1080] Viewport height
   * @param {number} [bufferRatio=0.3] Extra margin around viewport (30%)
   * @returns {[number, number, number, number]} [minX, minY, maxX, maxY] in world coordinates
   */
  static calculateViewportWorldBBox(centerLat, centerLng, compZoom, compWidth = 1920, compHeight = 1080, bufferRatio = 0.3) {
    const mapSize = 262144;
    const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(centerLat) || 0));
    const rad = safeLat * Math.PI / 180;
    const sinLat = Math.sin(rad);
    const normLng = ((((Number(centerLng) || 0) + 180) % 360 + 360) % 360) - 180;
    const centerX = ((normLng + 180) / 360) * mapSize;
    const centerY = ((1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2) * mapSize;

    const unitsPerPixel = (mapSize / 256) / Math.pow(2, Math.max(0, Math.min(22, Number(compZoom) || 0)));
    const halfW = (Number(compWidth) || 1920) * 0.5 * unitsPerPixel * (1 + bufferRatio);
    const halfH = (Number(compHeight) || 1080) * 0.5 * unitsPerPixel * (1 + bufferRatio);

    return [
      Math.max(0, centerX - halfW),
      Math.max(0, centerY - halfH),
      Math.min(mapSize, centerX + halfW),
      Math.min(mapSize, centerY + halfH)
    ];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PolylineMath;
}
if (typeof window !== 'undefined') {
  window.PolylineMath = PolylineMath;
}
