const assert = require('assert');
const path = require('path');
const UniversalGeoParser = require('../../../client/js/map/UniversalGeoParser');

console.log('====================================');
console.log('OpenGeo Universal Geo Parser Test Suite');
console.log('====================================');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

// 1. Google Maps Web @lat,lng,zoom
test('Google Maps standard @lat,lng,zoom', () => {
  const url = 'https://www.google.com/maps/@36.752887,3.042048,15z';
  const res = UniversalGeoParser.parse(url);
  assert(res && res.valid, 'Should parse successfully');
  assert.strictEqual(res.source, 'Google Maps');
  assert.strictEqual(res.lat, 36.752887);
  assert.strictEqual(res.lng, 3.042048);
  assert.strictEqual(res.zoom, 15);
});

// 2. Google Maps with Meters @lat,lng,meters
test('Google Maps with meters scale (@lat,lng,1500m)', () => {
  const url = 'https://www.google.com/maps/@29.9792,31.1342,1500m/data=!3m1!1e3';
  const res = UniversalGeoParser.parse(url);
  assert(res && res.valid, 'Should parse meters URL');
  assert.strictEqual(res.lat, 29.9792);
  assert.strictEqual(res.lng, 31.1342);
  assert(res.zoom >= 14 && res.zoom <= 16, `Zoom should be approx 15, got ${res.zoom}`);
});

// 3. Google Maps Place URL with Embedded Protobuf !3d/!4d
test('Google Maps Place with embedded !3d/!4d data', () => {
  const url = 'https://www.google.com/maps/place/Eiffel+Tower/@48.8583736,2.2922926,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813!16zL20vMDJqOTE';
  const res = UniversalGeoParser.parse(url);
  assert(res && res.valid, 'Should parse embedded place coordinates');
  assert.strictEqual(res.lat, 48.8583701);
  assert.strictEqual(res.lng, 2.2944813);
  assert.strictEqual(res.placeName, 'Eiffel Tower');
});

// 4. Google Maps Query URL (?q=lat,lng)
test('Google Maps query param (?q=lat,lng)', () => {
  const url = 'https://maps.google.com/?q=40.7128,-74.0060&z=12';
  const res = UniversalGeoParser.parse(url);
  assert(res && res.valid, 'Should parse query params');
  assert.strictEqual(res.lat, 40.7128);
  assert.strictEqual(res.lng, -74.006);
  assert.strictEqual(res.zoom, 12);
});

// 5. Google Maps Mobile Shortlinks
test('Google Maps shortlinks (maps.app.goo.gl and goo.gl/maps)', () => {
  const url1 = 'https://maps.app.goo.gl/ABCDEF12345';
  const res1 = UniversalGeoParser.parse(url1);
  assert(res1 && res1.isShortlink, 'Should identify mobile shortlink');

  const url2 = 'https://goo.gl/maps/XYZ98765';
  const res2 = UniversalGeoParser.parse(url2);
  assert(res2 && res2.isShortlink, 'Should identify goo.gl shortlink');
});

// 6. Apple Maps
test('Apple Maps (?ll=lat,lng&z=zoom)', () => {
  const url = 'https://maps.apple.com/?ll=37.7749,-122.4194&z=16';
  const res = UniversalGeoParser.parse(url);
  assert(res && res.valid, 'Should parse Apple Maps');
  assert.strictEqual(res.source, 'Apple Maps');
  assert.strictEqual(res.lat, 37.7749);
  assert.strictEqual(res.lng, -122.4194);
  assert.strictEqual(res.zoom, 16);
});

// 7. OpenStreetMap (#map=zoom/lat/lng and ?mlat=lat&mlon=lng)
test('OpenStreetMap hash format and query format', () => {
  const hashUrl = 'https://www.openstreetmap.org/#map=16/51.5074/-0.1278';
  const hashRes = UniversalGeoParser.parse(hashUrl);
  assert(hashRes && hashRes.valid, 'Should parse OSM hash format');
  assert.strictEqual(hashRes.source, 'OpenStreetMap');
  assert.strictEqual(hashRes.lat, 51.5074);
  assert.strictEqual(hashRes.lng, -0.1278);
  assert.strictEqual(hashRes.zoom, 16);

  const queryUrl = 'https://www.openstreetmap.org/?mlat=48.8566&mlon=2.3522&zoom=14';
  const queryRes = UniversalGeoParser.parse(queryUrl);
  assert(queryRes && queryRes.valid, 'Should parse OSM query format');
  assert.strictEqual(queryRes.lat, 48.8566);
  assert.strictEqual(queryRes.lng, 2.3522);
  assert.strictEqual(queryRes.zoom, 14);
});

