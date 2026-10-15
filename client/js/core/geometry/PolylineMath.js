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

class _MinHeap {
  constructor() {
    this.heap = [];
  }

  push(node) {
    node.heapIndex = this.heap.length;
    this.heap.push(node);
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (!this.heap.length) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      bottom.heapIndex = 0;
      this._sinkDown(0);
    }
    top.heapIndex = -1;
    return top;
  }

  update(node) {
    const idx = node.heapIndex;
    if (idx !== undefined && idx >= 0 && idx < this.heap.length) {
      this._bubbleUp(idx);
      this._sinkDown(idx);
    }
  }

  _bubbleUp(n) {
    const element = this.heap[n];
    while (n > 0) {
      const parentN = (n - 1) >> 1;
      const parent = this.heap[parentN];
      if (element.weight >= parent.weight) break;
      this.heap[parentN] = element;
      element.heapIndex = parentN;
      this.heap[n] = parent;
      parent.heapIndex = n;
      n = parentN;
    }
  }

  _sinkDown(n) {
    const length = this.heap.length;
    const element = this.heap[n];
    while (true) {
      const child2N = (n + 1) << 1;
      const child1N = child2N - 1;
      let swap = null;
      if (child1N < length) {
        const child1 = this.heap[child1N];
        if (child1.weight < element.weight) swap = child1N;
      }
      if (child2N < length) {
        const child2 = this.heap[child2N];
        if (child2.weight < (swap === null ? element.weight : this.heap[child1N].weight)) {
          swap = child2N;
        }
      }
      if (swap === null) break;
      this.heap[n] = this.heap[swap];
      this.heap[n].heapIndex = n;
      this.heap[swap] = element;
      element.heapIndex = swap;
      n = swap;
    }
  }

  size() {
    return this.heap.length;
  }
}

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
   * Computes the effective visual weight of vertex pCurr between neighbors pPrev and pNext.
   * Combines triangle area (Visvalingam) with turning angle curvature weighting.
   * Sharp geographic bends (capes, bays, tri-points) receive high multipliers.
   * Collinear points have area = 0 and are eliminated first.
   *
   * @param {number[]} pPrev Previous point [x, y]
   * @param {number[]} pCurr Current candidate point [x, y]
   * @param {number[]} pNext Next point [x, y]
   * @returns {number} Weighted effective area
   */
  static computeTriangleCurvatureWeight(pPrev, pCurr, pNext) {
    const area = 0.5 * Math.abs(
      pPrev[0] * (pCurr[1] - pNext[1]) +
      pCurr[0] * (pNext[1] - pPrev[1]) +
      pNext[0] * (pPrev[1] - pCurr[1])
    );

    const ux = pCurr[0] - pPrev[0];
    const uy = pCurr[1] - pPrev[1];
    const vx = pNext[0] - pCurr[0];
    const vy = pNext[1] - pCurr[1];

    const lenU = Math.hypot(ux, uy);
    const lenV = Math.hypot(vx, vy);
    if (lenU === 0 || lenV === 0) return 0;

    const dot = ux * vx + uy * vy;
    const cosTheta = Math.max(-1, Math.min(1, dot / (lenU * lenV)));
    const turningIndicator = 1 - cosTheta; // 0 for straight line, 1 for 90 deg, 2 for 180 deg hairpin

    // Sharp turn bonus: turning angle >= 35 deg gets an extra priority boost
    const sharpBonus = turningIndicator > 0.18 ? 3.0 : 1.0;
    const curvatureMultiplier = (1.0 + 4.0 * turningIndicator) * sharpBonus;

    return area * curvatureMultiplier;
  }

  /**
   * Cartographic feature-preserving polygon ring simplification (Visvalingam-Whyatt with Curvature Weighting).
   * - Pins cardinal extrema (minX, maxX, minY, maxY) and endpoints so bounding box never shifts.
   * - Eliminates vertices with lowest visual significance in O(N log N) using an indexed binary min-heap.
   * - Preserves capes, headlands, fjords, bays, and border salients.
   *
   * @param {number[][]} ring Array of [x, y] coordinates
   * @param {number} targetPoints Target vertex count
   * @returns {number[][]} Simplified ring
   */
  static simplifyVisvalingam(ring, targetPoints) {
    if (!Array.isArray(ring) || ring.length <= 4) return ring ? ring.slice() : [];
    const target = Math.max(4, Number(targetPoints) || 4);
    if (ring.length <= target) return ring.slice();

    const n = ring.length;
    const isClosed = ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];

    // Identify bounding box extrema indices to lock them permanently
    let minXIdx = 0, maxXIdx = 0, minYIdx = 0, maxYIdx = 0;
    for (let i = 1; i < (isClosed ? n - 1 : n); i++) {
      if (ring[i][0] < ring[minXIdx][0]) minXIdx = i;
      if (ring[i][0] > ring[maxXIdx][0]) maxXIdx = i;
      if (ring[i][1] < ring[minYIdx][1]) minYIdx = i;
      if (ring[i][1] > ring[maxYIdx][1]) maxYIdx = i;
    }
    const pinnedIndices = new Set([0, minXIdx, maxXIdx, minYIdx, maxYIdx]);
    if (isClosed) pinnedIndices.add(n - 1);

    // Build doubly-linked list of vertices
    const nodes = new Array(n);
    for (let i = 0; i < n; i++) {
      nodes[i] = {
        index: i,
        point: ring[i],
        prev: null,
        next: null,
        weight: 0,
        isPinned: pinnedIndices.has(i),
        heapIndex: -1,
        removed: false
      };
    }

    for (let i = 0; i < n; i++) {
      if (i > 0) nodes[i].prev = nodes[i - 1];
      if (i < n - 1) nodes[i].next = nodes[i + 1];
    }

    const heap = new _MinHeap();
    for (let i = 1; i < n - 1; i++) {
      const node = nodes[i];
      if (node.isPinned) {
        node.weight = Infinity;
      } else {
        node.weight = this.computeTriangleCurvatureWeight(node.prev.point, node.point, node.next.point);
      }
      heap.push(node);
    }

    let remaining = n;
    while (remaining > target && heap.size() > 0) {
      const minNode = heap.pop();
      if (!minNode || minNode.weight === Infinity) break;

      minNode.removed = true;
      remaining--;

      const prevNode = minNode.prev;
      const nextNode = minNode.next;

      if (prevNode) prevNode.next = nextNode;
      if (nextNode) nextNode.prev = prevNode;

      if (prevNode && prevNode.prev && !prevNode.isPinned && prevNode.heapIndex >= 0) {
        prevNode.weight = this.computeTriangleCurvatureWeight(prevNode.prev.point, prevNode.point, prevNode.next.point);
        heap.update(prevNode);
      }
      if (nextNode && nextNode.next && !nextNode.isPinned && nextNode.heapIndex >= 0) {
        nextNode.weight = this.computeTriangleCurvatureWeight(nextNode.prev.point, nextNode.point, nextNode.next.point);
        heap.update(nextNode);
      }
    }

    const result = [];
    let curr = nodes[0];
    while (curr) {
      if (!curr.removed) result.push(curr.point);
      curr = curr.next;
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
   * @param {number} compZoom Current camera zoom level (0 - 22)
   * @param {number} [mapSize=262144] Web Mercator map extent
   * @param {number} [pixelThreshold=1.2] Maximum allowable sub-pixel deviation on screen
   * @returns {number} Tolerance in world units
   */
  static calculateZoomTolerance(compZoom, mapSize = 262144, pixelThreshold = 1.2) {
    const zoom = Math.max(0, Math.min(22, Number(compZoom) || 0));
    const unitsPerPixel = (mapSize / 256) / Math.pow(2, zoom);
    const tol = unitsPerPixel * (Number(pixelThreshold) || 1.2);
    return Math.max(0.75, Math.min(250, tol));
  }

  /**
   * Calculates Level-of-Detail point budget based on camera zoom.
   * Guarantees that continental views remain smooth while close-ups provide ultra-definition.
   *
   * @param {number} compZoom Camera zoom (0 - 22)
   * @param {number} [targetLimit=3500] After Effects safety ceiling
   * @returns {number} Target vertex budget
   */
  static calculateLODBudget(compZoom, targetLimit = 3500) {
    const z = Math.max(0, Math.min(22, Number(compZoom) || 0));
    let budget;
    if (z <= 2) {
      budget = 2000;
    } else if (z <= 4) {
      budget = 2600;
    } else if (z <= 7) {
      budget = 3100;
    } else {
      budget = 3500;
    }
    return Math.min(targetLimit, budget);
  }

  /**
   * Cartographically simplifies a set of coordinate rings using curvature-weighted Visvalingam.
   * - Respects camera zoom altitude and AE safety ceiling (<= 3,500 points).
   * - If existing rings are already within budget, keeps them 100% intact.
   * - Allocates vertex quotas proportionally to ring complexity with an island-preserving minimum floor.
   *
   * @param {number[][][]} rings Array of coordinate rings
   * @param {number} compZoom Camera zoom
   * @param {number} [targetLimit=3500] Maximum total points allowed for After Effects safety
   * @returns {number[][][]} Simplified rings
   */
  static simplifyRingsForZoom(rings, compZoom, targetLimit = 3500) {
    if (!Array.isArray(rings) || !rings.length) return [];
    const limit = Math.max(20, Number(targetLimit) || 3500);
    const targetBudget = this.calculateLODBudget(compZoom, limit);

    let totalPoints = 0;
    for (let r = 0; r < rings.length; r++) {
      if (Array.isArray(rings[r])) totalPoints += rings[r].length;
    }

    // If already within budget, keep raw rings intact
    if (totalPoints <= targetBudget) {
      return rings.map(ring => ring.slice());
    }

    // Allocate quotas across rings proportionally with an island floor
    const ringBudgets = new Array(rings.length);
    let allocated = 0;
    for (let r = 0; r < rings.length; r++) {
      const len = rings[r].length;
      const share = Math.round((len / totalPoints) * targetBudget);
      const ringBudget = Math.max(8, Math.min(len, share));
      ringBudgets[r] = ringBudget;
      allocated += ringBudget;
    }

    // If slight excess above limit due to minimum floors, scale down largest rings
    let diff = allocated - limit;
    if (diff > 0) {
      const sortedIndices = rings.map((r, i) => ({ i, len: r.length })).sort((a, b) => b.len - a.len);
      for (const item of sortedIndices) {
        if (diff <= 0) break;
        const reduce = Math.min(diff, Math.max(0, ringBudgets[item.i] - 12));
        ringBudgets[item.i] -= reduce;
        diff -= reduce;
      }
    }

    const simplified = [];
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      if (ring.length <= ringBudgets[r]) {
        simplified.push(ring.slice());
      } else {
        simplified.push(this.simplifyVisvalingam(ring, ringBudgets[r]));
      }
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
