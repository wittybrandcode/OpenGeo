/**
 * OpenGeo Quality Assurance: GeoJSON Elevation & Interactive System Test Suite
 * Tests the 5 core engineering solutions:
 * 1. Curated Palette & Simplestyle metadata extraction
 * 2. Coordinate Grid Snapping & Sliver Hole Removal for multi-country bloc mergers
 * 3. Douglas-Peucker simplification in projected Web Mercator space
 * 4. Polylabel visual pole interior grid search for concave/island text label placement
 * 5. Camera framing calculator & VectorMapManager custom payload building
 */

const assert = require('assert');
const path = require('path');
const GeoJSONEngine = require(path.resolve(__dirname, '../../../client/js/core/GeoJSONEngine.js'));
const VectorMapManager = require(path.resolve(__dirname, '../../../client/js/core/VectorMapManager.js'));

console.log('====================================');
console.log('OpenGeo GeoJSON Elevation & Bloc Merge Suite');
console.log('====================================');

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

// 1. Curated Palette & Metadata Extraction
runTest('Extracts Arabic/English name, ISO code and Simplestyle properties accurately', () => {
  const feat = {
    type: 'Feature',
    properties: {
      name_ar: 'الجزائر',
      name: 'Algeria',
      iso_a3: 'DZA',
      fill: '#e11d48',
      stroke: '#ffffff',
      'fill-opacity': 0.8
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
    }
  };
  const meta = GeoJSONEngine.resolveFeatureMetadata(feat, 0);
  assert.strictEqual(meta.name, 'الجزائر');
  assert.strictEqual(meta.isoCode, 'DZA');
  assert.strictEqual(meta.fillColor, '#e11d48');
  assert.strictEqual(meta.fillOpacity, 80);
  assert.strictEqual(meta.vertexCount, 5);
  assert.strictEqual(meta.selected, true);
});

// 2. Coordinate Grid Snapping
runTest('Snaps coordinates to grid precision to eliminate microscopic coordinate gaps', () => {
  const feat = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[0.1234567, 0.9876543], [1.000004, 1.000006]]]
    }
  };
  const snapped = GeoJSONEngine.snapFeatureCoordinates(feat, 1e-4);
  const coords = snapped.geometry.coordinates[0];
  assert.strictEqual(coords[0][0], 0.1235);
  assert.strictEqual(coords[0][1], 0.9877);
  assert.strictEqual(coords[1][0], 1.0);
  assert.strictEqual(coords[1][1], 1.0);
});

// 3. Sliver Hole Removal & Isoperimetric Compactness
runTest('Cleans internal sliver holes created between shared borders while preserving real lakes', () => {
  // A large outer square with:
  // 1. A thin sliver hole (perimeter=2.02, area=0.01 -> compactness ~ 0.03 <= 0.08) -> MUST BE REMOVED
  // 2. A large circular/square lake (outerArea=100, lakeArea=10, compactness ~ 0.78) -> MUST BE KEPT
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]; // area = 100
  const sliverHole = [[5, 1], [5.01, 1], [5.01, 2], [5, 2], [5, 1]]; // very thin rectangle
  const realLake = [[1, 1], [4, 1], [4, 4], [1, 4], [1, 1]]; // large square lake area = 9

  const polyWithHoles = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [outer, sliverHole, realLake]
    }
  };

  const cleaned = GeoJSONEngine.cleanInternalSliverHoles(polyWithHoles, true, 0.015);
  // Outer ring + real lake kept = 2 rings (sliver hole removed!)
  assert.strictEqual(cleaned.geometry.coordinates.length, 2);
  assert.deepStrictEqual(cleaned.geometry.coordinates[0], outer);
  assert.deepStrictEqual(cleaned.geometry.coordinates[1], realLake);
});

