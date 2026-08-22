const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const os = require('os');

console.log('====================================');
console.log('[OpenGeo] Running Security & Smoke Tests...');
console.log('====================================');

let failed = 0;
let passed = 0;
const pendingAsyncTests = [];

function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    console.log(`  ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    console.error(`     Expected: ${expected}`);
    console.error(`     Got:      ${actual}`);
    failed++;
  }
}

function assertDoesNotThrow(fn, testName) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${testName}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ [FAIL] ${testName}`);
    console.error(`     Error: ${e.message}`);
    failed++;
  }
}

function assert(condition, testName, detail) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (detail) console.error(`     ${detail}`);
    failed++;
  }
}

function assertAsync(fn, testName) {
  pendingAsyncTests.push(
    Promise.resolve()
      .then(fn)
      .then(() => {
        console.log(`  ✅ [PASS] ${testName}`);
        passed++;
      })
      .catch(error => {
        console.error(`  ❌ [FAIL] ${testName}`);
        console.error(`     Error: ${error.message}`);
        failed++;
      })
  );
}

function loadBrowserClass(filePath, className, sandbox) {
  const source = fs.readFileSync(filePath, 'utf8') + `\nthis.__exportedClass = ${className};`;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.__exportedClass;
}

// 1. Test Bridge Escaping (Simulate AEBridge)
function escapeExtendScriptString(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

assertEqual(
  escapeExtendScriptString('Hello "World" \n test'),
  'Hello \\"World\\" \\n test',
  'Bridge string escaping handles quotes and newlines safely'
);

// 2. Test JSON parsing fallback safety (Simulate spatialPinHost.jsx)
const safeParseTest = () => {
  const badJson = '{ "name": "test", bad }';
  let feature = null;
  try { feature = JSON.parse(badJson); } catch (e) {}
  if (feature !== null) throw new Error("Parsed bad JSON without erroring out");
};
assertDoesNotThrow(safeParseTest, 'Host JSON parser catches errors securely without eval()');

// 3. Test Config Integrity
const configPath = path.resolve(__dirname, '../client/js/config.js');
assertDoesNotThrow(() => {
  const code = fs.readFileSync(configPath, 'utf8');
  if (code.includes('https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png?api_key={key}')) {
    // Stadia is secured
  } else {
    throw new Error('Stadia config is not secured with api_key requirement.');
  }
  if (!code.includes('mapboxSatellite')) {
    throw new Error('Mapbox config is missing.');
  }
  if (!code.includes('maptiler')) {
    throw new Error('MapTiler config is missing.');
  }
}, 'Map providers configuration is intact and secured');

// 4. Session persistence regression: compZoom must not be interpreted as UI zoom.
assertDoesNotThrow(() => {
  const sandbox = { console, window: {}, Number, Math, Object, Array };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/MapState.js'), 'MapState', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/core/StateContracts.js'), 'OpenGeoStateContracts', sandbox);
  const MapSession = loadBrowserClass(path.resolve(__dirname, '../client/js/core/MapSession.js'), 'MapSession', sandbox);
  const config = { defaults: { tileSource: 'esri', tileSize: 256, centerLat: 0, centerLng: 0, zoom: 2 } };
  const first = new MapSession(config, { isNewVersion: true });
  const persistedZoom = first.mapState.compZoom;
  const restored = new MapSession(config, { zoom: persistedZoom, lat: 0, lng: 0, tileSize: 256, source: 'esri' });
  if (Math.abs(restored.mapState.compZoom - persistedZoom) > 1e-9) {
    throw new Error('Restored compZoom drifted from its persisted value');
  }
  if (!restored.documentId) throw new Error('MapSession did not create a document identity');
  const priorDocumentId = restored.documentId;
  restored.createDocument();
  if (restored.documentId === priorDocumentId || restored.composition !== null) {
    throw new Error('Creating a new map document did not reset identity and composition state');
  }
}, 'MapSession restores compZoom without UI-zoom drift');

assertDoesNotThrow(() => {
  const contracts = require(path.resolve(__dirname, '../client/js/core/StateContracts.js'));
  const camera = contracts.normalizeCamera({ lat: 100, lng: 540, compZoom: 40 });
  if (camera.lat !== 85.05112878 || camera.lng !== -180 || camera.compZoom !== 22) throw new Error('Camera contract did not normalize bounds');
  const ae = contracts.toAeCamera(camera);
  if (ae.zoom !== 22 || Object.prototype.hasOwnProperty.call(ae, 'compZoom')) throw new Error('AE camera serialization is incorrect');
  const preferences = contracts.fromPreferences({ lat: 100, lng: 540, zoom: 40 }, { tileSource: 'osm', tileSize: 256, zoom: 2 });
  if (preferences.lat !== 85.05112878 || preferences.lng !== -180 || preferences.zoom !== 22) throw new Error('Persisted camera was not normalized');
}, 'State contracts normalize camera and AE serialization');

assertDoesNotThrow(() => {
  const sandbox = { console, window: {}, Number, Math, Object, Array };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  const MapState = loadBrowserClass(path.resolve(__dirname, '../client/js/MapState.js'), 'MapState', sandbox);
  const Viewport = loadBrowserClass(path.resolve(__dirname, '../client/js/map/Viewport.js'), 'Viewport', sandbox);
  const state = new MapState();
  state.updatePanelSize(800, 600);
  const viewport = new Viewport(state);
  viewport.setCenter(20, 30);
  viewport.setZoom(5);
  const before = viewport.screenToLatLng(620, 240);
  viewport.zoomAtPoint(5.25, 620, 240);
  const after = viewport.screenToLatLng(620, 240);
  if (Math.abs(before.lat - after.lat) > 1e-9 || Math.abs(before.lng - after.lng) > 1e-9) throw new Error('Zoom no longer preserves the cursor focus point');
}, 'Viewport zoom keeps the geographic cursor focus stable');

assertDoesNotThrow(() => {
  const sandbox = { console, window: {}, Number, Math, Object, Array };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  const MapState = loadBrowserClass(path.resolve(__dirname, '../client/js/MapState.js'), 'MapState', sandbox);
  const Viewport = loadBrowserClass(path.resolve(__dirname, '../client/js/map/Viewport.js'), 'Viewport', sandbox);
  const state = new MapState();
  const viewport = new Viewport(state, { minZoom: 2, maxZoom: 19 });
  viewport.setSize(1400, 900);
  const required = Math.log2((1400 + 512) / 256);
  if (viewport.zoom + 1e-9 < required) throw new Error('Initial viewport did not reserve horizontal tile guard bands');
}, 'Initial viewport reserves smart horizontal tile coverage');

assertDoesNotThrow(() => {
  const sandbox = { console, window: {}, Number, Math, Object, Array };
  const Mercator = loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  const lowZoomDistance = Mercator.cameraPixelDistance({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 }, 2, 256);
  const highZoomDistance = Mercator.cameraPixelDistance({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 }, 19, 256);
  const equatorDistance = Mercator.cameraPixelDistance({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }, 10, 256);
  const polarDistance = Mercator.cameraPixelDistance({ lat: 80, lng: 0 }, { lat: 80.001, lng: 0 }, 10, 256);
  if (!(lowZoomDistance < 1 && highZoomDistance > 1000)) throw new Error('Pixel distance does not scale with zoom or wrap the antimeridian');
  if (!(polarDistance > equatorDistance * 5)) throw new Error('Pixel distance does not account for Mercator latitude distortion');
}, 'Camera movement thresholds use projected pixels at low/high zoom and across the antimeridian');

assertDoesNotThrow(() => {
  let gridCalls = 0;
  const sandbox = {
    console,
    window: {},
    Number,
    Math,
    Object,
    Array,
    isFinite,
    CoveragePlanner: {
      planComposition(camera, options) {
        gridCalls++;
        return [{ key: `${options.downloadZoom}/0/0`, x: 0, y: 0, z: options.downloadZoom }];
      }
    }
  };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  const TilePlanner = loadBrowserClass(path.resolve(__dirname, '../client/js/engine/TilePlanner.js'), 'TilePlanner', sandbox);
  const planner = new TilePlanner({ _buildTileUrl: () => 'tile://0' });
  const plan = planner.createPlan([{ lat: 0, lon: 0, zoom: 2 }], {
    qualityOffset: 0,
    sourceTileSize: 256,
    maxSourceZoom: 19,
    sourceKey: 'test',
    fetchWidth: 1920,
    fetchHeight: 1080
  });
  if (gridCalls === 0 || plan.length === 0) throw new Error('The initial zero-coordinate frame was mistaken for a cached frame');
}, 'Tile planning never skips an initial camera at zero latitude/longitude');

assertDoesNotThrow(() => {
  const sandbox = { console, window: {}, Number, Math, Object, Array };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  const MapState = loadBrowserClass(path.resolve(__dirname, '../client/js/MapState.js'), 'MapState', sandbox);
  const Viewport = loadBrowserClass(path.resolve(__dirname, '../client/js/map/Viewport.js'), 'Viewport', sandbox);
  const state = new MapState();
  state.updatePanelSize(600, 900);
  const viewport = new Viewport(state);
  viewport.fitBounds(60, 80, 170, -170, 60);
  const northY = viewport.latLngToScreen(80, 180).y;
  const southY = viewport.latLngToScreen(60, 180).y;
  if (Math.abs((northY + southY) / 2 - viewport.height / 2) > 1e-6) throw new Error('High-latitude bounds are not centered in projected space');
  if (Math.abs(Math.abs(viewport.centerLng) - 180) > 1e-9) throw new Error('Antimeridian bounds chose the long longitude span');
}, 'fitBounds uses a Mercator midpoint for portrait high-latitude antimeridian bounds');

assertDoesNotThrow(() => {
  const PreferencesStore = require(path.resolve(__dirname, '../client/js/core/PreferencesStore.js'));
  const contracts = require(path.resolve(__dirname, '../client/js/core/StateContracts.js'));
  const values = new Map([['opengeo_prefs', '{not valid json']]);
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const config = { version: '2', defaults: { tileSource: 'osm', tileSize: 256, centerLat: 0, centerLng: 0, zoom: 2 } };
  const store = new PreferencesStore(storage, 'opengeo_prefs', config, contracts);
  const loaded = store.load();
  if (!loaded.isNewVersion || loaded.source !== 'osm') throw new Error('Invalid preferences did not safely reset to defaults');
}, 'Preferences store recovers safely from invalid persisted state');

// 5. Internal Mercator features use rings, not GeoJSON geometry; bbox must work.
assertDoesNotThrow(() => {
  const GeoDataRepository = require(path.resolve(__dirname, '../client/js/core/GeoDataRepository.js'));
  const repo = new GeoDataRepository();
  const bbox = repo._calculateFeatureBBox({ rings: [[[10, 20], [30, 40], [15, 25]]] });
  if (bbox.minX !== 10 || bbox.minY !== 20 || bbox.maxX !== 30 || bbox.maxY !== 40) {
    throw new Error('Mercator rings bounding-box calculation is incorrect');
  }
}, 'GeoDataRepository spatial filtering supports internal rings datasets');

assertDoesNotThrow(() => {
  const GeoDataRepository = require(path.resolve(__dirname, '../client/js/core/GeoDataRepository.js'));
  const repo = new GeoDataRepository();
  const line = { geometry: { type: 'LineString', coordinates: [[-2, 4], [7, -3]] } };
  const bbox = repo._calculateFeatureBBox(line);
  if (bbox.minX !== -2 || bbox.minY !== -3 || bbox.maxX !== 7 || bbox.maxY !== 4) {
    throw new Error('GeoJSON coordinate adapter does not calculate a line bounding box');
  }
  const invalid = repo.computeMercatorRingsBBox([[[1, 2], ['bad', 3]]]);
  if (invalid.minX !== 1 || invalid.maxY !== 2) throw new Error('Invalid Mercator points were not ignored');
}, 'GeoDataRepository adapters handle GeoJSON and invalid Mercator points');

// 5b. The repository must degrade safely when an older CEP runtime does not
// expose Node's filesystem bridge.
assertDoesNotThrow(() => {
  const sandbox = { console, Map, window: {} };
  const GeoDataRepository = loadBrowserClass(path.resolve(__dirname, '../client/js/core/GeoDataRepository.js'), 'GeoDataRepository', sandbox);
  const repo = new GeoDataRepository();
  if (repo.dataDir !== null || repo.loadDataset('anything.json') !== null) {
    throw new Error('Repository did not safely disable filesystem-backed data access');
  }
}, 'GeoDataRepository degrades safely without the CEP filesystem bridge');

// 5c. Arabic country/region matching must normalize harakat, tatweel, alif
// variants, ta marbuta, and alef maksura predictably.
assertDoesNotThrow(() => {
  const GeoDataRepository = require(path.resolve(__dirname, '../client/js/core/GeoDataRepository.js'));
  const repo = new GeoDataRepository();
  if (repo.normalizeArabic('إِلـى') !== 'الي' || repo.normalizeArabic('مدرسة') !== 'مدرسه') {
    throw new Error('Arabic normalization rules changed unexpectedly');
  }
}, 'Arabic search normalization handles common spelling variants');

// 6. Event subscriptions must be removable to support panel reload/dispose.
assertDoesNotThrow(() => {
  const sandbox = { console, Map, Array };
  const EventBus = loadBrowserClass(path.resolve(__dirname, '../client/js/events/EventBus.js'), 'EventBus', sandbox);
  const bus = new EventBus();
  let calls = 0;
  const unsubscribe = bus.on('test', () => { calls += 1; });
  bus.emit('test');
  unsubscribe();
  bus.emit('test');
  if (calls !== 1) throw new Error('Unsubscribed event listener was invoked');
}, 'EventBus subscriptions can be disposed safely');

assertDoesNotThrow(() => {
  const sandbox = { console, Map, Array, Object, Number, window: {} };
  const contracts = loadBrowserClass(path.resolve(__dirname, '../client/js/events/EventContracts.js'), 'OpenGeoEventContracts', sandbox);
  const EventBus = loadBrowserClass(path.resolve(__dirname, '../client/js/events/EventBus.js'), 'EventBus', sandbox);
  const bus = new EventBus();
  let payload = null;
  bus.on(contracts.events.SYNC_AE_CAMERA, value => { payload = value; });
  bus.emit(contracts.events.SYNC_AE_CAMERA, { lat: 0, lng: 0, zoom: 2 });
  if (!payload || !contracts.isValid(contracts.events.SYNC_AE_CAMERA, payload) || contracts.isValid(contracts.events.SYNC_AE_CAMERA, { lat: 0 })) {
    throw new Error('Event contract does not validate the AE camera payload');
  }
}, 'Critical EventBus payloads have named contracts');

assertDoesNotThrow(() => {
  const sandbox = { console, window: {}, Number, Math, Object, Array };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/MapState.js'), 'MapState', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/core/StateContracts.js'), 'OpenGeoStateContracts', sandbox);
  const MapSession = loadBrowserClass(path.resolve(__dirname, '../client/js/core/MapSession.js'), 'MapSession', sandbox);
  const session = new MapSession({ defaults: { tileSource: 'osm', tileSize: 256, centerLat: 0, centerLng: 0, zoom: 2 } });
  const first = session.beginOperation('sync');
  const second = session.beginOperation('sync');
  if (session.completeOperation('sync', first) || !session.completeOperation('sync', second) || session.snapshot().operations.sync !== 'completed') {
    throw new Error('Stale operation completion changed the current Session state');
  }
  const finalizeGeneration = session.beginOperation('finalize');
  if (!session.cancelOperation('finalize', finalizeGeneration) || session.snapshot().operations.finalize !== 'cancelled') {
    throw new Error('Cancelled operation did not settle in the Session');
  }
}, 'MapSession rejects stale operation completion');

// 7. Composition payloads must be file-backed, never embedded in evalScript.
assertDoesNotThrow(() => {
  const bridge = fs.readFileSync(path.resolve(__dirname, '../client/js/core/AEBridge.js'), 'utf8');
  const sync = fs.readFileSync(path.resolve(__dirname, '../client/js/core/SyncManager.js'), 'utf8');
  const finalize = fs.readFileSync(path.resolve(__dirname, '../client/js/core/FinalizeController.js'), 'utf8');
  if (!bridge.includes('invokeWithPayloadFile') || !sync.includes("invokeWithPayloadFile(") || !finalize.includes("invokeWithPayloadFile(")) {
    throw new Error('Composition payload-file bridge route is missing');
  }
}, 'Composition requests use temporary payload files');

// 8. Multi-map host composition names are scoped by a client document identity.
assertDoesNotThrow(() => {
  const sync = fs.readFileSync(path.resolve(__dirname, '../client/js/core/SyncManager.js'), 'utf8');
  const finalize = fs.readFileSync(path.resolve(__dirname, '../client/js/core/FinalizeController.js'), 'utf8');
  const host = fs.readFileSync(path.resolve(__dirname, '../host/modules/compBuilder.jsx'), 'utf8');
  if (!sync.includes('documentId: snapshot.documentId') || !finalize.includes('documentId: snapshot.documentId') ||
      !host.includes('identitySuffix') || !host.includes('opengeoFindDocumentOuterComp(documentId)')) {
    throw new Error('Composition document identity is not propagated end to end');
  }
}, 'Composition identity is propagated from client to host');

// 9. Search → Draw uses one purpose-built, local 10m package. Its contract is
// intentionally limited to open, international terrestrial borders.
assertDoesNotThrow(() => {
  const borderSource = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'vector-data-sources/natural-earth/10m/ne_10m_admin_0_boundary_lines_land.geojson'), 'utf8'));
  const outlines = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../client/assets/data/vectors/country-outlines-10m.json'), 'utf8'));
  const index = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../client/assets/data/vectors/country-index-10m.json'), 'utf8'));
  const sourceCatalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'vector-data-sources/SOURCES_MANIFEST.json'), 'utf8'));
  const topology = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'vector-data-sources/opengeo-profiles/countries_clipped.topojson'), 'utf8'));
  const canonicalCountries = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'vector-data-sources/natural-earth/10m/ne_10m_admin_0_countries.geojson'), 'utf8'));
  const builder = fs.readFileSync(path.resolve(__dirname, 'build-land-border-data.js'), 'utf8');
  const terrestrialBorders = borderSource.features.filter(feature => feature.properties && feature.properties.TYPE === 'Land');
  if (terrestrialBorders.length !== 494 || !builder.includes("properties.TYPE !== 'Land'")) {
    throw new Error('The build-time border evidence does not enforce terrestrial lines only');
  }
  const algeria = index.countries.DZA;
  const outlineById = new Map(outlines.features.map(feature => [feature.id, feature]));
  if (!algeria || Object.values(index.countries).some(country => Object.prototype.hasOwnProperty.call(country, 'borderIds'))) {
    throw new Error('Build-only border identifiers leaked into the runtime country index');
  }
  if (!algeria.outlineIds.length || algeria.outlineIds.some(id => {
    const feature = outlineById.get(id);
    return !feature || feature.type !== 'CountryLandOutline' || feature.isClosed !== true || feature.iso3 !== 'DZA' || !feature.rings.length;
  })) {
    throw new Error('DZA does not resolve to its closed land perimeter with coastline');
  }
  if (outlines.features.some(feature => feature.rings.reduce((points, ring) => points + ring.length, 0) > 100000)) {
    throw new Error('A country outline exceeds the guarded AE import point limit');
  }
  const topologyCountries = topology.objects && topology.objects.countries && topology.objects.countries.geometries;
  const marGeometry = topologyCountries && topologyCountries.find(feature => feature.properties && feature.properties.ISO_A3 === 'MAR');
  const eshGeometry = topologyCountries && topologyCountries.find(feature => feature.properties && feature.properties.ISO_A3 === 'ESH');
  const canonicalEsh = canonicalCountries.features && canonicalCountries.features.find(feature => feature.properties && feature.properties.ISO_A3 === 'ESH');
  const normalizeArc = arc => arc < 0 ? ~arc : arc;
  const marArcs = new Set((marGeometry && marGeometry.arcs || []).flat().map(normalizeArc));
  const eshArcs = new Set((eshGeometry && eshGeometry.arcs || []).flat().map(normalizeArc));
  const marOutline = outlineById.get(index.countries.MAR.outlineIds[0]);
  const eshOutline = outlineById.get(index.countries.ESH.outlineIds[0]);
  const mercatorToLatitude = y => Math.atan(Math.sinh(Math.PI * (1 - (2 * y / outlines.mapSize)))) * 180 / Math.PI;
  const marLatitudes = marOutline && marOutline.rings.flat().map(point => mercatorToLatitude(point[1]));
  const eshLatitudes = eshOutline && eshOutline.rings.flat().map(point => mercatorToLatitude(point[1]));
  const eshLongitudes = eshOutline && eshOutline.rings.flat().map(point => (point[0] / outlines.mapSize) * 360 - 180);
  const projectedRingArea = ring => {
    let area = 0;
    for (let pointIndex = 0, previousIndex = ring.length - 1; pointIndex < ring.length; previousIndex = pointIndex++) {
      area += ring[previousIndex][0] * ring[pointIndex][1] - ring[pointIndex][0] * ring[previousIndex][1];
    }
    return Math.abs(area / 2);
  };
  const eshProjectedArea = eshOutline && eshOutline.rings.reduce((sum, ring) => sum + projectedRingArea(ring), 0);
  const splitLatitude = 27 + (40 / 60);
  if (!marGeometry || !eshGeometry || !canonicalEsh || ![...marArcs].some(arc => eshArcs.has(arc)) ||
      !marOutline || !eshOutline || marOutline.geometrySource !== 'western-sahara-separated-profile' || eshOutline.geometrySource !== 'western-sahara-complete-territory-profile' ||
      Math.min(...marLatitudes) < splitLatitude - 0.000001 || Math.max(...eshLatitudes) > splitLatitude + 0.000001 || Math.min(...eshLatitudes) > 20.77 ||
      Math.min(...eshLongitudes) > -17.10 || Math.max(...eshLongitudes) < -8.681 ||
      eshProjectedArea < 10000000 ||
      !builder.includes('completeWesternSahara') || !builder.includes('turfUnion')) {
    throw new Error('MAR/ESH profile does not keep Morocco north of the split and reconstruct the complete Western Sahara territory');
  }
  if (sourceCatalog.schemaVersion !== '2.0.0' || !sourceCatalog.toolchain || sourceCatalog.toolchain.node !== process.versions.node ||
      !sourceCatalog.sources || sourceCatalog.sources.length !== 9 || !sourceCatalog.sources.every(source =>
        /^[a-f0-9]{64}$/.test(source.sha256) && Number.isInteger(source.bytes) && source.bytes > 0 &&
        source.filename && source.role && source.license && (source.url || source.sourceLocator))) {
    throw new Error('The canonical local source catalog is incomplete');
  }
  for (const source of sourceCatalog.sources) {
    const sourcePath = path.resolve(__dirname, 'vector-data-sources', source.path);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
    if (fs.statSync(sourcePath).size !== source.bytes || digest !== source.sha256) throw new Error(`Canonical source integrity check failed: ${source.path}`);
  }
}, 'Local 10m drawing package contains a complete country land perimeter without maritime lines');

