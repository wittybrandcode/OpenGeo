'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const MegaTileArtifactStore = require('../../../client/js/engine/MegaTileArtifactStore.js');

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

console.log('--- Running Tile Blending & Color Discrepancy Tests ---');
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
// TB.1: TilePlanner detects zoom boundary crossings and generates transition metadata
// ----------------------------------------------------------------------------
runTest('TB.1: TilePlanner detects zoom transitions and calculates boundary intervals', () => {
  const sandbox = {};
  loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', sandbox);
  loadBrowserClass('client/js/tiles/TileAddress.js', 'TileAddress', sandbox);
  loadBrowserClass('client/js/tiles/PlacementExpander.js', 'PlacementExpander', sandbox);
  loadBrowserClass('client/js/tiles/CoveragePlanner.js', 'CoveragePlanner', sandbox);
  const TilePlanner = loadBrowserClass('client/js/engine/TilePlanner.js', 'TilePlanner', sandbox);

  const planner = new TilePlanner({
    _buildTileUrl: (source, x, y, z) => `tile://${source}/${z}/${x}/${y}`
  });

  // 10 frames transitioning from zoom 4 to zoom 5 at frame 5 (t = 0.5s at 10 fps)
  const frames = [];
  for (let i = 0; i < 10; i++) {
    const time = i * 0.1;
    const zoom = i < 5 ? 4.2 : 5.3;
    frames.push({ lat: 35.0, lon: 10.0, zoom, time, sampleId: `f-${i}` });
  }

  const plan = planner.createPlan(frames, {
    qualityOffset: 0,
    sourceTileSize: 256,
    maxSourceZoom: 19,
    sourceKey: 'bing-satellite',
    fetchWidth: 1920,
    fetchHeight: 1080,
    gutterTiles: 1,
    includeBaseCoverage: false,
    blendDuration: 0.20
  });

  assert(Array.isArray(plan.zoomTransitions), 'plan.zoomTransitions must be an array');
  assert.strictEqual(plan.zoomTransitions.length, 1, 'Exactly one zoom transition should be detected');

  const tr = plan.zoomTransitions[0];
  assert.strictEqual(tr.fromZoom, 4, 'fromZoom should be 4');
  assert.strictEqual(tr.toZoom, 5, 'toZoom should be 5');
  assert(Math.abs(tr.boundaryTime - 0.45) < 0.01, `boundaryTime should be ~0.45, got ${tr.boundaryTime}`);
  assert(tr.startTime < tr.boundaryTime, 'startTime must precede boundaryTime');
  assert(tr.endTime > tr.boundaryTime, 'endTime must follow boundaryTime');
  assert.strictEqual(tr.duration, 0.20, 'duration should match blendDuration');
});

// ----------------------------------------------------------------------------
// TB.2: Dual-zoom coverage scheduling during transition window
// ----------------------------------------------------------------------------
runTest('TB.2: Dual-zoom tiles co-exist during the blend transition window', () => {
  const sandbox = {};
  loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', sandbox);
  loadBrowserClass('client/js/tiles/TileAddress.js', 'TileAddress', sandbox);
  loadBrowserClass('client/js/tiles/PlacementExpander.js', 'PlacementExpander', sandbox);
  loadBrowserClass('client/js/tiles/CoveragePlanner.js', 'CoveragePlanner', sandbox);
  const TilePlanner = loadBrowserClass('client/js/engine/TilePlanner.js', 'TilePlanner', sandbox);

  const planner = new TilePlanner({
    _buildTileUrl: (source, x, y, z) => `tile://${source}/${z}/${x}/${y}`
  });

  const frames = [
    { lat: 20.0, lon: 0.0, zoom: 4.0, time: 0.0 },
    { lat: 20.0, lon: 0.0, zoom: 4.0, time: 0.3 },
    { lat: 20.0, lon: 0.0, zoom: 5.0, time: 0.4 }, // Crossing occurs here
    { lat: 20.0, lon: 0.0, zoom: 5.0, time: 0.7 }
  ];

  const plan = planner.createPlan(frames, {
    qualityOffset: 0,
    sourceTileSize: 256,
    maxSourceZoom: 19,
    sourceKey: 'esri-sat',
    fetchWidth: 800,
    fetchHeight: 600,
    gutterTiles: 0,
    includeBaseCoverage: false,
    blendDuration: 0.30
  });

  const zoom4Tiles = plan.placements.filter(p => p.z === 4);
  const zoom5Tiles = plan.placements.filter(p => p.z === 5);

  assert(zoom4Tiles.length > 0, 'Plan must include Zoom 4 tiles');
  assert(zoom5Tiles.length > 0, 'Plan must include Zoom 5 tiles');
  assert.strictEqual(plan.zoomTransitions.length, 1, 'Must register the Z4->Z5 transition');
});