// 8. Google Earth Web
test('Google Earth Web (@lat,lng)', () => {
  const url = 'https://earth.google.com/web/@35.6895,139.6917,100a,500d,35y,0h';
  const res = UniversalGeoParser.parse(url);
  assert(res && res.valid, 'Should parse Google Earth');
  assert.strictEqual(res.source, 'Google Earth');
  assert.strictEqual(res.lat, 35.6895);
  assert.strictEqual(res.lng, 139.6917);
});

// 9. Bing Maps
test('Bing Maps (?cp=lat~lng&lvl=zoom)', () => {
  const url = 'https://www.bing.com/maps?cp=52.5200~13.4050&lvl=13';
  const res = UniversalGeoParser.parse(url);
  assert(res && res.valid, 'Should parse Bing Maps');
  assert.strictEqual(res.source, 'Bing Maps');
  assert.strictEqual(res.lat, 52.5200);
  assert.strictEqual(res.lng, 13.4050);
  assert.strictEqual(res.zoom, 13);
});

// 10. Yandex Maps
test('Yandex Maps (?ll=lng,lat convention)', () => {
  const url = 'https://yandex.com/maps/?ll=37.6173%2C55.7558&z=12';
  const res = UniversalGeoParser.parse(url);
  assert(res && res.valid, 'Should parse Yandex Maps');
  assert.strictEqual(res.source, 'Yandex Maps');
  assert.strictEqual(res.lat, 55.7558);
  assert.strictEqual(res.lng, 37.6173);
  assert.strictEqual(res.zoom, 12);
});

// 11. Geo URI (RFC 5870)
test('Geo URI (geo:lat,lng?z=zoom)', () => {
  const uri = 'geo:33.8688,151.2093?z=15';
  const res = UniversalGeoParser.parse(uri);
  assert(res && res.valid, 'Should parse Geo URI');
  assert.strictEqual(res.source, 'Geo URI');
  assert.strictEqual(res.lat, 33.8688);
  assert.strictEqual(res.lng, 151.2093);
  assert.strictEqual(res.zoom, 15);
});

// 12. GPS Coordinates: DMS (Degrees Minutes Seconds)
test('GPS DMS coordinates (36°45\'10.4"N 3°02\'31.4"E)', () => {
  const dms = '36°45\'10.4"N 3°02\'31.4"E';
  const res = UniversalGeoParser.parse(dms);
  assert(res && res.valid, 'Should parse DMS');
  assert.strictEqual(res.source, 'GPS Coordinates (DMS)');
  assert(Math.abs(res.lat - 36.752889) < 0.0001, `Lat should match: ${res.lat}`);
  assert(Math.abs(res.lng - 3.042056) < 0.0001, `Lng should match: ${res.lng}`);
});

// 13. GPS Coordinates: DDM (Degrees Decimal Minutes)
test('GPS DDM coordinates (36° 45.173\' N, 3° 02.523\' E)', () => {
  const ddm = "36° 45.173' N, 3° 02.523' E";
  const res = UniversalGeoParser.parse(ddm);
  assert(res && res.valid, 'Should parse DDM');
  assert.strictEqual(res.source, 'GPS Coordinates (DDM)');
  assert(Math.abs(res.lat - 36.752883) < 0.0001, `Lat should match: ${res.lat}`);
  assert(Math.abs(res.lng - 3.042050) < 0.0001, `Lng should match: ${res.lng}`);
});

// 14. Decimal Degrees (DD) with Cardinals or Comma
test('Decimal Degrees (DD) in various notations', () => {
  // Simple pair
  const r1 = UniversalGeoParser.parse('36.752887, 3.042048');
  assert(r1 && r1.valid && r1.lat === 36.752887 && r1.lng === 3.042048);

  // With cardinal directions
  const r2 = UniversalGeoParser.parse('36.752887 N, 3.042048 E');
  assert(r2 && r2.valid && r2.lat === 36.752887 && r2.lng === 3.042048);

  // South and West negative coordinates
  const r3 = UniversalGeoParser.parse('33.8688 S, 151.2093 E');
  assert(r3 && r3.valid && r3.lat === -33.8688 && r3.lng === 151.2093);

  // In brackets with zoom
  const r4 = UniversalGeoParser.parse('[36.752887, 3.042048, 16z]');
  assert(r4 && r4.valid && r4.lat === 36.752887 && r4.lng === 3.042048 && r4.zoom === 16);
});

// 15. Invalid or Unrelated text
test('Rejects non-coordinate search queries safely', () => {
  assert.strictEqual(UniversalGeoParser.parse('Paris, France'), null);
  assert.strictEqual(UniversalGeoParser.parse('Tokyo Tower'), null);
  assert.strictEqual(UniversalGeoParser.parse(''), null);
  assert.strictEqual(UniversalGeoParser.parse(null), null);
});

console.log('====================================');
console.log(`Universal Geo Parser Tests: Passed: ${passed} | Failed: ${failed}`);
console.log('====================================');

if (failed > 0) process.exit(1);
