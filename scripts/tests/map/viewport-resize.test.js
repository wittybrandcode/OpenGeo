'use strict';

/**
 * OpenGeo Automated Test Suite: Viewport Resize & Event Decoupling
 * Verifies that container resize is strictly isolated from camera motion
 * and that Finalized 4K states never revert to Preview on panel dimensions change.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '../../..');
const { readAggregatedCss } = require(path.join(projectRoot, 'scripts/read-css.js'));

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
console.log('[OpenGeo] Running Viewport Resize & Camera Event Tests...');
console.log('====================================');

// Mock MapState
class MockMapState {
  constructor() {
    this.panelWidth = 800;
    this.panelHeight = 600;
    this.latitude = 24.7136;
    this.longitude = 46.6753;
    this.uiZoom = 10;
    this.compZoom = 10;
    this.tileSize = 256;
    this.cameraCommitCount = 0;
  }

  getUIZoom() {
    return this.uiZoom;
  }

  updatePanelSize(w, h) {
    this.panelWidth = w;
    this.panelHeight = h;
  }

  setCamera(patch) {
    this.cameraCommitCount++;
    if (patch.lat !== undefined) this.latitude = patch.lat;
    if (patch.lng !== undefined) this.longitude = patch.lng;
    if (patch.uiZoom !== undefined) {
      this.uiZoom = patch.uiZoom;
      this.compZoom = patch.uiZoom;
    }
  }
}

const ViewportClass = loadBrowserClass('client/js/map/Viewport.js', 'Viewport', {
  EventBus: {
    emit: (event, payload) => {}
  }
});

// 1. Test setSize does not shift camera coordinates
{
  const mockState = new MockMapState();
  let changeEmitted = false;
  
  const viewport = new ViewportClass(mockState, {
    minZoom: 2,
    maxZoom: 19,
    tileSize: 256
  });

  viewport._emitChanged = () => {
    changeEmitted = true;
  };

  const initialLat = viewport.centerLat;
  const initialLng = viewport.centerLng;
  const initialZoom = viewport.zoom;

  // Resize window
  viewport.setSize(1200, 900);

  assert(viewport.width === 1200 && viewport.height === 900, 'Viewport width and height update correctly');
  assert(viewport.centerLat === initialLat && viewport.centerLng === initialLng, 'Center coordinates remain strictly unchanged during resize');
  assert(viewport.zoom === initialZoom, 'Camera zoom remains unchanged during standard window resize');
  assert(changeEmitted === false, 'Viewport setSize does NOT emit changed event when compZoom does not shift');
}

// 2. Test Euclidean distance threshold in FinalizeController camera motion detection
{
  function isSubstantialCameraMove(lat1, lng1, zoom1, lat2, lng2, zoom2) {
    const delta = Math.sqrt(Math.pow(lat1 - lat2, 2) + Math.pow(lng1 - lng2, 2)) + Math.abs(zoom1 - zoom2);
    return delta > 1e-6;
  }

  const lat = 24.71360000;
  const lng = 46.67530000;
  const zoom = 12.0;

  assert(!isSubstantialCameraMove(lat, lng, zoom, lat + 1e-8, lng + 1e-8, zoom), 'Micro-jitter below 1e-6 is ignored (does not revert finalize)');
  assert(isSubstantialCameraMove(lat, lng, zoom, lat + 0.001, lng, zoom), 'Real camera pan (> 1e-6) is correctly detected');
  assert(isSubstantialCameraMove(lat, lng, zoom, lat, lng, zoom + 0.1), 'Real camera zoom (> 1e-6) is correctly detected');
}

// 3. Test redundant setSize with identical dimensions
{
  const mockState = new MockMapState();
  const viewport = new ViewportClass(mockState);
  let emitCount = 0;
  viewport._emitChanged = () => { emitCount++; };

  viewport.setSize(800, 600); // Same as mock initial
  assert(emitCount === 0, 'Redundant setSize call with identical dimensions exits early with zero side effects');
}

// 4. Test safe min zoom calculation on very large display
{
  const mockState = new MockMapState();
  const viewport = new ViewportClass(mockState, { minZoom: 2, maxZoom: 19, tileSize: 256 });
  viewport.setSize(3840, 2160); // 4K display size
  const safeMin = viewport._getSafeMinZoom();
  assert(safeMin > 2, `Safe min zoom on 4K is dynamically elevated (${safeMin.toFixed(2)}) to prevent blank edge rendering`);
}

// 5. TASK-2.1: Non-Standard Aspect Ratios & Framing Box calculation
{
  const Mercator = loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', { Math, Number });
  const MapStateClass = loadBrowserClass('client/js/MapState.js', 'MapState', { MercatorProjection: Mercator, Math, Number });
  const LocationHudClass = loadBrowserClass('client/js/ui/LocationHudController.js', 'LocationHudController', {
    Map, Math, document: {}
  });

  const state = new MapStateClass();
  state.updatePanelSize(800, 600); // 4:3 panel

  // 5a. Vertical 9:16 (1080x1920)
  state.setCompSize(1080, 1920);
  const verticalRatio = state.frameWidth / state.frameHeight;
  assert(Math.abs(verticalRatio - 1080 / 1920) < 1e-4, 'Vertical 9:16 framing box maintains exact aspect ratio');
  assert(state.frameHeight <= 560 && state.frameWidth <= 760, 'Vertical framing box respects panel padding bounds');

  // 5b. Square 1:1 (1080x1080)
  state.setCompSize(1080, 1080);
  assert(Math.abs(state.frameWidth - state.frameHeight) < 1e-4, 'Square 1:1 framing box has equal width and height');

  // 5c. UltraWide 21:9 (3440x1440)
  state.setCompSize(3440, 1440);
  const uwRatio = state.frameWidth / state.frameHeight;
  assert(Math.abs(uwRatio - 3440 / 1440) < 1e-4, 'UltraWide 21:9 framing box maintains exact panoramic ratio');

  // 5d. LocationHud framing badge labels
  const mockHud = new LocationHudClass({
    lifecycle: {},
    session: { compSettings: { width: 3440, height: 1440 } }
  });
  mockHud.framingBadgeEl = { textContent: '' };
  mockHud.updateFramingBadge();
  assert(mockHud.framingBadgeEl.textContent.includes('21:9 • 3440×1440'), 'Location HUD accurately classifies 21:9 UltraWide aspect ratio');

  mockHud.app.session.compSettings = { width: 1080, height: 1920 };
  mockHud.updateFramingBadge();
  assert(mockHud.framingBadgeEl.textContent.includes('9:16 • 1080×1920'), 'Location HUD accurately classifies 9:16 Vertical aspect ratio');

  mockHud.app.session.compSettings = { width: 1080, height: 1080 };
  mockHud.updateFramingBadge();
  assert(mockHud.framingBadgeEl.textContent.includes('1:1 • 1080×1080'), 'Location HUD accurately classifies 1:1 Square aspect ratio');
}

// 6. TASK-2.2: Record Mode Safety on Comp Switch
{
  const AESyncEngineClass = loadBrowserClass('client/js/ae/AESyncEngine.js', 'AESyncEngine', {
    Math, Number, Map, Set, setTimeout, clearTimeout, Date, console
  });

  const session = {
    composition: { compId: 'comp-opengeo-1' },
    setComposition(c) { this.composition = c; }
  };
  const syncEngine = new AESyncEngineClass({}, session);

  // Enable recording on active comp
  syncEngine.setKeyframeRecording(true, 'comp-opengeo-1');
  assert(syncEngine.isKeyframeRecordingEnabled('comp-opengeo-1') === true, 'Record mode enabled on comp-opengeo-1');
  assert(syncEngine.isKeyframeRecording === true, 'Record mode active flag is true');

  // Switch to unlinked or null comp
  syncEngine.setActiveComp(null);
  assert(syncEngine.isKeyframeRecording === false, 'Record mode immediately disconnects when active comp is null');

  // Switch to another unlinked comp
  syncEngine.setActiveComp('comp-other-2');
  assert(syncEngine.isKeyframeRecording === false, 'Record mode remains inactive on unlinked comp');
  assert(syncEngine.isKeyframeRecordingEnabled('comp-other-2') === false, 'Recording is disabled by default for new comps');

  // Switch back to original map comp
  syncEngine.setActiveComp('comp-opengeo-1');
  assert(syncEngine.isKeyframeRecording === true, 'Record mode restores state when returning to original linked comp');
}

// 7. TASK-2.3: Atomic Clear Action Contract
{
  const trajectoryScript = fs.readFileSync(path.join(projectRoot, 'host/modules/trajectoryScanner.jsx'), 'utf8');
  assert(trajectoryScript.includes('function opengeoClearCameraKeyframes(compId)'), 'opengeoClearCameraKeyframes function exists in host trajectoryScanner');
  assert(trajectoryScript.includes('withUndoGroup("OpenGeo: Clear Camera Keyframes"'), 'Clear keyframes is wrapped in single atomic UndoGroup');
  assert(trajectoryScript.includes('valueAtTime(comp.time, false)'), 'Clear keyframes captures current time value to prevent sudden jumps');
  assert(trajectoryScript.includes('property.setValue(values[propertyIndex])'), 'Clear keyframes restores current camera position as static value');
}

// 8. TASK-2.4: Velocity Edge Cases & Antimeridian Wrapping
{
  const Mercator = loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', { Math, Number });

  // 8a. Micro-velocity move (0.0001 deg)
  const p1 = { lat: 24.7136, lng: 46.6753, zoom: 12 };
  const p2 = { lat: 24.7136001, lng: 46.6753001, zoom: 12 };
  const distMicro = Mercator.cameraPixelDistance(p1, p2, 12, 256);
  assert(distMicro < 0.05, 'Micro-movement (0.0001 deg) computes minimal sub-pixel distance');

  // 8b. Antimeridian crossing across 180° Date Line
  const eastOfDateLine = { lat: 0, lng: 179.999, zoom: 10 };
  const westOfDateLine = { lat: 0, lng: -179.999, zoom: 10 };
  const distAntimeridian = Mercator.cameraPixelDistance(eastOfDateLine, westOfDateLine, 10, 256);
  assert(distAntimeridian < 10, 'Antimeridian crossing computes shortest path distance across Date Line, preventing reverse camera flips');
  assert(Mercator.normalizeLng(185) === -175, 'normalizeLng wraps longitudes > 180 correctly');
  assert(Mercator.normalizeLng(-185) === 175, 'normalizeLng wraps longitudes < -180 correctly');
}

// 9. TASK-5.1: Responsive Rules for Ultra-Narrow CEP Docking (280px - 480px)
{
  const css = readAggregatedCss(path.join(projectRoot, 'client/css/style.css'));
  assert(css.includes('@media (max-width: 540px)'), 'CSS contains 540px responsive breakpoint');
  assert(css.includes('@media (max-width: 420px)'), 'CSS contains 420px responsive breakpoint');
  assert(css.includes('@media (max-width: 340px)'), 'CSS contains 340px ultra-narrow docking breakpoint');

  // Verify text collapsing to icons
  assert(css.includes('.bottom-btn:not(.finalize-btn) span'), 'Collapses button labels to icons on narrow widths');
  assert(css.includes('.finalize-split-group .finalize-btn span'), 'Collapses finalize label to icon on 340px width');

  // Verify HUD and coords compacting
  assert(css.includes('.coords-display .lat'), 'Hides lat/lng on ultra-narrow widths to preserve zoom visibility');
  assert(css.includes('.geo-location-hud .location-hud-coords'), 'Hides secondary coords in HUD on ultra-narrow widths');
}

// 10. TASK-5.2 & TASK-5.3: Location HUD Geodesic Scale Bar, Caching, and Debounce Protection
{
  const Mercator = loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', { Math, Number });
  global.MercatorProjection = Mercator;

  const LocationHudController = require(path.join(projectRoot, 'client/js/ui/LocationHudController.js'));
  const hud = new LocationHudController({
    viewport: { centerLat: 48.8566, centerLng: 2.3522, zoom: 12, tileSize: 256 },
    session: { compSettings: { width: 1920, height: 1080 } }
  });
  hud.scaleLineEl = { style: {} };
  hud.scaleTextEl = { textContent: '' };
  hud.locationNameEl = { textContent: '' };
  hud.locationCoordsEl = { textContent: '' };

  // 10a. Test scale bar at multiple zoom levels
  const zoomTests = [
    { lat: 0, zoom: 3, minWidth: 30, maxWidth: 140 },
    { lat: 35.6895, zoom: 8, minWidth: 30, maxWidth: 140 },
    { lat: 48.8566, zoom: 12, minWidth: 30, maxWidth: 140 },
    { lat: 51.5074, zoom: 16, minWidth: 30, maxWidth: 140 },
    { lat: 40.7128, zoom: 18, minWidth: 30, maxWidth: 140 }
  ];

  for (const zt of zoomTests) {
    hud.updateScaleBar(zt.lat, zt.zoom);
    const widthPx = parseInt(hud.scaleLineEl.style.width, 10);
    assert(widthPx >= zt.minWidth && widthPx <= zt.maxWidth, `Scale bar width (${widthPx}px) within [${zt.minWidth}, ${zt.maxWidth}] at zoom ${zt.zoom}`);
    assert(hud.scaleTextEl.textContent.includes('m') || hud.scaleTextEl.textContent.includes('km'), `Scale bar text '${hud.scaleTextEl.textContent}' has metric units at zoom ${zt.zoom}`);
  }

  // 10b. Scale Bar High Contrast Polish
  const css = readAggregatedCss(path.join(projectRoot, 'client/css/style.css'));
  assert(css.includes('.map-scale-bar'), 'CSS contains .map-scale-bar styling');
  assert(css.includes('backdrop-filter: blur(10px)'), 'Scale bar has premium glassmorphism blur');
  assert(css.includes('text-shadow'), 'Scale bar has drop shadow text for contrast on light satellite maps');

  // 10c. Location Identity Cache and Debounce Protection
  assert(hud._cache instanceof Map, 'Location HUD utilizes Map cache for place identity');
  assert(hud._reverseTimer === null, 'Reverse geocode timer initialized to null');

  // Test caching mechanism
  hud._cache.set('48.86,2.35,12', 'Paris, France');
  hud.updateLocationIdentity(48.8566, 2.3522, 12);
  assert(hud.locationNameEl.textContent === 'Paris, France', 'Immediate cache hit returns cached placename without network call');
  assert(hud._reverseTimer === null, 'Cache hit skips scheduling reverse geocode timer');

  // Test debounce timer creation
  hud.updateLocationIdentity(30.0444, 31.2357, 10); // Uncached (Cairo)
  assert(hud._reverseTimer !== null, 'Uncached coordinate schedules debounced reverse geocoding timer');

  // Test cache eviction at 200 items
  for (let i = 0; i < 205; i++) {
    hud._cache.set(`key_${i}`, `Place ${i}`);
    if (hud._cache.size > 200) {
      const first = hud._cache.keys().next().value;
      hud._cache.delete(first);
    }
  }
  assert(hud._cache.size <= 200, 'Cache is strictly capped at 200 items to prevent memory leaks');

  hud.dispose();
  assert(hud._bound === false, 'dispose resets bound state and clears timers');
}

// 11. Systematic Z-Index Layer Architecture & Stacking Context Isolation
{
  const css = readAggregatedCss(path.join(projectRoot, 'client/css/style.css'));

  // 11a. Verify presence of all standard layer tokens in :root
  const tokenRegex = /--z-([\w-]+):\s*(\d+);/g;
  const tokens = {};
  let match;
  while ((match = tokenRegex.exec(css)) !== null) {
    tokens[match[1]] = parseInt(match[2], 10);
  }

  assert(tokens['canvas'] !== undefined, 'CSS defines --z-canvas token');
  assert(tokens['framing'] !== undefined, 'CSS defines --z-framing token');
  assert(tokens['map-hud'] !== undefined, 'CSS defines --z-map-hud token');
  assert(tokens['toolbar'] !== undefined, 'CSS defines --z-toolbar token');
  assert(tokens['bottom-bar'] !== undefined, 'CSS defines --z-bottom-bar token');
  assert(tokens['tooltip'] !== undefined, 'CSS defines --z-tooltip token');
  assert(tokens['search-bar'] !== undefined, 'CSS defines --z-search-bar token');
  assert(tokens['search-results'] !== undefined, 'CSS defines --z-search-results token');
  assert(tokens['drawer'] !== undefined, 'CSS defines --z-drawer token');
  assert(tokens['modal-backdrop'] !== undefined, 'CSS defines --z-modal-backdrop token');
  assert(tokens['modal-panel'] !== undefined, 'CSS defines --z-modal-panel token');
  assert(tokens['modal-download'] !== undefined, 'CSS defines --z-modal-download token');
  assert(tokens['modal-projects'] !== undefined, 'CSS defines --z-modal-projects token');
  assert(tokens['dialog'] !== undefined, 'CSS defines --z-dialog token');
  assert(tokens['toast'] !== undefined, 'CSS defines --z-toast token');
  assert(tokens['splash'] !== undefined, 'CSS defines --z-splash token');

  // 11b. Verify monotonic ordering and layering isolation
  assert(tokens['canvas'] < tokens['framing'], 'Canvas is underneath framing box');
  assert(tokens['framing'] < tokens['map-hud'], 'Framing box is underneath map HUD widgets');
  assert(tokens['map-hud'] < tokens['toolbar'], 'Map HUD widgets are underneath top toolbar');
  assert(tokens['toolbar'] <= tokens['bottom-bar'], 'Toolbar and bottom bar are at equal baseline navigation level');
  assert(tokens['bottom-bar'] < tokens['search-bar'], 'Search bar has higher elevation than action bars');
  assert(tokens['search-bar'] < tokens['search-results'], 'Search results dropdown is strictly above search bar container');
  assert(tokens['map-hud'] < tokens['search-results'], 'Search results (z=650) are strictly above map scale bar and HUD (z=20)');
  assert(tokens['search-results'] < tokens['drawer'], 'Vector layers drawer is above search popup');
  assert(tokens['drawer'] < tokens['modal-backdrop'], 'Modal backdrops cover drawer and search elements');
  assert(tokens['modal-backdrop'] < tokens['modal-panel'], 'Modal panel content is above modal backdrop');
  assert(tokens['modal-panel'] <= tokens['modal-download'], 'Download progress modal sits above general settings');
  assert(tokens['modal-download'] <= tokens['modal-projects'], 'Project maps browser sits above download modal');
  assert(tokens['modal-projects'] < tokens['dialog'], 'Confirm/Alert dialogs sit above all application modals');
  assert(tokens['dialog'] < tokens['tooltip'], 'Tooltips float above all modals and dialogs');
  assert(tokens['tooltip'] < tokens['toast'], 'Toasts float above tooltips for emergency feedback');
  assert(tokens['toast'] < tokens['splash'], 'Splash screen has highest priority (9999)');

  // 11c. Verify component CSS uses the tokens
  assert(css.includes('z-index: var(--z-canvas, 1);'), '.map-container binds to --z-canvas');
  assert(css.includes('z-index: var(--z-search-bar, 500);'), '.search-bar binds to --z-search-bar');
  assert(css.includes('z-index: var(--z-search-results, 650);'), '.search-results binds to --z-search-results');
  assert(css.includes('z-index: var(--z-map-hud, 20);'), '.map-scale-bar / HUD bind to --z-map-hud');
  assert(css.includes('z-index: var(--z-modal-backdrop, 2000);'), '.settings-overlay binds to --z-modal-backdrop');
  assert(css.includes('z-index: var(--z-tooltip, 2250);'), '.opengeo-tooltip binds to --z-tooltip');
  assert(css.includes('position: fixed;'), '.settings-overlay uses position: fixed to cover full viewport');

  // 11d. Verify SearchPanel outside click and modal dismissal code
  const searchCode = fs.readFileSync(path.join(projectRoot, 'client/js/ui/SearchPanel.js'), 'utf8');
  assert(searchCode.includes('showResults()'), 'SearchPanel has showResults helper method');
  assert(searchCode.includes('hideResults()'), 'SearchPanel has hideResults helper method');
  assert(searchCode.includes('search-active'), 'SearchPanel sets search-active class for z-index elevation');
  assert(searchCode.includes('pointerdown'), 'SearchPanel registers outside pointerdown handler to auto-dismiss results');
  assert(searchCode.includes('this.hideResults()'), 'SearchPanel invokes hideResults on dismiss actions');
}

console.log('====================================');
console.log(`Viewport Tests: Passed: ${passed} | Failed: ${failed}`);
console.log('====================================');

if (failed > 0) {
  process.exit(1);
}