// 4. Unified Bloc Merger
runTest('Merges adjacent countries into one seamless bloc polygon', () => {
  const polyA = {
    type: 'Feature',
    properties: { name: 'Country A' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]
    }
  };
  const polyB = {
    type: 'Feature',
    properties: { name: 'Country B' },
    geometry: {
      type: 'Polygon',
      coordinates: [[[1.00002, 0], [2, 0], [2, 1], [1.00002, 1], [1.00002, 0]]]
    }
  };

  const merged = GeoJSONEngine.mergeFeaturesAsUnifiedBloc([polyA, polyB], { snapPrecision: 1e-4 });
  assert(merged && merged.geometry);
  assert.strictEqual(merged.geometry.type, 'Polygon');
  // Outer perimeter has 5 coordinates (starts and ends at [0,0])
  assert.strictEqual(merged.geometry.coordinates[0].length, 5);
});

// 5. Douglas-Peucker in Web Mercator Space
runTest('Simplifies dense rings in Web Mercator space while keeping polygons closed', () => {
  const denseRing = [];
  for (let i = 0; i <= 100; i++) {
    const x = i;
    // Add micro jitter
    const y = (i === 50) ? 10 : (i % 2 === 0 ? 0.01 : 0);
    denseRing.push([x, y]);
  }
  denseRing.push([denseRing[0][0], denseRing[0][1]]);

  const simplified = GeoJSONEngine.simplifyMercatorRing(denseRing, 0.5);
  assert(simplified.length < denseRing.length, 'Simplification reduced point count');
  assert.deepStrictEqual(simplified[0], simplified[simplified.length - 1], 'Ring remains closed');
});

// 6. Polylabel Visual Pole Center
runTest('Computes visual interior center inside polygon bounds', () => {
  const lShapedPolygon = {
    type: 'Polygon',
    coordinates: [[
      [0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10], [0, 0]
    ]]
  };
  const pos = GeoJSONEngine.computeFeatureVisualLabelPosition(lShapedPolygon);
  assert(pos && Number.isFinite(pos.lon) && Number.isFinite(pos.lat));
  assert(GeoJSONEngine.isPointInRing(pos.lon, pos.lat, lShapedPolygon.coordinates[0]), 'Visual label point is inside polygon');
});

// 7. Automatic Camera Framing
runTest('Computes camera framing encompassing all features with padding', () => {
  const feat1 = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [10, 20] }
  };
  const feat2 = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [15, 25] }
  };
  const framing = GeoJSONEngine.computeCameraFramingForFeatures([feat1, feat2], 1920, 1080, 0.15);
  assert(framing && Number.isFinite(framing.lat) && Number.isFinite(framing.lon) && Number.isFinite(framing.zoom));
  assert(framing.lat >= 19 && framing.lat <= 26);
  assert(framing.lon >= 9 && framing.lon <= 16);
});

// 8. VectorMapManager Custom Payload Construction
runTest('VectorMapManager builds custom payload for Unified Bloc mode with 3D labels', () => {
  const app = { mapState: { longitude: 0 } };
  const manager = new VectorMapManager(app);
  const validation = {
    ok: true,
    features: [
      {
        type: 'Feature',
        properties: { name: 'Algeria' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }
      },
      {
        type: 'Feature',
        properties: { name: 'Tunisia' },
        geometry: { type: 'Polygon', coordinates: [[[2, 0], [3, 0], [3, 2], [2, 2], [2, 0]]] }
      }
    ]
  };

  const importConfig = {
    mode: 'bloc',
    blocName: 'Arab Maghreb Union',
    blocColor: '#10b981',
    selectedFeatures: validation.features,
    createLabels: true,
    autoSimplify: true
  };

  const payload = manager._buildGeoJSONPayload(validation, 'maghreb.geojson', { importConfig });
  assert.strictEqual(payload.displayName, 'Arab Maghreb Union');
  assert.strictEqual(payload.layers.length, 1);
  assert.strictEqual(payload.layers[0].features[0].name, 'Arab Maghreb Union');
  assert.strictEqual(payload.labels.length, 1);
  assert.strictEqual(payload.labels[0].name, 'Arab Maghreb Union');
  assert(payload.anchor && Number.isFinite(payload.anchor.lat));
});