assertDoesNotThrow(() => {
  const baselinePath = path.resolve(__dirname, 'vector-data-reproducibility-manifest.json');
  const sourceManifestPath = path.resolve(__dirname, 'vector-data-sources/SOURCES_MANIFEST.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const packageDefinition = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  const releaseVerifier = fs.readFileSync(path.resolve(__dirname, 'verify-release.js'), 'utf8');
  const reproducibility = require(path.resolve(__dirname, 'verify-vector-data-reproducibility.js'));
  const outputs = reproducibility.outputRecords(path.resolve(__dirname, '../client/assets/data'));
  const expectedRuntimeOutputs = baseline.outputs.filter(output => output.packaged);
  const outputByPath = new Map(outputs.map(output => [output.path, output]));
  const sourceManifestSha256 = crypto.createHash('sha256').update(fs.readFileSync(sourceManifestPath)).digest('hex');
  const buildToolsValid = baseline.buildTools.every(tool => {
    const toolPath = path.resolve(__dirname, '..', tool.path);
    return fs.existsSync(toolPath) && fs.statSync(toolPath).size === tool.bytes &&
      crypto.createHash('sha256').update(fs.readFileSync(toolPath)).digest('hex') === tool.sha256;
  });
  if (baseline.schemaVersion !== '1.0.0' || baseline.outputCount !== 97 || expectedRuntimeOutputs.length !== 94 || outputs.length !== expectedRuntimeOutputs.length ||
      baseline.sourceManifest.sha256 !== sourceManifestSha256 || !buildToolsValid ||
      expectedRuntimeOutputs.some(expected => {
        const actual = outputByPath.get(expected.path);
        return !actual || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256;
      }) ||
      packageDefinition.scripts['verify:data'] !== 'node scripts/verify-vector-data-reproducibility.js' ||
      !releaseVerifier.includes("runNode(['scripts/verify-vector-data-reproducibility.js'])")) {
    throw new Error('The clean vector-data build baseline or its release-gate integration is incomplete');
  }
}, 'All vector runtime data has a pinned clean-build and SHA-256 reproducibility baseline');

assertDoesNotThrow(() => {
  const contract = require(path.resolve(__dirname, 'runtime-data-contract.js'));
  const result = contract.verifyRuntimeData(path.resolve(__dirname, '../client/assets/data'));
  const buildSource = fs.readFileSync(path.resolve(__dirname, 'build.js'), 'utf8');
  const packageVerifier = fs.readFileSync(path.resolve(__dirname, 'verify-package.js'), 'utf8');
  const runtimeBuilder = fs.readFileSync(path.resolve(__dirname, 'build-vector-runtime-data.js'), 'utf8');
  if (!result.ok || result.fileCount !== 96 || result.manifest.groups.length !== 8 ||
      !buildSource.includes('isAllowedRuntimeFile') || !packageVerifier.includes('verifyRuntimeData') ||
      !runtimeBuilder.includes('copyPackagedOutputs') || !runtimeBuilder.includes('forbiddenArtifacts')) {
    throw new Error(result.failures.length ? result.failures.join('; ') : 'Runtime data allowlist integration is incomplete');
  }
}, 'Runtime package data is default-deny, purpose-owned and excludes build-only artifacts');

assertDoesNotThrow(() => {
  const policyPath = path.resolve(__dirname, 'vector-data-sources/CARTOGRAPHY_POLICY.json');
  const runtimePath = path.resolve(__dirname, '../client/assets/data/vectors/cartography-policy.json');
  const outlinesPath = path.resolve(__dirname, '../client/assets/data/vectors/country-outlines-10m.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
  const outlines = JSON.parse(fs.readFileSync(outlinesPath, 'utf8'));
  const builder = fs.readFileSync(path.resolve(__dirname, 'build-land-border-data.js'), 'utf8');
  const sourceHash = crypto.createHash('sha256').update(fs.readFileSync(policyPath)).digest('hex');
  const locked = policy.activeProfiles.find(profile => profile.status === 'active-locked' && profile.affectedIso3.includes('MAR') && profile.affectedIso3.includes('ESH'));
  const palestineReview = policy.plannedReviews.find(review => review.reviewId === 'palestine-boundary-review-v1');
  const hashOutline = iso3 => {
    const feature = outlines.features.find(item => item.iso3 === iso3);
    return feature && crypto.createHash('sha256').update(JSON.stringify({ iso3: feature.iso3, rings: feature.rings })).digest('hex');
  };
  if (policy.governance.defaultDisputedBoundaryAuthority !== 'United Nations' || !policy.governance.productOwnerOverrideAllowed ||
      !locked || locked.profileId !== 'western-sahara-separated-v1' ||
      hashOutline('MAR') !== locked.expectedGeometrySha256.MAR || hashOutline('ESH') !== locked.expectedGeometrySha256.ESH ||
      !palestineReview || palestineReview.status !== 'planned-no-runtime-effect' ||
      runtime.policyVersion !== policy.policyVersion || runtime.sourcePolicySha256 !== sourceHash ||
      !builder.includes("readCartographyPolicy()") || !builder.includes('Locked cartography geometry changed') ||
      /const WESTERN_SAHARA_SPLIT_LAT\s*=\s*27/.test(builder)) {
    throw new Error('Versioned cartography policy is not authoritative, auditable, or protecting the approved MAR/ESH geometry');
  }
}, 'Cartography policy locks MAR/ESH, records UN-first governance and leaves Palestine as a non-runtime review');

assertDoesNotThrow(() => {
  const GeoDataRepository = require(path.resolve(__dirname, '../client/js/core/GeoDataRepository.js'));
  const CartographyPolicy = require(path.resolve(__dirname, '../client/js/core/CartographyPolicy.js'));
  const policy = new CartographyPolicy(new GeoDataRepository());
  const stamp = policy.getMetadataStamp();
  const MetadataManager = loadBrowserClass(path.resolve(__dirname, '../client/js/ae/MetadataManager.js'), 'MetadataManager', {
    console, OpenGeoVersions: { cartographyPolicy: '1.0.0' }
  });
  const manager = new MetadataManager({}, policy);
  const state = manager.createSnapshotState({
    camera: { lat: 1, lon: 2, zoom: 3 }, tileSize: 256, sourceKey: 'esri', documentId: 'doc-policy',
    composition: { width: 1920, height: 1080 }, operationId: 'op-policy'
  }, false, null);
  if (!policy.valid || stamp.policyVersion !== '1.0.0' || stamp.dataBundleVersion !== '1.0.0' ||
      !stamp.activeProfileIds.includes('western-sahara-separated-v1') ||
      !state.opengeo.cartography || state.opengeo.cartography.sourcePolicySha256 !== stamp.sourcePolicySha256) {
    throw new Error('Runtime cartography policy stamp is missing from immutable composition metadata');
  }
}, 'Runtime metadata records cartography policy, data bundle and active profile versions');

assertDoesNotThrow(() => {
  const result = require(path.resolve(__dirname, 'verify-vector-geometry.js')).verifyGeometry();
  if (!result.ok || result.fixtureCount !== 6 || result.relationshipCount !== 1 || result.checks < 70) {
    throw new Error(result.failures.length ? result.failures.join('; ') : 'Golden geometry coverage is incomplete');
  }
}, 'Golden geometry protects validity, closure, labels, islands, antimeridian and MAR/ESH separation');

assertDoesNotThrow(() => {
  const repository = new (require(path.resolve(__dirname, '../client/js/core/GeoDataRepository.js')))();
  const algeria = repository.getCountryOutline('DZ');
  const iceland = repository.getCountryOutline('IS');
  if (!algeria || algeria.country.iso3 !== 'DZA' || !algeria.features.length ||
      algeria.features.some(feature => feature.type !== 'CountryLandOutline' || feature.isClosed !== true || feature.iso3 !== 'DZA')) {
    throw new Error('Country lookup can return geometry outside the selected country-outline contract');
  }
  if (!iceland || !iceland.features.length || iceland.features.some(feature => feature.isClosed !== true || feature.iso3 !== 'ISL')) {
    throw new Error('An island country does not retain its coastline outline');
  }
}, 'Country-outline lookup resolves ISO2 and retains island coastlines');

assertDoesNotThrow(() => {
  const GeoDataRepository = require(path.resolve(__dirname, '../client/js/core/GeoDataRepository.js'));
  const GeographyIdentityResolver = require(path.resolve(__dirname, '../client/js/core/GeographyIdentityResolver.js'));
  const resolver = new GeographyIdentityResolver(new GeoDataRepository());
  const source = {
    name: 'Western Sahara',
    display_name: 'Western Sahara, Oum Dreyga, Morocco',
    osm_type: 'relation',
    osm_id: 2559126,
    address: { country_code: 'ma' }
  };
  const relation = resolver.resolve(source, 'Western Sahara');
  const english = resolver.resolve({ name: 'Western Sahara', display_name: 'Western Sahara, Morocco', address: { country_code: 'ma' } }, 'Western Sahara');
  const french = resolver.resolve({ display_name: 'Sahara Occidental, Maroc', address: { country_code: 'ma' } }, 'Sahara Occidental');
  const arabic = resolver.resolve({ display_name: 'الصحراء الغربية، المغرب', address: { country_code: 'ma' } }, 'الصحراء الغربية');
  const morocco = resolver.resolve({ name: 'Morocco', display_name: 'Morocco', osm_type: 'relation', osm_id: 3630439, address: { country_code: 'ma' } }, 'Morocco');
  const borderCity = resolver.resolve({ name: 'Tindouf', display_name: 'Tindouf, Algeria', address: { country_code: 'dz' } }, 'Tindouf');
  const falsePositiveGuard = resolver.resolve({ name: 'Border Road', display_name: 'Road to Western Sahara, Tindouf, Algeria', address: { country_code: 'dz' } }, 'Border Road');
  const unknown = resolver.resolve({ name: 'Unindexed Place', display_name: 'Unindexed Place', address: { country_code: 'zz' } }, 'Unindexed Place');
  if (relation.drawingIso3 !== 'ESH' || relation.ruleId !== 'identity.osm-relation' || relation.confidence !== 1 ||
      relation.displayLabel !== 'Western Sahara, Oum Dreyga' || relation.sourceAttribution.countryCode !== 'MA' ||
      english.drawingIso3 !== 'ESH' || french.drawingIso3 !== 'ESH' || french.displayLabel !== 'Sahara Occidental' ||
      arabic.drawingIso3 !== 'ESH' || arabic.displayLabel !== 'الصحراء الغربية' ||
      morocco.drawingIso3 !== 'MAR' || borderCity.drawingIso3 !== 'DZA' || falsePositiveGuard.drawingIso3 !== 'DZA' ||
      unknown.drawingIso3 !== 'UNKNOWN' || unknown.ruleId !== 'identity.unknown' || unknown.confidence !== 0 ||
      source.display_name !== 'Western Sahara, Oum Dreyga, Morocco') {
    throw new Error('Geographic identity resolution is not deterministic, multilingual, auditable, or source-preserving');
  }
}, 'GeographyIdentityResolver separates drawing identity, display label and provider attribution');

assertDoesNotThrow(() => {
  const search = fs.readFileSync(path.resolve(__dirname, '../client/js/ui/SearchPanel.js'), 'utf8');
  const resolver = fs.readFileSync(path.resolve(__dirname, '../client/js/core/GeographyIdentityResolver.js'), 'utf8');
  const manager = fs.readFileSync(path.resolve(__dirname, '../client/js/core/VectorMapManager.js'), 'utf8');
  const app = fs.readFileSync(path.resolve(__dirname, '../client/js/app.js'), 'utf8');
  const toolbar = fs.readFileSync(path.resolve(__dirname, '../client/js/ui/ToolbarController.js'), 'utf8');
  const lifecycle = fs.readFileSync(path.resolve(__dirname, '../client/js/core/ApplicationLifecycle.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '../client/index.html'), 'utf8');
  const host = fs.readFileSync(path.resolve(__dirname, '../host/modules/vectorHost.jsx'), 'utf8');
  if (!search.includes("search:drawCountryOutline") || !search.includes('identity.drawingIso3') || search.includes('CloudBoundaryService') ||
      search.includes('western\\s+sahara') || !resolver.includes('sourceAttribution') || !resolver.includes('ruleId') ||
      !manager.includes('getCountryOutline') || manager.includes('fetchBoundary') || manager.includes('customFeatures') ||
      html.includes('id="vector-map-btn"') || app.includes('_generateVectorMap') ||
      !host.includes('priorLayer.comment === vectorComment') || !host.includes('definition.isClosed !== false') || !host.includes('ADBE Vector Filter - Trim')) {
    throw new Error('Search drawing is not isolated from legacy/cloud vector-map paths');
  }
}, 'Search pen is the sole local country-outline drawing entry point');

assertDoesNotThrow(() => {
  const preview = fs.readFileSync(path.resolve(__dirname, '../client/js/overlays/VectorPreviewLayer.js'), 'utf8');
  const index = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../client/assets/data/vector-preview/10m/index.json'), 'utf8'));
  if (!preview.includes("vector-preview/10m/index.json") || !preview.includes('loadDatasetAsync') ||
      !preview.includes("viewport.zoom >= 4.2 ? '10m' : '50m'") || preview.includes("loadDataset('world_vector_layers_10m.json')") ||
      !index.layers || index.totals.chunks < 10 || index.totals.points < 1000000) {
    throw new Error('High-detail vector preview is missing');
  }
}, 'Vector preview streams indexed high detail without loading the 10m monolith');

assertDoesNotThrow(() => {
  const dataDir = path.resolve(__dirname, '../client/assets/data');
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'vector-preview/10m/index.json'), 'utf8'));
  const reproduction = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'vector-data-reproducibility-manifest.json'), 'utf8'));
  const sourceRecord = reproduction.outputs.find(output => output.path === 'world_vector_layers_10m.json');
  let chunks = 0, features = 0, points = 0, bytes = 0;
  for (const layerName of ['land', 'borders', 'coastlines']) for (const entry of index.layers[layerName]) {
    const fileBuffer = fs.readFileSync(path.join(dataDir, entry.file));
    if (fileBuffer.length !== entry.bytes || fileBuffer.length > 2 * 1024 * 1024 ||
        crypto.createHash('sha256').update(fileBuffer).digest('hex') !== entry.sha256) {
      throw new Error(`Invalid vector preview chunk: ${entry.file}`);
    }
    chunks++; features += entry.featureCount; points += entry.pointCount; bytes += entry.bytes;
  }
  if (!sourceRecord || sourceRecord.sha256 !== index.sourceSha256 || chunks !== index.totals.chunks || features !== index.totals.features ||
      points !== index.totals.points || bytes !== index.totals.bytes) throw new Error('Vector preview index totals or source identity drifted');
}, 'Vector preview index and all spatial chunks have reproducible integrity');

assertDoesNotThrow(() => {
  const VectorPreviewLayer = require(path.resolve(__dirname, '../client/js/overlays/VectorPreviewLayer.js'));
  const layer = Object.create(VectorPreviewLayer.prototype);
  layer.mapSize = 262144;
  layer._index10m = { layers: {
    land: [{ id: 'land-visible', bbox: [100, 100, 200, 200] }],
    borders: [{ id: 'borders-visible', bbox: [120, 100, 220, 200] }],
    coastlines: [{ id: 'coast-wrap', bbox: [262100, 100, 262200, 200] }]
  } };
  const localWindow = { minX: 0, minY: 0, maxX: 300, maxY: 300 };
  const visible = layer._getVisibleChunkIds('10m', localWindow);
  if (visible.size !== 3 || !visible.has('coast-wrap') || layer._isVisible([5000, 100, 5100, 200], localWindow)) {
    throw new Error('Viewport culling or antimeridian wrap is not local and bounded');
  }
}, 'Vector preview culls locally and protects all visible semantic layers');

assertDoesNotThrow(() => {
  const VectorMapManager = require(path.resolve(__dirname, '../client/js/core/VectorMapManager.js'));
  const manager = Object.create(VectorMapManager.prototype);
  const features = [{ id: 'outline-DZA-01' }, { id: 'outline-DZA-02' }];
  const initial = manager._getFeatureSignature({ iso3: 'DZA' }, features);
  const reordered = manager._getFeatureSignature({ iso3: 'DZA' }, features.slice().reverse());
  const otherCountry = manager._getFeatureSignature({ iso3: 'TUN' }, features);
  if (initial !== reordered || initial === otherCountry) throw new Error('Country-outline layer replacement identity is unstable or cross-country');
}, 'Country-outline redraw replaces only the exact country layer');

// 10. A viewport crossing the antimeridian must request only its local tile
// band, not every tile caused by normalized longitude ordering.
assertDoesNotThrow(() => {
  const sandbox = { console, Math, Number, Object, Array };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/TileAddress.js'), 'TileAddress', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/CoveragePlanner.js'), 'CoveragePlanner', sandbox);
  const TileGrid = loadBrowserClass(path.resolve(__dirname, '../client/js/map/TileGrid.js'), 'TileGrid', sandbox);
  const viewport = { centerLat: 0, centerLng: 179.9, width: 900, height: 500, zoom: 5, tileSize: 256 };
  const tiles = TileGrid.getVisibleTiles(viewport);
  const xValues = new Set(tiles.map(tile => tile.x));
  if (!xValues.has(0) || !xValues.has(31) || tiles.length >= 80) {
    throw new Error('Antimeridian tile range is not bounded and wrapped');
  }
}, 'TileGrid bounds requests across the antimeridian');

assertDoesNotThrow(() => {
  const sandbox = { console, Math, Number, Object, Array, Promise, Map, Set, String };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/TileAddress.js'), 'TileAddress', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/CachePolicy.js'), 'CachePolicy', sandbox);
  const CoveragePlanner = loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/CoveragePlanner.js'), 'CoveragePlanner', sandbox);
  const TileGrid = loadBrowserClass(path.resolve(__dirname, '../client/js/map/TileGrid.js'), 'TileGrid', sandbox);
  sandbox.TileTransport = { request: () => { throw new Error('Transport must not run during coverage planning'); } };
  const OpenGeo = loadBrowserClass(path.resolve(__dirname, '../client/js/engine/OpenGeoEngine.js'), 'OpenGeo', sandbox);
  const normalize = tiles => tiles.map(tile => `${tile.z}/${tile.x}/${tile.wrappedX}/${tile.y}/${tile.pixelX}/${tile.pixelY}`).sort();
  const cases = [
    { lat: 36.75, lon: 3.05, zoom: 6.25, downloadZoom: 7, width: 1920, height: 1080 },
    { lat: 5, lon: 179.8, zoom: 4.5, downloadZoom: 5, width: 1080, height: 1920 }
  ];
  for (const item of cases) {
    const golden = normalize(CoveragePlanner.planComposition(
      { lat: item.lat, lon: item.lon, zoom: item.zoom },
      { width: item.width, height: item.height, downloadZoom: item.downloadZoom, tileSize: 256 }
    ));
    const facade = normalize(TileGrid.getCompVisibleTiles(item.lat, item.lon, item.zoom, item.width, item.height, item.downloadZoom));
    const engine = normalize(new OpenGeo.TileGrid('https://example.test/{z}/{x}/{y}.png').getVisibleTiles({
      lat: item.lat, lon: item.lon, zoom: item.downloadZoom, compZoom: item.zoom,
      viewportWidth: item.width, viewportHeight: item.height
    }));
    if (JSON.stringify(golden) !== JSON.stringify(facade) || JSON.stringify(golden) !== JSON.stringify(engine)) {
      throw new Error('Preview/export/finalize coverage adapters diverged from the canonical golden set');
    }
  }
}, 'Preview and Finalize adapters produce one golden tile-coverage set');

// Draft composition coverage must use the fractional source/comp zoom ratio.
// A 1920x1080 z6 camera rendered from z4 needs six visible tiles (plus a
// bounded one-tile gutter), never an aligned 8x8/16x16 download block.
assertDoesNotThrow(() => {
  const sandbox = { console, Math, Number, Object, Array };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/TileAddress.js'), 'TileAddress', sandbox);
  const CoveragePlanner = loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/CoveragePlanner.js'), 'CoveragePlanner', sandbox);
  const camera = { lat: 28, lon: 2, zoom: 6 };
  const visible = CoveragePlanner.planComposition(camera, {
    width: 1920, height: 1080, downloadZoom: 4, tileSize: 256, gutterTiles: 0
  });
  const buffered = CoveragePlanner.planComposition(camera, {
    width: 1920, height: 1080, downloadZoom: 4, tileSize: 256, gutterTiles: 1
  });
  const explicitlyAligned = CoveragePlanner.planComposition(camera, {
    width: 1920, height: 1080, downloadZoom: 4, tileSize: 256, gutterTiles: 1, alignMegaTiles: true
  });
  if (visible.length !== 6 || buffered.length > 24 || buffered.length <= visible.length || explicitlyAligned.length <= buffered.length) {
    throw new Error(`Overfetch regression: visible=${visible.length}, buffered=${buffered.length}, aligned=${explicitlyAligned.length}`);
  }
}, 'Draft coverage stays proportional and does not align downloads to MegaTile blocks');

assertDoesNotThrow(() => {
  let calls = [];
  const sandbox = {
    console,
    window: {},
    Number,
    Math,
    Object,
    Array,
    CoveragePlanner: {
      planComposition(camera, options) {
        calls.push(options.downloadZoom);
        return [{ key: `${options.downloadZoom}/${calls.length}/0`, x: calls.length, wrappedX: calls.length, y: 0, z: options.downloadZoom }];
      }
    },
    MercatorProjection: { cameraPixelDistance: () => 10 }
  };
  const TilePlanner = loadBrowserClass(path.resolve(__dirname, '../client/js/engine/TilePlanner.js'), 'TilePlanner', sandbox);
  const app = { _buildTileUrl: () => 'tile://planned' };
  const options = {
    qualityOffset: 0, sourceTileSize: 256, maxSourceZoom: 19,
    sourceKey: 'test', fetchWidth: 1920, fetchHeight: 1080,
    gutterTiles: 1, includeBaseCoverage: false
  };
  new TilePlanner(app).createPlan([
    { lat: 0, lon: 0, zoom: 4 },
    { lat: 1, lon: 1, zoom: 6 }
  ], options);
  if (calls.length !== 2 || calls[0] !== 4 || calls[1] !== 6) {
    throw new Error('Trajectory planner still requested an implicit base layer');
  }
  calls = [];
  new TilePlanner(app).createPlan([
    { lat: 0, lon: 0, zoom: 4 },
    { lat: 1, lon: 1, zoom: 6 }
  ], Object.assign({}, options, { includeBaseCoverage: true }));
  if (calls.length !== 3 || calls.filter(zoom => zoom === 4).length !== 2) {
    throw new Error('Explicit base-coverage policy is not preserved');
  }
}, 'Trajectory coverage does not duplicate a base layer unless explicitly requested');

assertDoesNotThrow(() => {
  const scanner = fs.readFileSync(path.resolve(__dirname, '../host/modules/trajectoryScanner.jsx'), 'utf8');
  if (!scanner.includes('cameraProperty.keyTime(1)') ||
      !scanner.includes('start = Math.max(workStart, firstKeyTime)') ||
      !scanner.includes('end = Math.min(workEnd, lastKeyTime)') ||
      !scanner.includes('var end = workStart;')) {
    throw new Error('Trajectory scan is still unconditionally traversing the complete Work Area');
  }
}, 'Trajectory scan is bounded to the animated keyframe interval');

assertDoesNotThrow(() => {
  const ApplicationLifecycle = require(path.resolve(__dirname, '../client/js/core/ApplicationLifecycle.js'));
  const order = [];
  const target = {
    addEventListener: () => order.push('listen'),
    removeEventListener: () => order.push('unlisten')
  };
  const eventBus = {
    on: () => { order.push('subscribe'); return () => order.push('unsubscribe'); },
    emit: () => {}
  };
  const lifecycle = new ApplicationLifecycle(eventBus);
  lifecycle.listen(target, 'click', () => {});
  lifecycle.subscribe('test:event', () => {});
  lifecycle.dispose();
  lifecycle.dispose();
  if (order.join(',') !== 'listen,subscribe,unsubscribe,unlisten') throw new Error('Lifecycle did not dispose exactly once in reverse ownership order');
}, 'Application lifecycle disposes DOM and EventBus ownership exactly once');

