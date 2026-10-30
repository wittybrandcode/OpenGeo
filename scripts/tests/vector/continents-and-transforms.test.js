const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..');
const continentsIndexPath = path.join(root, 'client', 'assets', 'data', 'vectors', 'continents-index-10m.json');
const continentsDir = path.join(root, 'client', 'assets', 'data', 'vectors', 'continents');

function runContinentsSuite() {
  console.log('[Test] Running Continents Outlines & Effect Controls Suite...');

  // 1. Verify index integrity
  assert(fs.existsSync(continentsIndexPath), 'continents-index-10m.json must exist');
  const index = JSON.parse(fs.readFileSync(continentsIndexPath, 'utf8'));
  assert.strictEqual(index.schemaVersion, '1.0.0', 'Schema version must be 1.0.0');
  assert.strictEqual(index.dataTier, 'continent50m', 'DataTier must be continent50m');
  assert(index.continentCount >= 8, 'Must have at least 8 continent entries (7 continents + WLD)');

  const requiredCodes = ['AFR', 'ASI', 'EUR', 'NAM', 'SAM', 'OCE', 'ATA', 'WLD'];
  for (const code of requiredCodes) {
    assert(index.continents[code], `Index must contain continent ${code}`);
    const entry = index.continents[code];
    assert(entry.name, `Continent ${code} must have an English name`);
    assert(entry.nameAr, `Continent ${code} must have an Arabic name`);
    assert(entry.pointCount > 0, `Continent ${code} must have points`);
    assert(entry.ringCount > 0, `Continent ${code} must have rings`);
    assert(Array.isArray(entry.aliases) && entry.aliases.length > 0, `Continent ${code} must have aliases`);

    // Verify individual continent payload file
    const payloadFile = path.join(continentsDir, `${code}.json`);
    assert(fs.existsSync(payloadFile), `File ${payloadFile} must exist`);
    const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
    assert.strictEqual(payload.code, code, `Payload code must match ${code}`);
    assert(Array.isArray(payload.features) && payload.features.length > 0, `Payload must contain features`);
    assert(Array.isArray(payload.features[0].rings), `Feature must have rings`);
    assert.strictEqual(payload.features[0].rings.length, entry.ringCount, `Ring count must match index`);
  }

  // 2. Test GeographyIdentityResolver resolution
  const GeographyIdentityResolver = require(path.join(root, 'client', 'js', 'core', 'GeographyIdentityResolver.js'));
  const dummyRepo = {
    loadDataset: (file) => {
      const fullPath = path.join(root, 'client', 'assets', 'data', file);
      return fs.existsSync(fullPath) ? JSON.parse(fs.readFileSync(fullPath, 'utf8')) : null;
    }
  };
  const resolver = new GeographyIdentityResolver(dummyRepo);

  const testQueries = [
    { q: 'افريقيا', expected: 'AFR' },
    { q: 'أفريقيا', expected: 'AFR' },
    { q: 'Africa', expected: 'AFR' },
    { q: 'قارة افريقيا', expected: 'AFR' },
    { q: 'آسيا', expected: 'ASI' },
    { q: 'Asia', expected: 'ASI' },
    { q: 'أوروبا', expected: 'EUR' },
    { q: 'Europe', expected: 'EUR' },
    { q: 'North America', expected: 'NAM' },
    { q: 'امريكا الشمالية', expected: 'NAM' },
    { q: 'South America', expected: 'SAM' },
    { q: 'امريكا الجنوبية', expected: 'SAM' },
    { q: 'Oceania', expected: 'OCE' },
    { q: 'أوقيانوسيا', expected: 'OCE' },
    { q: 'Antarctica', expected: 'ATA' },
    { q: 'انتاركتيكا', expected: 'ATA' },
    { q: 'كل القارات', expected: 'WLD' },
    { q: 'خريطة العالم بدون حدود', expected: 'WLD' },
    { q: 'World Landmass', expected: 'WLD' }
  ];

  for (const t of testQueries) {
    const res = resolver.resolveContinentQuery(t.q);
    assert(res, `Resolver should resolve query "${t.q}"`);
    assert.strictEqual(res.code, t.expected, `Query "${t.q}" should resolve to ${t.expected}, got ${res.code}`);
  }

  // 3. Verify GeoDataRepository continent methods
  const GeoDataRepository = require(path.join(root, 'client', 'js', 'core', 'GeoDataRepository.js'));
  const repo = new GeoDataRepository();
  repo.dataDir = path.join(root, 'client', 'assets', 'data');
  repo.fs = fs;
  repo.path = path;

  const afrSync = repo.getContinentOutline('AFR');
  assert(afrSync, 'repo.getContinentOutline("AFR") should return outline');
  assert.strictEqual(afrSync.continent.code, 'AFR', 'Continent code must be AFR');
  assert.strictEqual(afrSync.continent.nameAr, 'أفريقيا', 'Arabic name must be أفريقيا');
  assert(afrSync.features.length > 0, 'Must have features');

  // 4. Verify vectorHost.jsx and vectorStyleEngine.jsx Effect Controls rigging
  const vectorHostCode = fs.readFileSync(path.join(root, 'host', 'modules', 'vectorHost.jsx'), 'utf8');
  assert(vectorHostCode.includes('Position Offset'), 'vectorHost.jsx must include Position Offset control');
  assert(vectorHostCode.includes('Altitude (Z Offset)'), 'vectorHost.jsx must include Altitude (Z Offset) control');
  assert(vectorHostCode.includes('Scale Multiplier %'), 'vectorHost.jsx must include Scale Multiplier % control');
  assert(vectorHostCode.includes('Rotation Offset'), 'vectorHost.jsx must include Rotation Offset control');

  const vectorStyleCode = fs.readFileSync(path.join(root, 'host', 'modules', 'vector', 'vectorStyleEngine.jsx'), 'utf8');
  assert(vectorStyleCode.includes('Position Offset'), 'vectorStyleEngine.jsx must include Position Offset control');
  assert(vectorStyleCode.includes('Altitude (Z Offset)'), 'vectorStyleEngine.jsx must include Altitude (Z Offset) control');
  assert(vectorStyleCode.includes('Scale Multiplier %'), 'vectorStyleEngine.jsx must include Scale Multiplier % control');
  assert(vectorStyleCode.includes('Rotation Offset'), 'vectorStyleEngine.jsx must include Rotation Offset control');

  console.log('✅ [PASSED] Continents Outlines & Effect Controls Suite.');
}

runContinentsSuite();
