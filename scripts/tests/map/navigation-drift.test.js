'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const projectRoot = path.resolve(__dirname, '../../..');

function sourcePath(relativePath) {
  return path.join(projectRoot, relativePath);
}

function loadBrowserClass(relativePath, className, sandbox = {}) {
  const absolutePath = sourcePath(relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8') +
    `\nthis.__openGeoExport = typeof ${className} !== 'undefined' ? ${className} : undefined;`;
  sandbox.window = sandbox.window || {};
  sandbox.console = sandbox.console || console;
  sandbox.Promise = sandbox.Promise || Promise;
  sandbox.Map = sandbox.Map || Map;
  sandbox.Set = sandbox.Set || Set;
  sandbox.Object = sandbox.Object || Object;
  sandbox.Array = sandbox.Array || Array;
  sandbox.Math = sandbox.Math || Math;
  sandbox.Number = sandbox.Number || Number;
  sandbox.String = sandbox.String || String;
  vm.runInNewContext(source, sandbox, { filename: absolutePath });
  return sandbox.__openGeoExport;
}

console.log('--- Running Navigation Drift & Screen-Space Velocity Tests ---');
let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    failed++;
  }
}

// ----------------------------------------------------------------------------
// ND.1: Screen-Space Monotonic Distance (Zoom-In Slingshot Elimination)
// ----------------------------------------------------------------------------
runTest('ND.1: Screen-space distance to target strictly decreases without slingshot', () => {
  const sandbox = {};
  const Mercator = loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', sandbox);

  const start = { lat: 51.5074, lon: -0.1278, zoom: 4.0 }; // London (continental)
  const end = { lat: 48.8566, lon: 2.3522, zoom: 16.0 };   // Paris (street level)
  const mapSize = 268435456;

  const w2 = Mercator.latLngToWorldPoint(end.lat, end.lon, 0, mapSize);

  let prevDistance = Infinity;
  const samples = 20;

  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const pt = Mercator.screenSpaceTrajectoryPoint(start, end, u, { mapSize });
    const curScale = Math.pow(2, pt.zoom);

    // Pixel distance from camera center to target on screen
    const dx = (w2.x - pt.x) * curScale;
    const dy = (w2.y - pt.y) * curScale;
    const screenDist = Math.sqrt(dx * dx + dy * dy);

    if (i > 0) {
      assert(screenDist <= prevDistance + 1e-6, `Screen distance must decrease monotonically: step ${i} (${screenDist}) > step ${i-1} (${prevDistance})`);
    }
    prevDistance = screenDist;
  }

  // At u = 1.0, distance must be virtually 0 (< 0.01 pixels)
  assert(prevDistance < 0.01, `Final screen distance to target must be 0, got ${prevDistance}`);
});

// ----------------------------------------------------------------------------
// ND.2: Collinear Approach (Zero Lateral Drift)
// ----------------------------------------------------------------------------
runTest('ND.2: Camera approach vector remains strictly collinear without sideways drift', () => {
  const sandbox = {};
  const Mercator = loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', sandbox);

  const start = { lat: 35.6762, lon: 139.6503, zoom: 5.0 }; // Tokyo
  const end = { lat: 37.5665, lon: 126.9780, zoom: 15.0 };  // Seoul
  const mapSize = 268435456;

  const w2 = Mercator.latLngToWorldPoint(end.lat, end.lon, 0, mapSize);
  let expectedAngle = null;

  for (let i = 0; i < 10; i++) {
    const u = i / 10;
    const pt = Mercator.screenSpaceTrajectoryPoint(start, end, u, { mapSize });

    const dx = w2.x - pt.x;
    const dy = w2.y - pt.y;
    const angle = Math.atan2(dy, dx);

    if (expectedAngle === null) {
      expectedAngle = angle;
    } else {
      assert(Math.abs(angle - expectedAngle) < 1e-7, `Direction vector drifted: expected ${expectedAngle}, got ${angle}`);
    }
  }
});

// ----------------------------------------------------------------------------
// ND.3: Zoom-Out Monotonic Distance Expansion
// ----------------------------------------------------------------------------
runTest('ND.3: Zoom-out distance expands smoothly and monotonically', () => {
  const sandbox = {};
  const Mercator = loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', sandbox);

  const start = { lat: 40.7128, lon: -74.0060, zoom: 16.0 }; // NYC Street
  const end = { lat: 34.0522, lon: -118.2437, zoom: 4.0 };   // Continental US
  const mapSize = 268435456;

  const w1 = Mercator.latLngToWorldPoint(start.lat, start.lon, 0, mapSize);
  let prevDistFromStart = -1;

  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    const pt = Mercator.screenSpaceTrajectoryPoint(start, end, u, { mapSize });
    const curScale = Math.pow(2, pt.zoom);

    const dx = (pt.x - w1.x) * curScale;
    const dy = (pt.y - w1.y) * curScale;
    const distFromStart = Math.sqrt(dx * dx + dy * dy);

    assert(distFromStart >= prevDistFromStart - 1e-6, `Zoom-out distance from origin must expand monotonically`);
    prevDistFromStart = distFromStart;
  }
});