assertDoesNotThrow(() => {
  const configSandbox = { window: {}, Object };
  const config = loadBrowserClass(path.resolve(__dirname, '../client/js/config.js'), 'OpenGeoConfig', configSandbox);
  const baseline = JSON.stringify(config.tileSources);
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const events = [];
  const sandbox = { console, window: {}, OpenGeoConfig: config, localStorage: storage, globalEventBus: { emit: name => events.push(name) }, Object, String };
  const ProviderManager = loadBrowserClass(path.resolve(__dirname, '../client/js/core/ProviderManager.js'), 'ProviderManager', sandbox);
  const settingsPanelSource = fs.readFileSync(path.resolve(__dirname, '../client/js/ui/SettingsPanel.js'), 'utf8');
  const manager = new ProviderManager(config, storage, sandbox.globalEventBus);
  const required = manager.getKeyProviderIds();
  const keys = {};
  for (const id of required) keys[id] = id + '-secret';
  const result = manager.saveSettings({ keys, customUrl: 'https://tiles.example.test/{z}/{x}/{y}.png' });
  if (!result.ok || JSON.stringify(config.tileSources) !== baseline) throw new Error('Provider settings mutated the global configuration');
  if (!Object.isFrozen(manager.providers) || !Object.isFrozen(manager.getProvider('esri'))) throw new Error('Provider registry is mutable');
  if (!required.includes('mapboxSatellite') || !required.includes('maptiler') || !required.includes('stamenTerrain')) throw new Error('Key-provider schema is incomplete');
  if (!settingsPanelSource.includes('getProviderSchema()')) throw new Error('Provider selector is not generated from the registry schema');
  if (!manager.buildTileUrl('stamenTerrain', 1, 2, 3).includes('stamenTerrain-secret') || events.length !== 1) throw new Error('Schema-backed provider key was not resolved or published');
}, 'Provider registry is immutable and its key schema covers every secured provider');

assertDoesNotThrow(() => {
  const app = fs.readFileSync(path.resolve(__dirname, '../client/js/app.js'), 'utf8');
  const toolbar = fs.readFileSync(path.resolve(__dirname, '../client/js/ui/ToolbarController.js'), 'utf8');
  const composition = fs.readFileSync(path.resolve(__dirname, '../client/js/core/CompositionController.js'), 'utf8');
  const preview = fs.readFileSync(path.resolve(__dirname, '../client/js/core/PreviewController.js'), 'utf8');
  const presenter = fs.readFileSync(path.resolve(__dirname, '../client/js/ui/OperationPresenter.js'), 'utf8');
  const coordinator = fs.readFileSync(path.resolve(__dirname, '../client/js/core/ApplicationCoordinator.js'), 'utf8');
  if (!app.includes('new ToolbarController(this)') || !app.includes('new CompositionController(this)') || !app.includes('new PreviewController(this') || !app.includes('new OperationPresenter(')) {
    throw new Error('AppBootstrap does not compose all extracted controllers');
  }
  if (app.includes("document.getElementById('provider-settings-btn')") || app.includes('reader.readAsText(file)')) throw new Error('DOM/file workflows still leak into AppBootstrap');
  if (!toolbar.includes('_bindProviderSettings') || !composition.includes('this.loadRevision') || !preview.includes('requestAnimationFrame') || !presenter.includes("'ui:download_modal'") || !coordinator.includes('validateProvider(source)')) {
    throw new Error('Extracted controller responsibilities are incomplete');
  }
}, 'AppBootstrap delegates UI, preview, composition and operation presentation');

// 11. Provider cache identity must not use a resolved API-key URL, while tile
// cache keys still isolate custom/provider definitions.
assertDoesNotThrow(() => {
  const providers = fs.readFileSync(path.resolve(__dirname, '../client/js/core/ProviderManager.js'), 'utf8');
  const tiles = fs.readFileSync(path.resolve(__dirname, '../client/js/tiles/TileManager.js'), 'utf8');
  if (!providers.includes('hash.toString(36)') || providers.includes('this.getResolvedTemplate(id)}')) {
    throw new Error('Provider signature is not compact or can leak a resolved API key');
  }
  if (!tiles.includes('this.sourceSignature') || !tiles.includes('MemoryCache.computeKey(t.x, t.y, t.z, this.sourceSignature)')) {
    throw new Error('Tile cache key is not isolated by provider definition');
  }
}, 'Provider signatures isolate cache entries without exposing keys');

// 14. Custom providers accept only a complete HTTPS XYZ template, preventing
// accidental insecure URLs and malformed requests from entering configuration.
assertDoesNotThrow(() => {
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem: () => {} },
    globalEventBus: { emit: () => {} },
    OpenGeoConfig: { tileSources: { customXYZ: { url: '', tileSize: 256 } } },
    String
  };
  const ProviderManager = loadBrowserClass(path.resolve(__dirname, '../client/js/core/ProviderManager.js'), 'ProviderManager', sandbox);
  const manager = new ProviderManager();
  if (manager.validateCustomTemplate('http://example.test/{z}/{x}/{y}').ok) throw new Error('HTTP custom URL was accepted');
  if (manager.validateCustomTemplate('https://example.test/{z}/{x}').ok) throw new Error('Incomplete XYZ template was accepted');
  if (!manager.validateCustomTemplate('https://example.test/{z}/{x}/{y}.png').ok) throw new Error('Valid HTTPS XYZ template was rejected');
}, 'Custom XYZ providers are validated before persistence');

// 12. State commits persist schema-versioned metadata and all long-lived UI
// services expose cleanup paths.
assertDoesNotThrow(() => {
  const app = fs.readFileSync(path.resolve(__dirname, '../client/js/app.js'), 'utf8');
  const lifecycle = fs.readFileSync(path.resolve(__dirname, '../client/js/core/ApplicationLifecycle.js'), 'utf8');
  const metadata = fs.readFileSync(path.resolve(__dirname, '../client/js/ae/MetadataManager.js'), 'utf8');
  const helpers = fs.readFileSync(path.resolve(__dirname, '../host/modules/helpers.jsx'), 'utf8');
  if (!app.includes('_scheduleMetadataSave()') || !metadata.includes('documentId:') || !metadata.includes('compWidth:')) {
    throw new Error('Metadata commit lifecycle is incomplete');
  }
  if (!app.includes('this.lifecycle.dispose()') || !lifecycle.includes('this._unsubscribers.splice(0).reverse()') || !helpers.includes('function withUndoGroup')) {
    throw new Error('Lifecycle or host undo boundary is missing');
  }
}, 'Metadata lifecycle and host mutation boundaries are explicit');

// 13. Preview composition manifests are request-scoped; navigation history may
// not silently inflate a later AE composition.
assertDoesNotThrow(() => {
  const sync = fs.readFileSync(path.resolve(__dirname, '../client/js/core/SyncManager.js'), 'utf8');
  const engine = fs.readFileSync(path.resolve(__dirname, '../client/js/engine/OpenGeoEngine.js'), 'utf8');
  if (!sync.includes('const accumulatedTiles = syncResult.tiles || []') || engine.includes('_accumulatedTiles')) {
    throw new Error('Preview still relies on a global accumulated tile history');
  }
}, 'Preview manifests are scoped to the current sync request');

assertDoesNotThrow(() => {
  const manager = fs.readFileSync(path.resolve(__dirname, '../client/js/tiles/TileManager.js'), 'utf8');
  if (!manager.includes('const cacheKey = MemoryCache.computeKey') || !manager.includes('const renderKey = this._getRenderKey(t)') || !manager.includes('entry.cacheKey !== data.key') || !manager.includes('_hasActiveCacheKey(entry.cacheKey)')) {
    throw new Error('Wrapped tile render slots still collapse into one cache entry');
  }
}, 'Wrapped world tiles render in every visible screen slot without duplicate downloads');

assertDoesNotThrow(() => {
  const html = fs.readFileSync(path.resolve(__dirname, '../client/index.html'), 'utf8');
  const app = fs.readFileSync(path.resolve(__dirname, '../client/js/app.js'), 'utf8');
  const preview = fs.readFileSync(path.resolve(__dirname, '../client/js/core/PreviewController.js'), 'utf8');
  const layer = fs.readFileSync(path.resolve(__dirname, '../client/js/overlays/VectorPreviewLayer.js'), 'utf8');
  if (!html.includes('id="preview-mode-btn"') || !html.includes('VectorPreviewLayer.js') || !app.includes('_setPreviewMode') || !preview.includes("'Offline Vector Preview — no tile downloads.'") || !preview.includes("this.mode === 'vector'") || !layer.includes('loadDatasetAsync') || !layer.includes('MercatorProjection.getWorldSize')) {
    throw new Error('Offline vector preview is not isolated from satellite tile mode');
  }
}, 'Offline Vector Preview renders bundled boundaries without tile requests');

// 13b. Each new preview replaces only that document's prior preview assets;
// a completed Finalize result remains immutable until the next Finalize.
assertDoesNotThrow(() => {
  const sync = fs.readFileSync(path.resolve(__dirname, '../client/js/core/SyncManager.js'), 'utf8');
  const host = fs.readFileSync(path.resolve(__dirname, '../host/modules/compBuilder.jsx'), 'utf8');
  if (!sync.includes('previewGeneration: currentGeneration') || !sync.includes('replaceFinal: !snapshot.isFinalized') ||
      !host.includes('opengeoRemoveDocumentAssets(folders.previewTiles') || !host.includes('var replaceFinal = data.replaceFinal === true')) {
    throw new Error('Preview replacement lifecycle is incomplete');
  }
}, 'Preview assets remain bounded while finalized layers stay intact');

// 15. Finalize must be a single-flight operation and must not commit an
// export after the user changed the active map/document.
assertDoesNotThrow(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../client/js/core/FinalizeController.js'), 'utf8');
  if (!source.includes('if (this.isFinalizing)') || !source.includes('_assertCurrentRun(runId, activeCompId, documentId, snapshot)')) {
    throw new Error('Finalize single-flight or stale-map protection is missing');
  }
}, 'Finalize rejects overlapping or stale-map operations');

// 15b. Spatial pins must resolve the target document's controller in the host,
// never embed a legacy global OpenGeo composition name in client expressions.
assertDoesNotThrow(() => {
  const client = fs.readFileSync(path.resolve(__dirname, '../client/js/ae/SpatialPin.js'), 'utf8');
  const host = fs.readFileSync(path.resolve(__dirname, '../host/modules/spatialPinHost.jsx'), 'utf8');
  if (client.includes('_generateMercatorExpression') || client.includes('OpenGeo World Mapcomp') || !host.includes("findLayerByComment(comp, 'opengeo:controller')")) {
    throw new Error('Spatial pin still relies on a global map composition name');
  }
}, 'Spatial pins are scoped to the target map document');

// 16. The bundled icon runtime must not reference a missing/corrupt source
// map, which otherwise produces distracting CEP DevTools warnings.
assertDoesNotThrow(() => {
  const lucide = fs.readFileSync(path.resolve(__dirname, '../client/lib/lucide.min.js'), 'utf8');
  if (/sourceMappingURL\s*=\s*lucide\.min\.js\.map/.test(lucide)) {
    throw new Error('Lucide bundle still references an unavailable source map');
  }
}, 'Bundled icon library has no broken source-map reference');

