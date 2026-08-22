const fs = require('fs');
const path = require('path');
const { measurePreview, validateMetrics } = require('./benchmark-preview');

const root = path.resolve(__dirname, '..');
const defaultPolicyPath = path.join(root, 'config', 'performance-budgets.json');
const defaultReportPath = path.join(root, 'release', 'performance-report.json');

function read(relativePath, projectRoot = root) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function captureNumber(source, pattern, label, failures) {
  const match = source.match(pattern);
  if (!match) {
    failures.push(`Unable to locate runtime limit: ${label}.`);
    return null;
  }
  return Number(match[1]);
}

function inventoryRuntimeLimits(projectRoot, failures) {
  const memoryCache = read('client/js/tiles/MemoryCache.js', projectRoot);
  const downloader = read('client/js/tiles/TileDownloader.js', projectRoot);
  const vector = read('client/js/overlays/VectorPreviewLayer.js', projectRoot);
  const sync = read('client/js/core/SyncManager.js', projectRoot);
  const finalize = read('client/js/core/FinalizeController.js', projectRoot);
  const aeSync = read('client/js/ae/AESyncEngine.js', projectRoot);
  const logger = read('client/js/core/OperationLogger.js', projectRoot);
  return {
    tileMemoryEntries: captureNumber(memoryCache, /memoryLimit\s*\|\|\s*(\d+)/, 'tileMemoryEntries', failures),
    tileDownloadConcurrency: captureNumber(downloader, /concurrency\s*\|\|\s*(\d+)/, 'tileDownloadConcurrency', failures),
    vectorChunkConcurrency: captureNumber(vector, /_chunkLoadConcurrency\s*=\s*(\d+)/, 'vectorChunkConcurrency', failures),
    vectorPointBudget: captureNumber(vector, /_chunkPointBudget\s*=\s*(\d+)/, 'vectorPointBudget', failures),
    vectorUnloadDelayMs: captureNumber(vector, /\},\s*(\d+)\);\s*\n\s*\}/, 'vectorUnloadDelayMs', failures),
    trajectoryPreviewTiles: captureNumber(sync, /maxTrajectoryPreviewTiles\s*=\s*(\d+)/, 'trajectoryPreviewTiles', failures),
    finalizeTiles: captureNumber(finalize, /plan\.length\s*>\s*(\d+)/, 'finalizeTiles', failures),
    cameraWriteRevisions: captureNumber(aeSync, /_cameraWrites\.size\s*>\s*(\d+)/, 'cameraWriteRevisions', failures),
    operationLogBytes: captureNumber(logger, /maxBytes\)\s*\|\|\s*(\d+)\s*\*\s*(\d+)/, 'operationLogBytes', failures),
    operationLogFiles: captureNumber(logger, /maxFiles\)\s*\|\|\s*(\d+)/, 'operationLogFiles', failures)
  };
}

function auditPerformance(options = {}) {
  const projectRoot = options.root || root;
  const policy = JSON.parse(fs.readFileSync(options.policyPath || defaultPolicyPath, 'utf8'));
  const failures = [];
  const runtimeLimits = inventoryRuntimeLimits(projectRoot, failures);
  // operationLogBytes is expressed as a multiplication in source; normalize it.
  const logger = read('client/js/core/OperationLogger.js', projectRoot);
  const logMatch = logger.match(/maxBytes\)\s*\|\|\s*(\d+)\s*\*\s*(\d+)/);
  if (logMatch) runtimeLimits.operationLogBytes = Number(logMatch[1]) * Number(logMatch[2]);

  for (const [name, expected] of Object.entries(policy.runtimeLimits)) {
    if (runtimeLimits[name] !== expected) failures.push(`Runtime limit ${name} is ${runtimeLimits[name]}, expected ${expected}.`);
  }

  let previewVector = null;
  if (options.includeBenchmark !== false) {
    previewVector = measurePreview({ dataDir: path.join(projectRoot, 'client', 'assets', 'data') });
    failures.push(...validateMetrics(previewVector, policy.previewVector));
  }

  return {
    schemaVersion: '1.0.0',
    status: failures.length ? 'failed' : 'passed',
    budgets: policy,
    runtimeLimits,
    previewVector,
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    failures
  };
}

function writeReport(reportPath = defaultReportPath, options = {}) {
  const report = auditPerformance(options);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return report;
}

if (require.main === module) {
  try {
    const report = writeReport();
    if (report.failures.length) {
      report.failures.forEach(failure => console.error(`FAIL: ${failure}`));
      process.exit(1);
    }
    console.log(`[OpenGeo] Performance budgets passed: vector parse p95 ${report.previewVector.parseP95Ms}ms, ${report.previewVector.maxVisiblePoints} visible points, ${report.previewVector.maxVisibleChunks} chunks.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { auditPerformance, inventoryRuntimeLimits, writeReport };
