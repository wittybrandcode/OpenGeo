/**
 * OpenGeo — Pure Geometry & Math Headless Test Suite
 *
 * Validates Functional Core modules (MercatorMath, FrustumMath, TileMath)
 * independently in headless Node.js without browser or CEP dependencies.
 */

const assert = require('assert');
const path = require('path');

const MercatorMath = require('../../../client/js/core/geometry/MercatorMath');
const FrustumMath = require('../../../client/js/core/geometry/FrustumMath');
const TileMath = require('../../../client/js/core/geometry/TileMath');
const PolylineMath = require('../../../client/js/core/geometry/PolylineMath');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${e.message}`);
    failed++;
  }
}

console.log('\n======================================================');
console.log('📐 OpenGeo Functional Core: Pure Math Test Suite');
console.log('======================================================\n');

// 1. MercatorMath Tests
console.log('--- 1. MercatorMath Verification ---');

test('clampLat restricts latitude to [-85.05112878, 85.05112878]', () => {
  assert.strictEqual(MercatorMath.clampLat(90), 85.05112878);
  assert.strictEqual(MercatorMath.clampLat(-90), -85.05112878);
  assert.strictEqual(MercatorMath.clampLat(45), 45);
  assert.strictEqual(MercatorMath.clampLat(0), 0);
});

test('normalizeLng normalizes degrees across antimeridian into [-180, 180]', () => {
  assert.strictEqual(MercatorMath.normalizeLng(0), 0);
  assert.strictEqual(MercatorMath.normalizeLng(180), -180);
  assert.strictEqual(MercatorMath.normalizeLng(-180), -180);
  assert.strictEqual(MercatorMath.normalizeLng(190), -170);
  assert.strictEqual(MercatorMath.normalizeLng(-190), 170);
  assert.strictEqual(MercatorMath.normalizeLng(540), -180);
});

test('getWorldSize scales exponentially by 2^zoom', () => {
  assert.strictEqual(MercatorMath.getWorldSize(0, 256), 256);
  assert.strictEqual(MercatorMath.getWorldSize(1, 256), 512);
  assert.strictEqual(MercatorMath.getWorldSize(2, 256), 1024);
  assert.strictEqual(MercatorMath.getWorldSize(4, 512), 8192);
});

test('latLngToWorldPoint and worldPointToLatLng round-trip accurately', () => {
  const points = [
    { lat: 0, lng: 0 },
    { lat: 48.8566, lng: 2.3522 },     // Paris
    { lat: 37.7749, lng: -122.4194 },  // SF
    { lat: -33.8688, lng: 151.2093 }   // Sydney
  ];

  for (const pt of points) {
    const world = MercatorMath.latLngToWorldPoint(pt.lat, pt.lng, 8, 256);
    const restored = MercatorMath.worldPointToLatLng(world.x, world.y, 8, 256);
    assert.ok(Math.abs(restored.lat - pt.lat) < 1e-6, `Lat mismatch for ${pt.lat}: got ${restored.lat}`);
    assert.ok(Math.abs(restored.lng - pt.lng) < 1e-6, `Lng mismatch for ${pt.lng}: got ${restored.lng}`);
  }
});

test('camerasEquivalent detects equal and unequal camera states', () => {
  const c1 = { lat: 40, lng: -74, zoom: 10 };
  const c2 = { lat: 40, lng: -74, zoom: 10 };
  const c3 = { lat: 40.001, lng: -74, zoom: 10 };

  assert.strictEqual(MercatorMath.camerasEquivalent(c1, c2), true);
  assert.strictEqual(MercatorMath.camerasEquivalent(c1, c3, { pixelTolerance: 0.1 }), false);
});

// 2. FrustumMath Tests
console.log('\n--- 2. FrustumMath Verification ---');

test('clampPitch enforces [0, 45] degree envelope', () => {
  assert.strictEqual(FrustumMath.clampPitch(-10), 0);
  assert.strictEqual(FrustumMath.clampPitch(0), 0);
  assert.strictEqual(FrustumMath.clampPitch(30), 30);
  assert.strictEqual(FrustumMath.clampPitch(60), 45);
});

test('normalizeBearing bounds angles to [0, 360)', () => {
  assert.strictEqual(FrustumMath.normalizeBearing(0), 0);
  assert.strictEqual(FrustumMath.normalizeBearing(360), 0);
  assert.strictEqual(FrustumMath.normalizeBearing(-90), 270);
  assert.strictEqual(FrustumMath.normalizeBearing(450), 90);
});

test('calculatePitchOverscan expands gutter strictly on 3D tilt', () => {
  const flat = FrustumMath.calculatePitchOverscan(0);
  assert.strictEqual(flat.gutterX, 1);
  assert.strictEqual(flat.gutterY, 1);
  assert.strictEqual(flat.horizonGutter, 0);

  const tilted = FrustumMath.calculatePitchOverscan(25);
  assert.strictEqual(tilted.gutterX, 3);
  assert.strictEqual(tilted.gutterY, 3);
  assert.strictEqual(tilted.horizonGutter, 3);
});

test('calculatePerspectiveScale applies foreshortening based on pitch', () => {
  assert.strictEqual(FrustumMath.calculatePerspectiveScale(0, 0), 1.0);
  assert.strictEqual(FrustumMath.calculatePerspectiveScale(0, 0.5), 1.0);
  
  const scaleTop = FrustumMath.calculatePerspectiveScale(45, 0);
  const scaleBottom = FrustumMath.calculatePerspectiveScale(45, 1);
  assert.ok(scaleTop < scaleBottom, 'Top of frustum must be compressed relative to bottom');
  assert.strictEqual(scaleBottom, 1.0);
});

test('calculateHorizonFadeRange activates only when pitch > 0', () => {
  const flatFade = FrustumMath.calculateHorizonFadeRange(0, 1080);
  assert.strictEqual(flatFade.isActive, false);

  const tiltedFade = FrustumMath.calculateHorizonFadeRange(45, 1080);
  assert.strictEqual(tiltedFade.isActive, true);
  assert.strictEqual(tiltedFade.fadeEnd, Math.round(1080 * 0.25));
});

// 3. TileMath Tests
console.log('\n--- 3. TileMath Verification ---');

test('maxTiles calculates 2^zoom', () => {
  assert.strictEqual(TileMath.maxTiles(0), 1);
  assert.strictEqual(TileMath.maxTiles(3), 8);
  assert.strictEqual(TileMath.maxTiles(10), 1024);
});

test('wrapTileX wraps around antimeridian', () => {
  assert.strictEqual(TileMath.wrapTileX(0, 3), 0);
  assert.strictEqual(TileMath.wrapTileX(8, 3), 0);
  assert.strictEqual(TileMath.wrapTileX(-1, 3), 7);
  assert.strictEqual(TileMath.wrapTileX(9, 3), 1);
});

test('clampTileY bounds coordinates within [0, 2^zoom - 1]', () => {
  assert.strictEqual(TileMath.clampTileY(-5, 3), 0);
  assert.strictEqual(TileMath.clampTileY(4, 3), 4);
  assert.strictEqual(TileMath.clampTileY(10, 3), 7);
});

test('latLngToTile matches known geographic anchors', () => {
  const origin = TileMath.latLngToTile(0, 0, 0);
  assert.strictEqual(origin.x, 0);
  assert.strictEqual(origin.y, 0);
  assert.strictEqual(origin.z, 0);

  const z1Origin = TileMath.latLngToTile(0, 0, 1);
  assert.strictEqual(z1Origin.x, 1);
  assert.strictEqual(z1Origin.y, 1);
  assert.strictEqual(z1Origin.z, 1);
});

test('tileKey and parseTileKey round-trip accurately', () => {
  const key = TileMath.tileKey(14, 22, 5);
  assert.strictEqual(key, '5/14/22');
  const parsed = TileMath.parseTileKey(key);
  assert.deepStrictEqual(parsed, { x: 14, y: 22, z: 5 });
  assert.strictEqual(TileMath.parseTileKey('invalid'), null);
});

test('tileBounds returns valid geographic bounding box', () => {
  const bounds = TileMath.tileBounds(0, 0, 1);
  assert.ok(bounds.north > bounds.south, 'North must be greater than South');
  assert.ok(bounds.east > bounds.west, 'East must be greater than West');
  assert.strictEqual(bounds.west, -180);
  assert.strictEqual(bounds.east, 0);
});

// 4. PolylineMath Tests
console.log('--- 4. PolylineMath Verification ---');

test('sqDist and sqDistToSegment calculate accurate Euclidean distances', () => {
  assert.strictEqual(PolylineMath.sqDist([0, 0], [3, 4]), 25);
  // Point (1, 1) to segment (0, 0) - (2, 0) has perpendicular distance 1 -> sqDist = 1
  assert.strictEqual(PolylineMath.sqDistToSegment([1, 1], [0, 0], [2, 0]), 1);
  // Point (3, 4) past segment (0, 0) - (2, 0) clamps to end (2, 0) -> dist (1, 4) -> sqDist 17
  assert.strictEqual(PolylineMath.sqDistToSegment([3, 4], [0, 0], [2, 0]), 17);
});

test('simplifyDouglasPeucker preserves endpoints, simplifies colinear points, and keeps closed rings closed', () => {
  const line = [[0, 0], [1, 0.05], [2, 0], [3, -0.05], [4, 0]];
  const simplified = PolylineMath.simplifyDouglasPeucker(line, 0.1);
  assert.strictEqual(simplified.length, 2);
  assert.deepStrictEqual(simplified[0], [0, 0]);
  assert.deepStrictEqual(simplified[1], [4, 0]);

  const closedRing = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const simplifiedClosed = PolylineMath.simplifyDouglasPeucker(closedRing, 0.5);
  assert.strictEqual(simplifiedClosed.length, 5);
  assert.deepStrictEqual(simplifiedClosed[0], simplifiedClosed[simplifiedClosed.length - 1]);
});

test('calculateZoomTolerance scales inversely with camera zoom', () => {
  const tolZ3 = PolylineMath.calculateZoomTolerance(3);
  const tolZ7 = PolylineMath.calculateZoomTolerance(7);
  const tolZ11 = PolylineMath.calculateZoomTolerance(11);
  assert(tolZ3 > tolZ7, 'Zoom 3 tolerance must be greater than Zoom 7');
  assert(tolZ7 > tolZ11, 'Zoom 7 tolerance must be greater than Zoom 11');
  assert.strictEqual(tolZ11, 0.75); // Bounded at minimum 0.75 units
});

test('simplifyRingsForZoom enforces safe vertex ceiling (<= 3500 points)', () => {
  const hugeRing = [];
  for (let i = 0; i < 10000; i++) {
    hugeRing.push([i * 0.05, Math.sin(i * 0.1) * 2]);
  }
  hugeRing.push(hugeRing[0]);

  const simplified = PolylineMath.simplifyRingsForZoom([hugeRing], 6, 3500);
  let totalPts = 0;
  for (let r = 0; r < simplified.length; r++) totalPts += simplified[r].length;
  assert(totalPts <= 3500, `Expected <= 3500 points, got ${totalPts}`);
});

test('computeTriangleCurvatureWeight assigns 0 to collinear points and boosts sharp turns', () => {
  // Straight line points
  const collinearW = PolylineMath.computeTriangleCurvatureWeight([0, 0], [5, 0], [10, 0]);
  assert.strictEqual(collinearW, 0, 'Collinear points must have weight 0');

  // Gentle turn with area = 10
  const gentleW = PolylineMath.computeTriangleCurvatureWeight([0, 0], [10, 1], [20, 0]);
  // Sharp 90-degree turn with identical area = 10
  const sharpW = PolylineMath.computeTriangleCurvatureWeight([0, 4.472], [0, 0], [4.472, 0]);

  assert(sharpW > gentleW * 5, 'Sharp 90-degree corner must have substantially higher weight than gentle turn of equal area');
});

test('simplifyVisvalingam strictly pins cardinal extrema and preserves prominent capes/corners', () => {
  // Create a polygon with known extrema and intermediate collinear noise
  const ring = [
    [0, 10],   // start / west
    [1, 10],   // collinear
    [2, 10],   // collinear
    [5, 50],   // Northernmost cape (maxY=50)
    [8, 10],   // collinear
    [10, 10],  // Eastmost point (maxX=10)
    [10, 0],   // Southeast corner (minY=0)
    [0, 0],    // Southwest corner (minX=0)
    [0, 10]    // close ring
  ];

  const simplified = PolylineMath.simplifyVisvalingam(ring, 5);
  assert.strictEqual(simplified.length, 5); // Matches target budget

  // Verify cardinal extrema are strictly preserved
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of simplified) {
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }
  assert.strictEqual(minX, 0, 'minX must be strictly preserved');
  assert.strictEqual(maxX, 10, 'maxX must be strictly preserved');
  assert.strictEqual(minY, 0, 'minY must be strictly preserved');
  assert.strictEqual(maxY, 50, 'Prominent cape apex (maxY=50) must be strictly preserved');
});

test('simplifyRingsForZoom preserves small island rings in multi-ring configurations', () => {
  const mainland = [];
  for (let i = 0; i < 4000; i++) mainland.push([i, Math.sin(i * 0.1) * 10]);
  mainland.push(mainland[0]);

  const island1 = [[100, 100], [110, 100], [110, 110], [100, 110], [100, 100]];
  const island2 = [[200, 200], [215, 200], [215, 215], [200, 215], [200, 200]];

  const result = PolylineMath.simplifyRingsForZoom([mainland, island1, island2], 6, 3500);
  assert.strictEqual(result.length, 3, 'All 3 rings must be preserved');
  assert.strictEqual(result[1].length, 5, 'Island 1 must retain all points');
  assert.strictEqual(result[2].length, 5, 'Island 2 must retain all points');
  assert(result[0].length <= 3500, 'Mainland must be simplified within budget');
});

test('calculateViewportWorldBBox computes valid bounds around center coordinate', () => {
  const bbox = PolylineMath.calculateViewportWorldBBox(36.75, 3.05, 10, 1920, 1080);
  assert.strictEqual(bbox.length, 4);
  const [minX, minY, maxX, maxY] = bbox;
  assert(minX < maxX, 'minX must be less than maxX');
  assert(minY < maxY, 'minY must be less than maxY');
  assert(minX >= 0 && maxX <= 262144, 'Bounds must be within mapSize');
});

console.log('\n======================================================');
console.log(`Results: ${passed} passed | ${failed} failed`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
}