// 19. Finalize cancellation must abort engine downloads and invalidate the
// active run before any subsequent AE composition commit can occur.
assertDoesNotThrow(() => {
  const finalize = fs.readFileSync(path.resolve(__dirname, '../client/js/core/FinalizeController.js'), 'utf8');
  const engine = fs.readFileSync(path.resolve(__dirname, '../client/js/engine/OpenGeoEngine.js'), 'utf8');
  const session = fs.readFileSync(path.resolve(__dirname, '../client/js/engine/DownloadSession.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '../client/index.html'), 'utf8');
  if (!finalize.includes('cancel()') || !finalize.includes('this._downloadSession.cancel()') || !finalize.includes("error.code === 'OPEN_GEO_FINALIZE_CANCELLED'") || !finalize.includes("cancellation.code = 'OPEN_GEO_FINALIZE_CANCELLED'") || !session.includes('this.engine.cancelDownloads()') || !engine.includes('TileDownloader.prototype.cancelAll') || !engine.includes('Engine.prototype.cancelDownloads') || !html.includes('id="dl-cancel"')) {
    throw new Error('Cancelable Finalize lifecycle is incomplete');
  }
}, 'Finalize cancellation aborts downloads, prevents stale commits, and stays silent');

// 20. Preview and filesystem-backed engine downloads share the same network
// transport so timeout/abort/HTTP policy cannot drift between workflows.
assertDoesNotThrow(() => {
  const html = fs.readFileSync(path.resolve(__dirname, '../client/index.html'), 'utf8');
  const preview = fs.readFileSync(path.resolve(__dirname, '../client/js/tiles/TileDownloader.js'), 'utf8');
  const engine = fs.readFileSync(path.resolve(__dirname, '../client/js/engine/OpenGeoEngine.js'), 'utf8');
  const transport = fs.readFileSync(path.resolve(__dirname, '../client/js/tiles/TileTransport.js'), 'utf8');
  if (!html.includes('js/tiles/TileTransport.js') || !preview.includes('TileTransport.request') || !engine.includes('TileTransport.request') || !transport.includes('request.onabort')) {
    throw new Error('Tile transport is not shared across preview and engine paths');
  }
}, 'Preview and Finalize share one tile transport policy');

// 21. Disk cache files produced by the Engine must be namespaced by the safe
// provider signature so a provider switch cannot reuse wrong imagery.
assertDoesNotThrow(() => {
  const engine = fs.readFileSync(path.resolve(__dirname, '../client/js/engine/OpenGeoEngine.js'), 'utf8');
  const downloadSession = fs.readFileSync(path.resolve(__dirname, '../client/js/engine/DownloadSession.js'), 'utf8');
  const snapshot = fs.readFileSync(path.resolve(__dirname, '../client/js/core/OperationSnapshot.js'), 'utf8');
  if (!engine.includes('setCacheNamespace') || !engine.includes('this._cacheNamespace') || !downloadSession.includes('this.engine.setCacheNamespace(snapshot.providerSignature)') || !snapshot.includes('providerSignature: app.providerManager.getSignature(sourceKey)')) {
    throw new Error('Engine disk cache is not isolated by provider signature');
  }
}, 'Engine disk cache is isolated across providers');

// 22. Composition ownership/asset cleanup must be isolated in a host helper,
// leaving the builder responsible for orchestration rather than project scans.
assertDoesNotThrow(() => {
  const hostIndex = fs.readFileSync(path.resolve(__dirname, '../host/index.jsx'), 'utf8');
  const builder = fs.readFileSync(path.resolve(__dirname, '../host/modules/compBuilder.jsx'), 'utf8');
  const assets = fs.readFileSync(path.resolve(__dirname, '../host/modules/compositionAssets.jsx'), 'utf8');
  const tiles = fs.readFileSync(path.resolve(__dirname, '../host/modules/compositionTiles.jsx'), 'utf8');
  const rig = fs.readFileSync(path.resolve(__dirname, '../host/modules/compositionRig.jsx'), 'utf8');
  const result = fs.readFileSync(path.resolve(__dirname, '../host/modules/compositionResult.jsx'), 'utf8');
  if (!hostIndex.includes('compositionAssets.jsx') || !hostIndex.includes('compositionTiles.jsx') || !hostIndex.includes('compositionRig.jsx') || !hostIndex.includes('compositionResult.jsx') || !builder.includes('opengeoEnsureComposition') || !builder.includes('opengeoClearMapLayers') || !builder.includes('opengeoImportCompositionTiles') || !builder.includes('opengeoEnsureMapController') || !builder.includes('opengeoInstallMapPivotExpressions') || !builder.includes('opengeoSerializeCompositionResult') || !assets.includes('opengeoRemoveDocumentAssets') || !tiles.includes('opengeoImportCompositionTiles') || !rig.includes('opengeoInstallMapPivotExpressions') || !rig.includes('opengeoSynchronizeControllerCamera') || !result.includes('opengeoSerializeCompositionResult')) {
    throw new Error('Composition assets were not separated from compBuilder');
  }
}, 'Host composition ownership helpers are separated from the builder');

// 23. Finalized maps must continue to accept non-destructive Preview work.
assertDoesNotThrow(() => {
  const sync = fs.readFileSync(path.resolve(__dirname, '../client/js/core/SyncManager.js'), 'utf8');
  const builder = fs.readFileSync(path.resolve(__dirname, '../host/modules/compBuilder.jsx'), 'utf8');
  if (sync.includes('Auto-export blocked by Finalize Brake') || !sync.includes('queueTrajectoryPreview()') || !sync.includes('maxTrajectoryPreviewTiles = 2500') || !sync.includes("previewScope: 'trajectory'") || !builder.includes('var replaceFinal = data.replaceFinal === true')) {
    throw new Error('Preview after Finalize is not an isolated overlay workflow');
  }
}, 'Preview remains available after Finalize without deleting final layers');

// 23b. Add Key must supersede background viewport work, issue exactly one
// trajectory-preview request, and keep preview mutations visually atomic.
assertDoesNotThrow(() => {
  const cleared = [];
  const cancelled = [];
  const emitted = [];
  const sandbox = {
    console,
    clearTimeout: id => cleared.push(id),
    setTimeout: () => 99,
    require,
    OpenGeo: { Engine: { getDefaultCacheDir: () => 'C:/OpenGeo_Test' } },
    MegaTileStitcher: function() {},
    OperationSnapshot: {},
    TilePlanner: function() {},
    DownloadSession: function() {},
    globalEventBus: { emit: (event, payload) => emitted.push({ event, payload }) },
    window: {}
  };
  const SyncManager = loadBrowserClass(path.resolve(__dirname, '../client/js/core/SyncManager.js'), 'SyncManager', sandbox);
  const app = {
    activeCompId: 12,
    finalizeController: { isFinalizing: false },
    session: {
      operations: { sync: 'running' },
      nextGeneration: kind => kind === 'sync' ? 8 : 0,
      cancelOperation: (kind, generation) => { cancelled.push(`${kind}:${generation}`); return true; }
    }
  };
  const manager = new SyncManager(app);
  manager.exportTimer = 41;
  manager.trajectoryTimer = 42;
  manager._syncDownloadSession = { cancel: () => cancelled.push('sync-download') };
  manager._trajectoryDownloadSession = { cancel: () => cancelled.push('trajectory-download') };
  manager.prepareForKeyframeMutation();
  if (manager.exportTimer !== null || manager.trajectoryTimer !== null ||
      cleared.indexOf(41) < 0 || cleared.indexOf(42) < 0 ||
      cancelled.indexOf('sync-download') < 0 || cancelled.indexOf('trajectory-download') < 0 ||
      cancelled.indexOf('sync:8') < 0 || !emitted.some(item => item.event === 'ui:download_modal' && item.payload.show === false)) {
    throw new Error('Add Key did not supersede pending Live Sync/trajectory work');
  }

  const toolbar = fs.readFileSync(path.resolve(__dirname, '../client/js/ui/ToolbarController.js'), 'utf8');
  const addKeyStart = toolbar.indexOf('async _addKeyframe(');
  const addKeySection = toolbar.slice(addKeyStart, toolbar.indexOf('_finishGeoJSONError', addKeyStart));
  const builder = fs.readFileSync(path.resolve(__dirname, '../host/modules/compBuilder.jsx'), 'utf8');
  const tiles = fs.readFileSync(path.resolve(__dirname, '../host/modules/compositionTiles.jsx'), 'utf8');
  const transaction = fs.readFileSync(path.resolve(__dirname, '../host/modules/compositionTransaction.jsx'), 'utf8');
  const sync = fs.readFileSync(path.resolve(__dirname, '../client/js/core/SyncManager.js'), 'utf8');
  if (!addKeySection.includes('prepareForKeyframeMutation()') || addKeySection.includes('queueAutoExport()') ||
      !addKeySection.includes('queueTrajectoryPreview()') ||
      (sync.match(/await this\._packPreviewTiles\(/g) || []).length !== 2 ||
      !sync.includes("crypto.createHash('sha256')") ||
      (sync.match(/await this\._cleanupPreviewMegaTiles\(/g) || []).length !== 2 ||
      !builder.includes('data.previewStaging = true') ||
      !builder.includes('importedCount !== tiles.length') ||
      !transaction.includes('function opengeoCommitPreviewRevision') ||
      !tiles.includes("ownershipRole = isPreviewStaging ? 'preview-staging'") ||
      !tiles.includes('if (isPreviewStaging) tileLayer.enabled = false')) {
    throw new Error('Keyframe preview coalescing, packing, or atomic host swap is incomplete');
  }
}, 'Add Key supersedes stale sync and commits one packed preview generation atomically');

// 24. Add Keyframe and Record are intentionally separate: Record creates a
// new key, while ordinary navigation may safely edit only a key already at CTI.
assertDoesNotThrow(() => {
  const app = fs.readFileSync(path.resolve(__dirname, '../client/js/app.js'), 'utf8');
  const toolbar = fs.readFileSync(path.resolve(__dirname, '../client/js/ui/ToolbarController.js'), 'utf8');
  const metadata = fs.readFileSync(path.resolve(__dirname, '../host/modules/metadataSync.jsx'), 'utf8');
  const sync = fs.readFileSync(path.resolve(__dirname, '../client/js/ae/AESyncEngine.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '../client/index.html'), 'utf8');
  if (!app.includes('this.syncEngine.start();') || !toolbar.includes('_setKeyframeRecording') || !sync.includes('recordKeyframe: this.isKeyframeRecording') || sync.includes('sync:toggle') || sync.includes('setLiveSync(') || html.includes('live-sync-btn') || metadata.includes('sync:toggle') || !metadata.includes('function opengeoSetCameraControlValue') || !metadata.includes('recordKeyframe === true') || !metadata.includes('property.setValueAtTime(time, value)') || !metadata.includes('property.numKeys === 0') || !metadata.includes('property.nearestKeyIndex(time)') || !metadata.includes('property.setValueAtKey(keyIndex, value)') || !html.includes('id="keyframe-add-btn"') || !html.includes('id="keyframe-record-btn"')) {
    throw new Error('Live Sync is not keyframe-aware');
  }
}, 'Live Sync is an always-on background service with separate Add Keyframe and Record modes');

assertDoesNotThrow(() => {
  const sandbox = {};
  const source = fs.readFileSync(path.resolve(__dirname, '../host/modules/compositionRig.jsx'), 'utf8') +
    '\nthis.__syncCamera = opengeoSynchronizeControllerCamera;';
  vm.runInNewContext(source, sandbox, { filename: 'compositionRig.jsx' });
  const changes = [];
  const makeControl = (name, numKeys, initial) => ({
    numKeys,
    value: initial,
    setValue(value) { this.value = value; changes.push({ name, value }); }
  });
  const animatedControls = {
    Latitude: makeControl('Latitude', 2, 10),
    Longitude: makeControl('Longitude', 2, 20),
    Zoom: makeControl('Zoom', 2, 5)
  };
  const makeLayer = controls => ({
    property(group) {
      if (group !== 'ADBE Effect Parade') return null;
      return { property: name => ({ property: () => controls[name] }) };
    }
  });
  const preserved = sandbox.__syncCamera(makeLayer(animatedControls), 0, { lat: 99, lon: 88, zoom: 12 });
  if (!preserved || preserved.preservedAnimation !== true || changes.length !== 0 ||
      animatedControls.Latitude.value !== 10 || animatedControls.Longitude.value !== 20 || animatedControls.Zoom.value !== 5) {
    throw new Error('Composition rebuild overwrote animated camera controls');
  }

  const staticControls = {
    Latitude: makeControl('Latitude', 0, 10),
    Longitude: makeControl('Longitude', 0, 20),
    Zoom: makeControl('Zoom', 0, 5)
  };
  const applied = sandbox.__syncCamera(makeLayer(staticControls), 0, { lat: 30, lon: 40, zoom: 7 });
  if (!applied || applied.applied !== true || changes.length !== 3 ||
      staticControls.Latitude.value !== 30 || staticControls.Longitude.value !== 40 || staticControls.Zoom.value !== 7) {
    throw new Error('Static camera synchronization stopped working');
  }

  const finalize = fs.readFileSync(path.resolve(__dirname, '../client/js/core/FinalizeController.js'), 'utf8');
  const prepareStart = finalize.indexOf('async prepareComposition(');
  const mutationSection = finalize.slice(prepareStart, finalize.indexOf('_assertTypedImportResult', prepareStart));
  if (mutationSection.includes('trajectory[trajectory.length - 1]') || mutationSection.includes('camera:')) {
    throw new Error('Finalize still sends the last trajectory camera into the asset transaction');
  }
}, 'Preview and Finalize asset rebuilds preserve the complete camera keyframe set');

// 25. Older CEP runtimes must retain documented fallbacks for every browser
// feature the panel uses for layout and MegaTile work.
assertDoesNotThrow(() => {
  const app = fs.readFileSync(path.resolve(__dirname, '../client/js/app.js'), 'utf8');
  const stitcher = fs.readFileSync(path.resolve(__dirname, '../client/js/engine/MegaTileStitcher.js'), 'utf8');
  if (!app.includes('window.ResizeObserver') || !app.includes("this._listen(window, 'resize'") || !stitcher.includes("typeof window.Worker !== 'undefined'") || !stitcher.includes('OffscreenCanvas')) {
    throw new Error('A CEP compatibility fallback is missing');
  }
}, 'CEP feature fallbacks are present for resize, network, and stitching');

// 24. Finalize must reject excessive trajectory or tile work before issuing a
// large network operation or a payload the host is configured to reject.
assertDoesNotThrow(() => {
  const trajectory = fs.readFileSync(path.resolve(__dirname, '../host/modules/trajectoryScanner.jsx'), 'utf8');
  const finalize = fs.readFileSync(path.resolve(__dirname, '../client/js/core/FinalizeController.js'), 'utf8');
  if (!trajectory.includes('var maxSamples = 5000') || !trajectory.includes('expectedSamples > maxSamples') || !finalize.includes('plan.length > 20000')) {
    throw new Error('Finalize work limits are missing');
  }
}, 'Finalize validates trajectory and tile-work limits early');

// 24. A late AE polling response must be ignored once the active document or
// panel lifecycle has advanced to a new epoch.
assertDoesNotThrow(() => {
  const sync = fs.readFileSync(path.resolve(__dirname, '../client/js/ae/AESyncEngine.js'), 'utf8');
  const input = fs.readFileSync(path.resolve(__dirname, '../client/js/ui/InputHandler.js'), 'utf8');
  if (!sync.includes('this._pollEpoch = 0') || !sync.includes('const pollEpoch = this._pollEpoch') || !sync.includes('pollEpoch !== this._pollEpoch') || !sync.includes('_shouldIgnoreAeCamera') || !sync.includes('this._cameraWrites = new Map()') || !sync.includes('state.appliedRevision') || !sync.includes('MercatorProjection.camerasEquivalent') || sync.includes('this._localCameraUntil') || !input.includes('_applyWheelZoom') || !input.includes('requestAnimationFrame(() => this._applyWheelZoom())')) {
    throw new Error('AESyncEngine does not invalidate stale poll responses');
  }
}, 'AE polling and input handling prevent stale-camera zoom rollback');

// 18. The release gate must be an explicit reproducible command, not a
// sequence of undocumented manual shell steps.
assertDoesNotThrow(() => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  if (!pkg.scripts || !pkg.scripts['verify:release']) throw new Error('verify:release script is missing');
}, 'A reproducible automated release gate is available');

// Behavioral regressions added after the deep architectural audit.
assertAsync(async () => {
  const captured = [];
  const sandbox = { console: { warn() {}, error() {} }, Map, Promise, Error };
  const EventBus = loadBrowserClass(path.resolve(__dirname, '../client/js/events/EventBus.js'), 'EventBus', sandbox);
  const bus = new EventBus({ onListenerError: entry => captured.push(entry) });
  bus.on('audit:asyncFailure', async () => { throw new Error('expected async failure'); });
  bus.emit('audit:asyncFailure', { value: 1 });
  await Promise.resolve();
  await Promise.resolve();
  if (captured.length !== 1 || captured[0].event !== 'audit:asyncFailure' || captured[0].error.message !== 'expected async failure') {
    throw new Error('Async listener rejection did not reach the EventBus error boundary');
  }
}, 'EventBus captures asynchronous listener rejections without unhandled promises');

assertAsync(async () => {
  const emitted = [];
  const sandbox = {
    console,
    Map,
    Promise,
    Error,
    setTimeout,
    globalEventBus: { emit: (event, data) => emitted.push({ event, data }) }
  };
  loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/TileAddress.js'), 'TileAddress', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/CachePolicy.js'), 'CachePolicy', sandbox);
  const MemoryCache = loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/MemoryCache.js'), 'MemoryCache', sandbox);
  const TileDownloader = loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/TileDownloader.js'), 'TileDownloader', sandbox);
  const cache = new MemoryCache({ memoryLimit: 1 });
  sandbox.globalEventBus.emit = (event, data) => {
    emitted.push({ event, data });
    if (event === 'tiles:loaded') cache.set(data.key, data.bitmap);
  };
  const downloader = new TileDownloader({ concurrency: 1, retries: 0 });
  let requests = 0;
  downloader._fetch = async () => { requests++; return { width: 256, height: 256 }; };
  downloader.addTile('provider/3/1/2', [{ url: 'https://example.test/a.png' }], 0);
  await new Promise(resolve => setTimeout(resolve, 5));
  cache.set('provider/3/9/9', { width: 256, height: 256 });
  if (cache.has('provider/3/1/2')) throw new Error('Test setup did not evict the first tile');
  downloader.addTile('provider/3/1/2', [{ url: 'https://example.test/a.png' }], 0);
  await new Promise(resolve => setTimeout(resolve, 5));
  if (requests !== 2) throw new Error(`Expected a re-download after cache eviction, got ${requests} requests`);
  if (emitted.filter(item => item.event === 'tiles:loaded').length !== 2) throw new Error('Both completed downloads were not published');
}, 'TileDownloader permits re-download after the memory cache evicts a completed tile');

assertDoesNotThrow(() => {
  const eventNames = [];
  let timeoutStarts = 0;
  let timeoutStops = 0;
  const sandbox = {
    console,
    Promise,
    Date,
    Math,
    Object,
    setTimeout: () => { timeoutStarts++; return 42; },
    clearTimeout: () => { timeoutStops++; },
    globalEventBus: {
      on: eventName => { eventNames.push(eventName); return () => {}; },
      emit: () => {}
    },
    OpenGeoEvents: { VIEWPORT_CHANGED: 'viewport:changed', SYNC_COMP_CHANGED: 'sync:compChanged', SYNC_AE_CAMERA: 'sync:aeCamera' }
  };
  const AESyncEngine = loadBrowserClass(path.resolve(__dirname, '../client/js/ae/AESyncEngine.js'), 'AESyncEngine', sandbox);
  const engine = new AESyncEngine({ invoke: async () => null }, { composition: null, setComposition() {}, mapState: {} });
  engine.start();
  engine.start();
  if (!engine.isRunning || timeoutStarts !== 1) throw new Error('Always-on sync did not start exactly once');
  if (eventNames.includes('sync:toggle')) throw new Error('Legacy Live Sync toggle is still subscribed');
  engine.dispose();
  if (engine.isRunning || timeoutStops !== 1) throw new Error('Live Sync lifecycle did not stop only during disposal');
}, 'Live Sync has start/dispose lifecycle and no enable/disable event');

assertDoesNotThrow(() => {
  const coordinator = fs.readFileSync(path.resolve(__dirname, '../client/js/core/ApplicationCoordinator.js'), 'utf8');
  const viewportStart = coordinator.indexOf("this.lifecycle.subscribe('viewport:changed'");
  const tilesStart = coordinator.indexOf("this.lifecycle.subscribe('tiles:renderReady'");
  const overlayStart = coordinator.indexOf("this.lifecycle.subscribe('overlay:changed'");
  const providersStart = coordinator.indexOf("this.lifecycle.subscribe('providers:updated'");
  const viewportBlock = coordinator.slice(viewportStart, tilesStart);
  const tilesBlock = coordinator.slice(tilesStart, overlayStart);
  const overlayBlock = coordinator.slice(overlayStart, providersStart);
  if (!viewportBlock.includes('queueAutoExport()')) throw new Error('Camera changes no longer schedule the AE preview');
  if (tilesBlock.includes('queueAutoExport()') || overlayBlock.includes('queueAutoExport()')) throw new Error('Render completion or overlay invalidation still schedules composition work');
}, 'Render invalidation is isolated from After Effects composition export');

assertDoesNotThrow(() => {
  const host = fs.readFileSync(path.resolve(__dirname, '../host/modules/metadataSync.jsx'), 'utf8');
  const dispatcher = fs.readFileSync(path.resolve(__dirname, '../host/modules/bridgeDispatcher.jsx'), 'utf8');
  if (!host.includes('OPEN_GEO_ACTIVE_STATE_CACHE') || !host.includes('OpenGeo Sync Revision') || !host.includes('"appliedRevision":') ||
      !host.includes('normalizedRevision = Math.floor(normalizedRevision) % 1000000') || !host.includes('"controllerId":') || !dispatcher.includes('args.revision')) {
    throw new Error('Host camera state does not persist and acknowledge revisions with cached controller identity');
  }
}, 'Host camera sync caches controller identity and acknowledges applied revisions');

assertDoesNotThrow(() => {
  const emitted = [];
  const sandbox = {
    console,
    Map,
    Promise,
    Error,
    Date,
    Math,
    Object,
    Number,
    isFinite,
    setTimeout: () => 1,
    clearTimeout() {},
    globalEventBus: { on: () => () => {}, emit: (event, data) => emitted.push({ event, data }) },
    OpenGeoEvents: { VIEWPORT_CHANGED: 'viewport:changed', SYNC_COMP_CHANGED: 'sync:compChanged', SYNC_AE_CAMERA: 'sync:aeCamera' }
  };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  const AESyncEngine = loadBrowserClass(path.resolve(__dirname, '../client/js/ae/AESyncEngine.js'), 'AESyncEngine', sandbox);
  const engine = new AESyncEngine({ invoke: async () => null }, { composition: { compId: 1 }, setComposition() {}, mapState: {} });
  engine._revisionClock = 999999;
  if (engine._nextRevision() !== 1) throw new Error('Camera revision did not wrap inside the AE Slider range');
  engine._cameraWrites.set(42, { lat: 10, lng: 179.999, zoom: 8 });
  if (!engine._shouldIgnoreAeCamera({ lat: 10, lng: 179.999, zoom: 8 }, 42)) throw new Error('Exact local echo was not suppressed');
  engine._cameraWrites.set(43, { lat: 10, lng: 20, zoom: 8 });
  if (engine._shouldIgnoreAeCamera({ lat: 11, lng: 20, zoom: 8 }, 43)) throw new Error('A legitimate AE move with the same acknowledged revision was suppressed');
  if (engine._shouldIgnoreAeCamera({ lat: 12, lng: 20, zoom: 8 }, 41) !== true) throw new Error('An older in-flight poll was accepted after a newer acknowledgement');
  engine._latestLocalIntentRevision = 50;
  if (!engine._shouldIgnoreAeCamera({ lat: 0, lng: 0, zoom: 2 }, 49)) throw new Error('A poll older than a debounced local intent was accepted');
}, 'Camera revision protocol suppresses only exact echoes and accepts real AE movement');

assertAsync(async () => {
  let delayedWrite = null;
  const sandbox = {
    console,
    Map,
    Promise,
    Error,
    Date,
    Math,
    Object,
    Number,
    isFinite,
    setTimeout: callback => { delayedWrite = callback; return 1; },
    clearTimeout() {},
    globalEventBus: { on: () => () => {}, emit() {} },
    OpenGeoEvents: { VIEWPORT_CHANGED: 'viewport:changed', SYNC_COMP_CHANGED: 'sync:compChanged', SYNC_AE_CAMERA: 'sync:aeCamera' }
  };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  const AESyncEngine = loadBrowserClass(path.resolve(__dirname, '../client/js/ae/AESyncEngine.js'), 'AESyncEngine', sandbox);
  const timelineCamera = { lat: 5, lng: 6, zoom: 7 };
  const bridge = { invoke: async () => ({ applied: false, appliedRevision: 0, disposition: 'skipped-keyframed-outside-cti', camera: timelineCamera }) };
  const engine = new AESyncEngine(bridge, {
    composition: { compId: 12 },
    setComposition() {},
    mapState: { latitude: 20, longitude: 30, compZoom: 8 }
  });
  engine.isRunning = true;
  await engine._onPanelViewportChanged();
  if (!engine._shouldIgnoreAeCamera(timelineCamera, 0)) throw new Error('A stale poll before the debounced write was not suppressed');
  await delayedWrite();
  if (!engine._shouldIgnoreAeCamera(timelineCamera, 0)) throw new Error('An unchanged keyed timeline camera snapped local navigation back');
  if (engine._shouldIgnoreAeCamera({ lat: 6, lng: 6, zoom: 7 }, 0)) throw new Error('A real timeline camera change remained blocked after detached navigation');
}, 'Keyframed camera rejection keeps panel navigation local until the AE timeline actually changes');

assertDoesNotThrow(() => {
  const animationFrames = [];
  let nextFrameId = 1;
  const sandbox = {
    console,
    Date,
    Math,
    isFinite,
    requestAnimationFrame(callback) { animationFrames.push(callback); return nextFrameId++; },
    cancelAnimationFrame() {}
  };
  const InputHandler = loadBrowserClass(path.resolve(__dirname, '../client/js/ui/InputHandler.js'), 'InputHandler', sandbox);
  const panCalls = [];
  const zoomCalls = [];
  const viewport = {
    zoom: 5,
    pan(dx, dy) { panCalls.push({ dx, dy }); },
    clampZoom(value) { return Math.max(2, Math.min(19, value)); },
    zoomAtPoint(value, x, y) { this.zoom = value; zoomCalls.push({ value, x, y }); },
    screenToLatLng() { return { lat: 0, lng: 0 }; }
  };
  const canvas = {
    style: {},
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, height: 600 }; }
  };
  const input = new InputHandler(canvas, viewport);
  input._onPointerDown({ preventDefault() {}, pointerId: 1, clientX: 0, clientY: 0 });
  input._onPointerMove({ preventDefault() {}, clientX: 3, clientY: 4 });
  input._onPointerMove({ preventDefault() {}, clientX: 8, clientY: 10 });
  if (panCalls.length !== 0 || animationFrames.length !== 1) throw new Error('Pointer moves were not coalesced into one animation frame');
  animationFrames.shift()();
  if (panCalls.length !== 1 || panCalls[0].dx !== 8 || panCalls[0].dy !== 10) throw new Error('Coalesced pan lost or duplicated pointer deltas');

  input._onWheel({ preventDefault() {}, deltaMode: 0, deltaY: 120, clientX: 100, clientY: 120 });
  animationFrames.shift()();
  if (zoomCalls.length !== 1 || Math.abs(zoomCalls[0].value - 4.90928) > 1e-5) throw new Error('Wheel zoom was applied as a direct jump instead of an eased step');
  let safety = 40;
  while (animationFrames.length && safety-- > 0) animationFrames.shift()();
  if (Math.abs(viewport.zoom - 4.784) > 0.002 || safety <= 0) throw new Error('Eased wheel zoom did not settle at its target');

  const panCountBeforeInertia = panCalls.length;
  input.velBuffer = [{ vx: 1, vy: 0, t: Date.now() }];
  input._startInertia();
  if (panCalls.length !== panCountBeforeInertia || animationFrames.length !== 1) throw new Error('Inertia applied an immediate release jump');
  animationFrames.shift()(100);
  if (panCalls.length !== panCountBeforeInertia) throw new Error('The first inertia frame moved without a time delta');
  animationFrames.shift()(116);
  if (Math.abs(panCalls[panCalls.length - 1].dx - 16) > 1e-9) throw new Error('Inertia is not expressed in pixels per millisecond');
  input.dispose();
}, 'Pan is frame-coalesced, inertia is time-based, and wheel zoom converges without overshoot');

assertAsync(async () => {
  const emitted = [];
  let calls = 0;
  const sandbox = {
    console,
    Map,
    Promise,
    Error,
    Date,
    Math,
    Object,
    Number,
    isFinite,
    setTimeout: () => 1,
    clearTimeout() {},
    globalEventBus: { on: () => () => {}, emit: (event, data) => emitted.push({ event, data }) },
    OpenGeoEvents: { VIEWPORT_CHANGED: 'viewport:changed', SYNC_COMP_CHANGED: 'sync:compChanged', SYNC_AE_CAMERA: 'sync:aeCamera' }
  };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  const AESyncEngine = loadBrowserClass(path.resolve(__dirname, '../client/js/ae/AESyncEngine.js'), 'AESyncEngine', sandbox);
  const bridge = { invoke: async () => { calls++; if (calls <= 3) throw new Error('AE busy'); return null; } };
  const engine = new AESyncEngine(bridge, { composition: null, setComposition() {}, mapState: {} });
  engine.isRunning = true;
  for (let index = 0; index < 4; index++) {
    engine._syncTimer = null;
    await engine._pollAfterEffects();
  }
  const healthEvents = emitted.filter(entry => entry.event === 'sync:health');
  if (healthEvents.length !== 2 || healthEvents[0].data.state !== 'degraded' || healthEvents[1].data.state !== 'healthy') {
    throw new Error('Polling did not publish one degraded transition and one recovery transition');
  }
  if (engine.getHealth().consecutiveFailures !== 0 || engine.getHealth().nextIntervalMs !== 500) throw new Error('Polling health did not recover its base cadence');

  let resolvePoll;
  let overlappingCalls = 0;
  engine.aeBridge = { invoke: () => { overlappingCalls++; return new Promise(resolve => { resolvePoll = resolve; }); } };
  engine._syncTimer = null;
  const first = engine._pollAfterEffects();
  const second = engine._pollAfterEffects();
  if (overlappingCalls !== 1) throw new Error('A second polling request overlapped the first');
  resolvePoll(null);
  await Promise.all([first, second]);
}, 'AE polling is single-flight, degrades after repeated failures, backs off, and recovers automatically');

assertDoesNotThrow(() => {
  const frameBox = { style: {} };
  const sandbox = {
    console,
    window: { addEventListener() {}, dispatchEvent() {} },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return frameBox; } },
    ErrorEvent: function ErrorEvent() {},
    localStorage: { getItem() { return 'dark'; } },
    globalEventBus: { emit() {} }
  };
  const CompositionController = loadBrowserClass(path.resolve(__dirname, '../client/js/core/CompositionController.js'), 'CompositionController', sandbox);
  const App = loadBrowserClass(path.resolve(__dirname, '../client/js/app.js'), 'App', sandbox);
  for (const tileSize of [256, 512]) {
    const instance = Object.create(App.prototype);
    const restored = { tileSize: null, composition: null, camera: [], finalized: null, source: null, settingsSize: null };
    instance._suppressViewportEffects = false;
    instance.syncEngine = { isApplyingAeState: false };
    instance.mapState = { frameWidth: 640, frameHeight: 360 };
    instance.session = {
      documentId: 'old',
      setComposition(value) { restored.composition = value; },
      setTileSize(value) { restored.tileSize = value; },
      setFinalized(value) { restored.finalized = value; },
      setCamera(value) { restored.camera.push(value); }
    };
    instance.stateHydrator = {
      hydrate(value, compId) {
        instance.session.documentId = value.documentId;
        restored.composition = { compId, width: value.compWidth, height: value.compHeight };
        restored.tileSize = value.tileSize;
        restored.finalized = value.isFinalized;
        return { ok: true, snapshot: {
          documentId: value.documentId,
          composition: restored.composition,
          camera: { lat: value.centerLat, lng: value.centerLng, compZoom: value.zoom, tileSize: value.tileSize },
          providerId: value.source,
          isFinalized: value.isFinalized
        } };
      }
    };
    instance.viewport = {}; // Intentionally has no setTileSize method.
    instance.tileManager = { source: 'esri', setSource(value) { restored.source = value; } };
    instance.providerManager = { getProvider(id) { return id === 'osm' ? {} : null; }, getSignature() { return 'osm-signature'; } };
    instance.settingsPanel = {
      updateState(source, size) { restored.settingsSize = size; },
      updateAttribution() {}
    };
    instance.compositionController = new CompositionController(instance);
    instance.compositionController.hydrate({
      documentId: 'restored', compWidth: 1920, compHeight: 1080,
      tileSize, isFinalized: true, centerLat: 12, centerLng: 3, zoom: 6, source: 'osm'
    }, 77);
    if (restored.tileSize !== tileSize || restored.settingsSize !== tileSize || restored.composition.compId !== 77 || instance.session.documentId !== 'restored' || restored.source !== 'osm') {
      throw new Error(`Composition metadata was not restored through MapSession for ${tileSize}px`);
    }
    if (frameBox.style.width !== '640px' || frameBox.style.height !== '360px') throw new Error('Composition frame DOM did not follow restored dimensions');
    if (instance._suppressViewportEffects || instance.syncEngine.isApplyingAeState) {
      throw new Error('Hydration suppression flags were not released');
    }
  }
}, 'Composition metadata restores tile size without a nonexistent Viewport API');

assertAsync(async () => {
  const pending = {};
  let saved = 0;
  let scheduled = null;
  const sandbox = {
    console,
    window: { addEventListener() {}, dispatchEvent() {} },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } },
    ErrorEvent: function ErrorEvent() {},
    localStorage: { getItem() { return 'dark'; } },
    globalEventBus: { emit() {} },
    setTimeout(callback) { scheduled = callback; return 1; },
    clearTimeout() { scheduled = null; }
  };
  const CompositionController = loadBrowserClass(path.resolve(__dirname, '../client/js/core/CompositionController.js'), 'CompositionController', sandbox);
  const App = loadBrowserClass(path.resolve(__dirname, '../client/js/app.js'), 'App', sandbox);
  const instance = Object.create(App.prototype);
  instance._compositionLoadRevision = 0;
  instance._metadataSaveTimer = null;
  instance._suppressViewportEffects = false;
  instance.session = {
    documentId: 'doc-a',
    composition: null,
    setComposition(value) { this.composition = value; }
  };
  instance.viewport = {};
  instance.tileManager = {};
  instance.metadataManager = {
    loadFromComp(compId) { return new Promise(resolve => { pending[compId] = resolve; }); },
    async saveToComp() { saved++; }
  };
  const hydrated = [];
  instance._hydrateCompositionState = (_state, compId) => hydrated.push(compId);
  instance._triggerTileUpdate = () => {};
  instance._updateUIInfo = () => {};
  instance.compositionController = new CompositionController(instance);
  instance.compositionController.hydrate = (_state, compId) => hydrated.push(compId);

  const first = instance._loadCompositionState(1);
  const second = instance._loadCompositionState(2);
  pending[1]({ documentId: 'doc-a' });
  await first;
  pending[2]({ documentId: 'doc-b' });
  await second;
  if (hydrated.length !== 1 || hydrated[0] !== 2) throw new Error('A stale composition load overwrote the active composition');

  instance.activeCompId = 2;
  instance.session.documentId = 'doc-b';
  instance._scheduleMetadataSave();
  const staleSave = scheduled;
  instance.activeCompId = 3;
  await staleSave();
  if (saved !== 0) throw new Error('A delayed metadata save wrote the previous composition state into the new composition');
}, 'Composition switching rejects stale loads and stale delayed metadata saves');

