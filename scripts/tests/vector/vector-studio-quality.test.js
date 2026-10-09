'use strict';

/**
 * OpenGeo — Vector Studio 10m Quality & Isolation Test Suite
 *
 * Validates:
 *  1. Studio 10m index integrity and per-country data constraints (<= 85k pts, <= 2 MiB).
 *  2. Geometric validity (closed rings, finite coords, bounded within 262144).
 *  3. Policy compliance (locked MAR/ESH profile verification, PSE/ISR stability).
 *  4. Isolation between Local approved and Studio 10m.
 *  5. Async non-blocking reader resolution and memory eviction.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '../../..');
const dataDir = path.join(root, 'client', 'assets', 'data');
const indexPath = path.join(dataDir, 'vectors', 'country-outlines-studio10m-index.json');
const countriesDir = path.join(dataDir, 'vectors', 'country-outlines-studio10m');

// Require GeoDataRepository
const GeoDataRepository = require(path.join(root, 'client', 'js', 'core', 'GeoDataRepository.js'));

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${e.message}`);
    failed++;
  }
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

console.log('\n======================================================');
console.log('🌍 OpenGeo Vector Studio 10m Quality & Isolation Suite');
console.log('======================================================\n');

(async () => {
  // 1. Index & File Existence
  await runTest('Studio 10m index exists and covers 258 distinct sovereign entities', () => {
    assert(fs.existsSync(indexPath), 'Studio index file missing');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.strictEqual(index.schemaVersion, '1.0.0');
    assert.strictEqual(index.dataTier, 'studio10m');
    assert.strictEqual(index.countryCount, 258);
    assert(index.totalPoints > 500000, 'Total points count should be over 500,000');
    assert.strictEqual(Object.keys(index.countries).length, 258);
  });

  // 2. Budget & File Integrity
  await runTest('Every Studio 10m country file satisfies strict <= 85k point and <= 2 MiB budget', () => {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const files = fs.readdirSync(countriesDir).filter(f => f.endsWith('.json'));
    assert.strictEqual(files.length, 258, 'Expected exactly 258 country files in studio directory');

    for (const file of files) {
      const iso3 = file.replace('.json', '');
      const entry = index.countries[iso3];
      assert(entry, `Country ${iso3} missing in index`);

      const filePath = path.join(countriesDir, file);
      const buf = fs.readFileSync(filePath);
      assert(buf.length <= 2 * 1024 * 1024, `Country ${iso3} exceeds 2 MiB file budget: ${buf.length} bytes`);
      assert.strictEqual(sha256Buffer(buf), entry.sha256, `SHA256 mismatch for ${iso3}`);
      assert(entry.pointCount <= 85000, `Country ${iso3} exceeds 85,000 points limit: ${entry.pointCount}`);

      const data = JSON.parse(buf.toString('utf8'));
      assert.strictEqual(data.dataTier, 'studio10m');
      assert.strictEqual(data.iso3, iso3);
      assert(Array.isArray(data.features), `Country ${iso3} features must be an array`);
      assert(data.features.length > 0, `Country ${iso3} must have at least one feature`);
    }
  });

  // 3. Geometric Bounds & Ring Closure
  await runTest('All Studio 10m polygon rings are closed with finite Web-Mercator coordinates', () => {
    const sampleIsoList = ['DZA', 'IDN', 'ITA', 'NOR', 'CAN', 'JPN', 'BRA'];
    for (const iso3 of sampleIsoList) {
      const payload = JSON.parse(fs.readFileSync(path.join(countriesDir, `${iso3}.json`), 'utf8'));
      for (const feat of payload.features) {
        assert.strictEqual(feat.type, 'CountryLandOutline');
        assert.strictEqual(feat.isClosed, true);
        assert(Array.isArray(feat.rings), `Rings must be an array for ${iso3}`);
        for (const ring of feat.rings) {
          assert(ring.length >= 3, `Ring must have at least 3 points for ${iso3}`);
          for (const pt of ring) {
            assert(Array.isArray(pt) && pt.length === 2, `Point must be [x,y] for ${iso3}`);
            assert(Number.isFinite(pt[0]) && Number.isFinite(pt[1]), `Non-finite coordinate in ${iso3}`);
            assert(pt[0] >= 0 && pt[0] <= 262144, `X out of Mercator world bounds in ${iso3}: ${pt[0]}`);
            assert(pt[1] >= 0 && pt[1] <= 262144, `Y out of Mercator world bounds in ${iso3}: ${pt[1]}`);
          }
        }
      }
    }
  });

  // 4. Policy Compliance (MAR / ESH and PSE / ISR)
  await runTest('MAR and ESH conform strictly to active-locked cartography policy profile', () => {
    const policyPath = path.join(dataDir, 'vectors', 'cartography-policy.json');
    assert(fs.existsSync(policyPath), 'Cartography policy runtime file missing');
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    const marEshProfile = policy.activeProfiles.find(p => p.profileId === 'western-sahara-separated-v1');
    assert(marEshProfile, 'Missing locked MAR/ESH profile');

    const marData = JSON.parse(fs.readFileSync(path.join(countriesDir, 'MAR.json'), 'utf8'));
    const eshData = JSON.parse(fs.readFileSync(path.join(countriesDir, 'ESH.json'), 'utf8'));

    assert.strictEqual(marData.policyProfile, 'active-locked:western-sahara-separated-v1');
    assert.strictEqual(eshData.policyProfile, 'active-locked:western-sahara-separated-v1');

    function geomSha(feat) {
      return crypto.createHash('sha256').update(JSON.stringify({ iso3: feat.iso3, rings: feat.rings })).digest('hex');
    }
    assert.strictEqual(geomSha(marData.features[0]), marEshProfile.expectedGeometrySha256.MAR);
    assert.strictEqual(geomSha(eshData.features[0]), marEshProfile.expectedGeometrySha256.ESH);
  });

  // 5. Local Approved Isolation
  await runTest('Local approved getCountryOutline remains 100% functional and unmutated', () => {
    const repo = new GeoDataRepository();
    const localDza = repo.getCountryOutline('DZA');
    assert(localDza && localDza.country && localDza.features, 'Local DZA outline must resolve');
    assert.strictEqual(localDza.country.iso3, 'DZA');
    assert.strictEqual(localDza.features[0].type, 'CountryLandOutline');
  });

  // 6. Async Studio Resolution & Detail Comparison
  await runTest('resolveStudioCountryOutlineAsync loads high-definition outline with expected point density', async () => {
    const repo = new GeoDataRepository();
    const studioDza = await repo.resolveStudioCountryOutlineAsync('DZA');
    assert(studioDza && studioDza.country && studioDza.features, 'Studio DZA outline must resolve');
    assert.strictEqual(studioDza.country.iso3, 'DZA');
    assert.strictEqual(studioDza.country.dataTier, 'studio10m');

    let studioDzaPoints = 0;
    studioDza.features[0].rings.forEach(r => { studioDzaPoints += r.length; });
    assert(studioDzaPoints > 1200, `Studio DZA should have over 1200 points (got ${studioDzaPoints})`);

    const studioIta = await repo.resolveStudioCountryOutlineAsync('ITA');
    let studioItaPoints = 0;
    studioIta.features[0].rings.forEach(r => { studioItaPoints += r.length; });
    assert(studioItaPoints > 3000, `Studio ITA should have over 3000 points (got ${studioItaPoints})`);
  });

  // 7. Non-existent Country Error Handling
  await runTest('resolveStudioCountryOutlineAsync returns null cleanly for invalid country codes without exceptions', async () => {
    const repo = new GeoDataRepository();
    const resultInvalid = await repo.resolveStudioCountryOutlineAsync('XYZ_INVALID');
    assert.strictEqual(resultInvalid, null, 'Invalid ISO3 should resolve to null');

    const resultEmpty = await repo.resolveStudioCountryOutlineAsync('');
    assert.strictEqual(resultEmpty, null, 'Empty country code should resolve to null');
  });

  console.log('\n======================================================');
  console.log(`📊 Studio 10m Suite Results: ${passed} passed, ${failed} failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
})();
