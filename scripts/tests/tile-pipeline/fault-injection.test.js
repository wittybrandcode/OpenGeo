'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '../../..');
const fixtureRoot = path.join(projectRoot, 'scripts', 'fixtures', 'tile-pipeline');
const oracle = readJson('failure-oracle.json');
const partialDownload = readJson('partial-download.json');
const megaTileFixtures = readJson('megatile-manifests.json');
const identityFixtures = readJson('identity-and-budget.json');

class FaultAssertion extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FaultAssertion';
    this.code = code;
  }
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
}

function sourcePath(relativePath) {
  return path.join(projectRoot, relativePath);
}

function loadBrowserClass(relativePath, className, sandbox = {}) {
  const absolutePath = sourcePath(relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8') +
    `\nthis.__openGeoExport = typeof ${className} !== 'undefined' ? ${className} : undefined;`;
  sandbox.window = sandbox.window || {};
  sandbox.console = sandbox.console || console;
  sandbox.Promise = sandbox.Promise || Promise;
  sandbox.Map = sandbox.Map || Map;
  sandbox.Set = sandbox.Set || Set;
  sandbox.Object = sandbox.Object || Object;
  sandbox.Array = sandbox.Array || Array;
  sandbox.String = sandbox.String || String;
  sandbox.Number = sandbox.Number || Number;
  sandbox.Math = sandbox.Math || Math;
  vm.runInNewContext(source, sandbox, { filename: absolutePath });
  return sandbox.__openGeoExport;
}

function fail(code, message) {
  throw new FaultAssertion(code, message);
}

function makeSnapshot(generation, compId) {
  return {
    operationId: `fault:${generation}`,
    generation,
    compId,
    documentId: 'fault-document',
    providerSignature: 'fixture-provider-v1',
    sourceKey: 'fixture-provider',
    sourceTileSize: 256,
    maxSourceZoom: 19,
    isFinalized: true,
    camera: { lat: 0, lon: 0, zoom: 6 },
    composition: { width: 1920, height: 1080, displayName: 'Fault fixture' },
    compSettings: null,
    isCurrent: () => true
  };
}

function makeSession() {
  return {
    documentId: 'fault-document',
    generations: { sync: 1, preview: 1 },
    operations: { sync: 'idle', preview: 'idle' },
    beginOperation(kind) {
      this.operations[kind] = 'running';
      return this.generations[kind];
    },
    completeOperation(kind) { this.operations[kind] = 'complete'; },
    failOperation(kind) { this.operations[kind] = 'failed'; },
    cancelOperation(kind) { this.operations[kind] = 'cancelled'; },
    nextGeneration(kind) { return ++this.generations[kind]; }
  };
}

function makeFaultPlan(count = partialDownload.plannedCount) {
  const placements = [];
  const downloads = Array.from({ length: count }, (_, index) => {
    const downloadKey = `fixture-provider-v1/webMercator/256/8/${index}/97`;
    const placementKey = `webMercator/256/8/${index}/97`;
    placements.push({
      downloadKey, placementKey, providerSignature: 'fixture-provider-v1',
      tileMatrix: 'webMercator', sourceTileSize: 256, z: 8,
      x: index, wrappedX: index, y: 97
    });
    return {
      downloadKey, placementKeys: [placementKey], providerSignature: 'fixture-provider-v1',
      tileMatrix: 'webMercator', sourceTileSize: 256, z: 8,
      x: index, wrappedX: index, y: 97
    };
  });
  downloads.contractVersion = 'tile-plan/1.0';
  downloads.placementCount = placements.length;
  downloads.placements = placements;
  downloads.coverageSamples = [{
    sampleId: 'fixture-sample',
    requiredPlacementKeys: placements.map(placement => placement.placementKey)
  }];
  return downloads;
}

function makeFaultResults(plan, completedCount) {
  return plan.map((download, index) => ({
    tile: download,
    downloadKey: download.downloadKey,
    status: index < completedCount ? 'complete' : 'error',
    filePath: index < completedCount ? `${index}.png` : null,
    error: index < completedCount ? null : { code: 'NETWORK_TIMEOUT' }
  }));
}

function makeSyncSandbox(downloadBehavior, hostCounter) {
  class FaultDownloadSession {
    constructor() {}
    cancel() {}
    sync() { return Promise.resolve(downloadBehavior.sync); }
    downloadTiles() { return Promise.resolve(downloadBehavior.path); }
    downloadPlan(plan) {
      const results = downloadBehavior.path || [];
      return Promise.resolve({
        plan,
        results,
        tiles: results.filter(result => result.status === 'complete' && result.filePath).map(result => ({
          downloadKey: result.tile.downloadKey,
          placementKey: result.tile.placementKey,
          filePath: result.filePath,
          z: result.tile.z,
          x: result.tile.x,
          y: result.tile.y
        }))
      });
    }
  }
  class FaultTilePlanner {
    createPlan() {
      return makeFaultPlan();
    }
  }
  return {
    console: { log() {}, warn() {}, error() {} },
    clearTimeout,
    setTimeout,
    require,
    OpenGeo: { Engine: { getDefaultCacheDir: () => 'C:/OpenGeo_Fault_Test' } },
    MegaTileStitcher: function FaultStitcher() {},
    TilePlanner: FaultTilePlanner,
    DownloadSession: FaultDownloadSession,
    OperationSnapshot: { capture: (_app, options) => makeSnapshot(options.generation, options.compId || 'comp-fixture') },
    globalEventBus: { emit() {} },
    __hostCounter: hostCounter
  };
}

async function fi01LiveSyncRejectsPartialDownload() {
  const plan = makeFaultPlan();
  const results = makeFaultResults(plan, partialDownload.completedCount);
  const tiles = plan.placements.slice(0, partialDownload.completedCount).map((placement, index) =>
    Object.assign({}, placement, { filePath: `${index}.png` })
  );
  const hostCounter = { calls: 0 };
  const sandbox = makeSyncSandbox({
    sync: { plan, results, tiles, errors: partialDownload.failed, camera: { lat: 0, lon: 0, zoom: 6 } },
    path: []
  }, hostCounter);
  loadBrowserClass('client/js/tiles/CoverageContract.js', 'CoverageContract', sandbox);
  const SyncManager = loadBrowserClass('client/js/core/SyncManager.js', 'SyncManager', sandbox);
  const session = makeSession();
  const app = {
    activeCompId: 'comp-fixture', session,
    aeBridge: {
      isHostInitialized: true,
      invokeWithPayloadFile: async () => {
        hostCounter.calls++;
        return { compId: 'comp-fixture', tilesImported: 1, tilesTotal: 1 };
      }
    },
    jobManager: {},
    metadataManager: { saveToComp: async () => true },
    finalizeController: { isFinalizing: false }
  };
  const manager = new SyncManager(app);
  manager._packPreviewTiles = async tiles => tiles;
  manager._cleanupPreviewMegaTiles = async () => {};
  await manager.exportToAE(false, true);
  if (hostCounter.calls !== 0) {
    fail('LIVE_SYNC_PARTIAL_COMMIT', 'Live Sync mutated After Effects after a 29/30 download result.');
  }
}

async function fi02PathPreviewRejectsPartialDownload() {
  const hostCounter = { calls: 0 };
  const plan = makeFaultPlan();
  const sandbox = makeSyncSandbox({ sync: null, path: makeFaultResults(plan, partialDownload.completedCount) }, hostCounter);
  loadBrowserClass('client/js/tiles/CoverageContract.js', 'CoverageContract', sandbox);
  const SyncManager = loadBrowserClass('client/js/core/SyncManager.js', 'SyncManager', sandbox);
  const session = makeSession();
  const app = {
    activeCompId: 'comp-fixture', session,
    finalizeController: { isFinalizing: false },
    aeBridge: {
      invoke: async () => ({ frames: [{ lat: 1, lon: 1, zoom: 6 }] }),
      invokeWithPayloadFile: async () => {
        hostCounter.calls++;
        return { compId: 'comp-fixture' };
      }
    },
    jobManager: {}
  };
  const manager = new SyncManager(app);
  manager._trajectoryRunId = 1;
  manager._packPreviewTiles = async tiles => tiles;
  manager._cleanupPreviewMegaTiles = async () => {};
  await manager._buildTrajectoryPreview(1);
  if (hostCounter.calls !== 0) {
    fail('PATH_PREVIEW_PARTIAL_COMMIT', 'Path Preview discarded a failed result and committed the remaining tiles.');
  }
}

async function fi03WorkerRejectsPartialDecode() {
  const posted = [];
  class FixtureBlob {
    constructor(parts) { this.parts = parts; }
    async arrayBuffer() { return new ArrayBuffer(8); }
  }
  class FixtureCanvas {
    getContext() { return { drawImage() {} }; }
    async convertToBlob() { return new FixtureBlob([new ArrayBuffer(8)]); }
  }
  const sandbox = {
    console: { warn() {} },
    Blob: FixtureBlob,
    OffscreenCanvas: FixtureCanvas,
    createImageBitmap: async blob => {
      if (blob.parts[0] && blob.parts[0].decodeFailure) throw new Error('Injected decode failure');
      return { close() {} };
    },
    self: { postMessage: message => { posted.push(message); } }
  };
  vm.runInNewContext(fs.readFileSync(sourcePath('client/js/engine/stitcherWorker.js'), 'utf8'), sandbox, {
    filename: sourcePath('client/js/engine/stitcherWorker.js')
  });
  const readFailureChildren = Array.from({ length: megaTileFixtures.readFailure.readableChildren }, (_, index) => ({
    x: index % 8,
    y: Math.floor(index / 8),
    buffer: { bytes: index }
  }));
  await sandbox.self.onmessage({ data: {
    id: 1,
    children: readFailureChildren,
    originalExpectedCount: megaTileFixtures.readFailure.plannedChildren,
    expectedCells: Array.from({ length: megaTileFixtures.readFailure.plannedChildren }, (_, index) =>
      `${index % 8},${Math.floor(index / 8)}`
    ),
    startX: 0,
    startY: 0,
    size: 2048,
    sourceTileSize: 256,
    outputPath: 'read-failure.png'
  }});

  const missingIndex = 37;
  const decodeFailureChildren = Array.from({ length: megaTileFixtures.decodeFailure.expectedChildren }, (_, index) => ({
    x: index % 8,
    y: Math.floor(index / 8),
    buffer: index === missingIndex ? { decodeFailure: true } : { bytes: index }
  }));
  await sandbox.self.onmessage({ data: {
    id: 2,
    children: decodeFailureChildren,
    originalExpectedCount: megaTileFixtures.decodeFailure.expectedChildren,
    expectedCells: Array.from({ length: megaTileFixtures.decodeFailure.expectedChildren }, (_, index) =>
      `${index % 8},${Math.floor(index / 8)}`
    ),
    startX: 0,
    startY: 0,
    size: 2048,
    sourceTileSize: 256,
    outputPath: 'decode-failure.png'
  }});
  const readFailureRejected = posted[0] && posted[0].status === 'error' &&
    posted[0].code === 'MEGATILE_WORKER_INPUT_INCOMPLETE';
  const decodeFailureRejected = posted[1] && posted[1].status === 'error' &&
    posted[1].code === 'MEGATILE_WORKER_DECODE_INCOMPLETE';
  if (!readFailureRejected || !decodeFailureRejected) {
    fail(
      'WORKER_ACCEPTED_PARTIAL_DECODE',
      'Worker did not reject incomplete input and decode coverage with typed errors.'
    );
  }
}

async function fi04CacheRequiresManifestValidation() {
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-fi04-'));
  try {
    const MegaTileArtifactStore = require(sourcePath('client/js/engine/MegaTileArtifactStore.js'));
    const store = new MegaTileArtifactStore({
      artifactKind: 'preview-cache', providerSignature: 'fixture',
      cacheSignature: 'fixture-cache', operationId: 'fi04'
    });
    const children = Array.from({ length: 64 }, (_, index) => ({
      z: 8, x: index % 8, y: Math.floor(index / 8),
      downloadKey: `d-${index}`, placementKey: `p-${index}`
    }));
    const outputPath = path.join(root, 'corrupt.png');
    const spec = store.createSpec(children, 0, 0, 2048, 256, outputPath);
    spec.fingerprinted = true;
    fs.writeFileSync(outputPath, Buffer.alloc(megaTileFixtures.staleCache.fileBytes));
    if (store.validateCache(spec)) {
      fail('CACHE_SIZE_ONLY_ACCEPTED', 'A stale MegaTile was accepted without a manifest solely because it exceeded 1000 bytes.');
    }
    fs.writeFileSync(spec.manifestPath, JSON.stringify({
      schemaVersion: 'megatile-manifest/1.0', artifactKind: 'preview-cache',
      providerSignature: 'fixture', cacheSignature: 'fixture-cache',
      expectedCells: spec.expectedCells,
      decodedCells: spec.expectedCells.slice(0, megaTileFixtures.staleCache.manifestActualChildren),
      coverageMask: spec.expectedCells.slice(0, megaTileFixtures.staleCache.manifestActualChildren),
      outputBytes: megaTileFixtures.staleCache.fileBytes,
      outputSha256: 'invalid'
    }));
    if (store.validateCache(spec)) {
      fail('CACHE_SIZE_ONLY_ACCEPTED', 'A stale MegaTile was accepted with mismatched coverage and hash metadata.');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function fi05PreservesRepeatedWorldPlacements() {
  const sandbox = {};
  loadBrowserClass('client/js/map/MercatorProjection.js', 'MercatorProjection', sandbox);
  loadBrowserClass('client/js/tiles/TileAddress.js', 'TileAddress', sandbox);
  const CoveragePlanner = loadBrowserClass('client/js/tiles/CoveragePlanner.js', 'CoveragePlanner', sandbox);
  loadBrowserClass('client/js/tiles/PlacementExpander.js', 'PlacementExpander', sandbox);
  const TilePlanner = loadBrowserClass('client/js/engine/TilePlanner.js', 'TilePlanner', sandbox);
  const frame = { lat: 0, lon: 0, zoom: 2 };
  const options = {
    qualityOffset: 0, sourceTileSize: 256, maxSourceZoom: 19, sourceKey: 'fixture',
    fetchWidth: 3840, fetchHeight: 2160, gutterTiles: 1, includeBaseCoverage: false
  };
  const rawPlacements = CoveragePlanner.planComposition(frame, {
    width: options.fetchWidth, height: options.fetchHeight, downloadZoom: 2,
    tileSize: 256, gutterTiles: 1, alignMegaTiles: false
  });
  const planner = new TilePlanner({ _buildTileUrl: (_source, x, y, z) => `${z}/${x}/${y}` });
  const plan = planner.createPlan([frame], options);
  const repeatedDownload = rawPlacements.some((tile, index) =>
    rawPlacements.findIndex(other => other.key === tile.key) !== index
  );
  const placementLinks = plan.reduce((total, download) => total + download.placementKeys.length, 0);
  if (!repeatedDownload || plan.length >= rawPlacements.length ||
      plan.placementCount !== rawPlacements.length || placementLinks !== rawPlacements.length ||
      plan.coverageSamples.length !== 1 ||
      plan.coverageSamples[0].requiredPlacementKeys.length !== rawPlacements.length) {
    fail('PLACEMENT_COLLAPSED_BY_DOWNLOAD_KEY', `Planning collapsed ${rawPlacements.length} placements into ${plan.length} download identities.`);
  }
}

async function fi06VisiblePreviewTileIsRescheduled() {
  const emitted = [];
  const sandbox = {
    setTimeout,
    globalEventBus: { emit: (event, payload) => emitted.push({ event, payload }) }
  };
  const TileDownloader = loadBrowserClass('client/js/tiles/TileDownloader.js', 'TileDownloader', sandbox);
  const downloader = new TileDownloader({ concurrency: 1 });
  let requests = 0;
  downloader._delay = async () => {};
  downloader._fetch = async () => {
    requests++;
    if (requests < 3) throw new Error('Injected transient failure');
    return { width: 256, height: 256 };
  };
  downloader.addTile('fixture/6/30/22', [{ url: 'https://fixture.invalid/tile.png' }], 0);
  await new Promise(resolve => setTimeout(resolve, 15));
  const loaded = emitted.some(entry => entry.event === 'tiles:loaded');
  if (!loaded || requests < 3) {
    fail('VISIBLE_TILE_NOT_RESCHEDULED', `Visible tile stopped after ${requests} failed attempts and required viewport movement.`);
  }
}

async function fi07ChecksEveryTrajectorySamplePlacement() {
  const contractPath = sourcePath('client/js/tiles/CoverageContract.js');
  if (!fs.existsSync(contractPath)) {
    fail('TRAJECTORY_SAMPLE_COVERAGE_UNVERIFIED', 'No canonical per-sample coverage contract exists.');
  }
  const CoverageContract = require(contractPath);
  const result = CoverageContract.evaluateTrajectory(identityFixtures.trajectory.samples, identityFixtures.trajectory.observedPlacements);
  if (result.ok === true || !result.missingBySample || !result.missingBySample.t1.includes('p3')) {
    fail('TRAJECTORY_SAMPLE_COVERAGE_UNVERIFIED', 'A complete-looking union hid a missing placement in trajectory sample t1.');
  }
}

async function fi08RejectsEqualCountIdentityMismatch() {
  const contractPath = sourcePath('client/js/tiles/CoverageContract.js');
  if (!fs.existsSync(contractPath)) {
    fail('EXACT_IDENTITY_SET_UNVERIFIED', 'No canonical exact-set CoverageResult gate exists.');
  }
  const CoverageContract = require(contractPath);
  const fixture = identityFixtures.equalCountIdentityMismatch;
  const result = CoverageContract.compareExactSets(fixture.expectedIds, fixture.actualIds);
  if (result.ok === true || !result.missing.includes('asset-c') || !result.unexpected.includes('asset-x')) {
    fail('EXACT_IDENTITY_SET_UNVERIFIED', 'Equal counters concealed missing and unexpected asset identities.');
  }
}

async function fi09PreflightRunsBeforeNetwork() {
  const source = fs.readFileSync(sourcePath('client/js/core/FinalizeController.js'), 'utf8');
  const budget = identityFixtures.fourKUltra;
  const hasPreflightBeforeNetwork = /(?:preflight|evaluateFinalizeBudget)[\s\S]*await this\.downloadTiles\(/i.test(source);
  const hasSoftGateConfirmation = /(?:softLimit|softGate)[\s\S]*(?:confirm|approval)/i.test(source);
  if (budget.estimatedDownloads > budget.softLimit && !budget.userConfirmed &&
      (!hasPreflightBeforeNetwork || !hasSoftGateConfirmation)) {
    fail('FOUR_K_PREFLIGHT_MISSING', '4K Ultra can start network work without a soft-budget estimate and explicit confirmation.');
  }
}

async function fi10HostResultUsesExactAssetIds() {
  const sandbox = { globalEventBus: { emit() {} } };
  const FinalizeController = loadBrowserClass('client/js/core/FinalizeController.js', 'FinalizeController', sandbox);
  const controller = new FinalizeController({});
  const expectedIds = ['asset-a', 'asset-b'];
  let rejected = false;
  try {
    controller._assertTypedImportResult({
      ok: true,
      operationId: 'revision-fixture',
      expected: 2,
      imported: 2,
      failed: [],
      assetIds: ['asset-a', 'asset-x']
    }, expectedIds.length, 'revision-fixture', 'prepare', expectedIds);
  } catch (_error) {
    rejected = true;
  }
  if (!rejected) fail('HOST_ASSET_ID_SET_UNCHECKED', 'Host prepare accepted the right count with the wrong asset ID set.');
}

const tests = [
  ['FI-01', fi01LiveSyncRejectsPartialDownload],
  ['FI-02', fi02PathPreviewRejectsPartialDownload],
  ['FI-03', fi03WorkerRejectsPartialDecode],
  ['FI-04', fi04CacheRequiresManifestValidation],
  ['FI-05', fi05PreservesRepeatedWorldPlacements],
  ['FI-06', fi06VisiblePreviewTileIsRescheduled],
  ['FI-07', fi07ChecksEveryTrajectorySamplePlacement],
  ['FI-08', fi08RejectsEqualCountIdentityMismatch],
  ['FI-09', fi09PreflightRunsBeforeNetwork],
  ['FI-10', fi10HostResultUsesExactAssetIds]
];

async function main() {
  const expectedById = new Map(oracle.expectedFailures.map(entry => [entry.id, entry.code]));
  const expectedPasses = new Set(oracle.expectedPasses || []);
  const summary = { schemaVersion: '1.0.0', suite: oracle.suite, failed: [], passed: [], harnessErrors: [] };
  for (const [id, test] of tests) {
    try {
      await test();
      summary.passed.push(id);
      console.log(`[${expectedPasses.has(id) ? 'EXPECTED GREEN' : 'UNEXPECTED GREEN'}] ${id}`);
    } catch (error) {
      const expectedCode = expectedById.get(id);
      if (error instanceof FaultAssertion && error.code === expectedCode) {
        summary.failed.push({ id, code: error.code });
        console.log(`[EXPECTED RED] ${id} ${error.code}: ${error.message}`);
      } else {
        summary.harnessErrors.push({ id, code: error && error.code || 'HARNESS_ERROR', message: error && error.message || String(error) });
        console.error(`[HARNESS ERROR] ${id}:`, error && error.stack || error);
      }
    }
  }
  console.log(`OPEN_GEO_FAULT_SUMMARY=${JSON.stringify(summary)}`);
  process.exitCode = summary.failed.length > 0 || summary.harnessErrors.length > 0 ? 1 : 0;
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 2;
});