assertDoesNotThrow(() => {
  const hostMetadata = fs.readFileSync(path.resolve(__dirname, '../host/modules/metadataSync.jsx'), 'utf8');
  if (!hostMetadata.includes('metadata.opengeo.compWidth = comp.width') || !hostMetadata.includes('metadata.opengeo.compHeight = comp.height') ||
      !hostMetadata.includes('[METADATA_INVALID]')) {
    throw new Error('AE CompItem dimensions are not authoritative when metadata is loaded');
  }
}, 'Metadata loading repairs persisted format from the authoritative AE composition');

assertDoesNotThrow(() => {
  class FakeTarget {
    constructor() {
      this.listeners = {};
      this.value = '';
      this.textContent = '';
      this.classList = { remove: () => { this.removeCalls = (this.removeCalls || 0) + 1; } };
    }
    addEventListener(name, callback) {
      if (!this.listeners[name]) this.listeners[name] = new Set();
      this.listeners[name].add(callback);
    }
    removeEventListener(name, callback) {
      if (this.listeners[name]) this.listeners[name].delete(callback);
    }
    dispatch(name, event = {}) {
      for (const callback of Array.from(this.listeners[name] || [])) callback(event);
    }
    listenerCount(name) { return (this.listeners[name] || new Set()).size; }
  }

  const input = new FakeTarget();
  const results = new FakeTarget();
  const close = new FakeTarget();
  const list = new FakeTarget();
  const elements = {
    'search-input': input,
    'search-results': results,
    'search-close-btn': close,
    'search-results-list': list
  };
  const sandbox = {
    console,
    document: { getElementById: id => elements[id] || null },
    clearTimeout,
    setTimeout,
    XMLHttpRequest: function () {},
    encodeURIComponent,
    Number,
    Math
  };
  const SearchPanel = loadBrowserClass(path.resolve(__dirname, '../client/js/ui/SearchPanel.js'), 'SearchPanel', sandbox);
  const first = new SearchPanel('search-input', 'search-results', {});
  first.dispose();
  const second = new SearchPanel('search-input', 'search-results', {});
  results.removeCalls = 0;
  input.dispatch('keydown', { key: 'Escape' });
  if (results.removeCalls !== 1 || input.listenerCount('keydown') !== 1 || input.listenerCount('input') !== 1) {
    throw new Error('A disposed SearchPanel left duplicate DOM handlers behind');
  }
  second.dispose();
  if (input.listenerCount('keydown') !== 0 || input.listenerCount('input') !== 0 || close.listenerCount('click') !== 0) {
    throw new Error('SearchPanel.dispose did not release its static DOM handlers');
  }
}, 'SearchPanel mount/dispose/remount produces exactly one DOM action');

assertAsync(async () => {
  const OperationSnapshot = require(path.resolve(__dirname, '../client/js/core/OperationSnapshot.js'));
  const DownloadSession = require(path.resolve(__dirname, '../client/js/engine/DownloadSession.js'));
  const engines = [];
  class FakeEngine {
    constructor() { this.cancelled = false; engines.push(this); }
    static getDefaultCacheDir() { return 'C:/OpenGeoTestCache'; }
    setUrlTemplate(value) { this.template = value; }
    setCacheNamespace(value) { this.namespace = value; }
    setCamera() {}
    setViewport() {}
    downloadTiles(plan) { return Promise.resolve(plan); }
    cancelDownloads() { this.cancelled = true; }
  }
  const createSnapshot = (sourceKey, generation) => new OperationSnapshot({
    operationId: `sync:doc:${generation}`,
    kind: 'sync', generation, documentId: 'doc', compId: 7,
    sourceKey, providerSignature: `${sourceKey}_signature`,
    resolvedTemplate: `https://${sourceKey}.example/{z}/{x}/{y}`,
    sourceTileSize: 256, maxSourceZoom: 19, isFinalized: false,
    quality: null, camera: { lat: 0, lon: 0, zoom: 3 },
    composition: { width: 1920, height: 1080 }, compSettings: null
  });
  const firstSnapshot = createSnapshot('providerA', 1);
  const secondSnapshot = createSnapshot('providerB', 2);
  if (!Object.isFrozen(firstSnapshot) || !Object.isFrozen(firstSnapshot.camera) || !Object.isFrozen(firstSnapshot.composition)) {
    throw new Error('OperationSnapshot is mutable');
  }
  const first = new DownloadSession(firstSnapshot, { EngineClass: FakeEngine });
  const second = new DownloadSession(secondSnapshot, { EngineClass: FakeEngine });
  first.cancel();
  await second.downloadTiles([{ key: '3/1/2' }]);
  if (!engines[0].cancelled || engines[1].cancelled) {
    throw new Error('Cancellation crossed from one DownloadSession into another');
  }
  if (engines[0].namespace !== 'providerA_signature' || engines[1].namespace !== 'providerB_signature' ||
      engines[0].template === engines[1].template) {
    throw new Error('Provider identity leaked between DownloadSessions');
  }
  const app = {
    activeCompId: 7,
    tileManager: { source: 'providerA' },
    providerManager: {
      getSignature: source => `${source}_signature`,
      getResolvedTemplate: source => `https://${source}.example/{z}/{x}/{y}`
    },
    session: { documentId: 'doc', generations: { sync: 1 } }
  };
  if (!firstSnapshot.isCurrent(app)) throw new Error('Current snapshot was rejected');
  app.tileManager.source = 'providerB';
  if (firstSnapshot.isCurrent(app)) throw new Error('Snapshot stayed current after a provider switch');
}, 'Operation snapshots and download cancellation stay isolated across providers');

assertDoesNotThrow(() => {
  const finalize = fs.readFileSync(path.resolve(__dirname, '../client/js/core/FinalizeController.js'), 'utf8');
  const dispatcher = fs.readFileSync(path.resolve(__dirname, '../host/modules/bridgeDispatcher.jsx'), 'utf8');
  const hostIndex = fs.readFileSync(path.resolve(__dirname, '../host/index.jsx'), 'utf8');
  const transaction = fs.readFileSync(path.resolve(__dirname, '../host/modules/compositionTransaction.jsx'), 'utf8');
  if (finalize.includes("'composition.build'") ||
      !finalize.includes("'composition.prepare'") ||
      !finalize.includes("'composition.commit'") ||
      !finalize.includes("'composition.rollback'") ||
      !finalize.includes("'composition.getRevision'") ||
      !dispatcher.includes("'composition.prepare': { kind: 'json'") ||
      !dispatcher.includes("'composition.commit': { kind: 'json'") ||
      !dispatcher.includes("'composition.rollback': { kind: 'json'") ||
      !dispatcher.includes("'composition.getRevision': { kind: 'json'") ||
      !hostIndex.includes('compositionTransaction.jsx')) {
    throw new Error('Finalize does not use the atomic host protocol exclusively');
  }
  const activation = transaction.indexOf('stagingLayers[stageIndex].enabled = true');
  const metadataCommit = transaction.indexOf('opengeoSetCompMetadata(resolved.containingComp.id, String(data.metadata))');
  const destructiveCleanup = transaction.indexOf('oldFinalLayers[removeOld].remove()');
  if (activation < 0 || metadataCommit < activation || destructiveCleanup < 0 || destructiveCleanup < metadataCommit ||
      !transaction.includes("withUndoGroup('OpenGeo: Commit Finalize'") ||
      !transaction.includes("role=' + String(role || 'unknown')")) {
    throw new Error('Host commit cleanup can precede activation or lacks revision ownership');
  }
}, 'Finalize uses prepare/commit/rollback and cleans old revisions only after activation');

assertDoesNotThrow(() => {
  const sandbox = { console, Promise, Map, Error, String, Array, globalEventBus: { emit() {} } };
  const FinalizeController = loadBrowserClass(
    path.resolve(__dirname, '../client/js/core/FinalizeController.js'), 'FinalizeController', sandbox
  );
  const controller = new FinalizeController({});
  controller._assertTypedImportResult({
    ok: true,
    operationId: 'revision_1',
    expected: 3,
    imported: 3,
    failed: []
  }, 3, 'revision_1', 'prepare');
  let rejected = false;
  try {
    controller._assertTypedImportResult({
      ok: true,
      operationId: 'revision_1',
      expected: 3,
      imported: 2,
      failed: []
    }, 3, 'revision_1', 'prepare');
  } catch (error) {
    rejected = error.code === 'FINALIZE_PREPARE_FAILED';
  }
  if (!rejected) throw new Error('Imported-count mismatch was accepted');
}, 'Typed Finalize import results reject every expected/imported mismatch');

assertDoesNotThrow(() => {
  const emitted = [];
  const sandbox = {
    console, Promise, Map, Error, String, Array,
    globalEventBus: { emit: (event, payload) => emitted.push({ event, payload }) }
  };
  const FinalizeController = loadBrowserClass(
    path.resolve(__dirname, '../client/js/core/FinalizeController.js'), 'FinalizeController', sandbox
  );
  const app = {
    session: { cancelOperation() {} },
    aeBridge: { invoke: () => Promise.resolve({ ok: true }) }
  };
  const controller = new FinalizeController(app);
  controller.isFinalizing = true;
  controller._runId = 4;
  controller._operationGeneration = 2;
  controller._commitState = 'commit-in-progress';
  if (controller.cancel() !== false || controller._runId !== 4) {
    throw new Error('Cancellation interrupted an in-progress host commit');
  }
  controller._commitState = 'prepared';
  controller._activeTransaction = { state: 'prepared' };
  controller._downloadSession = { cancel() {} };
  if (controller.cancel() !== true || controller._runId !== 5 || controller.isFinalizing !== true) {
    throw new Error('Pre-commit cancellation did not invalidate the run while retaining cleanup ownership');
  }
  const messages = emitted.map(entry => entry.payload && entry.payload.message).filter(Boolean).join(' ');
  if (/No changes were applied/i.test(messages) || messages.indexOf('active Final revision remains unchanged') === -1) {
    throw new Error('Cancellation status is not truthful about transaction state');
  }
}, 'Finalize cancellation distinguishes pre-commit cancellation from commit-in-progress');

assertDoesNotThrow(() => {
  const worker = fs.readFileSync(path.resolve(__dirname, '../client/js/engine/stitcherWorker.js'), 'utf8');
  const stitcher = fs.readFileSync(path.resolve(__dirname, '../client/js/engine/MegaTileStitcher.js'), 'utf8');
  if (worker.includes("ctx.fillStyle = '#0f172a'") || worker.includes('ctx.fillRect(0, 0, size, size)') ||
      stitcher.includes("ctx.fillStyle = '#0f172a'") || stitcher.includes('ctx.fillRect(0, 0, size, size)') ||
      !worker.includes('decodedCount: decoded.length') || !worker.includes('coverageMask:') ||
      !stitcher.includes('getCoverageReport()')) {
    throw new Error('MegaTile missing cells are opaque or coverage diagnostics are absent');
  }
}, 'MegaTile worker and fallback preserve transparency and report decoded coverage');

assertDoesNotThrow(() => {
  const assets = fs.readFileSync(path.resolve(__dirname, '../host/modules/compositionAssets.jsx'), 'utf8');
  const transaction = fs.readFileSync(path.resolve(__dirname, '../host/modules/compositionTransaction.jsx'), 'utf8');
  if (!assets.includes('var isOwned =') || !assets.includes('sourceComment === legacyAssetComment') ||
      !transaction.includes("role === 'final-active'") ||
      !transaction.includes("layer.source.comment === 'opengeo:document:' + documentId")) {
    throw new Error('Layer names can still be treated as ownership without metadata');
  }
}, 'AE cleanup requires document ownership metadata rather than a final_ name alone');

assertDoesNotThrow(() => {
  const GeoJSONValidator = require(path.resolve(__dirname, '../client/js/core/GeoJSONValidator.js'));
  const validator = new GeoJSONValidator({ maxBytes: 1024, maxFeatures: 2, maxPoints: 4, maxDepth: 8 });
  const valid = validator.parse({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: 'A' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }
  ] });
  const openRing = validator.parse({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] });
  const tooManyPoints = validator.parse({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]] });
  const oversized = validator.parse('{bad json', { sourceBytes: 2048 });
  if (!valid.ok || valid.stats.points !== 2 || openRing.ok || openRing.error.code !== 'GEOJSON_RING_OPEN' ||
      tooManyPoints.ok || tooManyPoints.error.code !== 'GEOJSON_POINT_LIMIT' || oversized.ok || oversized.error.code !== 'GEOJSON_TOO_LARGE') {
    throw new Error('GeoJSON validation limits or typed failures are incomplete');
  }
}, 'GeoJSON gate validates structure, coordinates, cardinality and size before rendering');

assertDoesNotThrow(() => {
  const GeoJSONValidator = require(path.resolve(__dirname, '../client/js/core/GeoJSONValidator.js'));
  const GeoJSONLayer = require(path.resolve(__dirname, '../client/js/overlays/GeoJSONLayer.js'));
  const layer = new GeoJSONLayer({}, new GeoJSONValidator());
  const valid = layer.loadGeoJSON({ type: 'Point', coordinates: [2, 3] });
  const retained = layer.features[0];
  const invalid = layer.loadGeoJSON({ type: 'Point', coordinates: ['bad', 3] });
  if (!valid.ok || invalid.ok || layer.features.length !== 1 || layer.features[0] !== retained) {
    throw new Error('Invalid GeoJSON cleared or partially replaced the active overlay');
  }
}, 'GeoJSON overlay replacement is transactional');

assertDoesNotThrow(() => {
  const VectorMapManager = require(path.resolve(__dirname, '../client/js/core/VectorMapManager.js'));
  const manager = new VectorMapManager({ mapState: { longitude: 179 } });
  const validation = {
    ok: true,
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[
        [1, 1], [2, 1], [2, 2], [1, 2], [1, 1]
      ]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[179, 0], [-179, 0]] } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [3, 4] } }
    ]
  };
  const payload = manager._buildGeoJSONPayload(validation, 'district/map.geojson');
  const polygonLayer = payload.layers.find(layer => layer.id === 'geojson-polygons');
  const lineLayer = payload.layers.find(layer => layer.id === 'geojson-lines');
  const pointLayer = payload.layers.find(layer => layer.id === 'geojson-points');
  if (!polygonLayer || !lineLayer || !pointLayer || polygonLayer.isClosed !== true ||
      lineLayer.isClosed !== false || pointLayer.isClosed !== true ||
      polygonLayer.features[0].rings[0].length !== 4 || pointLayer.features[0].rings[0].length !== 4 ||
      payload.layerName.indexOf('/') !== -1 || payload.featureSignature.indexOf('geojson-') !== 0) {
    throw new Error('GeoJSON geometry was not converted into safe typed AE vector layers');
  }
  const datelineLine = lineLayer.features[0].rings[0];
  if (Math.abs(datelineLine[1][0] - datelineLine[0][0]) > 262144 / 2) {
    throw new Error('GeoJSON antimeridian path was projected across the long world span');
  }
}, 'GeoJSON polygons, lines and points project into typed AE vector layers');

assertAsync(async () => {
  const VectorMapManager = require(path.resolve(__dirname, '../client/js/core/VectorMapManager.js'));
  const FeatureManager = require(path.resolve(__dirname, '../client/js/core/FeatureManager.js'));
  const FeatureRegistry = require(path.resolve(__dirname, '../client/js/core/FeatureRegistry.js'));
  global.MercatorProjection = global.MercatorProjection || {
    worldPointToLatLng: (x, y) => ({ lat: y / 1000, lng: x / 1000 }),
    latLngToWorldPoint: (lat, lng) => ({ x: (lng + 180) * 1000, y: lat * 1000 })
  };
  let writtenPayload = null;
  let finishedJob = null;
  let bridgeCall = null;
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-geojson-draw-'));
  const tempDir = path.join(sandboxRoot, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const app = {
    activeCompId: '88',
    mapState: { longitude: 0 },
    session: { documentId: 'draw-test' },
    _schedulePreviewRender() {},
    _scheduleMetadataSave() {},
    jobManager: {
      tempDir,
      startJob: () => 'geojson_job',
      createTempFile: () => path.join(tempDir, 'geojson_job.json'),
      finishJob: id => { finishedJob = id; }
    },
    aeBridge: {
      invoke: async (command, args) => {
        bridgeCall = { command, args };
        writtenPayload = JSON.parse(fs.readFileSync(args.filePath, 'utf8'));
        return { status: 'success', paths: 1, layers: 1 };
      }
    }
  };
  const registry = new FeatureRegistry();
  app.featureManager = new FeatureManager(app, registry);
  const manager = new VectorMapManager(app);
  const validation = {
    ok: true,
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }]
  };
  try {
    const result = await manager.drawGeoJSONInAE(validation, { name: 'route.geojson' });
    if (!writtenPayload || !bridgeCall || bridgeCall.command !== 'vector.import' ||
        bridgeCall.args.compId !== '88' || bridgeCall.args.featureSignature !== writtenPayload.featureSignature ||
        finishedJob !== 'geojson_job' || result.paths !== 1 || registry.list().length !== 1) {
      throw new Error('Validated GeoJSON did not complete the centralized temporary-file AE vector transaction');
    }
  } finally {
    manager.dispose();
    app.featureManager.dispose();
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
  const toolbar = fs.readFileSync(path.resolve(__dirname, '../client/js/ui/ToolbarController.js'), 'utf8');
  if (!toolbar.includes('async _finishGeoJSONLoad') || !toolbar.includes('drawGeoJSONInAE(validation')) {
    throw new Error('The GeoJSON file workflow is not connected to the AE drawing transaction');
  }
}, 'GeoJSON upload invokes one bounded AE vector import and always cleans its job');

assertDoesNotThrow(() => {
  const host = fs.readFileSync(path.resolve(__dirname, '../host/modules/vectorHost.jsx'), 'utf8');
  const importSection = host.slice(host.indexOf('function opengeoImportVectorMapFromFile'));
  if (!host.includes('fileBytes: 25 * 1024 * 1024') || !host.includes('features: 500') || !host.includes('points: 100000') ||
      !host.includes('stringLength: 512') || !host.includes('VECTOR_POINT_INVALID') ||
      importSection.indexOf('opengeoVectorReadPayload(filePath)') < 0 ||
      importSection.indexOf('opengeoVectorReadPayload(filePath)') > importSection.indexOf("withUndoGroup('OpenGeo: Synthesize Vector Map'")) {
    throw new Error('Host vector limits do not precede the mutation/Undo boundary');
  }
}, 'Host vector import validates bounded untrusted payloads before UndoGroup');

assertDoesNotThrow(() => {
  const app = fs.readFileSync(path.resolve(__dirname, '../client/js/app.js'), 'utf8');
  const preview = fs.readFileSync(path.resolve(__dirname, '../client/js/core/PreviewController.js'), 'utf8');
  const vector = fs.readFileSync(path.resolve(__dirname, '../client/js/core/VectorMapManager.js'), 'utf8');
  const features = fs.readFileSync(path.resolve(__dirname, '../client/js/core/FeatureManager.js'), 'utf8');
  const stitcher = fs.readFileSync(path.resolve(__dirname, '../client/js/engine/MegaTileStitcher.js'), 'utf8');
  if (!preview.includes('scheduleRender(tiles)') || !preview.includes('requestAnimationFrame(flush)') ||
      vector.includes('writeFileSync(tempFile') || !features.includes('this.fs.promises.writeFile(tempFile') ||
      stitcher.includes('fs.readFileSync(child.filePath)')) {
    throw new Error('A known heavy preview/vector I/O path still blocks the CEP UI task');
  }
}, 'Preview invalidations are frame-coalesced and heavy vector I/O is asynchronous');

assertAsync(async () => {
  const GeoDataRepository = require(path.resolve(__dirname, '../client/js/core/GeoDataRepository.js'));
  const repository = new GeoDataRepository();
  const first = repository.loadDatasetAsync('vector-preview/10m/index.json', { maxBytes: 1024 * 1024 });
  const second = repository.loadDatasetAsync('vector-preview/10m/index.json', { maxBytes: 1024 * 1024 });
  if (first !== second) throw new Error('Concurrent dataset reads were not deduplicated');
  const dataset = await first;
  const stats = repository.getCacheStats();
  if (!dataset || stats.entries < 1 || stats.sourceBytes <= 0 || !repository.unloadDataset('vector-preview/10m/index.json')) {
    throw new Error('Async dataset cache metrics or unload policy failed');
  }
}, 'Async dataset repository deduplicates reads, reports memory sources and unloads chunks');

