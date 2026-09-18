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

console.log('\n======================================================');
console.log(`Results: ${passed} passed | ${failed} failed`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
}
