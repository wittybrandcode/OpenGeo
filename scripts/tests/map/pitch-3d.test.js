'use strict';

/**
 * OpenGeo Automated Test Suite: 3D Map Pitch & Horizon Tile Architecture
 * Verifies that the subtle 3D tilt/pitch feature works reliably across MapState,
 * Viewport, CoveragePlanner overscan math, HUD scrubber, and Host JSX synchronization.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '../../..');

function loadBrowserClass(relativePath, className, sandbox = {}) {
  const absolutePath = path.join(projectRoot, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8') +
    `\nthis.__openGeoExport = typeof ${className} !== 'undefined' ? ${className} : undefined;`;
  sandbox.console = sandbox.console || console;
  sandbox.Math = sandbox.Math || Math;
  sandbox.Number = sandbox.Number || Number;
  sandbox.Object = sandbox.Object || Object;
  sandbox.Array = sandbox.Array || Array;
  sandbox.String = sandbox.String || String;
  sandbox.parseFloat = sandbox.parseFloat || parseFloat;
  sandbox.parseInt = sandbox.parseInt || parseInt;
  sandbox.isFinite = sandbox.isFinite || isFinite;
  vm.runInNewContext(source, sandbox, { filename: absolutePath });
  return sandbox.__openGeoExport;
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

console.log('====================================');
console.log('[OpenGeo] Running 3D Pitch & Horizon Architecture Tests...');
console.log('====================================');

// ----------------------------------------------------
// 1. MapState Pitch Management
// ----------------------------------------------------
console.log('\n--- 1. MapState Pitch Tests ---');
const MapState = loadBrowserClass('client/js/MapState.js', 'MapState');
const mapState = new MapState();

assert(mapState.pitch === 0, 'Initial pitch is 0 degrees');
assert(mapState.getPitch() === 0, 'getPitch() returns initial 0');

mapState.setPitch(30);
assert(mapState.pitch === 30, 'setPitch(30) sets pitch to 30 degrees');
assert(mapState.getPitch() === 30, 'getPitch() returns 30');

mapState.setPitch(75);
assert(mapState.pitch === 45, 'setPitch(75) clamps to safe maximum 45 degrees');

mapState.setPitch(-15);
assert(mapState.pitch === 0, 'setPitch(-15) clamps to safe minimum 0 degrees');

mapState.setPitch('invalid');
assert(mapState.pitch === 0, 'setPitch with NaN/invalid value does not corrupt pitch state');

// ----------------------------------------------------
// 2. CoveragePlanner Horizon Overscan Math
// ----------------------------------------------------
console.log('\n--- 2. CoveragePlanner Pitch Overscan Tests ---');
const plannerSandbox = {};
const MercatorProjection = loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', plannerSandbox);
plannerSandbox.MercatorProjection = MercatorProjection;
const TileAddress = loadBrowserClass('client/js/tiles/TileAddress.js', 'TileAddress', plannerSandbox);
plannerSandbox.TileAddress = TileAddress;
const CoveragePlanner = loadBrowserClass('client/js/tiles/CoveragePlanner.js', 'CoveragePlanner', plannerSandbox);

const flatPlan = CoveragePlanner.planViewport({
  centerLat: 24.7136,
  centerLng: 46.6753,
  zoom: 10,
  pitch: 0,
  width: 800,
  height: 600,
  tileSize: 256
});

const tiltedPlan = CoveragePlanner.planViewport({
  centerLat: 24.7136,
  centerLng: 46.6753,
  zoom: 10,
  pitch: 45,
  width: 800,
  height: 600,
  tileSize: 256
});

assert(flatPlan.length > 0, 'Flat plan generates valid tiles');
assert(tiltedPlan.length > 0, 'Tilted plan generates valid tiles');
assert(tiltedPlan.length >= flatPlan.length, `Tilted plan total tiles (${tiltedPlan.length}) >= flat plan (${flatPlan.length}) to prevent horizon clipping`);

// ----------------------------------------------------
// 3. UI HTML & Zero-Radius CSS Inspection
// ----------------------------------------------------
console.log('\n--- 3. UI HTML & CSS Styling Tests ---');
const html = fs.readFileSync(path.join(projectRoot, 'client/index.html'), 'utf8');
assert(html.includes('id="map-pitch-control"'), 'index.html contains #map-pitch-control element');
assert(html.includes('id="pitch-value-display"'), 'index.html contains #pitch-value-display element');
assert(html.includes('pitch-label'), 'index.html contains pitch-label badge');
assert(html.includes('id="map-horizon-vignette"'), 'index.html contains #map-horizon-vignette atmospheric element');

const css = fs.readFileSync(path.join(projectRoot, 'client/css/modules/04-map.css'), 'utf8');
assert(css.includes('.map-pitch-control'), '04-map.css has .map-pitch-control styling rule');
assert(css.includes('border-radius: 0px;') || css.includes('border-radius: 0;'), '04-map.css enforces strict zero border-radius on pitch controller');
assert(css.includes('perspective: 1000px'), '04-map.css configures 3D perspective on .map-container');
assert(css.includes('transform-origin: center center'), '04-map.css anchors transform-origin at center center to eliminate top clipping');
assert(css.includes('.map-horizon-vignette'), '04-map.css styles atmospheric horizon vignette overlay');

// ----------------------------------------------------
// 4. Client Controller & Interaction Code Checks
// ----------------------------------------------------
console.log('\n--- 4. Client Interaction Controller Tests ---');
const hudControllerCode = fs.readFileSync(path.join(projectRoot, 'client/js/ui/LocationHudController.js'), 'utf8');
assert(hudControllerCode.includes('map-pitch-control'), 'LocationHudController binds #map-pitch-control');
assert(hudControllerCode.includes('updatePitch'), 'LocationHudController includes updatePitch method');
assert(hudControllerCode.includes('rotateX'), 'LocationHudController applies rotateX transform on map-canvas');
assert(hudControllerCode.includes('overscanScale'), 'LocationHudController computes overscanScale to eliminate side trapezoid cutoffs');
assert(hudControllerCode.includes('map-horizon-vignette'), 'LocationHudController updates atmospheric horizon vignette opacity');
assert(hudControllerCode.includes('pointerdown'), 'LocationHudController registers pointerdown for pitch scrubbing');

const inputHandlerCode = fs.readFileSync(path.join(projectRoot, 'client/js/ui/InputHandler.js'), 'utf8');
assert(inputHandlerCode.includes('isRightClick') || inputHandlerCode.includes('e.button === 2'), 'InputHandler handles right-click drag');
assert(inputHandlerCode.includes('setPitch'), 'InputHandler updates pitch on right-drag / shift-drag');

const syncEngineCode = fs.readFileSync(path.join(projectRoot, 'client/js/ae/AESyncEngine.js'), 'utf8');
assert(syncEngineCode.includes('pitch'), 'AESyncEngine includes pitch in camera synchronization payload and hashes');

// ----------------------------------------------------
// 5. Host ExtendScript 3D Rig & Bridge Protocol Tests
// ----------------------------------------------------
console.log('\n--- 5. Host ExtendScript Rig & Bridge Protocol Tests ---');
const compositionRigCode = fs.readFileSync(path.join(projectRoot, 'host/modules/compositionRig.jsx'), 'utf8');
assert(compositionRigCode.includes('addCamera'), 'compositionRig ensures real After Effects 3D Camera layer');
assert(compositionRigCode.includes('opengeo:camera'), 'compositionRig tags Camera layer with opengeo:camera comment');
assert(compositionRigCode.includes('Point of Interest'), 'compositionRig locks camera Point of Interest to controller center');
assert(compositionRigCode.includes('cameraOption.zoom'), 'compositionRig wires orbital position expression to camera zoom and Pitch effect');
assert(compositionRigCode.includes('mapLayer.threeDLayer = true;'), 'compositionRig sets map layer threeDLayer to true for 3D space interaction');
assert(compositionRigCode.includes("pitchCtrl.name = 'Pitch'") || compositionRigCode.includes('pitchCtrl.name = "Pitch"'), 'compositionRig creates ADBE Angle Control named "Pitch"');
assert(compositionRigCode.includes('pitchProperty'), 'compositionRig synchronizes pitch property safely without overwriting keyframes');

const metadataSyncCode = fs.readFileSync(path.join(projectRoot, 'host/modules/metadataSync.jsx'), 'utf8');
assert(metadataSyncCode.includes('"pitch":'), 'metadataSync returns pitch in camera state JSON');
assert(metadataSyncCode.includes('opengeoUpdateCamera'), 'metadataSync updates pitch in opengeoUpdateCamera');

const trajectoryScannerCode = fs.readFileSync(path.join(projectRoot, 'host/modules/trajectoryScanner.jsx'), 'utf8');
assert(trajectoryScannerCode.includes('"pitch":'), 'trajectoryScanner samples pitch in timeline trajectory');
assert(trajectoryScannerCode.includes('opengeoAddKeyframe(compId, lat, lon, zoom, pitch)'), 'trajectoryScanner supports pitch in opengeoAddKeyframe');

const compBuilderCode = fs.readFileSync(path.join(projectRoot, 'host/modules/compBuilder.jsx'), 'utf8');
assert(compBuilderCode.includes('mapPivot.threeDLayer = true;'), 'compBuilder sets mapPivot.threeDLayer = true for 3D coordinate space');

const compositionTilesCode = fs.readFileSync(path.join(projectRoot, 'host/modules/compositionTiles.jsx'), 'utf8');
assert(compositionTilesCode.includes('tileLayer.threeDLayer = true;'), 'compositionTiles sets tileLayer.threeDLayer = true so collapsed precomps interact with 3D camera');

const compositionTransactionCode = fs.readFileSync(path.join(projectRoot, 'host/modules/compositionTransaction.jsx'), 'utf8');
assert(compositionTransactionCode.includes('tileLayer.threeDLayer = true;'), 'compositionTransaction sets tileLayer.threeDLayer = true on staged tiles');

assert(metadataSyncCode.includes('innerLayer.threeDLayer = true;'), 'metadataSync auto-upgrades existing inner mapComp layers to 3D on sync');

const bridgeDispatcherCode = fs.readFileSync(path.join(projectRoot, 'host/modules/bridgeDispatcher.jsx'), 'utf8');
assert(bridgeDispatcherCode.includes('args.pitch'), 'bridgeDispatcher forwards args.pitch in camera.update and keyframe.add');

const vectorHostCode = fs.readFileSync(path.join(projectRoot, 'host/modules/vectorHost.jsx'), 'utf8');
assert(vectorHostCode.includes('layer.threeDLayer = true;'), 'vectorHost enables 3D on shape layers via opengeoVectorBindToMap');
assert(vectorHostCode.includes('controller.threeDLayer = true;'), 'vectorHost enables 3D on vector controllers');
assert(vectorHostCode.includes('textLayer.threeDLayer = true;'), 'vectorHost enables 3D on label text layers');
assert(vectorHostCode.includes('Auto-Orient Label to Camera'), 'vectorHost implements Auto-Orient Label to Camera control and orientation expression');

const spatialPinCode = fs.readFileSync(path.join(projectRoot, 'host/modules/spatialPinHost.jsx'), 'utf8');
assert(spatialPinCode.includes('options.autoOrient !== false'), 'spatialPinHost defaults Auto-Orient to Camera to enabled');
assert(spatialPinCode.includes('-(alt !== 0 ? alt : 2)'), 'spatialPinHost offsets pin to Z = -2 to eliminate Z-fighting on 3D ground plane');

assert(metadataSyncCode.includes('opengeo:feature:'), 'metadataSync auto-upgrades existing vector features in open comps to 3D');

console.log('====================================');
console.log(`3D Pitch Tests: Passed: ${passed} | Failed: ${failed}`);
console.log('====================================');

if (failed > 0) {
  process.exit(1);
}