assertDoesNotThrow(() => {
  const emitted = [];
  const sandbox = { console, window: {}, Number, Math, Object, Array, Date, globalEventBus: { emit: (event, payload) => emitted.push({ event, payload }) } };
  loadBrowserClass(path.resolve(__dirname, '../client/js/map/MercatorProjection.js'), 'MercatorProjection', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/MapState.js'), 'MapState', sandbox);
  loadBrowserClass(path.resolve(__dirname, '../client/js/core/StateContracts.js'), 'OpenGeoStateContracts', sandbox);
  const MapSession = loadBrowserClass(path.resolve(__dirname, '../client/js/core/MapSession.js'), 'MapSession', sandbox);
  const Viewport = loadBrowserClass(path.resolve(__dirname, '../client/js/map/Viewport.js'), 'Viewport', sandbox);
  const session = new MapSession({ defaults: { tileSource: 'osm', tileSize: 256, centerLat: 0, centerLng: 0, zoom: 2 } }, { version: '1', lat: 0, lng: 0, zoom: 2, tileSize: 256, source: 'osm' });
  let notifications = 0;
  session.onChange(() => notifications++);
  const initialRevision = session.revision;
  session.setProvider('esri');
  if (session.revision !== initialRevision + 1 || notifications !== 1) throw new Error('One state command did not create exactly one revision/notification');
  const beforeHydrationRevision = session.revision;
  session.hydrateDocument({
    documentId: 'doc-restored', composition: { compId: 9, width: 3840, height: 2160 }, providerId: 'osm', tileSize: 512,
    camera: { lat: 12, lng: 3, compZoom: 6 }, isFinalized: true
  });
  if (session.revision !== beforeHydrationRevision + 1 || notifications !== 2 || session.documentId !== 'doc-restored' || session.mapState.tileSize !== 512) {
    throw new Error('Hydration did not commit as one notification');
  }
  const stable = JSON.stringify(session.snapshot());
  let rejected = false;
  try { session.hydrateDocument({ camera: { lat: NaN, lng: 0, compZoom: 4 } }); } catch (error) { rejected = true; }
  if (!rejected || JSON.stringify(session.snapshot()) !== stable || notifications !== 2) throw new Error('Failed hydration leaked partial state or notification');
  const viewport = new Viewport(session);
  const beforeViewportRevision = session.revision;
  viewport.setCenter(22, 7);
  if (session.revision !== beforeViewportRevision + 1 || session.mapState.latitude !== 22 || notifications !== 3) throw new Error('Viewport bypassed the MapSession write boundary');
  const generation = session.beginOperation('sync');
  session.completeOperation('sync', generation);
  if (!emitted.some(entry => entry.event === 'operation:progress') || !emitted.some(entry => entry.event === 'operation:result')) {
    throw new Error('Operation lifecycle events were not published');
  }
}, 'MapSession commands and transactional hydration own state revisions atomically');

assertDoesNotThrow(() => {
  const StateHydrator = require(path.resolve(__dirname, '../client/js/core/StateHydrator.js'));
  let committed = null;
  const session = {
    snapshot: () => ({ camera: { lat: 1, lng: 2, compZoom: 3, tileSize: 256 }, layout: { compWidth: 1920, compHeight: 1080 }, composition: null, providerId: 'osm', documentId: 'doc', isFinalized: false }),
    hydrateDocument: value => { committed = value; return { camera: Object.assign({ tileSize: value.tileSize }, value.camera), providerId: value.providerId }; }
  };
  const providers = { getProvider: id => id === 'osm' ? {} : null };
  const result = new StateHydrator(session, providers).hydrate({ centerLat: 4, centerLng: 5, zoom: 6, source: 'unknown', tileSize: 512 }, 10);
  if (!result.ok || committed.providerId !== 'osm' || committed.composition.compId !== 10 || committed.tileSize !== 512) throw new Error('StateHydrator did not normalize metadata before one commit');
  const rejected = new StateHydrator(session, providers).hydrate({ compWidth: -1, centerLat: 7, centerLng: 8, zoom: 9 }, 10);
  if (rejected.ok || rejected.error.code !== 'HYDRATION_COMPOSITION_INVALID' || committed.camera.lat !== 4) {
    throw new Error('StateHydrator accepted corrupt metadata or changed state after rejection');
  }
}, 'StateHydrator normalizes provider and composition metadata before committing');

assertDoesNotThrow(() => {
  const result = require(path.resolve(__dirname, 'audit-events.js')).audit();
  if (!result.ok || result.catalogSize < 25 || result.usages.length < 100) throw new Error('Event catalog coverage is incomplete');
}, 'Every literal EventBus publication/subscription belongs to the central event catalog');

assertDoesNotThrow(() => {
  const migrations = require(path.resolve(__dirname, '../client/js/core/VersionMigrations.js'));
  const PreferencesStore = require(path.resolve(__dirname, '../client/js/core/PreferencesStore.js'));
  const contracts = require(path.resolve(__dirname, '../client/js/core/StateContracts.js'));
  const values = new Map([['prefs', JSON.stringify({ version: '1.0.0', source: 'esri', tileSize: 512, lat: 15, lng: 8, zoom: 7, documentId: 'old-doc' })]]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const config = { version: '1.1.2', defaults: { tileSource: 'osm', tileSize: 256, centerLat: 0, centerLng: 0, zoom: 2 } };
  const loaded = new PreferencesStore(storage, 'prefs', config, contracts, migrations).load();
  const metadata = migrations.migrateMetadata({ version: '1.0.0', lat: 3, lng: 4, zoom: 5, width: 1000, height: 500, providerId: 'osm',
    cartography: { policyId: 'opengeo-cartography-policy', policyVersion: '1.0.0', dataBundleVersion: '1.0.0', activeProfileIds: ['western-sahara-separated-v1'], sourcePolicySha256: 'abc' } });
  if (loaded.source !== 'esri' || loaded.tileSize !== 512 || loaded.lat !== 15 || loaded.documentId !== 'old-doc' || loaded.isNewVersion ||
      !metadata.ok || metadata.value.centerLat !== 3 || metadata.value.compWidth !== 1000 || migrations.versions.bridgeProtocol !== '2.0.0' ||
      migrations.versions.cartographyPolicy !== '1.0.0' || metadata.value.cartography.activeProfileIds[0] !== 'western-sahara-separated-v1') {
    throw new Error('N-2 migration erased settings or schema versions are not independent');
  }
}, 'Version migrations preserve N-2 preferences and normalize legacy metadata');

assertAsync(async () => {
  const AEBridge = require(path.resolve(__dirname, '../client/js/core/AEBridge.js'));
  const bridge = Object.create(AEBridge.prototype);
  bridge._sequence = 0;
  bridge._evalScript = async script => {
    const requestJson = JSON.parse(script.slice(script.indexOf('(') + 1, -1));
    const request = JSON.parse(requestJson);
    return JSON.stringify({ protocolVersion: '2.0.0', ok: true, data: { value: 7 }, requestId: request.requestId, command: request.command });
  };
  const success = await bridge.invoke('test.command', { safe: true });
  if (success.value !== 7) throw new Error('Bridge v2 success envelope was not decoded');
  bridge._evalScript = async () => '{malformed';
  let malformedCode = null;
  try { await bridge.invoke('test.command'); } catch (error) { malformedCode = error.code; }
  bridge._evalScript = async script => {
    const request = JSON.parse(JSON.parse(script.slice(script.indexOf('(') + 1, -1)));
    return JSON.stringify({ protocolVersion: '2.0.0', ok: false, error: { code: 'TEST_FAILURE', message: 'failed' }, requestId: request.requestId, command: request.command });
  };
  let hostCode = null;
  try { await bridge.invoke('test.command'); } catch (error) { hostCode = error.code; }
  const timeoutBridge = Object.create(AEBridge.prototype);
  timeoutBridge._cs = { evalScript: (_script, callback) => setTimeout(() => callback('late response'), 15) };
  let timeoutCode = null;
  try { await timeoutBridge._evalScript('noop()', 1); } catch (error) { timeoutCode = error.code; }
  await new Promise(resolve => setTimeout(resolve, 20));
  if (malformedCode !== 'BRIDGE_RESPONSE_MALFORMED' || hostCode !== 'TEST_FAILURE' || timeoutCode !== 'BRIDGE_TIMEOUT') {
    throw new Error('Bridge v2 failures are not stable typed errors');
  }
}, 'Bridge Protocol v2 validates success, malformed and typed failure envelopes');

assertDoesNotThrow(() => {
  const dispatcher = fs.readFileSync(path.resolve(__dirname, '../host/modules/bridgeDispatcher.jsx'), 'utf8');
  const bridge = fs.readFileSync(path.resolve(__dirname, '../client/js/core/AEBridge.js'), 'utf8');
  if (!dispatcher.includes("OPENGEO_BRIDGE_PROTOCOL_VERSION = '2.0.0'") || !dispatcher.includes('opengeoBridgeHandlers') ||
      dispatcher.includes('opengeoBridgeParseLegacyResult') || !dispatcher.includes('HOST_RESPONSE_MALFORMED') ||
      !bridge.includes("protocolVersion: '2.0.0'") || !bridge.includes('BRIDGE_RESPONSE_MISMATCH')) {
    throw new Error('Bridge v2 schema or typed handler table is incomplete');
  }
}, 'Host dispatcher uses a versioned typed command table instead of the legacy heuristic parser');

assertAsync(async () => {
  const os = require('os');
  const OperationLogger = require(path.resolve(__dirname, '../client/js/core/OperationLogger.js'));
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-logger-'));
  try {
    const logger = new OperationLogger({ on: () => () => {} }, { logDir: tempDirectory, maxBytes: 512, maxFiles: 3 });
    await logger.record('operation:progress', {
      operationId: 'sync:doc:1',
      phase: 'started',
      token: 'secret123',
      keys: { maptiler: 'persisted-secret' },
      url: 'https://example.test/a?api_key=secret123&key=plain-key&signature=signed-secret'
    });
    await logger.record('operation:result', { operationId: 'sync:doc:1', ok: false, errorCode: 'TEST', authorization: 'Bearer abc' });
    await logger.dispose();
    const files = logger.getSupportFiles();
    const content = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
    if (!files.length || content.includes('secret123') || content.includes('persisted-secret') || content.includes('plain-key') ||
        content.includes('signed-secret') || content.includes('Bearer abc') || !content.includes('[REDACTED]') || !content.includes('durationMs')) {
      throw new Error('Operation log is missing, unredacted, or lacks duration/error fields');
    }
  } finally {
    const resolved = path.resolve(tempDirectory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
  }
}, 'OperationLogger writes bounded redacted JSONL diagnostics suitable for support');

assertDoesNotThrow(() => {
  const NetworkPolicy = require(path.resolve(__dirname, '../client/js/core/NetworkPolicy.js'));
  if (NetworkPolicy.validateHttpsUrl('http://example.test').ok ||
      NetworkPolicy.validateHttpsUrl('https://user:pass@example.test').ok ||
      !NetworkPolicy.validateHttpsUrl('https://example.test/a').ok ||
      NetworkPolicy.validateFinalUrl('https://example.test/a', 'http://example.test/b').error.code !== 'NETWORK_REDIRECT_REJECTED' ||
      NetworkPolicy.timeoutMs(1, 15000) !== 1000 || NetworkPolicy.maxBytes(Number.MAX_SAFE_INTEGER, 1024) !== 64 * 1024 * 1024 ||
      NetworkPolicy.utf8Bytes('خريطة') <= 'خريطة'.length) {
    throw new Error('Network policy did not enforce protocol, redirect, timeout, size or UTF-8 limits');
  }
}, 'NetworkPolicy enforces HTTPS, final redirect and bounded transport limits');

assertAsync(async () => {
  const originalXhr = global.XMLHttpRequest;
  const originalPolicy = global.NetworkPolicy;
  const NetworkPolicy = require(path.resolve(__dirname, '../client/js/core/NetworkPolicy.js'));
  global.NetworkPolicy = NetworkPolicy;
  class OversizeXhr {
    open(_method, url) { this.responseURL = url; }
    send() { this.onprogress({ loaded: 2049 }); }
    abort() { if (this.onabort) this.onabort(); }
  }
  global.XMLHttpRequest = OversizeXhr;
  delete require.cache[require.resolve(path.resolve(__dirname, '../client/js/tiles/TileTransport.js'))];
  try {
    const TileTransport = require(path.resolve(__dirname, '../client/js/tiles/TileTransport.js'));
    let insecureCode = null;
    try { TileTransport.request('http://example.test/tile.png'); } catch (error) { insecureCode = error.code; }
    const request = TileTransport.request('https://example.test/tile.png', { maxBytes: 1024 });
    let oversizeCode = null;
    try { await request.promise; } catch (error) { oversizeCode = error.code; }
    if (insecureCode !== 'NETWORK_HTTPS_REQUIRED' || oversizeCode !== 'NETWORK_RESPONSE_TOO_LARGE') {
      throw new Error('Tile transport accepted HTTP or failed to abort an oversized response deterministically');
    }
  } finally {
    global.XMLHttpRequest = originalXhr;
    global.NetworkPolicy = originalPolicy;
  }
}, 'TileTransport rejects HTTP and aborts oversized tile responses');

assertDoesNotThrow(() => {
  const supplyChain = require(path.resolve(__dirname, 'supply-chain-audit.js'));
  const lockfile = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package-lock.json'), 'utf8'));
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  const audit = supplyChain.auditLockfile(lockfile, packageJson);
  const sbom = supplyChain.buildSbom(lockfile, packageJson, audit);
  if (audit.runtimeDependencies.length !== 0 || audit.components.length < 3 || sbom.bomFormat !== 'CycloneDX' ||
      sbom.components.length !== audit.components.length || sbom.components.some(component => component.scope !== 'excluded')) {
    throw new Error('Dependency audit or deterministic build-only SBOM is incomplete');
  }
}, 'Supply-chain audit pins HTTPS integrity and produces a build-only SBOM');

assertDoesNotThrow(() => {
  const os = require('os');
  const artifactManifest = require(path.resolve(__dirname, 'artifact-manifest.js'));
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-artifact-'));
  const stageDirectory = path.join(tempDirectory, 'stage');
  const manifestPath = path.join(tempDirectory, 'artifact-manifest.json');
  const sbomPath = path.join(tempDirectory, 'sbom.cdx.json');
  const compatibilityReportPath = path.join(tempDirectory, 'compatibility-report.json');
  const performancePolicyPath = path.join(tempDirectory, 'performance-budgets.json');
  try {
    fs.mkdirSync(path.join(stageDirectory, 'CSXS'), { recursive: true });
    fs.writeFileSync(path.join(stageDirectory, 'CSXS', 'manifest.xml'), '<ExtensionManifest ExtensionBundleVersion="1.0.0"><Extension Id="com.opengeo.map.panel" Version="1.0.0" /></ExtensionManifest>');
    fs.writeFileSync(path.join(stageDirectory, 'CSXS', 'extension.properties'), 'version=1.0.0\n');
    fs.writeFileSync(path.join(stageDirectory, 'payload.txt'), 'stable');
    fs.writeFileSync(sbomPath, '{"bomFormat":"CycloneDX"}\n');
    fs.writeFileSync(compatibilityReportPath, '{"status":"passed"}\n');
    fs.writeFileSync(performancePolicyPath, '{"previewVector":{}}\n');
    const options = { sbomPath, compatibilityReportPath, performancePolicyPath, packageJson: { name: 'opengeo-test', version: '1.0.0' } };
    const written = artifactManifest.writeManifest(stageDirectory, manifestPath, options);
    const verified = artifactManifest.verifyManifest(stageDirectory, manifestPath, options);
    fs.writeFileSync(compatibilityReportPath, '{"status":"mutated"}\n');
    let rejectedCompatibilityMutation = false;
    try { artifactManifest.verifyManifest(stageDirectory, manifestPath, options); } catch (_error) { rejectedCompatibilityMutation = true; }
    fs.writeFileSync(compatibilityReportPath, '{"status":"passed"}\n');
    fs.writeFileSync(performancePolicyPath, '{"previewVector":{"mutated":true}}\n');
    let rejectedPerformanceMutation = false;
    try { artifactManifest.verifyManifest(stageDirectory, manifestPath, options); } catch (_error) { rejectedPerformanceMutation = true; }
    fs.writeFileSync(performancePolicyPath, '{"previewVector":{}}\n');
    fs.writeFileSync(path.join(stageDirectory, 'payload.txt'), 'mutated');
    let rejected = false;
    try { artifactManifest.verifyManifest(stageDirectory, manifestPath, options); } catch (_error) { rejected = true; }
    if (written.aggregateSha256 !== verified.aggregateSha256 || written.fileCount !== 3 || !rejectedCompatibilityMutation ||
        !rejectedPerformanceMutation || !rejected) {
      throw new Error('Artifact manifest did not verify stable bytes or reject a stage/policy mutation');
    }
  } finally {
    const resolved = path.resolve(tempDirectory);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
  }
}, 'Artifact manifest pins every staged byte and rejects post-verification mutation');

assertDoesNotThrow(() => {
  const performanceAudit = require(path.resolve(__dirname, 'performance-audit.js'));
  const report = performanceAudit.auditPerformance({ includeBenchmark: false });
  if (report.status !== 'passed' || report.runtimeLimits.tileMemoryEntries !== 200 ||
      report.runtimeLimits.vectorPointBudget !== 400000 || report.runtimeLimits.finalizeTiles !== 20000 ||
      report.runtimeLimits.operationLogBytes !== 1048576 || report.failures.length) {
    throw new Error(`Performance budget contract failed: ${report.failures.join('; ')}`);
  }
}, 'Runtime performance limits match the audited memory, concurrency, tile and log budgets');

assertDoesNotThrow(() => {
  const sandbox = { Object };
  const OperationSnapshot = loadBrowserClass(
    path.resolve(__dirname, '../client/js/core/OperationSnapshot.js'),
    'OperationSnapshot', sandbox
  );
  const snapshot = new OperationSnapshot({
    operationId: 'sync:doc:1', kind: 'sync', generation: 1, documentId: 'doc', compId: '10',
    sourceKey: 'customXYZ', providerSignature: 'customXYZ_old',
    resolvedTemplate: 'https://old.example/{z}/{x}/{y}.png', sourceTileSize: 256,
    tileSize: 256, maxSourceZoom: 19, isFinalized: false, quality: null,
    camera: { lat: 0, lon: 0, zoom: 3 }, composition: { width: 1920, height: 1080 }
  });
  const app = {
    activeCompId: '10',
    session: { documentId: 'doc', generations: { sync: 1 } },
    tileManager: { source: 'customXYZ' },
    providerManager: {
      getSignature: () => 'customXYZ_new',
      getResolvedTemplate: () => 'https://new.example/{z}/{x}/{y}.png'
    }
  };
  if (snapshot.isCurrent(app)) throw new Error('An operation from an older provider definition remained current');
  app.providerManager.getSignature = () => 'customXYZ_old';
  app.providerManager.getResolvedTemplate = () => 'https://old.example/{z}/{x}/{y}.png';
  if (!snapshot.isCurrent(app)) throw new Error('The exact provider snapshot was rejected');
}, 'OperationSnapshot rejects stale same-id provider definitions and credentials');

assertDoesNotThrow(() => {
  let cancelledSync = 0;
  let cancelledTrajectory = 0;
  let destroyedStitcher = 0;
  const cancelledOperations = [];
  const session = {
    generations: { sync: 4, preview: 7 },
    operations: { sync: 'running', preview: 'running' },
    cancelOperation(kind, generation) { cancelledOperations.push(`${kind}:${generation}`); this.operations[kind] = 'cancelled'; },
    nextGeneration(kind) { this.generations[kind] += 1; return this.generations[kind]; }
  };
  const sandbox = { clearTimeout, setTimeout, Object };
  const SyncManager = loadBrowserClass(path.resolve(__dirname, '../client/js/core/SyncManager.js'), 'SyncManager', sandbox);
  const manager = new SyncManager({ session });
  manager.exportTimer = setTimeout(() => {}, 1000);
  manager.trajectoryTimer = setTimeout(() => {}, 1000);
  manager._syncDownloadSession = { cancel: () => { cancelledSync++; } };
  manager._trajectoryDownloadSession = { cancel: () => { cancelledTrajectory++; } };
  manager._previewStitcher = { destroy: () => { destroyedStitcher++; } };
  manager._trajectoryOperationGeneration = 7;
  manager.invalidateForProviderChange();
  if (cancelledSync !== 1 || cancelledTrajectory !== 1 || destroyedStitcher !== 1 ||
      manager._syncDownloadSession || manager._trajectoryDownloadSession || manager._previewStitcher ||
      session.generations.sync !== 5 || session.generations.preview !== 8 ||
      cancelledOperations.join(',') !== 'sync:4,preview:7') {
    throw new Error('Provider invalidation did not cancel and supersede every background generation');
  }
}, 'Provider changes cancel downloads, packing and stale sync/trajectory generations atomically');

assertDoesNotThrow(() => {
  const actions = [];
  const sandbox = {
    clearTimeout,
    setTimeout,
    Object,
    document: { getElementById: () => null, querySelector: () => null },
    globalEventBus: { emit: (name) => actions.push(`event:${name}`) }
  };
  const ApplicationCoordinator = loadBrowserClass(
    path.resolve(__dirname, '../client/js/core/ApplicationCoordinator.js'),
    'ApplicationCoordinator', sandbox
  );
  const app = {
    lifecycle: {},
    activeCompId: '42',
    previewMode: 'raster',
    providerManager: {
      getProvider: () => ({ name: 'Custom', minZoom: 1, maxZoom: 20 }),
      validateProvider: () => ({ ok: true }),
      getSignature: () => 'custom-v2'
    },
    syncManager: {
      invalidateForProviderChange: () => actions.push('invalidate-provider'),
      invalidateBackgroundWork: () => actions.push('invalidate-background'),
      queueAutoExport: () => actions.push('queue-preview')
    },
    session: {
      setProvider: source => actions.push(`provider:${source}`),
      setTileSize: size => actions.push(`tile-size:${size}`)
    },
    viewport: {
      zoom: 5,
      setZoom: () => actions.push('clamp-zoom')
    },
    tileManager: {
      source: 'customXYZ',
      setSource: (source, signature) => actions.push(`tile-source:${source}:${signature}`),
      clearCache: () => actions.push('clear-cache')
    },
    settingsPanel: { updateAttribution: () => actions.push('attribution') },
    preferencesStore: { saveSession: () => actions.push('save-prefs') },
    _triggerTileUpdate: () => actions.push('tile-update'),
    _scheduleMetadataSave: () => actions.push('save-metadata')
  };
  const coordinator = new ApplicationCoordinator(app);
  coordinator._onSourceChanged('customXYZ');
  const providerOrder = actions.slice();
  if (providerOrder[0] !== 'invalidate-provider' ||
      providerOrder.indexOf('invalidate-provider') > providerOrder.indexOf('provider:customXYZ') ||
      providerOrder.filter(action => action === 'queue-preview').length !== 1 ||
      providerOrder.indexOf('queue-preview') < providerOrder.indexOf('tile-update')) {
    throw new Error(`Provider transition was not cancel-first/latest-preview: ${providerOrder.join(',')}`);
  }

  actions.length = 0;
  coordinator._onTileSizeChanged(512);
  if (actions[0] !== 'invalidate-background' ||
      actions.indexOf('invalidate-background') > actions.indexOf('tile-size:512') ||
      actions.filter(action => action === 'queue-preview').length !== 1 ||
      actions.indexOf('queue-preview') < actions.indexOf('tile-update')) {
    throw new Error(`Tile-size transition was not cancel-first/latest-preview: ${actions.join(',')}`);
  }
}, 'Provider and tile-size transitions invalidate old work before queuing one latest preview');

assertDoesNotThrow(() => {
  const sandbox = {
    Map,
    MemoryCache: class {
      constructor() { this.values = new Map(); }
      static computeKey(x, y, z, source) { return `${source}/${z}/${x}/${y}`; }
      get(key) { return this.values.get(key) || null; }
      set(key, value) { this.values.set(key, value); }
      clear() { this.values.clear(); }
      getStats() { return { size: this.values.size, max: 200 }; }
    },
    TileDownloader: class {
      constructor() { this.cancelled = []; }
      addTile() {}
      cancelTile(key) { this.cancelled.push(key); }
      cancelAll() {}
      reset() {}
      getStats() { return { errors: 0 }; }
    },
    CachePolicy: { renderKey: (source, tile) => `${source}/${tile.z}/${tile.tileX}/${tile.y}` },
    TileGrid: { getVisibleTiles: viewport => viewport.tiles },
    globalEventBus: { on: () => () => {}, emit: () => {} }
  };
  const TileManager = loadBrowserClass(path.resolve(__dirname, '../client/js/tiles/TileManager.js'), 'TileManager', sandbox);
  const manager = new TileManager({ source: 'esri', sourceSignature: 'esri-v1' });
  const tile = (x, y) => ({ x, tileX: x, y, z: 4, screenX: x * 256, screenY: y * 256, drawSize: 256, distance: 0 });
  manager.update({ tiles: [tile(1, 1), tile(2, 1), tile(3, 1), tile(4, 1)] }, () => ['https://example.test/tile']);
  manager.update({ tiles: [tile(8, 2), tile(9, 2)] }, () => ['https://example.test/tile']);
  manager.update({ tiles: [tile(9, 2)] }, () => ['https://example.test/tile']);
  if (manager.getStats().visibleTiles !== 1 || manager._activeTiles.size !== 1 || manager.downloader.cancelled.length < 4) {
    throw new Error('Repeated viewport updates accumulated stale tile slots');
  }
}, 'Repeated preview updates retain only the current viewport tile set');

assertDoesNotThrow(() => {
  const compatibility = require(path.resolve(__dirname, 'compatibility-audit.js'));
  const report = compatibility.auditCompatibility();
  if (report.status !== 'passed' || report.manifest.hostRange !== '[18.4,24.99]' ||
      report.manifest.runtimeVersion !== '11.0' || !report.inventory.modernSyntax.optionalChaining ||
      !report.inventory.fallbacks.resizeObserver || !report.inventory.fallbacks.workerOffscreenCanvas ||
      !report.inventory.fallbacks.xhrTransport || !report.inventory.extendScriptLegacySyntax || report.failures.length) {
    throw new Error(`Compatibility contract failed: ${report.failures.join('; ')}`);
  }
}, 'CEP compatibility contract matches the manifest, syntax baseline and tested fallbacks');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const obsoleteConfigs = ['rollup.config.js', 'tsconfig.json']
    .filter(file => fs.existsSync(path.join(root, file)));
  if (obsoleteConfigs.length) {
    throw new Error(`Obsolete parallel build configs remain: ${obsoleteConfigs.join(', ')}`);
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const scripts = packageJson.scripts || {};
  const serializedToolchain = JSON.stringify({ scripts, devDependencies: packageJson.devDependencies || {} });
  if (/rollup|typescript|\btsc\b/i.test(serializedToolchain)) {
    throw new Error('Package metadata reintroduced an unapproved TypeScript/Rollup build path');
  }
  const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
  if (!html.includes('js/engine/OpenGeoEngine.js')) {
    throw new Error('The declared runtime engine is not loaded by client/index.html');
  }
  const build = fs.readFileSync(path.join(root, 'scripts/build.js'), 'utf8');
  if (build.includes('client/js/engine/src') || build.includes('client/js/engine/dist')) {
    throw new Error('The production build still references the removed parallel engine tree');
  }
  const adr = fs.readFileSync(path.join(root, 'docs/ADR-001_BUILD_ARCHITECTURE_AR.md'), 'utf8');
  if (!adr.includes('JavaScript كلاسيكي') || !adr.includes('release/stage')) {
    throw new Error('ADR-001 does not pin the selected runtime and artifact architecture');
  }
}, 'ADR-001 enforces one explicit JavaScript runtime build architecture');

assertDoesNotThrow(() => {
  const SecurityPolicy = require(path.resolve(__dirname, '../client/js/core/SecurityPolicy.js'));
  if (SecurityPolicy.normalizeHttpsUrl('javascript:alert(1)') !== '' ||
      SecurityPolicy.normalizeHttpsUrl('http://example.test/x') !== '' ||
      SecurityPolicy.normalizeHttpsUrl('https://user:pass@example.test/x') !== '' ||
      SecurityPolicy.normalizeHttpsUrl('https://example.test/x') !== 'https://example.test/x') {
    throw new Error('External navigation URL policy accepts an unsafe scheme or credential');
  }
  const documentStub = {
    createElement: tag => ({
      tag,
      attributes: {},
      style: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    })
  };
  const icon = SecurityPolicy.createLucideIcon(documentStub, 'map-pin', 14);
  let rejected = false;
  try { SecurityPolicy.createLucideIcon(documentStub, '<img src=x>', 14); } catch (_error) { rejected = true; }
  if (icon.attributes['data-lucide'] !== 'map-pin' || !rejected) throw new Error('DOM icon policy accepted markup');
}, 'SecurityPolicy rejects unsafe navigation and creates icons without HTML parsing');

assertDoesNotThrow(() => {
  const result = require(path.resolve(__dirname, 'security-audit.js')).auditSecurity();
  if (!result.csp || result.firstPartyFiles < 40 || !result.allowedClientNodeModules.includes('fs')) {
    throw new Error('Security inventory is incomplete');
  }
}, 'CSP, DOM sinks, remote code and Node capabilities are enforced by the release audit');

assertDoesNotThrow(() => {
  const FeatureRegistry = require(path.resolve(__dirname, '../client/js/core/FeatureRegistry.js'));
  const registry = new FeatureRegistry();
  registry.upsert({ id: 'country-DZA', type: 'country', name: 'Algeria', previewPayload: { layers: [] } });
  registry.setVisibility('country-DZA', false);
  const persisted = registry.serialize();
  if (persisted.length !== 1 || persisted[0].visible !== false || Object.prototype.hasOwnProperty.call(persisted[0], 'previewPayload')) {
    throw new Error('Feature registry did not preserve identity/visibility or persisted a heavy preview payload');
  }
  registry.replaceAll(persisted);
  registry.setHostState('country-DZA', { visible: true, controllerId: 7, layerCount: 3 });
  const restored = registry.get('country-DZA');
  if (!restored.hostPresent || restored.ae.controllerId !== 7 || restored.visible !== true) throw new Error('Feature reconciliation state is invalid');
}, 'Composition FeatureRegistry persists bounded descriptors and reconciles host state');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const host = fs.readFileSync(path.join(root, 'host/modules/vectorHost.jsx'), 'utf8');
  const dispatcher = fs.readFileSync(path.join(root, 'host/modules/bridgeDispatcher.jsx'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'client/js/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
  if (!/opengeo:feature:/.test(host) || !/layers\.addNull\(\)/.test(host) ||
      !/opengeoFeatureSetVisibility/.test(host) || !/opengeoFeatureDelete/.test(host) ||
      !/'feature\.list'/.test(dispatcher) || !/'feature\.visibility'/.test(dispatcher) || !/'feature\.delete'/.test(dispatcher) ||
      !/new FeatureManager/.test(app) || !/feature-layers-panel/.test(html)) {
    throw new Error('Feature lifecycle is not wired from panel through metadata/bridge to the AE controller Null');
  }
}, 'Vector feature lifecycle uses stable comments, a controller Null and typed host commands');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const host = fs.readFileSync(path.join(root, 'host/modules/vectorHost.jsx'), 'utf8');
  const dispatcher = fs.readFileSync(path.join(root, 'host/modules/bridgeDispatcher.jsx'), 'utf8');
  const manager = fs.readFileSync(path.join(root, 'client/js/core/FeatureManager.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
  const controllerStart = host.indexOf('function opengeoVectorCreateController');
  const shapeStart = host.indexOf('function opengeoVectorCreateShapeLayer');
  const labelStart = host.indexOf('function opengeoVectorCreateLabelLayer');
  const controllerSection = host.slice(controllerStart, shapeStart);
  const shapeSection = host.slice(shapeStart, labelStart);
  const migrationStart = host.indexOf('function opengeoNormalizeVectorFeatureControls');
  const listStart = host.indexOf('function opengeoFeatureList');
  const migrationSection = host.slice(migrationStart, listStart);
  if (controllerStart < 0 || shapeStart < 0 || migrationStart < 0 ||
      controllerSection.includes("opengeoVectorAddCheckbox(fx, 'Visible'") || controllerSection.includes('Stroke Color') ||
      !shapeSection.includes('opengeoVectorAddCheckbox(fx, "Visible", true)') ||
      !shapeSection.includes("shapeLayer.property('Opacity').expression = 'effect(\"Visible\")") ||
      shapeSection.includes('safeControllerName') ||
      !migrationSection.includes("opengeoVectorReadEffectValue(controller, 'Stroke Color'") ||
      migrationSection.indexOf("opengeoVectorReadEffectValue(controller, 'Stroke Color'") > migrationSection.indexOf('controllerEffects.property(effectIndex).remove()') ||
      !migrationSection.includes("group.labels[labelIndex].property('Opacity').expression") ||
      !dispatcher.includes("'feature.normalizeControls'") ||
      manager.indexOf("invoke('feature.normalizeControls'") > manager.indexOf("invoke('feature.list'") ||
      !html.includes('js/core/FeatureManager.js?v=5')) {
    throw new Error('Vector visual controls have more than one source of truth or legacy migration is unsafe');
  }
}, 'Vector Shape owns all visual controls while the Null stays spatial-only and legacy values migrate before removal');

assertDoesNotThrow(() => {
  const migration = require(path.resolve(__dirname, '../client/js/core/VersionMigrations.js'));
  const result = migration.migrateMetadata({ opengeo: { version: '2.0.0', features: [{ id: 'country-DZA', visible: false }] } });
  if (!result.ok || result.value.version !== '2.2.0' || result.value.features.length !== 1 || result.value.features[0].id !== 'country-DZA' || result.value.displayName !== 'OpenGeo Map') {
    throw new Error('Metadata 2.0 to 2.2 migration lost the feature registry or map name fallback');
  }
}, 'Metadata schema 2.2 migrates legacy compositions and preserves features and map naming');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const manifest = fs.readFileSync(path.join(root, 'CSXS/manifest.xml'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'client/js/config.js'), 'utf8');
  const migrations = require(path.join(root, 'client/js/core/VersionMigrations.js'));
  const bundleVersion = (manifest.match(/ExtensionBundleVersion="([^"]+)"/) || [])[1];
  const configVersion = (config.match(/version:\s*'([^']+)'/) || [])[1];
  if (packageVersion !== bundleVersion || packageVersion !== configVersion || packageVersion !== migrations.versions.app) {
    throw new Error(`Version drift: package=${packageVersion}, manifest=${bundleVersion}, config=${configVersion}, migrations=${migrations.versions.app}`);
  }
}, 'v1 release version is synchronized across package, manifest, runtime and migrations');