runTest('VectorMapManager builds custom payload for Separate Features mode', () => {
  const app = { mapState: { longitude: 0 } };
  const manager = new VectorMapManager(app);
  const validation = {
    ok: true,
    features: [
      {
        type: 'Feature',
        properties: { name: 'Algeria' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
      },
      {
        type: 'Feature',
        properties: { name: 'Morocco' },
        geometry: { type: 'Polygon', coordinates: [[[-2, 0], [-1, 0], [-1, 1], [-2, 1], [-2, 0]]] }
      }
    ]
  };

  const importConfig = {
    mode: 'separate',
    selectedFeatures: validation.features,
    featureMetas: [
      { name: 'Algeria', fillColor: '#10b981', fillOpacity: 70 },
      { name: 'Morocco', fillColor: '#f43f5e', fillOpacity: 80 }
    ],
    createLabels: true,
    autoSimplify: false
  };

  const payload = manager._buildGeoJSONPayload(validation, 'countries.geojson', { importConfig });
  assert.strictEqual(payload.layers.length, 2, 'Two separate layers created');
  assert.strictEqual(payload.layers[0].features[0].name, 'Algeria');
  assert.strictEqual(payload.layers[1].features[0].name, 'Morocco');
  assert.strictEqual(payload.labels.length, 2, 'Two 3D text labels created');
});

// 9. FeatureManager.payloadToGeoJSONFeatures & Mercator back-projection
runTest('FeatureManager.payloadToGeoJSONFeatures converts Mercator rings into valid WGS84 GeoJSON features', () => {
  const FeatureRegistry = require(path.resolve(__dirname, '../../../client/js/core/FeatureRegistry.js'));
  const FeatureManager = require(path.resolve(__dirname, '../../../client/js/core/FeatureManager.js'));
  const app = { session: {}, jobManager: null };
  const manager = new FeatureManager(app, new FeatureRegistry());

  const p1 = GeoJSONEngine.latLngToWorldPoint(36.0, 3.0);
  const p2 = GeoJSONEngine.latLngToWorldPoint(36.0, 4.0);
  const p3 = GeoJSONEngine.latLngToWorldPoint(37.0, 4.0);
  const p4 = GeoJSONEngine.latLngToWorldPoint(37.0, 3.0);

  const payload = {
    displayName: 'Test Map',
    layers: [{
      features: [{
        name: 'Region',
        rings: [[p1, p2, p3, p4, p1]]
      }]
    }]
  };

  const geoFeats = manager.payloadToGeoJSONFeatures(payload);
  assert.strictEqual(geoFeats.length, 1);
  assert.strictEqual(geoFeats[0].type, 'Feature');
  assert.strictEqual(geoFeats[0].geometry.type, 'Polygon');
  const ring = geoFeats[0].geometry.coordinates[0];
  assert.strictEqual(ring.length, 5);
  assert(Math.abs(ring[0][0] - 3.0) < 1e-4);
  assert(Math.abs(ring[0][1] - 36.0) < 1e-4);
});

// 10. Non-destructive merge of drawn maps in FeatureManager
runTest('mergeFeaturesIntoBloc creates a new unified layer without deleting or mutating source features', async () => {
  const FeatureRegistry = require(path.resolve(__dirname, '../../../client/js/core/FeatureRegistry.js'));
  const FeatureManager = require(path.resolve(__dirname, '../../../client/js/core/FeatureManager.js'));
  const registry = new FeatureRegistry();

  const pA1 = GeoJSONEngine.latLngToWorldPoint(30.0, 0.0);
  const pA2 = GeoJSONEngine.latLngToWorldPoint(30.0, 1.0);
  const pA3 = GeoJSONEngine.latLngToWorldPoint(31.0, 1.0);
  const pA4 = GeoJSONEngine.latLngToWorldPoint(31.0, 0.0);

  const pB1 = GeoJSONEngine.latLngToWorldPoint(30.0, 1.0);
  const pB2 = GeoJSONEngine.latLngToWorldPoint(30.0, 2.0);
  const pB3 = GeoJSONEngine.latLngToWorldPoint(31.0, 2.0);
  const pB4 = GeoJSONEngine.latLngToWorldPoint(31.0, 1.0);

  const mapA = {
    id: 'map-a',
    name: 'Map Alpha',
    type: 'geojson',
    previewPayload: {
      displayName: 'Map Alpha',
      layers: [{ features: [{ name: 'A', rings: [[pA1, pA2, pA3, pA4, pA1]] }] }]
    }
  };
  const mapB = {
    id: 'map-b',
    name: 'Map Beta',
    type: 'geojson',
    previewPayload: {
      displayName: 'Map Beta',
      layers: [{ features: [{ name: 'B', rings: [[pB1, pB2, pB3, pB4, pB1]] }] }]
    }
  };

  registry.upsert(mapA);
  registry.upsert(mapB);

  const mockVectorMapManager = {
    drawGeoJSONInAE: async (validation, options) => {
      registry.upsert({
        id: 'merged-bloc-1',
        name: options.name,
        type: 'geojson',
        previewPayload: {}
      });
      return { success: true };
    }
  };

  const app = {
    activeCompId: 'comp-1',
    session: {},
    jobManager: null,
    vectorMapManager: mockVectorMapManager
  };
  const manager = new FeatureManager(app, registry);

  const result = await manager.mergeFeaturesIntoBloc(['map-a', 'map-b'], {
    name: 'Unified Alpha Beta',
    color: '#3b82f6'
  });

  assert.strictEqual(result.blocName, 'Unified Alpha Beta');
  // Source maps are preserved!
  assert(registry.get('map-a'), 'Source map A must be preserved');
  assert(registry.get('map-b'), 'Source map B must be preserved');
  // New merged map is added!
  assert(registry.get('merged-bloc-1'), 'New merged bloc must be registered');
  assert.strictEqual(registry.list().length, 3);
});

// 12. Single Shape unified bloc dissolves borders into exactly one ring
runTest('Unified Bloc with singleShape dissolves shared border into exactly one AE shape ring', () => {
  const app = { mapState: { longitude: 0 } };
  const manager = new VectorMapManager(app);
  // Two touching polygons + 1 small detached island
  const validation = {
    ok: true,
    features: [
      {
        type: 'Feature',
        properties: { name: 'Mainland A' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }
      },
      {
        type: 'Feature',
        properties: { name: 'Mainland B' },
        geometry: { type: 'Polygon', coordinates: [[[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]] }
      },
      {
        type: 'Feature',
        properties: { name: 'Detached Island' },
        geometry: { type: 'Polygon', coordinates: [[[10, 10], [10.1, 10], [10.1, 10.1], [10, 10.1], [10, 10]]] }
      }
    ]
  };

  const importConfig = {
    mode: 'bloc',
    blocName: 'Merged Country',
    selectedFeatures: validation.features,
    singleShape: true
  };

  const payload = manager._buildGeoJSONPayload(validation, 'merged.geojson', { importConfig });
  assert.strictEqual(payload.layers.length, 1);
  assert.strictEqual(payload.layers[0].features.length, 1);
  // With singleShape: true, exactly one ring (Path 1) is created, retaining the dissolved mainland
  assert.strictEqual(payload.layers[0].features[0].rings.length, 1, 'Must have exactly 1 shape ring in AE');
});

console.log('====================================');
console.log(`GeoJSON Elevation Tests: Passed: ${passed} | Failed: ${failed}`);
console.log('====================================');

if (failed > 0) process.exit(1);

if (failed > 0) {
  process.exit(1);
}