// ----------------------------------------------------------------------------
// TB.3: Static and pan-only camera paths produce zero transitions and zero extra tiles
// ----------------------------------------------------------------------------
runTest('TB.3: Static framing creates zero transitions and downloads single zoom level', () => {
  const sandbox = {};
  loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', sandbox);
  loadBrowserClass('client/js/tiles/TileAddress.js', 'TileAddress', sandbox);
  loadBrowserClass('client/js/tiles/PlacementExpander.js', 'PlacementExpander', sandbox);
  loadBrowserClass('client/js/tiles/CoveragePlanner.js', 'CoveragePlanner', sandbox);
  const TilePlanner = loadBrowserClass('client/js/engine/TilePlanner.js', 'TilePlanner', sandbox);

  const planner = new TilePlanner({
    _buildTileUrl: (source, x, y, z) => `tile://${source}/${z}/${x}/${y}`
  });

  // Pan across 5 frames with constant zoom
  const frames = [];
  for (let i = 0; i < 5; i++) {
    frames.push({ lat: 20.0 + (i * 0.1), lon: 10.0 + (i * 0.1), zoom: 6.0, time: i * 0.1 });
  }

  const plan = planner.createPlan(frames, {
    qualityOffset: 0,
    sourceTileSize: 256,
    maxSourceZoom: 19,
    sourceKey: 'esri-sat',
    fetchWidth: 800,
    fetchHeight: 600,
    gutterTiles: 0,
    includeBaseCoverage: false,
    blendDuration: 0.25
  });

  assert.strictEqual(plan.zoomTransitions.length, 0, 'Static zoom must produce zero transitions');
  const distinctZooms = new Set(plan.placements.map(p => p.z));
  assert.strictEqual(distinctZooms.size, 1, 'Only one zoom level should be planned');
  assert(distinctZooms.has(6), 'The planned zoom level must be 6');
});

// ----------------------------------------------------------------------------
// TB.4: Host ExtendScript uses normal compositing; the safe overlap is baked
// into the source image as an edge gutter, never by additive compositing.
// ----------------------------------------------------------------------------
runTest('TB.4: ExtendScript modules set BlendingMode.NORMAL with edge-gutter assets to eliminate seams and white glow', () => {
  const transactionCode = fs.readFileSync(sourcePath('host/modules/compositionTransaction.jsx'), 'utf8');
  const tilesCode = fs.readFileSync(sourcePath('host/modules/compositionTiles.jsx'), 'utf8');
  const syncCode = fs.readFileSync(sourcePath('host/modules/metadataSync.jsx'), 'utf8');

  assert(transactionCode.includes('tileLayer.blendingMode = BlendingMode.NORMAL;'), 'compositionTransaction.jsx must use BlendingMode.NORMAL');
  assert(tilesCode.includes('tileLayer.blendingMode = BlendingMode.NORMAL;'), 'compositionTiles.jsx must use BlendingMode.NORMAL');
  assert(syncCode.includes('innerLayer.blendingMode = BlendingMode.NORMAL;'), 'metadataSync.jsx must use BlendingMode.NORMAL');
});

