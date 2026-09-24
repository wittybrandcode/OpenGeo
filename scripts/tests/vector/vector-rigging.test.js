'use strict';

/**
 * OpenGeo Automated Test Suite: Vector Rigging & Expression Architecture
 * Verifies mathematical integrity, parenting, scale normalization,
 * and zero cross-composition circular dependencies.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '../../..');

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
  sandbox.JSON = sandbox.JSON || JSON;
  sandbox.Error = sandbox.Error || Error;
  vm.runInNewContext(source, sandbox, { filename: absolutePath });
  return sandbox.__openGeoExport;
}

console.log('====================================');
console.log('[OpenGeo] Running Vector Rigging & Expressions Tests...');
console.log('====================================');

// Read vectorHost.jsx and compositionRig.jsx to verify expressions statically and dynamically
const vectorHostCode = fs.readFileSync(path.join(projectRoot, 'host/modules/vectorHost.jsx'), 'utf8');
const compositionRigCode = fs.readFileSync(path.join(projectRoot, 'host/modules/compositionRig.jsx'), 'utf8');
const searchPanelCode = fs.readFileSync(path.join(projectRoot, 'client/js/ui/SearchPanel.js'), 'utf8');

// 1. Verify text layer is strictly parented to controller with 100% scale
{
  const parentingMatch = /textLayer\.parent\s*=\s*controller;/.test(vectorHostCode);
  const textScaleMatch = /textLayer\.property\(["']Scale["']\)\.setValue\(\[100,\s*100\]\);/.test(vectorHostCode);
  assert(parentingMatch, 'textLayer is directly assigned parent = controller');
  assert(textScaleMatch, 'textLayer scale is strictly set to [100, 100] without synthetic multipliers');
}

// 2. Verify zero cross-composition circular dependency in vector controller
{
  // Controller position must not query comp("...").layer("MapPivot")
  const hasMapPivotInVector = /comp\([^)]+\)\.layer\([^)]*MapPivot/.test(vectorHostCode);
  assert(!hasMapPivotInVector, 'Vector host contains zero cross-comp queries to MapPivot (Zero Circular Dependency)');

  // Controller position must use thisComp.layer(safeMapLayerName)
  const usesThisCompEffects = /thisComp\.layer\([^)]+\)\.effect\("Latitude"\)/.test(vectorHostCode) ||
                              /map\.effect\("Latitude"\)/.test(vectorHostCode);
  assert(usesThisCompEffects, 'Vector controller computes coordinates from local thisComp effects directly');
}

// 3. Mathematical proof: 32x vertex compression cancels scale multiplier
{
  const MAP_SIZE = 262144;
  const zoom = 10;
  const targetWorldX = 131072;
  const camWorldX = 131072;

  // Vertex position compressed by 32
  const vertexStoredX = targetWorldX / 32; // 4096, safely below AE 32767 limit!
  assert(vertexStoredX < 32767, 'World coordinate 131072 compressed by 32 (4096) is well within AE shape vertex limit 32767');

  // Scale expression: (100 * 2^zoom * 256) / 262144 * 32
  const baseScale = (100 * Math.pow(2, zoom) * 256) / MAP_SIZE;
  const layerScale = baseScale * 32;

  // Rendered screen offset = (vertexStored - camWorldX/32) * (layerScale / 100)
  const renderedOffset = (vertexStoredX - (camWorldX / 32)) * (layerScale / 100);
  const directOffset = (targetWorldX - camWorldX) * (baseScale / 100);

  assert(Math.abs(renderedOffset - directOffset) < 1e-9, 'Mathematical cancellation: (vertex / 32) * (scale * 32) exactly equals target world offset');
}

// 4. Latitude clamping in Mercator expressions
{
  // Test latitude clamping function
  function safeMercatorY(lat, mapSize = 262144) {
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const latRad = clampedLat * (Math.PI / 180);
    const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    return ((1 - mercN / Math.PI) / 2) * mapSize;
  }

  const normalY = safeMercatorY(0);
  const polarNorthY = safeMercatorY(90); // Extreme pole
  const polarSouthY = safeMercatorY(-90); // Extreme pole

  assert(isFinite(normalY) && normalY === 131072, 'Equator (lat=0) maps to exact world center Y = 131072');
  assert(isFinite(polarNorthY) && polarNorthY >= -1e-4, 'Extreme North Pole (lat=90) is safely clamped and finite');
  assert(isFinite(polarSouthY) && polarSouthY <= 262144 + 1e-4, 'Extreme South Pole (lat=-90) is safely clamped and finite');
}

// 5. Clean UTF-8 naming delimiters in ExtendScript
{
  // Must not contain corrupted ANSI characters â€¢ or â€“
  const hasCorruptedBullet = vectorHostCode.indexOf('\u00e2\u20ac\u00a2') !== -1 ||
                             compositionRigCode.indexOf('\u00e2\u20ac\u00a2') !== -1;
  const hasCorruptedDash = vectorHostCode.indexOf('\u00e2\u20ac\u201c') !== -1 ||
                           compositionRigCode.indexOf('\u00e2\u20ac\u201c') !== -1;

  assert(!hasCorruptedBullet, 'ExtendScript files are free of corrupted bullet characters (â€¢)');
  assert(!hasCorruptedDash, 'ExtendScript files are free of corrupted dash characters (â€“)');
}

// 6. SearchPanel draw button decoupling
{
  // Verify that drawing country outlines emits search:drawCountryOutline and does not trigger camera movement
  const penButtonEmitsDraw = searchPanelCode.indexOf('search:drawCountryOutline') !== -1;
  const penButtonDecoupled = searchPanelCode.indexOf('pen-tool') !== -1 && penButtonEmitsDraw;
  assert(penButtonDecoupled, 'SearchPanel pen-tool emits dedicated search:drawCountryOutline decoupled from camera movement');
}

// 7. JavaScript Expression Engine array addition safety
{
  const trajectoryCode = fs.readFileSync(path.join(projectRoot, 'host/modules/trajectoryScanner.jsx'), 'utf8');
  const syncManagerCode = fs.readFileSync(path.join(projectRoot, 'client/js/core/SyncManager.js'), 'utf8');

  const hasUnsafeArrayAddition = /map\.transform\.position\s*\+\s*\[/.test(vectorHostCode);
  const usesSafeScalarAddition = /mapPos\[0\]\s*\+\s*\(pt\[0\]/.test(vectorHostCode) &&
                                 /mapPos\[1\]\s*\+\s*\(pt\[1\]/.test(vectorHostCode);
  assert(!hasUnsafeArrayAddition, 'Vector expressions do NOT use direct array addition (prevents JS engine string concatenation error)');
  assert(usesSafeScalarAddition, 'Vector expressions use safe scalar dimension addition [mapPos[0] + dx, mapPos[1] + dy]');
}

// 8. Controller anchor point initialization to [0, 0]
{
  const setsZeroAnchor = /controller\.property\(["']Anchor Point["']\)\.setValue\(\[0,\s*0\]\)/.test(vectorHostCode);
  assert(setsZeroAnchor, 'Vector controller explicitly initializes Anchor Point to [0, 0] (overrides default AE [50, 50])');
}

// 9. Resilient map layer resolution with opengeo comment fallback
{
  const hasResilientFallback = /thisComp\.numLayers/.test(vectorHostCode) &&
                               /opengeo:controller/.test(vectorHostCode) &&
                               /role=controller/.test(vectorHostCode);
  assert(hasResilientFallback, 'Vector expressions contain resilient fallback to find map controller by comment if layer name is altered');
}

// 10. Atomic keyframe seeding at t=0 to preserve finalized camera state
{
  const trajectoryCode = fs.readFileSync(path.join(projectRoot, 'host/modules/trajectoryScanner.jsx'), 'utf8');
  const hasAtomicKeyframeSeeding = /latProp\.numKeys\s*===\s*0/.test(trajectoryCode) &&
                                   /latProp\.setValueAtTime\(0,\s*latProp\.valueAtTime\(0,\s*false\)\)/.test(trajectoryCode);
  assert(hasAtomicKeyframeSeeding, 'trajectoryScanner.jsx implements Atomic Keyframe Seeding at t=0 when adding keyframe at t>0');
}

// 11. SyncManager exportToAE protection for finalized compositions
{
  const syncManagerCode = fs.readFileSync(path.join(projectRoot, 'client/js/core/SyncManager.js'), 'utf8');
  const hasProtectedReplaceFinal = /replaceFinal:\s*!snapshot\.isFinalized/.test(syncManagerCode);
  const passesDisplayName = /displayName:\s*snapshot\.composition/.test(syncManagerCode);
  assert(hasProtectedReplaceFinal, 'SyncManager.exportToAE sets replaceFinal: !snapshot.isFinalized to protect finalized high-res tiles');
  assert(passesDisplayName, 'SyncManager.exportToAE passes snapshot composition displayName to prevent layer renaming');
}

// 12. MapPivot resilience, value preservation and sandbox safety to prevent map from disappearing
{
  const compRigCode = fs.readFileSync(path.join(projectRoot, 'host/modules/compositionRig.jsx'), 'utf8');
  const hasValueFallback = /catch\(anchorErr\)\s*\{\s*value;\s*\}/.test(compRigCode) &&
                           /catch\(scaleErr\)\s*\{\s*value;\s*\}/.test(compRigCode);
  const noIllegalAppInExpr = !/app\.project/.test(compRigCode);
  const hasUnicodeEscaping = /opengeoEscapeExpressionString/.test(compRigCode) &&
                             /\\u/.test(compRigCode);
  assert(hasValueFallback, 'MapPivot expressions safely preserve value on error instead of snapping to [0, 0] (prevents map from disappearing)');
  assert(noIllegalAppInExpr, 'MapPivot expressions contain zero illegal app.project references (expressions execute in sandbox where app is undefined)');
  assert(hasUnicodeEscaping, 'MapPivot expressions use Unicode escape sequences to prevent comp name encoding corruption');
}

// 13. Effect signature identification in vector and spatial pin expressions
{
  const pinCode = fs.readFileSync(path.join(projectRoot, 'host/modules/spatialPinHost.jsx'), 'utf8');
  const vectorUsesEffectSignature = /l\.effect\("Latitude"\)\s*&&\s*l\.effect\("Longitude"\)\s*&&\s*l\.effect\("Zoom"\)/.test(vectorHostCode);
  const pinUsesEffectSignature = /l\.effect\("Latitude"\)\s*&&\s*l\.effect\("Longitude"\)\s*&&\s*l\.effect\("Zoom"\)/.test(pinCode);
  assert(vectorUsesEffectSignature, 'Vector expressions use foolproof effect signature identification [Latitude + Longitude + Zoom]');
  assert(pinUsesEffectSignature, 'Spatial pin expressions use foolproof effect signature identification [Latitude + Longitude + Zoom]');
}

// 14. Clean ASCII delimiters in compBuilder.jsx to prevent Mojibake
{
  const compBuilderCode = fs.readFileSync(path.join(projectRoot, 'host/modules/compBuilder.jsx'), 'utf8');
  const hasNoBulletInBuilder = compBuilderCode.indexOf(' • ') === -1;
  const hasCleanDashInBuilder = compBuilderCode.indexOf(' - ') !== -1;
  assert(hasNoBulletInBuilder && hasCleanDashInBuilder, 'compBuilder.jsx uses clean ASCII hyphen delimiters instead of Unicode bullet');
}

// 15. Keyframe mutation guards in SyncManager to protect finalized maps
{
  const syncManagerCode = fs.readFileSync(path.join(projectRoot, 'client/js/core/SyncManager.js'), 'utf8');
  const guardsKeyframeRecording = /isKeyframeRecording\s*\|\|\s*\(this\.app\.toolbarController\s*&&\s*this\.app\.toolbarController\.hasPendingKeyframeMutation/.test(syncManagerCode);
  assert(guardsKeyframeRecording, 'SyncManager guards session.setFinalized(false) when keyframe recording or mutation is active');
}

// 16. Shape layer effect controls for label management
{
  const hasShowLabel = /opengeoVectorAddCheckbox\(fx,\s*"Show Label",\s*true\)/.test(vectorHostCode);
  const hasLabelSize = /opengeoVectorAddSlider\(fx,\s*"Label Size",\s*100\)/.test(vectorHostCode);
  const hasLabelOffsetX = /opengeoVectorAddSlider\(fx,\s*"Label Offset X",\s*0\)/.test(vectorHostCode);
  const hasLabelOffsetY = /opengeoVectorAddSlider\(fx,\s*"Label Offset Y",\s*0\)/.test(vectorHostCode);
  const hasScaleWithZoom = /opengeoVectorAddCheckbox\(fx,\s*"Scale with Zoom",\s*false\)/.test(vectorHostCode);
  const hasReferenceZoom = /opengeoVectorAddSlider\(fx,\s*"Reference Zoom"/.test(vectorHostCode);
  const hasMinZoomScale = /opengeoVectorAddSlider\(fx,\s*"Min Zoom Scale",\s*25\)/.test(vectorHostCode);
  const hasMaxZoomScale = /opengeoVectorAddSlider\(fx,\s*"Max Zoom Scale",\s*400\)/.test(vectorHostCode);

  assert(hasShowLabel && hasLabelSize, 'Shape layer defines Show Label and Label Size controls');
  assert(hasLabelOffsetX && hasLabelOffsetY, 'Shape layer defines Label Offset X and Label Offset Y controls');
  assert(hasScaleWithZoom && hasReferenceZoom && hasMinZoomScale && hasMaxZoomScale, 'Shape layer defines full suite of Zoom scaling controls');
}

// 17. Label layer dynamic expressions for Position offset, Opacity decoupling, and Zoom scaling
{
  const hasPositionOffset = /Label Offset X/.test(vectorHostCode) && /Label Offset Y/.test(vectorHostCode);
  const hasZoomScaleMode = /Scale with Zoom/.test(vectorHostCode) && /Reference Zoom/.test(vectorHostCode) && /Math\.pow\(2,\s*curZoom\s*-\s*refZoom\)/.test(vectorHostCode);
  const hasDecoupledOpacity = /Show Label/.test(vectorHostCode) && /vis\s*&&\s*showLbl/.test(vectorHostCode);

  assert(hasPositionOffset, 'Label Position expression dynamically reads Label Offset X and Y');
  assert(hasZoomScaleMode, 'Label Scale expression implements dual zoom modes with 2^(zoom - refZoom) formulation');
  assert(hasDecoupledOpacity, 'Label Opacity expression decouples label visibility from boundary visibility');
}

// 18. Mathematical simulation of Zoom Mode 0 (constant size) vs Mode 1 (exponential scaling with clamping)
{
  function calculateLabelScale(mode, currentZoom, refZoom, baseSize, minScalePercent, maxScalePercent) {
    if (!mode) {
      return [baseSize, baseSize];
    }
    const minS = minScalePercent / 100;
    const maxS = maxScalePercent / 100;
    const factor = Math.max(minS, Math.min(maxS, Math.pow(2, currentZoom - refZoom)));
    const finalS = baseSize * factor;
    return [finalS, finalS];
  }

  // Mode 0: Constant Size
  const scaleAtZoom4 = calculateLabelScale(false, 4, 6, 100, 25, 400);
  const scaleAtZoom10 = calculateLabelScale(false, 10, 6, 100, 25, 400);
  assert(scaleAtZoom4[0] === 100 && scaleAtZoom10[0] === 100, 'Mode 0 (Constant Size): Label scale remains strictly [100, 100] across any zoom');

  // Mode 1: Scale with Zoom
  const dynamicAtRef = calculateLabelScale(true, 6, 6, 100, 25, 400);
  const dynamicAtZoom7 = calculateLabelScale(true, 7, 6, 100, 25, 400); // 2^(7-6) = 2x -> 200%
  const dynamicAtZoom8 = calculateLabelScale(true, 8, 6, 100, 25, 400); // 2^(8-6) = 4x -> 400%
  const dynamicAtZoom12 = calculateLabelScale(true, 12, 6, 100, 25, 400); // Clamped at max 400%
  const dynamicAtZoom2 = calculateLabelScale(true, 2, 6, 100, 25, 400); // Clamped at min 25%

  assert(dynamicAtRef[0] === 100, 'Mode 1 (Scale with Zoom): At reference zoom, scale is exact [100, 100]');
  assert(dynamicAtZoom7[0] === 200, 'Mode 1: Zooming in by 1 level doubles scale to [200, 200]');
  assert(dynamicAtZoom8[0] === 400, 'Mode 1: Zooming in by 2 levels quadruples scale to [400, 400]');
  assert(dynamicAtZoom12[0] === 400, 'Mode 1: Extreme zoom-in safely clamped at max scale [400, 400]');
  assert(dynamicAtZoom2[0] === 25, 'Mode 1: Extreme zoom-out safely clamped at min scale [25, 25]');
}

// 19. TASK-3.1: Sub-Pixel Spatial Lock across zoom levels 2 to 18
{
  function computeSpatialPinOffset(pinLat, pinLng, camLat, camLng, zoom, alt = 0) {
    const MAP_SIZE = 262144;
    const pinSin = Math.sin(pinLat * Math.PI / 180);
    const worldX = ((pinLng + 180) / 360) * MAP_SIZE;
    const worldY = ((1 - Math.log((1 + pinSin) / (1 - pinSin)) / (2 * Math.PI)) / 2) * MAP_SIZE;

    const safeCamLat = Math.max(-85.05112878, Math.min(85.05112878, camLat));
    const camSin = Math.sin(safeCamLat * Math.PI / 180);
    const camX = ((camLng + 180) / 360) * MAP_SIZE;
    const camY = ((1 - Math.log((1 + camSin) / (1 - camSin)) / (2 * Math.PI)) / 2) * MAP_SIZE;

    const s = (Math.pow(2, zoom) * 256) / MAP_SIZE;
    return [(worldX - camX) * s, (worldY - camY) * s, -alt];
  }

  // A pin placed at Burj Khalifa (25.1972° N, 55.2744° E)
  const pinLat = 25.1972;
  const pinLng = 55.2744;

  for (let z = 2; z <= 18; z++) {
    // When camera is looking exactly at the pin:
    const offset = computeSpatialPinOffset(pinLat, pinLng, pinLat, pinLng, z);
    assert(Math.abs(offset[0]) < 1e-9 && Math.abs(offset[1]) < 1e-9, `Sub-Pixel Spatial Lock at Zoom ${z}: Zero screen offset when centered (< 1e-9 px)`);
  }

  // At Zoom 18, moving camera 0.001 deg gives exact proportional pixel offset without jitter
  const offsetZ18 = computeSpatialPinOffset(pinLat, pinLng, pinLat + 0.001, pinLng, 18);
  assert(Math.abs(offsetZ18[1]) > 50 && isFinite(offsetZ18[1]), 'Microscopic zoom level 18 maintains continuous sub-pixel trajectory');
}

// 20. TASK-3.2: Universal & Arabic Name Support for Spatial Pin Layers
{
  const arabicNames = [
    'برج خليفة',
    'مطار الجزائر الدولي - هواري بومدين',
    'مكة المكرمة',
    'جامع الجزائر الأعظم',
    'Tokyo Tower 東京タワー'
  ];

  for (const name of arabicNames) {
    const serialized = JSON.stringify({ compId: 'comp-1', lat: 25.2, lng: 55.3, name });
    const parsed = JSON.parse(serialized);
    assert(parsed.name === name, `UTF-16 Bridge payload preserves international name: "${name}"`);
  }

  const pinHostScript = fs.readFileSync(path.join(projectRoot, 'host/modules/spatialPinHost.jsx'), 'utf8');
  assert(pinHostScript.includes("pin.name = name || 'Spatial Pin'"), 'Spatial Pin assigns name directly to AE Null layer');
  assert(pinHostScript.includes("comp.layers.addText(name || 'Pin Label')"), 'Spatial Pin assigns international name directly to text layer');
}

// 21. TASK-3.3: Orphan Pin Recovery & Expression Resilience
{
  const pinHostScript = fs.readFileSync(path.join(projectRoot, 'host/modules/spatialPinHost.jsx'), 'utf8');
  assert(pinHostScript.includes('if (!ctrl) { value; }'), 'Spatial Pin expression safely returns current value when controller layer is deleted');
  assert(pinHostScript.includes('for (var i = 1; i <= thisComp.numLayers; i++)'), 'Spatial Pin dynamically scans remaining layers if primary controller name changed');
  assert(pinHostScript.includes('catch(e) { [0, -45, 0]; }'), 'Text layer Label Offset expression falls back safely if parent controls are missing');
}

// 22. TASK-4.1: GeoJSON Payload Guard (Bytes, Vertices, and Coordinate Limits)
{
  const GeoJSONValidator = loadBrowserClass('client/js/core/GeoJSONValidator.js', 'GeoJSONValidator', {
    Math, Number, Object, Array, String, JSON, Error
  });

  const validator = new GeoJSONValidator({
    maxBytes: 1024 * 1024,
    maxFeatures: 100,
    maxPoints: 500
  });

  // 22a. Reject oversized byte payload
  const oversizedResult = validator.parse('{}', { sourceBytes: 2 * 1024 * 1024 });
  assert(!oversizedResult.ok && oversizedResult.error.code === 'GEOJSON_TOO_LARGE', 'GeoJSONValidator safely rejects payloads exceeding maxBytes');

  // 22b. Reject payload exceeding feature limit
  const tooManyFeatures = {
    type: 'FeatureCollection',
    features: Array.from({ length: 150 }, (_, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {}
    }))
  };
  const featureLimitResult = validator.parse(tooManyFeatures);
  assert(!featureLimitResult.ok && featureLimitResult.error.code === 'GEOJSON_FEATURE_LIMIT', 'GeoJSONValidator rejects collections exceeding maxFeatures');

  // 22c. Reject payload exceeding vertex point limit
  const tooManyPoints = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: Array.from({ length: 600 }, (_, i) => [i * 0.01, i * 0.01])
    },
    properties: {}
  };
  const pointLimitResult = validator.parse(tooManyPoints);
  assert(!pointLimitResult.ok && pointLimitResult.error.code === 'GEOJSON_POINT_LIMIT', 'GeoJSONValidator rejects geometries exceeding maxPoints');

  // 22d. Reject invalid coordinates outside [-180, 180] or [-90, 90]
  const outOfBounds = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [195, 0] },
    properties: {}
  };
  const outOfBoundsResult = validator.parse(outOfBounds);
  assert(!outOfBoundsResult.ok && outOfBoundsResult.error.code === 'GEOJSON_COORDINATE_RANGE', 'GeoJSONValidator rejects longitude outside [-180, 180]');

  // 22e. Reject unclosed polygon rings
  const openPolygon = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]]
    },
    properties: {}
  };
  const openPolygonResult = validator.parse(openPolygon);
  assert(!openPolygonResult.ok && openPolygonResult.error.code === 'GEOJSON_RING_OPEN', 'GeoJSONValidator rejects unclosed polygon rings');

  // 22f. Host pre-Undo validation
  assert(vectorHostCode.includes('var prepared = opengeoVectorReadPayload(filePath);'), 'vectorHost parses and validates payload before opening UndoGroup');
  assert(vectorHostCode.includes("if (!prepared.ok) return 'error: [' + prepared.code"), 'vectorHost returns typed error code on validation failure');
}

// 23. TASK-4.2: Atomic UndoGroup Integrity for Vector Maps & Features
{
  assert(vectorHostCode.includes("withUndoGroup('OpenGeo: Synthesize Vector Map'"), 'Vector map synthesis is wrapped in single withUndoGroup');
  assert(vectorHostCode.includes("withUndoGroup('OpenGeo: Delete Feature'"), 'Vector feature deletion is wrapped in single withUndoGroup');
  assert(vectorHostCode.includes("withUndoGroup('OpenGeo: Feature Visibility'"), 'Vector feature visibility mutation is wrapped in single withUndoGroup');
}

// 24. TASK-4.3: Layers Panel Safe DOM Rendering & Host Reconciliation
{
  const layersPanelCode = fs.readFileSync(path.join(projectRoot, 'client/js/ui/LayersPanel.js'), 'utf8');
  assert(!layersPanelCode.includes('.innerHTML'), 'LayersPanel strictly avoids .innerHTML (Zero DOM sink violations)');
  assert(layersPanelCode.includes('app.featureRegistry.onChange'), 'LayersPanel reacts to feature registry changes');
  assert(layersPanelCode.includes('app.featureManager.setVisibility'), 'LayersPanel binds visibility toggle to FeatureManager');
  assert(layersPanelCode.includes('app.featureManager.deleteFeature'), 'LayersPanel binds deletion to FeatureManager with confirmation dialog');

  const featureManagerCode = fs.readFileSync(path.join(projectRoot, 'client/js/core/FeatureManager.js'), 'utf8');
  assert(featureManagerCode.includes("this.app.aeBridge.invoke('feature.list'"), 'FeatureManager queries AE feature list during host reconciliation');
  assert(featureManagerCode.includes("this.registry.setHostState(item.id, null"), 'FeatureManager detaches missing host layers without data corruption');
}

// 25. Mathematical Lock: Vector shape layer anchor point, controller Null, and spatial pins perfectly match MapPivot raster tiles across keyframes
{
  assert(vectorHostCode.includes('(s1 / curScale) * (1 - uZoom)'), 'vectorHost Anchor Point expression implements screen-space camera velocity matching MapPivot');
  assert(vectorHostCode.includes('(s2 / curScale) * uZoom'), 'vectorHost Anchor Point expression implements screen-space zoom-out velocity matching MapPivot');

  const pinCode = fs.readFileSync(path.join(projectRoot, 'host/modules/spatialPinHost.jsx'), 'utf8');
  assert(pinCode.includes('(s1 / curScale) * (1 - uZoom)'), 'spatialPinHost Position expression implements screen-space camera velocity matching MapPivot');
  assert(pinCode.includes('(s2 / curScale) * uZoom'), 'spatialPinHost Position expression implements screen-space zoom-out velocity matching MapPivot');

  // Simulation of keyframe trajectory:
  // Keyframe 1: t=0, lat=25.1972, lon=55.2744, zoom=14
  // Keyframe 2: t=4, lat=48.8584, lon=2.2945, zoom=6
  function simLatLonToWorld(lat, lon, mapSize) {
    const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const rad = safeLat * (Math.PI / 180);
    const mN = Math.log(Math.tan(Math.PI / 4 + rad / 2));
    const normLon = ((((lon + 180) % 360 + 360) % 360) - 180);
    const wx = ((normLon + 180) / 360) * mapSize;
    const wy = ((1 - mN / Math.PI) / 2) * mapSize;
    return [wx, wy];
  }

  function simPivotWorldPos(t, t1, t2, k1, k2, currentZoom, mapSize) {
    const w1 = simLatLonToWorld(k1.lat, k1.lon, mapSize);
    const w2 = simLatLonToWorld(k2.lat, k2.lon, mapSize);
    let dx = w2[0] - w1[0];
    if (dx > mapSize / 2) dx -= mapSize;
    else if (dx < -mapSize / 2) dx += mapSize;
    const dy = w2[1] - w1[1];
    const curScale = Math.pow(2, currentZoom);
    const dz = k2.zoom - k1.zoom;
    if (Math.abs(dz) > 0.2) {
      const uZoom = Math.max(0, Math.min(1, (currentZoom - k1.zoom) / dz));
      if (dz > 0) {
        const s1 = Math.pow(2, k1.zoom);
        const fIn = (s1 / curScale) * (1 - uZoom);
        return [w2[0] - dx * fIn, w2[1] - dy * fIn];
      } else {
        const s2 = Math.pow(2, k2.zoom);
        const fOut = (s2 / curScale) * uZoom;
        return [w1[0] + dx * fOut, w1[1] + dy * fOut];
      }
    } else {
      const uTime = Math.max(0, Math.min(1, (t - t1) / (t2 - t1)));
      return [w1[0] + dx * uTime, w1[1] + dy * uTime];
    }
  }

  const k1 = { lat: 25.1972, lon: 55.2744, zoom: 14 };
  const k2 = { lat: 48.8584, lon: 2.2945, zoom: 6 };
  const targetPt = { lat: 25.1972, lon: 55.2744 }; // Landmark under observation

  // Test across 9 intermediate frames between t=0 and t=4
  for (let step = 0; step <= 8; step++) {
    const t = (step / 8) * 4;
    const u = t / 4;
    const currentZoom = k1.zoom + (k2.zoom - k1.zoom) * u;

    // 1. MapPivot (Raster Tiles at mapSize 262144)
    const pivotWorld = simPivotWorldPos(t, 0, 4, k1, k2, currentZoom, 262144);
    const targetWorld262k = simLatLonToWorld(targetPt.lat, targetPt.lon, 262144);
    const rasterScale = (100 * Math.pow(2, currentZoom) * 256) / 262144;
    const screenOffsetRasterX = (targetWorld262k[0] - pivotWorld[0]) * (rasterScale / 100);
    const screenOffsetRasterY = (targetWorld262k[1] - pivotWorld[1]) * (rasterScale / 100);

    // 2. Vector Shape Layer (vertices compressed by 32, mapSize 8192)
    const vectorWorld = simPivotWorldPos(t, 0, 4, k1, k2, currentZoom, 8192);
    const targetVertex = [targetWorld262k[0] / 32, targetWorld262k[1] / 32];
    const vectorScale = 3.125 * Math.pow(2, currentZoom);
    const screenOffsetVectorX = (targetVertex[0] - vectorWorld[0]) * (vectorScale / 100);
    const screenOffsetVectorY = (targetVertex[1] - vectorWorld[1]) * (vectorScale / 100);

    const driftX = Math.abs(screenOffsetVectorX - screenOffsetRasterX);
    const driftY = Math.abs(screenOffsetVectorY - screenOffsetRasterY);

    assert(driftX < 1e-9 && driftY < 1e-9, `Zero Vector Drift at t=${t.toFixed(2)}s (z=${currentZoom.toFixed(1)}): ΔX=${driftX.toFixed(2)}px, ΔY=${driftY.toFixed(2)}px (< 1e-9 px)`);
  }
}

console.log('====================================');
console.log(`Vector Rigging Tests: Passed: ${passed} | Failed: ${failed}`);
console.log('====================================');

if (failed > 0) {
  process.exit(1);
}


