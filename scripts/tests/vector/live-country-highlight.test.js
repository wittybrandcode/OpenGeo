'use strict';

/**
 * OpenGeo — Live Country Highlight & Instant Vector Preview Test Suite
 *
 * Validates:
 *  1. Multilingual country resolution (Arabic, English, ISO2, ISO3, full names).
 *  2. Robustness to Arabic variations (hamzas, diacritics, teh marbuta).
 *  3. CountryHighlightLayer state lifecycle (setHighlight, clearHighlight, autoFit).
 *  4. Coordinate math and bounding box calculation.
 *  5. Canvas 2D rendering safety (paths, glow, floating badge).
 *  6. Event contract compliance for 'search:countryHighlight'.
 */

const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const GeoDataRepository = require(path.join(root, 'client', 'js', 'core', 'GeoDataRepository.js'));
const GeographyIdentityResolver = require(path.join(root, 'client', 'js', 'core', 'GeographyIdentityResolver.js'));
const MercatorProjection = require(path.join(root, 'client', 'js', 'map', 'MercatorProjection.js'));
global.MercatorProjection = MercatorProjection;
const CountryHighlightLayer = require(path.join(root, 'client', 'js', 'overlays', 'CountryHighlightLayer.js'));
const EventContracts = require(path.join(root, 'client', 'js', 'events', 'EventContracts.js'));

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${e.message}`);
    failed++;
  }
}

console.log('--- Testing Live Country Highlight & Instant Vector Preview ---');

const repo = new GeoDataRepository();
const resolver = new GeographyIdentityResolver(repo);

runTest('GeographyIdentityResolver resolves Arabic country names accurately', () => {
  const tests = [
    { query: 'الجزائر', expected: 'DZA' },
    { query: 'مصر', expected: 'EGY' },
    { query: 'فرنسا', expected: 'FRA' },
    { query: 'تونس', expected: 'TUN' },
    { query: 'السعودية', expected: 'SAU' },
    { query: 'المملكة العربية السعودية', expected: 'SAU' },
    { query: 'المانيا', expected: 'DEU' },
    { query: 'ألمانيا', expected: 'DEU' },
    { query: 'امريكا', expected: 'USA' },
    { query: 'أمريكا', expected: 'USA' },
    { query: 'الولايات المتحدة', expected: 'USA' },
    { query: 'روسيا', expected: 'RUS' },
    { query: 'تركيا', expected: 'TUR' },
    { query: 'اليابان', expected: 'JPN' }
  ];

  for (const t of tests) {
    const res = resolver.resolveCountryQuery(t.query);
    assert(res, `Expected match for query "${t.query}"`);
    assert.strictEqual(res.iso3, t.expected, `Query "${t.query}" resolved to ${res.iso3}, expected ${t.expected}`);
  }
});

runTest('GeographyIdentityResolver resolves English and ISO country codes', () => {
  const tests = [
    { query: 'Algeria', expected: 'DZA' },
    { query: 'algeria', expected: 'DZA' },
    { query: 'DZA', expected: 'DZA' },
    { query: 'dz', expected: 'DZA' },
    { query: 'France', expected: 'FRA' },
    { query: 'france', expected: 'FRA' },
    { query: 'FRA', expected: 'FRA' },
    { query: 'FR', expected: 'FRA' },
    { query: 'Egypt', expected: 'EGY' },
    { query: 'EGY', expected: 'EGY' },
    { query: 'United States', expected: 'USA' },
    { query: 'USA', expected: 'USA' }
  ];

  for (const t of tests) {
    const res = resolver.resolveCountryQuery(t.query);
    assert(res, `Expected match for query "${t.query}"`);
    assert.strictEqual(res.iso3, t.expected, `Query "${t.query}" resolved to ${res.iso3}, expected ${t.expected}`);
  }
});

runTest('GeographyIdentityResolver rejects non-country queries cleanly', () => {
  const negatives = ['', 'a', 'x', 'Paris', 'street 42', 'xyz_invalid_name'];
  for (const q of negatives) {
    const res = resolver.resolveCountryQuery(q);
    assert.strictEqual(res, null, `Query "${q}" should not resolve to a country`);
  }
});

runTest('GeographyIdentityResolver formats country names strictly as Arabic space English', () => {
  const tests = [
    { iso3: 'DZA', expected: 'الجزائر Algeria' },
    { iso3: 'EGY', expected: 'مصر Egypt' },
    { iso3: 'FRA', expected: 'فرنسا France' },
    { iso3: 'SAU', expected: 'السعودية Saudi Arabia' },
    { iso3: 'TUN', expected: 'تونس Tunisia' }
  ];

  for (const t of tests) {
    const formatted = resolver.formatCountryName(t.iso3);
    assert.strictEqual(formatted, t.expected, `Formatted country for ${t.iso3} should be "${t.expected}", got "${formatted}"`);
    assert(!/[•()/\-_]/.test(formatted), `Country name "${formatted}" must not contain symbols or bullets`);
  }

  // Also test resolution and formatting for country item
  const mockCountryItem = {
    name: 'Algeria',
    display_name: 'Algeria',
    class: 'boundary',
    type: 'administrative',
    addresstype: 'country'
  };
  const decision = resolver.resolve(mockCountryItem, 'Algeria');
  assert.strictEqual(decision.drawingIso3, 'DZA');
  assert(resolver.isCountryItem(mockCountryItem, decision.drawingIso3), 'mockCountryItem must be recognized as country');
  assert.strictEqual(resolver.formatCountryName(decision.drawingIso3), 'الجزائر Algeria');
});

runTest('CountryHighlightLayer computes bounds and stores country outline', () => {
  let fitBoundsCalled = false;
  let fitted = null;

  const mockViewport = {
    zoom: 5,
    tileSize: 256,
    width: 800,
    height: 600,
    centerLat: 28,
    centerLng: 3,
    fitBounds: (s, n, w, e, p) => {
      fitBoundsCalled = true;
      fitted = { south: s, north: n, west: w, east: e, padding: p };
    }
  };

  const layer = new CountryHighlightLayer(mockViewport, repo);
  assert.strictEqual(layer.getHighlight(), null, 'Initially highlight must be null');

  layer.setHighlight('DZA', true);
  const hl = layer.getHighlight();
  assert(hl, 'Highlight must be set for DZA');
  assert.strictEqual(hl.iso3, 'DZA');
  assert(hl.features.length >= 1, 'DZA must have features');
  assert(hl.bounds, 'DZA must have computed bounds');
  assert(hl.bounds.north > hl.bounds.south, 'North bound must be greater than South');
  assert(fitBoundsCalled, 'fitBounds must be called when autoFit is true');
  assert.strictEqual(fitted.padding, 48);

  // Clear highlight
  layer.clearHighlight();
  assert.strictEqual(layer.getHighlight(), null, 'clearHighlight must reset highlight');
});

runTest('CountryHighlightLayer renders smoothly without errors on mock 2D context', () => {
  const mockViewport = {
    zoom: 5,
    tileSize: 256,
    width: 800,
    height: 600,
    centerLat: 28,
    centerLng: 3,
    fitBounds: () => {}
  };

  const drawCalls = [];
  const mockCtx = {
    save: () => drawCalls.push('save'),
    restore: () => drawCalls.push('restore'),
    beginPath: () => drawCalls.push('beginPath'),
    closePath: () => drawCalls.push('closePath'),
    moveTo: (x, y) => drawCalls.push(`moveTo(${Math.round(x)},${Math.round(y)})`),
    lineTo: (x, y) => drawCalls.push(`lineTo(${Math.round(x)},${Math.round(y)})`),
    quadraticCurveTo: () => drawCalls.push('quadraticCurveTo'),
    arc: () => drawCalls.push('arc'),
    fill: () => drawCalls.push('fill'),
    stroke: () => drawCalls.push('stroke'),
    fillText: (text) => drawCalls.push(`fillText(${text})`),
    measureText: (text) => ({ width: text.length * 7 })
  };

  // Attach MercatorProjection to global if not already present
  if (typeof global.MercatorProjection === 'undefined') {
    global.MercatorProjection = MercatorProjection;
  }

  const layer = new CountryHighlightLayer(mockViewport, repo);
  layer.setHighlight('DZA', false);
  layer.render(mockCtx);

  assert(drawCalls.length > 10, 'Render must produce draw calls');
  assert(drawCalls.includes('fill'), 'Render must include fill for polygon and badge');
  assert(drawCalls.includes('stroke'), 'Render must include stroke for glowing outline');
  const fillTextCalls = drawCalls.filter(c => c.startsWith('fillText'));
  assert(fillTextCalls.includes('fillText(الجزائر Algeria)'), 'Badge text must be strictly "الجزائر Algeria"');
  assert(!fillTextCalls.some(c => c.includes('•')), 'Badge text must not contain bullet symbol');
});

runTest('EventContracts validates search:countryHighlight event specifications', () => {
  assert(EventContracts.isKnown('search:countryHighlight'), 'search:countryHighlight must be a known event');
  assert.strictEqual(EventContracts.events.SEARCH_COUNTRY_HIGHLIGHT, 'search:countryHighlight');

  assert(EventContracts.isValid('search:countryHighlight', null), 'Null payload (clear) must be valid');
  assert(EventContracts.isValid('search:countryHighlight', { countryCode: 'DZA' }), 'Object with countryCode must be valid');
  assert(EventContracts.isValid('search:countryHighlight', { countryCode: 'DZA', country: {}, autoFit: true }), 'Full payload must be valid');

  assert(!EventContracts.isValid('search:countryHighlight', {}), 'Empty object without countryCode must be invalid');
  assert(!EventContracts.isValid('search:countryHighlight', 'invalid'), 'String payload must be invalid');
});

runTest('CountryHighlightLayer zoomToHighlight fits bounds when highlight is active', () => {
  let fitBoundsCalled = false;
  let fittedPadding = 0;
  const mockViewport = {
    zoom: 5,
    tileSize: 256,
    width: 800,
    height: 600,
    fitBounds: (s, n, w, e, p) => {
      fitBoundsCalled = true;
      fittedPadding = p;
    }
  };

  const layer = new CountryHighlightLayer(mockViewport, repo);
  assert.strictEqual(layer.zoomToHighlight(), false, 'zoomToHighlight must return false when no highlight');

  layer.setHighlight('DZA', false); // No auto-fit on typing
  assert.strictEqual(fitBoundsCalled, false, 'fitBounds must NOT be called on typing when autoFit is false');

  const jumped = layer.zoomToHighlight(48);
  assert.strictEqual(jumped, true, 'zoomToHighlight must return true when highlight is set');
  assert.strictEqual(fitBoundsCalled, true, 'fitBounds must be called upon explicit zoomToHighlight');
  assert.strictEqual(fittedPadding, 48, 'Padding must match 48');
});

runTest('EventContracts validates search:countryJump event specifications', () => {
  assert(EventContracts.isKnown('search:countryJump'), 'search:countryJump must be a known event');
  assert.strictEqual(EventContracts.events.SEARCH_COUNTRY_JUMP, 'search:countryJump');
  assert(EventContracts.isValid('search:countryJump', { countryCode: 'DZA' }), 'Valid country jump payload');
  assert(!EventContracts.isValid('search:countryJump', null), 'Null payload must be invalid');
  assert(!EventContracts.isValid('search:countryJump', {}), 'Empty object must be invalid');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