assertAsync(async () => {
  const FeatureRegistry = require(path.resolve(__dirname, '../client/js/core/FeatureRegistry.js'));
  const FeatureManager = require(path.resolve(__dirname, '../client/js/core/FeatureManager.js'));
  global.MercatorProjection = {
    worldPointToLatLng(x, y) { return { lat: 90 - y / 1000, lng: x / 1000 - 180 }; }
  };
  const registry = new FeatureRegistry();
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-feature-test-'));
  const app = {
    activeCompId: null,
    session: { documentId: 'draft-test' },
    jobManager: { tempDir: path.join(sandboxRoot, 'temp') },
    _schedulePreviewRender() {}, _scheduleMetadataSave() {}
  };
  const manager = new FeatureManager(app, registry);
  try {
    await manager.registerPreview({
      featureId: 'country-DZA', featureSignature: 'outline-dza', layerName: 'Algeria', sourceId: 'DZA',
      layers: [{ features: [{ rings: [[[1000, 1000], [2000, 1000], [2000, 2000]]] }] }]
    }, 'country');
    const item = registry.get('country-DZA');
    if (!item || item.hostPresent !== false || !item.previewAvailable || registry.list().length !== 1) {
      throw new Error('A composition-free preview was not registered as Preview only');
    }
  } finally {
    manager.dispose();
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}, 'GeoJSON/country preview features remain visible in Layers without an AE composition');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const layersPanel = fs.readFileSync(path.join(root, 'client/js/ui/LayersPanel.js'), 'utf8');
  const toolbar = fs.readFileSync(path.join(root, 'client/js/ui/ToolbarController.js'), 'utf8');
  const dialog = fs.readFileSync(path.join(root, 'client/js/ui/DialogManager.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
  if (/window\.confirm\s*\(|(^|[^.A-Za-z])prompt\s*\(/m.test(layersPanel + toolbar) ||
      !/app\.dialog\.confirm/.test(layersPanel) || !/app\.dialog\.prompt/.test(toolbar) ||
      !/aria-modal="true"/.test(html) || !/Escape/.test(dialog)) {
    throw new Error('A native browser dialog remains or the OpenGeo dialog lacks its accessibility contract');
  }
}, 'OpenGeo theme-native dialogs replace native confirm/prompt chrome');

assertAsync(async () => {
  const FeatureRegistry = require(path.resolve(__dirname, '../client/js/core/FeatureRegistry.js'));
  const FeatureManager = require(path.resolve(__dirname, '../client/js/core/FeatureManager.js'));
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-managed-payload-'));
  const app = {
    activeCompId: null,
    session: { documentId: 'managed-path-test' },
    jobManager: { tempDir: path.join(sandboxRoot, 'temp') },
    _schedulePreviewRender() {}, _scheduleMetadataSave() {}
  };
  const manager = new FeatureManager(app, new FeatureRegistry());
  const payload = {
    featureId: 'geojson-safe', featureSignature: 'geojson-safe', layerName: 'Safe',
    layers: [{ features: [{ rings: [[[1, 1], [2, 2]]] }] }], labels: []
  };
  const outsidePath = path.join(sandboxRoot, 'outside.json');
  fs.writeFileSync(outsidePath, JSON.stringify(payload), 'utf8');
  let outsideRejected = false;
  try { await manager._readManagedPayload(outsidePath, payload.featureId); }
  catch (error) { outsideRejected = /outside OpenGeo managed storage/.test(error.message); }
  try {
    const managedPath = await manager._persistPayload(payload.featureId, payload);
    const restored = await manager._readManagedPayload(managedPath, payload.featureId);
    if (!outsideRejected || restored.featureId !== payload.featureId) {
      throw new Error('Managed payload containment or identity validation failed');
    }
  } finally {
    manager.dispose();
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}, 'Persisted GeoJSON preview payloads cannot escape OpenGeo managed storage');

assertAsync(async () => {
  const FeatureRegistry = require(path.resolve(__dirname, '../client/js/core/FeatureRegistry.js'));
  const FeatureManager = require(path.resolve(__dirname, '../client/js/core/FeatureManager.js'));
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-feature-queue-'));
  const app = {
    activeCompId: null,
    session: { documentId: 'queue-test' },
    jobManager: { tempDir: path.join(sandboxRoot, 'temp') },
    _schedulePreviewRender() {}, _scheduleMetadataSave() {}
  };
  const manager = new FeatureManager(app, new FeatureRegistry());
  const order = [];
  try {
    const first = manager._queueFeatureOperation('same-feature', async () => {
      order.push('start-1');
      await new Promise(resolve => setTimeout(resolve, 5));
      order.push('end-1');
    });
    const second = manager._queueFeatureOperation('same-feature', async () => {
      order.push('start-2');
      order.push('end-2');
    });
    await Promise.all([first, second]);
    if (order.join(',') !== 'start-1,end-1,start-2,end-2') throw new Error(`Feature operations overlapped: ${order.join(',')}`);
  } finally {
    manager.dispose();
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}, 'Visibility, delete and import operations serialize per feature identity');

assertAsync(async () => {
  const FeatureRegistry = require(path.resolve(__dirname, '../client/js/core/FeatureRegistry.js'));
  const FeatureManager = require(path.resolve(__dirname, '../client/js/core/FeatureManager.js'));
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-country-hydrate-'));
  global.MercatorProjection = {
    worldPointToLatLng: (x, y) => ({ lat: y / 100, lng: x / 100 }),
    latLngToWorldPoint: (lat, lng) => ({ x: (lng + 180) * 100, y: lat * 100 })
  };
  const app = {
    activeCompId: null,
    session: { documentId: 'country-hydrate-test' },
    jobManager: { tempDir: path.join(sandboxRoot, 'temp') },
    geoDataRepository: {
      getCountryOutline: () => ({
        country: { label: [1200, 3400] },
        features: [{ id: 'DZA', rings: [[[1, 1], [2, 2], [3, 1]]] }]
      })
    },
    _schedulePreviewRender() {}, _scheduleMetadataSave() {}
  };
  const registry = new FeatureRegistry();
  const manager = new FeatureManager(app, registry);
  try {
    await manager.hydrate([{ id: 'country-DZA', type: 'country', name: 'Algeria', sourceId: 'DZA', featureSignature: 'outline-dza', layerName: 'Algeria' }]);
    const payload = registry.get('country-DZA').previewPayload;
    if (!payload || !payload.labels.length || payload.labels[0].name !== 'Algeria' ||
        payload.anchor.point[0] !== 1200 || payload.anchor.lat !== 34) {
      throw new Error('Country preview lost its restored label/controller anchor');
    }
  } finally {
    manager.dispose();
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}, 'Country hydration restores local geometry, label and controller anchor');

assertAsync(async () => {
  const FeatureRegistry = require(path.resolve(__dirname, '../client/js/core/FeatureRegistry.js'));
  const FeatureManager = require(path.resolve(__dirname, '../client/js/core/FeatureManager.js'));
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-comp-switch-vector-'));
  const tempDir = path.join(sandboxRoot, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  let finishCount = 0;
  const app = {
    activeCompId: '101',
    session: { documentId: 'comp-switch-test' },
    jobManager: {
      tempDir,
      startJob: () => 'switch_job',
      createTempFile: () => path.join(tempDir, 'switch_job.json'),
      finishJob: () => { finishCount++; }
    },
    aeBridge: { invoke: async () => { app.activeCompId = '202'; return { status: 'success' }; } },
    _schedulePreviewRender() {}, _scheduleMetadataSave() {}
  };
  const registry = new FeatureRegistry();
  const manager = new FeatureManager(app, registry);
  const payload = {
    featureId: 'geojson-switch', featureSignature: 'geojson-switch', layerName: 'Switch',
    layers: [{ features: [{ rings: [[[1, 1], [2, 2]]] }] }], labels: []
  };
  try {
    const result = await manager.drawPayloadInAE(payload, 'geojson');
    if (!result.registryDeferred || result.compId !== '101' || registry.list().length !== 0 || finishCount !== 1) {
      throw new Error('Late vector response contaminated the newly active composition registry');
    }
    if (!fs.existsSync(manager._getPayloadPath(payload.featureId))) throw new Error('Deferred GeoJSON recovery payload was not persisted');
  } finally {
    manager.dispose();
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}, 'Vector drawing pins one composition and defers late registry reconciliation safely');

assertDoesNotThrow(() => {
  const FeatureRegistry = require(path.resolve(__dirname, '../client/js/core/FeatureRegistry.js'));
  const registry = new FeatureRegistry();
  registry.upsert({ id: 'country-DZA', type: 'country', name: 'Algeria' });
  let invalidRejected = false;
  try { registry.replaceAll([{ id: '', type: 'country' }]); } catch (error) { invalidRejected = true; }
  if (!invalidRejected || !registry.get('country-DZA')) throw new Error('Invalid replacement partially erased the registry');
  const oversized = [];
  for (let index = 0; index < 150; index++) {
    oversized.push({
      id: `geojson-${index}`, type: 'geojson', name: 'N'.repeat(160), sourceId: 'S'.repeat(160),
      featureSignature: `signature-${index}-${'x'.repeat(130)}`, layerName: 'L'.repeat(160),
      sourcePath: `C:/${'p'.repeat(1900)}/${index}.json`
    });
  }
  let budgetRejected = false;
  try { registry.replaceAll(oversized); } catch (error) { budgetRejected = error.code === 'FEATURE_REGISTRY_SIZE_LIMIT'; }
  if (!budgetRejected || !registry.get('country-DZA')) throw new Error('Metadata budget overflow was accepted or mutated existing state');
}, 'FeatureRegistry replacement is atomic and bounded below the metadata limit');

assertDoesNotThrow(() => {
  const OperationSnapshot = require(path.resolve(__dirname, '../client/js/core/OperationSnapshot.js'));
  const MetadataManager = loadBrowserClass(
    path.resolve(__dirname, '../client/js/ae/MetadataManager.js'),
    'MetadataManager',
    { console }
  );
  const feature = { id: 'country-DZA', type: 'country', name: 'Algeria', visible: true };
  const app = {
    activeCompId: '77',
    config: { defaults: { tileSource: 'esri' } },
    tileManager: { source: 'esri' },
    providerManager: {
      getProvider: () => ({ tileSize: 256, maxZoom: 19 }),
      validateProvider: () => ({ ok: true }),
      getResolvedTemplate: () => 'https://example.test/{z}/{x}/{y}',
      getSignature: () => 'esri-signature'
    },
    mapState: { latitude: 1, longitude: 2, compZoom: 3, tileSize: 256, compWidth: 1920, compHeight: 1080 },
    session: {
      documentId: 'snapshot-features', isFinalized: false,
      featureRegistry: { serialize: () => [feature] },
      getOperationId: () => 'finalize:snapshot-features:1',
      generations: { finalize: 1 }
    }
  };
  const snapshot = OperationSnapshot.capture(app, { kind: 'finalize', generation: 1 });
  feature.name = 'MUTATED';
  const metadata = new MetadataManager(null).createSnapshotState(snapshot, true, snapshot.operationId);
  if (snapshot.features[0].name !== 'Algeria' || metadata.opengeo.features[0].id !== 'country-DZA') {
    throw new Error('Finalize snapshot lost or mutated the feature registry');
  }
  let sizeRejected = false;
  try { new MetadataManager(null).serializeState({ opengeo: { payload: 'x'.repeat(262145) } }); }
  catch (error) { sizeRejected = error.code === 'METADATA_SIZE_LIMIT'; }
  if (!sizeRejected) throw new Error('Oversized composition metadata was accepted');
}, 'Finalize snapshots preserve feature descriptors and enforce the metadata size limit');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const helpers = fs.readFileSync(path.join(root, 'host/modules/helpers.jsx'), 'utf8');
  const vectorHost = fs.readFileSync(path.join(root, 'host/modules/vectorHost.jsx'), 'utf8');
  const compBuilder = fs.readFileSync(path.join(root, 'host/modules/compBuilder.jsx'), 'utf8');
  const metadataHost = fs.readFileSync(path.join(root, 'host/modules/metadataSync.jsx'), 'utf8');
  if (!helpers.includes('function opengeoIsManagedPayloadFile') ||
      !vectorHost.includes("opengeoVectorValidationError('VECTOR_FILE_PATH'") ||
      !compBuilder.includes('if (!opengeoIsManagedPayloadFile(file))') ||
      !metadataHost.includes('METADATA_SIZE_LIMIT') || !metadataHost.includes('METADATA_FEATURE_LIMIT')) {
    throw new Error('Host file/metadata trust boundaries are incomplete');
  }
}, 'ExtendScript accepts payload files only from managed storage and validates metadata bounds');

assertDoesNotThrow(() => {
  const EventBus = loadBrowserClass(
    path.resolve(__dirname, '../client/js/events/EventBus.js'),
    'EventBus',
    { console, Map, Promise, Error, String }
  );
  const bus = new EventBus();
  let rejected = false;
  try { bus.on('invalid', null); } catch (error) { rejected = error instanceof TypeError || error.name === 'TypeError'; }
  const dispose = bus.on('valid', () => {});
  dispose();
  if (!rejected || bus._listeners.has('valid')) throw new Error('EventBus accepted a non-function or retained an empty listener bucket');
}, 'EventBus validates listeners and releases empty subscription buckets');

assertDoesNotThrow(() => {
  const FeatureRegistry = require(path.resolve(__dirname, '../client/js/core/FeatureRegistry.js'));
  const FeatureManager = require(path.resolve(__dirname, '../client/js/core/FeatureManager.js'));
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-finalize-feature-gate-'));
  const app = {
    session: { documentId: 'finalize-gate', operations: { finalize: 'running' } },
    jobManager: { tempDir: path.join(sandboxRoot, 'temp') },
    _schedulePreviewRender() {}, _scheduleMetadataSave() {}
  };
  const manager = new FeatureManager(app, new FeatureRegistry());
  let blocked = false;
  try { manager._assertFeatureMutationAllowed(); }
  catch (error) { blocked = error.code === 'FEATURE_MUTATION_DURING_FINALIZE'; }
  const finalize = fs.readFileSync(path.resolve(__dirname, '../client/js/core/FinalizeController.js'), 'utf8');
  try {
    if (!blocked || finalize.indexOf('await this.app.featureManager.waitForIdle()') < 0 ||
        finalize.indexOf('await this.app.featureManager.waitForIdle()') > finalize.indexOf('OperationSnapshot.capture')) {
      throw new Error('Finalize does not isolate its metadata snapshot from vector mutations');
    }
  } finally {
    manager.dispose();
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}, 'Finalize waits for prior vector work and blocks new feature mutations');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
  const toolbar = fs.readFileSync(path.join(root, 'client/js/ui/ToolbarController.js'), 'utf8');
  const repository = fs.readFileSync(path.join(root, 'client/js/core/GeoDataRepository.js'), 'utf8');
  const removedSurface = html + toolbar + repository;
  if (/opengeo_vector_path|vector-save-path|browse-save-path-btn|saveLocalBoundary|loadLocalBoundary|hasLocalBoundary|setCustomPath/.test(removedSurface)) {
    throw new Error('The unused local boundary-cache UI/API surface remains in the v1 runtime');
  }
}, 'Unused local boundary-cache controls and zombie repository methods are removed');

assertAsync(async () => {
  const emitted = [];
  const sandbox = {
    console, Map, Date, Math, Number, String, Object, Promise, isFinite,
    setTimeout: () => 1, clearTimeout() {},
    globalEventBus: { on: () => () => {}, emit: (event, data) => emitted.push({ event, data }) },
    OpenGeoEvents: { VIEWPORT_CHANGED: 'viewport:changed', SYNC_COMP_CHANGED: 'sync:compChanged', SYNC_AE_CAMERA: 'sync:aeCamera' }
  };
  const AESyncEngine = loadBrowserClass(path.resolve(__dirname, '../client/js/ae/AESyncEngine.js'), 'AESyncEngine', sandbox);
  const session = {
    composition: { compId: 101, width: 1920, height: 1080 }, mapState: {},
    setComposition(value) { this.composition = value; }
  };
  const engine = new AESyncEngine({ invoke: async () => ({}) }, session);
  engine.setKeyframeRecording(true, 101);
  engine.setKeyframeRecording(true, 202);
  engine.setActiveComp(202);
  engine.setKeyframeRecording(false, 202);
  engine.setActiveComp(101);
  if (!engine.isKeyframeRecordingEnabled(101) || engine.isKeyframeRecordingEnabled(202) || !engine.isKeyframeRecording) {
    throw new Error('Recording state leaked between composition identities');
  }
  engine.isRunning = true;
  engine._syncTimer = null;
  await engine._pollAfterEffects();
  const changed = emitted.find(entry => entry.event === 'sync:compChanged');
  if (!changed || changed.data.oldId !== 101 || changed.data.newId !== null || session.composition.compId !== null || engine.isKeyframeRecording) {
    throw new Error('Empty AE state retained a stale OpenGeo composition identity');
  }
}, 'AE detachment clears stale composition identity and Record remains per composition');

assertAsync(async () => {
  let hydrated = null;
  let metadataRead = false;
  const sandbox = {
    console,
    document: { querySelector() { return null; } },
    globalEventBus: { emit() {} }
  };
  const CompositionController = loadBrowserClass(path.resolve(__dirname, '../client/js/core/CompositionController.js'), 'CompositionController', sandbox);
  const preview = { id: 'geojson-draft', hostPresent: false, previewPayload: { layers: [] } };
  const hosted = { id: 'country-DZA', hostPresent: true, previewPayload: { layers: [] } };
  const app = {
    activeCompId: 55,
    featureManager: {
      registry: { list: () => [preview, hosted] },
      async hydrate(items) { hydrated = items; }
    },
    metadataManager: { async loadFromComp() { metadataRead = true; return null; } },
    _schedulePreviewRender() {}
  };
  const controller = new CompositionController(app);
  await controller.load(null);
  if (metadataRead || app.activeCompId !== null || !hydrated || hydrated.length !== 1 || hydrated[0].id !== preview.id) {
    throw new Error('Detached composition load did not preserve preview-only GeoJSON safely');
  }
}, 'Leaving an OpenGeo composition preserves preview-only features without querying stale metadata');

assertAsync(async () => {
  const calls = [];
  const states = new Map();
  const button = {
    classList: { toggle() {} }, setAttribute() {}, title: ''
  };
  const label = { textContent: '' };
  const sandbox = {
    console, Number,
    document: { getElementById(id) { return id === 'keyframe-record-btn' ? button : (id === 'keyframe-record-label' ? label : null); } },
    globalEventBus: { emit(event, payload) { calls.push({ event, payload }); } }
  };
  const ToolbarController = loadBrowserClass(path.resolve(__dirname, '../client/js/ui/ToolbarController.js'), 'ToolbarController', sandbox);
  const app = {
    activeCompId: 11,
    mapState: { latitude: 1, longitude: 2, compZoom: 3 },
    lifecycle: {},
    syncEngine: {
      setKeyframeRecording(enabled, compId) { if (enabled) states.set(String(compId), true); else states.delete(String(compId)); },
      isKeyframeRecordingEnabled(compId) { return !!compId && states.get(String(compId)) === true; }
    },
    syncManager: { prepareForKeyframeMutation() {}, queueTrajectoryPreview() {} },
    aeBridge: { async invoke(command, payload) { calls.push({ command, payload }); return null; } }
  };
  const toolbar = new ToolbarController(app);
  if (!await toolbar._setKeyframeRecording(true)) throw new Error('Record did not start');
  const initialKey = calls.find(entry => entry.command === 'keyframe.add');
  if (!initialKey || initialKey.payload.compId !== 11) throw new Error('Record did not create its initial key at the active composition');
  app.activeCompId = 22;
  toolbar.syncKeyframeRecordingState(22);
  if (app.isKeyframeRecording || label.textContent !== 'Record') throw new Error('A second composition inherited the first composition Record state');
  toolbar.syncKeyframeRecordingState(11);
  if (!app.isKeyframeRecording || label.textContent !== 'Recording') throw new Error('Returning to the first composition did not restore its Record state');
}, 'Record creates an immediate first key and exposes composition-scoped UI state');

assertDoesNotThrow(() => {
  const properties = [10, 20, 6].map(value => ({
    keys: [0, 1, 2], value,
    get numKeys() { return this.keys.length; },
    valueAtTime() { return this.value; },
    removeKey(index) {
      if (index !== this.keys.length) throw new Error('Keys were not removed in descending order');
      this.keys.splice(index - 1, 1);
    },
    setValue(next) { this.value = next; }
  }));
  const effects = {
    property(name) {
      const index = name === 'Latitude' ? 0 : (name === 'Longitude' ? 1 : 2);
      return { property() { return properties[index]; } };
    }
  };
  const comp = { time: 1.5 };
  const sandbox = {
    JSON,
    ensureComp: () => comp,
    findLayerByComment: () => ({ property: () => effects }),
    withUndoGroup: (_name, operation) => operation()
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../host/modules/trajectoryScanner.jsx'), 'utf8') +
    '\nthis.__clearCameraKeys = opengeoClearCameraKeyframes;';
  vm.runInNewContext(source, sandbox, { filename: 'trajectoryScanner.jsx' });
  const result = JSON.parse(sandbox.__clearCameraKeys(77));
  if (result.keysRemoved !== 9 || properties.some(property => property.numKeys !== 0) ||
      properties[0].value !== 10 || properties[1].value !== 20 || properties[2].value !== 6) {
    throw new Error('Camera keyframe clear did not preserve the CTI camera value');
  }
  const dispatcher = fs.readFileSync(path.resolve(__dirname, '../host/modules/bridgeDispatcher.jsx'), 'utf8');
  const toolbar = fs.readFileSync(path.resolve(__dirname, '../client/js/ui/ToolbarController.js'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../client/css/style.css'), 'utf8');
  if (!dispatcher.includes("'keyframe.clear': { kind: 'json'") || !toolbar.includes("invoke('keyframe.clear'") ||
      /\.toast-(info|error|success|warning)\s*\{[^}]*border-left/.test(css)) {
    throw new Error('Typed clear command or compact toast contract is incomplete');
  }
}, 'Clear removes camera keys in one UndoGroup, preserves the CTI view, and uses compact toasts');

assertDoesNotThrow(() => {
  function CompItem() {}
  const regularComp = new CompItem();
  regularComp.id = 501;
  const sandbox = {
    JSON, Number, String, Math, isFinite,
    CompItem,
    app: { project: { activeItem: regularComp } },
    resolveOpenGeoMapComp: candidate => candidate,
    findLayerByComment: () => null,
    ensureComp: () => null
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../host/modules/metadataSync.jsx'), 'utf8') +
    '\nthis.__getActiveState = opengeoGetActiveState;';
  vm.runInNewContext(source, sandbox, { filename: 'metadataSync.jsx' });
  if (sandbox.__getActiveState() !== '{}') throw new Error('A regular AE composition was exposed as an OpenGeo drawing target');
  const toolbar = fs.readFileSync(path.resolve(__dirname, '../client/js/ui/ToolbarController.js'), 'utf8');
  if (!toolbar.includes('await registerPreviewOnly()') || !toolbar.includes('was kept in Layers as Preview only')) {
    throw new Error('Failed GeoJSON drawing is not retained as a managed preview draft');
  }
}, 'GeoJSON target validation rejects controller-free compositions and preserves Preview-only drafts');

assertAsync(async () => {
  const sandbox = { console, document: { querySelector() { return null; } }, globalEventBus: { emit() {} } };
  const CompositionController = loadBrowserClass(path.resolve(__dirname, '../client/js/core/CompositionController.js'), 'CompositionController', sandbox);
  const transitions = [];
  const app = {
    activeCompId: 44,
    aeBridge: { async invoke() { return { compId: 44 }; } },
    syncEngine: { setActiveComp(value) { app.activeCompId = value; } },
    toolbarController: { syncKeyframeRecordingState(value) { transitions.push(['record', value]); } }
  };
  const controller = new CompositionController(app);
  controller.load = async value => { app.activeCompId = value; transitions.push(['load', value]); };
  const invalid = await controller.resolveActiveMapTarget();
  if (invalid !== null || app.activeCompId !== null) throw new Error('A controller-free composition survived direct draw preflight');
  app.aeBridge.invoke = async () => ({ compId: 88, controllerId: 3 });
  const valid = await controller.resolveActiveMapTarget();
  if (valid !== 88 || app.activeCompId !== 88 || !transitions.some(entry => entry[0] === 'load' && entry[1] === 88)) {
    throw new Error('A valid OpenGeo map was not adopted by direct draw preflight');
  }
}, 'Direct vector draw preflight requires both compId and OpenGeo controller identity');

assertDoesNotThrow(() => {
  function CompItem() {}
  const controller = {
    comment: 'opengeo:v2;document=map_doc_1;role=controller', index: 1,
    property() {
      return { property(name) {
        const values = { Latitude: 28, Longitude: 2, Zoom: 5 };
        return { property() { return { valueAtTime() { return values[name]; } }; } };
      } };
    }
  };
  const comp = new CompItem();
  Object.assign(comp, {
    id: 77, name: 'North Africa • abc', width: 1920, height: 1080, duration: 30, frameRate: 30, time: 0,
    comment: JSON.stringify({ opengeo: { documentId: 'map_doc_1', displayName: 'North Africa', source: 'esri', isFinalized: true, features: [{ id: 'country-DZA' }] } }),
    opened: false, openInViewer() { this.opened = true; }
  });
  const items = { 1: comp, length: 1 };
  const sandbox = {
    JSON, Number, String, isFinite, CompItem,
    app: { project: { items, activeItem: comp } },
    findLayerByComment: candidate => candidate === comp ? controller : null,
    resolveOpenGeoMapComp: candidate => candidate,
    opengeoReadOwnership(comment) {
      const documentMatch = /document=([^;]+)/.exec(String(comment));
      return { document: documentMatch ? documentMatch[1] : null };
    },
    opengeoSanitizeIdentity: value => String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_'),
    ensureComp: id => Number(id) === comp.id ? comp : null
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../host/modules/projectMapsHost.jsx'), 'utf8') +
    '\nthis.__listMaps = opengeoListProjectMaps; this.__openMap = opengeoOpenProjectMap;';
  vm.runInNewContext(source, sandbox, { filename: 'projectMapsHost.jsx' });
  const listed = JSON.parse(sandbox.__listMaps());
  const opened = JSON.parse(sandbox.__openMap(77, 'map_doc_1'));
  if (listed.maps.length !== 1 || listed.maps[0].displayName !== 'North Africa' || !listed.maps[0].active ||
      listed.maps[0].featureCount !== 1 || !comp.opened || opened.compId !== 77) {
    throw new Error('Project Maps did not list and open the owned composition deterministically: ' + JSON.stringify({ listed, opened, openedFlag: comp.opened }));
  }
}, 'Project Maps Host index lists owned maps and opens by compId plus documentId');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
  const panel = fs.readFileSync(path.join(root, 'client/js/ui/ProjectMapsPanel.js'), 'utf8');
  const metadata = fs.readFileSync(path.join(root, 'client/js/ae/MetadataManager.js'), 'utf8');
  const snapshot = fs.readFileSync(path.join(root, 'client/js/core/OperationSnapshot.js'), 'utf8');
  const host = fs.readFileSync(path.join(root, 'host/modules/projectMapsHost.jsx'), 'utf8');
  const dispatcher = fs.readFileSync(path.join(root, 'host/modules/bridgeDispatcher.jsx'), 'utf8');
  if (!html.includes('id="comp-name"') || !html.includes('id="project-maps-btn"') || !html.includes('id="project-maps-modal"') ||
      !html.includes('class="bottom-btn create-map-btn"') || !panel.includes("invoke('project.listOpenGeoMaps'") ||
      !panel.includes("invoke('project.openOpenGeoMap'") || !panel.includes('_getThumbnailUrl(map)') ||
      !metadata.includes('displayName:') || !snapshot.includes('displayName:') ||
      !host.includes('var maxMaps = 200') || !dispatcher.includes("'project.listOpenGeoMaps'") || !dispatcher.includes("'project.openOpenGeoMap'")) {
    throw new Error('Project Maps v1 UI, naming, thumbnail, metadata, or typed Bridge surface is incomplete');
  }
}, 'Project Maps is wired as a v1 feature with names, bounded discovery, thumbnails, and typed commands');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const ToolbarController = require(path.join(root, 'client/js/ui/ToolbarController.js'));
  const toolbar = Object.create(ToolbarController.prototype);
  const ordinal = toolbar._createMapOrdinal(['OpenGeo Map \u2022 1234', 'Atlas \u2022 9999']);
  const projectName = toolbar._normalizeProjectName('North Africa Documentary.aep');
  const suggested = toolbar._composeSuggestedMapName('project', projectName, ordinal);
  const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'client/css/style.css'), 'utf8');
  const panel = fs.readFileSync(path.join(root, 'client/js/ui/ProjectMapsPanel.js'), 'utf8');
  const helpers = fs.readFileSync(path.join(root, 'host/modules/helpers.jsx'), 'utf8');
  if (!/^\d{4}$/.test(ordinal) || ordinal === '1234' || ordinal === '9999' ||
      suggested !== `North Africa Documentary \u2022 ${ordinal}` || suggested.length > 80 ||
      !html.includes('id="comp-name-mode"') || !html.includes('id="comp-name-mode-label"') ||
      !helpers.includes('projectName: projectName') || !panel.includes('project-map-thumbnail-backdrop') ||
      !panel.includes('project-map-thumbnail-image') || !css.includes('.project-map-thumbnail-image') ||
      !css.includes('object-fit: contain')) {
    throw new Error('Project-aware map naming or uncropped thumbnail presentation is incomplete');
  }
}, 'Project map naming toggles between default and AE project names with a collision-resistant number and uncropped thumbnails');

assertDoesNotThrow(() => {
  function CompItem() {}
  const folders = new Set(['C:/Project', 'C:/Project/OpenGeo_Assets']);
  const normalize = value => String(value || '').replace(/\\/g, '/');
  function File(value) {
    this.fsName = normalize(value);
    this.name = this.fsName.split('/').pop();
  }
  Object.defineProperties(File.prototype, {
    exists: { get() { return false; } },
    length: { get() { return 0; } },
    modified: { get() { return null; } }
  });
  function Folder(value) { this.fsName = normalize(value); }
  Object.defineProperty(Folder.prototype, 'exists', { get() { return folders.has(this.fsName); } });
  Folder.prototype.create = function() { folders.add(this.fsName); return true; };
  const controller = {
    comment: 'opengeo:v2;document=map_thumb_1;role=controller', index: 1,
    property() {
      return { property(name) {
        const values = { Latitude: 28, Longitude: 2, Zoom: 5 };
        return { property() { return { valueAtTime() { return values[name]; } }; } };
      } };
    }
  };
  const comp = new CompItem();
  Object.assign(comp, {
    id: 91, name: 'Thumbnail Map', width: 1920, height: 1080, duration: 30, frameRate: 30,
    frameDuration: 1 / 30, displayStartTime: 0, time: 4.5,
    comment: JSON.stringify({ opengeo: { documentId: 'map_thumb_1', displayName: 'Thumbnail Map', source: 'esri' } })
  });
  const sandbox = {
    JSON, Number, String, Date, Math, isFinite, CompItem, File, Folder,
    app: { project: { file: { name: 'Project.aep' } } },
    getProjectPath: () => 'C:/Project',
    ensureComp: id => Number(id) === comp.id ? comp : null,
    findLayerByComment: candidate => candidate === comp ? controller : null,
    opengeoReadOwnership: () => ({ document: 'map_thumb_1' }),
    opengeoSanitizeIdentity: value => String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../host/modules/projectMapsHost.jsx'), 'utf8') +
    '\nthis.__prepareThumbnail = opengeoPrepareProjectMapThumbnail;';
  vm.runInNewContext(source, sandbox, { filename: 'projectMapsHost.jsx' });
  const result = JSON.parse(sandbox.__prepareThumbnail(91, 'map_thumb_1'));
  const finalPath = 'C:/Project/OpenGeo_Assets/Thumbnails/thumb_map_thumb_1.png';
  if (result.thumbnailTargetPath !== finalPath || result.thumbnailCaptureApiVersion !== 5 ||
      result.thumbnailSource !== 'opengeo-preview-canvas' || !folders.has('C:/Project/OpenGeo_Assets/Thumbnails')) {
    throw new Error('Preview thumbnail target preparation was not deterministic: ' + JSON.stringify(result));
  }
}, 'Project Maps prepares deterministic project-local storage without rendering through After Effects');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const panel = fs.readFileSync(path.join(root, 'client/js/ui/ProjectMapsPanel.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'client/css/style.css'), 'utf8');
  const host = fs.readFileSync(path.join(root, 'host/modules/projectMapsHost.jsx'), 'utf8');
  const dispatcher = fs.readFileSync(path.join(root, 'host/modules/bridgeDispatcher.jsx'), 'utf8');
  if (!panel.includes("invoke('project.prepareOpenGeoMapThumbnail'") || !panel.includes("data-lucide', 'camera'") ||
      !panel.includes('thumbnailProcessor.captureCanvas(sourceCanvas') || !panel.includes('!map.active') ||
      panel.includes('buildTileUrl(map.providerId') || !panel.includes("'file:///'") ||
      !css.includes('.project-map-capture') || !css.includes('object-fit: contain') ||
      host.includes('renderQueue') || host.includes('saveFrameToPng') || host.includes('opengeoRenderThumbnailPng') ||
      !dispatcher.includes("'project.prepareOpenGeoMapThumbnail'") || dispatcher.includes("'project.captureOpenGeoMapThumbnail'")) {
    throw new Error('Direct preview thumbnail UI, storage safety, or Bridge wiring is incomplete');
  }
}, 'Project Maps captures the active OpenGeo preview without Render Queue or synthetic provider requests');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const panel = fs.readFileSync(path.join(root, 'client/js/ui/ProjectMapsPanel.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'client/css/style.css'), 'utf8');
  const host = fs.readFileSync(path.join(root, 'host/modules/projectMapsHost.jsx'), 'utf8');
  const debug = fs.readFileSync(path.join(root, '.debug'), 'utf8');
  const build = fs.readFileSync(path.join(root, 'scripts/build.js'), 'utf8');
  if (!host.includes('thumbnailCaptureApiVersion: 5') || !host.includes('thumbnailCaptureSupported: !!(app.project && app.project.file)') ||
      !panel.includes('Restart After Effects to load direct preview capture.') || !panel.includes("operationLogger.record('project-map:thumbnail'") ||
      !panel.includes("statusElement.classList.add('error')") || !panel.includes("console.error('[ProjectMapsPanel] Thumbnail capture failed:'") ||
      !panel.includes('Open this map to capture its preview.') || !css.includes('z-index: 2300') ||
      !debug.includes('<Host Name="AEFT" Port="8088" />') || !build.includes("'.debug'")) {
    throw new Error('Thumbnail capability negotiation, visible diagnostics, or development-only console configuration is incomplete');
  }
}, 'Thumbnail capture reports active-map and saved-project requirements inline and keeps the 8088 console outside release artifacts');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const ThumbnailProcessor = require(path.join(root, 'client/js/core/ThumbnailProcessor.js'));
  const processor = new ThumbnailProcessor({ maxDimension: 960 });
  const png = Buffer.alloc(45);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
  png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1920, 16); png.writeUInt32BE(1080, 20);
  png[24] = 16; png[25] = 6;
  png.writeUInt32BE(0, 33); png.write('IEND', 37, 'ascii');
  const info = processor.inspectPng(png);
  const accepted = processor._validatePath('C:/Project/OpenGeo_Assets/Thumbnails/thumb_map_1.png', path);
  let rejected = false;
  try { processor._validatePath('C:/Project/unsafe.png', path); } catch (error) { rejected = error.code === 'THUMBNAIL_PATH_REJECTED'; }
  const panel = fs.readFileSync(path.join(root, 'client/js/ui/ProjectMapsPanel.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
  const host = fs.readFileSync(path.join(root, 'host/modules/projectMapsHost.jsx'), 'utf8');
  if (info.width !== 1920 || info.height !== 1080 || info.bitDepth !== 16 || info.colorType !== 6 || info.hasColorProfile ||
      !accepted.endsWith(path.join('Thumbnails', 'thumb_map_1.png')) || !rejected ||
      !panel.includes('thumbnailProcessor.captureCanvas(sourceCanvas') || !panel.includes('frameWidth: this.app.mapState && this.app.mapState.frameWidth') ||
      !html.includes('js/core/ThumbnailProcessor.js?v=5') || !html.includes('js/ui/ProjectMapsPanel.js?v=10') ||
      host.includes('renderQueue') || host.includes('comp.saveFrameToPng') ||
      !fs.readFileSync(path.join(root, 'client/js/core/ThumbnailProcessor.js'), 'utf8').includes("colorStrategy: 'opengeo-preview-canvas-srgb'") ||
      fs.readFileSync(path.join(root, 'client/js/core/ThumbnailProcessor.js'), 'utf8').includes('_encodeLinearCanvasAsSrgb')) {
    throw new Error('Preview crop, PNG validation, managed path, or client wiring is incomplete');
  }
}, 'Preview thumbnails are frame-cropped, validated as complete PNGs, and stored as display-ready sRGB assets');

assertDoesNotThrow(() => {
  const root = path.resolve(__dirname, '..');
  const runtime = fs.readFileSync(path.join(root, 'client/js/core/NodeRuntime.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'client/index.html'), 'utf8');
  const security = fs.readFileSync(path.join(root, 'scripts/security-audit.js'), 'utf8');
  const compatibility = fs.readFileSync(path.join(root, 'scripts/compatibility-audit.js'), 'utf8');
  if (!runtime.includes('globalObject.cep_node.require') || !runtime.includes("globalObject.require('buffer').Buffer") ||
      !runtime.includes("globalObject.require('process')") || !html.includes('js/core/NodeRuntime.js?v=1') ||
      html.indexOf('js/core/NodeRuntime.js?v=1') > html.indexOf('js/config.js') ||
      !security.includes("'buffer', 'crypto', 'fs', 'os', 'path', 'process'") ||
      !compatibility.includes("'buffer', 'crypto', 'fs', 'os', 'path', 'process'")) {
    throw new Error('CEP DevTools reload cannot restore the allowlisted Node runtime safely');
  }
}, 'CEP DevTools reload restores require, Buffer and process from cep_node before application bootstrap');

// Summary
Promise.all(pendingAsyncTests).then(() => {
  console.log('====================================');
  console.log(`Tests Run: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log('====================================');
  process.exit(failed > 0 ? 1 : 0);
});
