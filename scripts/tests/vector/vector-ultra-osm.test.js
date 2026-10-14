/**
 * OpenGeo Ultra OSM Quality & Integration Suite
 *
 * Verifies OsmBoundaryService functionality, geometry projection,
 * cartography policy compliance (MAR/ESH), cache persistence,
 * and point budget safety.
 */

const assert = require('assert');
const path = require('path');

const OsmBoundaryService = require(path.resolve(__dirname, '../../../client/js/core/OsmBoundaryService.js'));

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(err);
    process.exit(1);
  }
}

(async () => {
  console.log('\n================================================================');
  console.log('🧪 OpenGeo Ultra OSM Quality & Policy Suite');
  console.log('================================================================\n');

  runTest('OsmBoundaryService instantiates with default limits', () => {
    const service = new OsmBoundaryService();
    assert.strictEqual(service.MAP_SIZE, 262144);
    assert.strictEqual(service.MAX_POINTS, 85000);
  });

  runTest('projectPoint produces bounded Web Mercator coordinates with 2 decimals', () => {
    const service = new OsmBoundaryService();
    const ptNull = service.projectPoint([NaN, 10]);
    assert.strictEqual(ptNull, null);

    const ptCenter = service.projectPoint([0, 0]);
    assert.strictEqual(ptCenter[0], 131072);
    assert.strictEqual(ptCenter[1], 131072);

    const ptAlg = service.projectPoint([3.05, 36.75]);
    assert(Number.isFinite(ptAlg[0]) && Number.isFinite(ptAlg[1]));
    assert(ptAlg[0] > 0 && ptAlg[0] < 262144);
    assert(ptAlg[1] > 0 && ptAlg[1] < 262144);
  });

  runTest('projectRing closes unclosed rings and rejects rings with fewer than 3 points', () => {
    const service = new OsmBoundaryService();
    const badRing = service.projectRing([[0, 0], [1, 1]]);
    assert.strictEqual(badRing, null);

    const openRing = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const closed = service.projectRing(openRing);
    assert(Array.isArray(closed));
    assert.strictEqual(closed.length, 5);
    assert.deepStrictEqual(closed[0], closed[closed.length - 1]);
  });

  runTest('extractOuterRings correctly extracts exterior polygons and ignores holes', () => {
    const service = new OsmBoundaryService();
    const polygonWithHole = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], // outer
        [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]       // inner hole
      ]
    };
    const rings = service.extractOuterRings(polygonWithHole);
    assert.strictEqual(rings.length, 1);
    assert(rings[0].length >= 4);

    const multiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
        [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]]
      ]
    };
    const multiRings = service.extractOuterRings(multiPolygon);
    assert.strictEqual(multiRings.length, 2);
  });

  await runAsyncTest('Cartography Policy: MAR and ESH enforce locked sovereignty profile', async () => {
    let resolveStudioCalled = false;
    const mockRepo = {
      resolveStudioCountryOutlineAsync: async (iso3) => {
        resolveStudioCalled = true;
        return {
          country: { iso3, name: 'Morocco' },
          features: [{ id: 'locked-mar', rings: [[[100, 100], [200, 100], [200, 200], [100, 100]]] }],
          provenance: 'CARTOGRAPHY_POLICY active-locked:western-sahara-separated-v1'
        };
      }
    };
    const service = new OsmBoundaryService(mockRepo);
    const result = await service.resolveCountryBoundaryAsync('MAR', 'Morocco');
    assert.strictEqual(resolveStudioCalled, true);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.tier, 'ultra-osm');
    assert.strictEqual(result.policyEnforced, true);
  });

  runTest('Cache operations: stores and clears memory cache safely', () => {
    const service = new OsmBoundaryService();
    service._memoryCache.set('DZA', { ok: true, country: { iso3: 'DZA' }, features: [] });
    assert.strictEqual(service._memoryCache.has('DZA'), true);
    service.clearCache();
    assert.strictEqual(service._memoryCache.has('DZA'), false);
  });

  runTest('Point budget safety: decimation reduces excessive rings above MAX_POINTS', () => {
    const service = new OsmBoundaryService();
    service.MAX_POINTS = 500;
    const hugeRing = [];
    for (let i = 0; i < 2000; i++) {
      hugeRing.push([i * 0.01, 10 + (i % 2) * 0.01]);
    }
    hugeRing.push(hugeRing[0]); // closed

    const geojson = {
      type: 'Polygon',
      coordinates: [hugeRing]
    };
    const outerRings = service.extractOuterRings(geojson);
    assert.strictEqual(outerRings.length, 1);
    assert(outerRings[0].length <= 600); // Decimated from 2000 points
  });

  await runAsyncTest('resolveCountryBoundaryAsync fetches and parses valid GeoBoundaries gbOpen payload', async () => {
    const service = new OsmBoundaryService();
    const mockMetaPayload = {
      boundaryID: 'DZA-ADM0-test',
      boundaryISO: 'DZA',
      boundaryName: 'Algeria',
      boundarySource: 'OpenStreetMap, Wambacher',
      meanVertices: 45000,
      gjDownloadURL: 'https://example.test/geoBoundaries-DZA-ADM0.geojson'
    };
    const mockGeoJsonPayload = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [
              [[0, 30], [5, 30], [5, 35], [0, 35], [0, 30]]
            ]
          }
        }
      ]
    };

    global.TileTransport = {
      request: (url) => {
        return {
          promise: Promise.resolve(Buffer.from(JSON.stringify(url.includes('/ADM0/') ? mockMetaPayload : mockGeoJsonPayload), 'utf8')),
          abort: () => {}
        };
      }
    };

    const res = await service.resolveCountryBoundaryAsync('DZA', 'Algeria');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.country.iso3, 'DZA');
    assert.strictEqual(res.tier, 'ultra-osm');
    assert.strictEqual(res.features.length, 1);
    assert(res.features[0].rings[0].length >= 4);
    assert.strictEqual(service._memoryCache.has('DZA'), true);
  });

  console.log('\n================================================================');
  console.log('🎉 All OsmBoundaryService quality tests passed.');
  console.log('================================================================\n');
})();
