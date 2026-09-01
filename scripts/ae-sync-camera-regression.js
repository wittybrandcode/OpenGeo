const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBrowserClass(filePath, className, sandbox) {
  const source = fs.readFileSync(filePath, 'utf8') + `\nthis.__exportedClass = ${className};`;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.__exportedClass;
}

async function run() {
  let delayedWrite = null;
  const fixedDate = { now: () => 600000000 };
  const sandbox = {
    console,
    Map,
    Promise,
    Error,
    Date: fixedDate,
    Math,
    Object,
    Number,
    isFinite,
    setTimeout(callback) {
      delayedWrite = callback;
      return 1;
    },
    clearTimeout() {},
    globalEventBus: { on: () => () => {}, emit() {} },
    OpenGeoEvents: {
      VIEWPORT_CHANGED: 'viewport:changed',
      SYNC_COMP_CHANGED: 'sync:compChanged',
      SYNC_AE_CAMERA: 'sync:aeCamera'
    }
  };

  loadBrowserClass(
    path.resolve(__dirname, '../client/js/map/MercatorProjection.js'),
    'MercatorProjection',
    sandbox
  );
  const AESyncEngine = loadBrowserClass(
    path.resolve(__dirname, '../client/js/ae/AESyncEngine.js'),
    'AESyncEngine',
    sandbox
  );

  const timelineCamera = { lat: 5, lng: 6, zoom: 7 };
  const bridge = {
    invoke: async () => ({
      applied: false,
      appliedRevision: 0,
      disposition: 'skipped-keyframed-outside-cti',
      camera: timelineCamera
    })
  };
  const engine = new AESyncEngine(bridge, {
    composition: { compId: 12 },
    setComposition() {},
    mapState: { latitude: 20, longitude: 30, compZoom: 8 }
  });

  engine.isRunning = true;
  await engine._onPanelViewportChanged();

  if (typeof delayedWrite !== 'function') {
    throw new Error('The debounced camera write was not scheduled.');
  }
  if (!engine._shouldIgnoreAeCamera(timelineCamera, 0)) {
    throw new Error('A zero-revision stale poll was accepted before the debounced write.');
  }

  await delayedWrite();
  if (!engine._shouldIgnoreAeCamera(timelineCamera, 0)) {
    throw new Error('An unchanged keyed timeline camera snapped local navigation back.');
  }
  if (engine._shouldIgnoreAeCamera({ lat: 6, lng: 6, zoom: 7 }, 0)) {
    throw new Error('A real timeline camera change remained blocked after detached navigation.');
  }

  console.log('[PASS] Isolated AE camera revision regression');
}

run().catch(error => {
  console.error('[FAIL] Isolated AE camera revision regression');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