// ----------------------------------------------------------------------------
// TB.5: Host ExtendScript sets Opacity keyframes across transition duration
// ----------------------------------------------------------------------------
runTest('TB.5: Host ExtendScript generates solid-base asymmetric opacity transitions', () => {
  const transactionCode = fs.readFileSync(sourcePath('host/modules/compositionTransaction.jsx'), 'utf8');

  // Higher zoom layer animates
  assert(transactionCode.includes('opacityProp.setValueAtTime(tr.startTime, 0)'), 'Higher layer must fade in from 0% on Zoom-In');
  assert(transactionCode.includes('opacityProp.setValueAtTime(tr.endTime, 100)'), 'Higher layer must reach 100% on Zoom-In');
  assert(transactionCode.includes('opacityProp.setValueAtTime(tr.startTime, 100)'), 'Higher layer must fade out from 100% on Zoom-Out');
  assert(transactionCode.includes('opacityProp.setValueAtTime(tr.endTime, 0)'), 'Higher layer must reach 0% on Zoom-Out');

  // Lower zoom base layer MUST REMAIN 100% solid throughout transition window
  assert(transactionCode.includes('effectiveZ === lowerZ'), 'Must identify lowerZ as solid base');
  assert(transactionCode.includes('opacityProp.setValueAtTime(tr.startTime, 100);'), 'Lower layer must be 100% at startTime');
  assert(transactionCode.includes('opacityProp.setValueAtTime(tr.endTime, 100);'), 'Lower layer must be 100% at endTime');
});

// ----------------------------------------------------------------------------
// TB.6: Layer Stacking Hierarchy places higher zoom MegaTiles above lower zoom
// ----------------------------------------------------------------------------
runTest('TB.6: MegaTiles are sorted by zoom level ascending so higher zoom is on top', () => {
  const transactionCode = fs.readFileSync(sourcePath('host/modules/compositionTransaction.jsx'), 'utf8');

  assert(transactionCode.includes('tiles.sort(function(a, b)'), 'Tiles must be sorted before layer creation');
  assert(transactionCode.includes('return za - zb'), 'Tiles must be sorted ascending by zoom level');
});

// ----------------------------------------------------------------------------
// TB.7: FinalizeController forwards zoomTransitions in payloadObject
// ----------------------------------------------------------------------------
runTest('TB.7: FinalizeController packages zoomTransitions into host payload', () => {
  const finalizeCode = fs.readFileSync(sourcePath('client/js/core/FinalizeController.js'), 'utf8');

  assert(finalizeCode.includes('plan.zoomTransitions'), 'FinalizeController must pass plan.zoomTransitions');
  assert(finalizeCode.includes('zoomTransitions: zoomTransitions || []'), 'prepareComposition must include zoomTransitions in payloadObject');
});

// ----------------------------------------------------------------------------
// TB.8: Trajectory scanner includes timeline time in frame samples
// ----------------------------------------------------------------------------
runTest('TB.8: trajectoryScanner serializes time property in frame samples', () => {
  const scannerCode = fs.readFileSync(sourcePath('host/modules/trajectoryScanner.jsx'), 'utf8');

  assert(scannerCode.includes('"time":\' + sampleTime'), 'trajectoryScanner must include sampleTime');
  assert(scannerCode.includes('"time":\' + end'), 'trajectoryScanner must include end time on trailing sample');
});

// ----------------------------------------------------------------------------
// TB.9: OpenGeo Color Balance adjustment layer created on top of mapComp
// ----------------------------------------------------------------------------
runTest('TB.9: OpenGeo Color Balance adjustment layer created in commitCompositionRevision', () => {
  const transactionCode = fs.readFileSync(sourcePath('host/modules/compositionTransaction.jsx'), 'utf8');

  assert(transactionCode.includes('OpenGeo Color Balance'), 'Host must manage OpenGeo Color Balance layer');
  assert(transactionCode.includes('balLayer.adjustmentLayer = true'), 'Layer must be marked as adjustment layer');
  assert(transactionCode.includes('balLayer.moveToBeginning()'), 'Layer must move to top of map comp');
});