// ----------------------------------------------------------------------------
// ND.4: Pure Pan & Constant Altitude Compatibility
// ----------------------------------------------------------------------------
runTest('ND.4: Constant-zoom panning uses standard linear interpolation', () => {
  const sandbox = {};
  const Mercator = loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', sandbox);

  const start = { lat: 10.0, lon: 20.0, zoom: 8.0 };
  const end = { lat: 30.0, lon: 40.0, zoom: 8.0 };
  const mapSize = 268435456;

  const w1 = Mercator.latLngToWorldPoint(start.lat, start.lon, 0, mapSize);
  const w2 = Mercator.latLngToWorldPoint(end.lat, end.lon, 0, mapSize);

  const mid = Mercator.screenSpaceTrajectoryPoint(start, end, 0.5, { mapSize });
  assert.strictEqual(mid.zoom, 8.0, 'Zoom must remain exactly 8.0');
  assert(Math.abs(mid.x - (w1.x + w2.x) / 2) < 1e-4, 'Midpoint X must equal average of start and end');
  assert(Math.abs(mid.y - (w1.y + w2.y) / 2) < 1e-4, 'Midpoint Y must equal average of start and end');
});

// ----------------------------------------------------------------------------
// ND.5: Host ExtendScript MapPivot Expression Integration
// ----------------------------------------------------------------------------
runTest('ND.5: Host compositionRig installs screen-space linearized Anchor Point expression', () => {
  const rigCode = fs.readFileSync(sourcePath('host/modules/compositionRig.jsx'), 'utf8');

  assert(rigCode.includes('nearestKey'), 'Anchor Point expression must check adjacent keyframes');
  assert(rigCode.includes('latLonToWorld'), 'Anchor Point expression must have inline projection converter');
  assert(rigCode.includes('(s1 / curScale) * (1 - uZoom)'), 'Must apply screen-space zoom-in linear factor with uZoom');
  assert(rigCode.includes('(s2 / curScale) * uZoom'), 'Must apply screen-space zoom-out linear factor with uZoom');
  assert(rigCode.includes('dx > mapSize / 2'), 'Must include shortest antimeridian longitudinal wrap');
  assert(rigCode.includes('!worldPos'), 'Must fallback gracefully to standard Mercator evaluation');
});

// ----------------------------------------------------------------------------
// ND.6: Shortest Geodesic Antimeridian Longitude Wrap
// ----------------------------------------------------------------------------
runTest('ND.6: Antimeridian crossing takes shortest 20-degree path instead of 340-degree long flight', () => {
  const sandbox = {};
  const Mercator = loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', sandbox);

  const start = { lat: 0, lon: 170.0, zoom: 6.0 };
  const end = { lat: 0, lon: -170.0, zoom: 6.0 };
  const mapSize = 268435456;

  const mid = Mercator.screenSpaceTrajectoryPoint(start, end, 0.5, { mapSize });
  // Midpoint longitude between 170 and -170 along the shortest path must be 180 (or -180)
  assert(Math.abs(Math.abs(mid.lng) - 180.0) < 1e-4, `Midpoint across antimeridian must be +/-180, got ${mid.lng}`);
});

// ----------------------------------------------------------------------------
// ND.7: Phase-Locked Speed Graph (Non-linear Zoom Bezier curve)
// ----------------------------------------------------------------------------
runTest('ND.7: Custom non-linear Zoom curve phase-locks spatial progress', () => {
  const sandbox = {};
  const Mercator = loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', sandbox);

  const start = { lat: 0, lon: 0, zoom: 4.0 };
  const end = { lat: 0, lon: 10, zoom: 14.0 };
  const mapSize = 268435456;

  // Case A: Extreme Ease-In (at 50% time, zoom has only moved 2% to 4.2)
  const ptSlow = Mercator.screenSpaceTrajectoryPoint(start, end, 0.5, { mapSize, currentZoom: 4.2 });
  assert.strictEqual(ptSlow.zoom, 4.2, 'Point must match custom slow Bezier zoom');
  assert(ptSlow.lng < 2.0, `Spatial position must lag with slow zoom: expected lng < 2.0, got ${ptSlow.lng}`);

  // Case B: Extreme Ease-Out (at 50% time, zoom has already moved 80% to 12.0)
  const ptFast = Mercator.screenSpaceTrajectoryPoint(start, end, 0.5, { mapSize, currentZoom: 12.0 });
  assert.strictEqual(ptFast.zoom, 12.0, 'Point must match custom fast Bezier zoom');
  assert(ptFast.lng > 9.0, `Spatial position must surge with fast zoom: expected lng > 9.0, got ${ptFast.lng}`);

  // Monotonic phase-locking guarantee: Faster zoom curve strictly produces more spatial progress
  assert(ptFast.lng > ptSlow.lng, `Fast zoom curve must produce more spatial advance than slow zoom curve`);
});

// ----------------------------------------------------------------------------
// ND.8: Host ExtendScript Keyframe Easing Synchronization
// ----------------------------------------------------------------------------
runTest('ND.8: Host trajectoryScanner exports opengeoSynchronizeKeyframeEasing', () => {
  const scannerCode = fs.readFileSync(sourcePath('host/modules/trajectoryScanner.jsx'), 'utf8');

  assert(scannerCode.includes('function opengeoSynchronizeKeyframeEasing'), 'Must define opengeoSynchronizeKeyframeEasing');
  assert(scannerCode.includes('synchronizeKeyframeEasing: opengeoSynchronizeKeyframeEasing'), 'Must export synchronizeKeyframeEasing in namespace');
  assert(scannerCode.includes('KeyframeEase'), 'Must configure KeyframeEase with influence');
  assert(scannerCode.includes('setTemporalEaseAtKey'), 'Must call setTemporalEaseAtKey across properties');
});

console.log('====================================');
console.log(`Results: ${passed} Passed | ${failed} Failed`);
console.log('====================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL NAVIGATION DRIFT TESTS PASSED!');
}