// ----------------------------------------------------------------------------
// TB.10: Exact content geometry with a source-asset edge gutter
// ----------------------------------------------------------------------------
runTest('TB.10: ExtendScript modules preserve exact content scale and offset only the baked gutter', () => {
  const transactionCode = fs.readFileSync(sourcePath('host/modules/compositionTransaction.jsx'), 'utf8');
  const tilesCode = fs.readFileSync(sourcePath('host/modules/compositionTiles.jsx'), 'utf8');

  const helpersCode = fs.readFileSync(sourcePath('host/modules/helpers.jsx'), 'utf8');
  assert(helpersCode.includes('function opengeoResolveTileGeometry'), 'helpers.jsx must centralize content/gutter geometry');
  assert(helpersCode.includes('contentPixels + (requestedGutter * 2) <= sourcePixels'), 'gutter must fit within the source footage');
  assert(transactionCode.includes("tileLayer.property('Anchor Point').setValue([tileGeometry.gutterPixels, tileGeometry.gutterPixels, 0])"), 'compositionTransaction.jsx must offset the anchor by the baked gutter');
  assert(tilesCode.includes("tileLayer.property('Anchor Point').setValue([tileGeometry.gutterPixels, tileGeometry.gutterPixels, 0])"), 'compositionTiles.jsx must offset the anchor by the baked gutter');
  assert(transactionCode.includes("tileLayer.property('Scale').setValue([tileGeometry.exactScale, tileGeometry.exactScale, 100])"), 'compositionTransaction.jsx must use exact content scale');
  assert(tilesCode.includes("tileLayer.property('Scale').setValue([tileGeometry.exactScale, tileGeometry.exactScale, 100])"), 'compositionTiles.jsx must use exact content scale');
  assert(!transactionCode.includes('paddedScale'), 'compositionTransaction.jsx must not geometrically stretch tiles');
  assert(!tilesCode.includes('paddedScale'), 'compositionTiles.jsx must not geometrically stretch tiles');
});

// ----------------------------------------------------------------------------
// TB.11: MegaTile assets contain an edge-extruded source gutter, while their
// logical Mercator extent remains unchanged for the host placer.
// ----------------------------------------------------------------------------
runTest('TB.11: MegaTile artifact contract preserves content size and adds a one-pixel edge gutter', () => {
  const store = new MegaTileArtifactStore({ artifactKind: 'preview-cache' });
  const spec = store.createSpec([
    { z: 4, x: 3, y: 2, placementKey: 'placement/4/3/2' }
  ], 3, 2, 256, 256, 'C:/tmp/megatile.png');
  const stitcherCode = fs.readFileSync(sourcePath('client/js/engine/MegaTileStitcher.js'), 'utf8');
  const workerCode = fs.readFileSync(sourcePath('client/js/engine/stitcherWorker.js'), 'utf8');

  assert.strictEqual(spec.contentWidth, 256, 'Logical width must remain the original tile extent');
  assert.strictEqual(spec.contentHeight, 256, 'Logical height must remain the original tile extent');
  assert.strictEqual(spec.gutterPixels, 1, 'Every derived MegaTile needs a one-pixel edge gutter');
  assert.strictEqual(spec.width, 258, 'Stored texture width must include both gutter sides');
  assert.strictEqual(spec.height, 258, 'Stored texture height must include both gutter sides');
  assert(stitcherCode.includes('contentPixelSize: canvasSize'), 'Stitcher must pass the logical content size to AE');
  assert(stitcherCode.includes('gutterPixels: this.artifactStore.gutterPixels'), 'Stitcher must pass the gutter size to AE');
  assert(stitcherCode.includes('this._extrudeCanvasGutter(ctx, size, spec.gutterPixels)'), 'Main-thread fallback must extrude edge texels');
  assert(workerCode.includes('extrudeCanvasGutter(ctx, size, edge)'), 'Worker route must extrude edge texels');
  assert(workerCode.includes('new OffscreenCanvas(size + (edge * 2), size + (edge * 2))'), 'Worker output must include the gutter dimensions');
});


console.log('====================================');
console.log(`Results: ${passed} Passed | ${failed} Failed`);
console.log('====================================');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL TILE BLENDING TESTS PASSED!');
}
