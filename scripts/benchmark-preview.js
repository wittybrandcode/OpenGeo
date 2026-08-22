const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const root = path.resolve(__dirname, '..');

function measurePreview(options = {}) {
  const dataDir = options.dataDir || path.join(root, 'client', 'assets', 'data');
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'vector-preview', '10m', 'index.json'), 'utf8'));
  const parseTimes = [];
  let maxChunkBytes = 0;

  for (const layerName of ['land', 'borders', 'coastlines']) {
    for (const entry of index.layers[layerName]) {
      const raw = fs.readFileSync(path.join(dataDir, entry.file), 'utf8');
      maxChunkBytes = Math.max(maxChunkBytes, Buffer.byteLength(raw));
      const startedAt = performance.now();
      JSON.parse(raw);
      parseTimes.push(performance.now() - startedAt);
    }
  }

  parseTimes.sort((a, b) => a - b);
  const percentile = value => parseTimes[Math.min(parseTimes.length - 1, Math.floor(parseTimes.length * value))];
  const isVisible = (bbox, view) => {
    if (bbox[3] < view[1] || bbox[1] > view[3]) return false;
    for (let wrap = -1; wrap <= 1; wrap++) {
      const shift = wrap * index.mapSize;
      if (bbox[2] + shift >= view[0] && bbox[0] + shift <= view[2]) return true;
    }
    return false;
  };

  let maxVisiblePoints = 0;
  let maxVisibleChunks = 0;
  const sampleSpan = 20000;
  const sampleStep = 16384;
  for (let y = 0; y < index.mapSize; y += sampleStep) for (let x = 0; x < index.mapSize; x += sampleStep) {
    const view = [x, y, x + sampleSpan, y + sampleSpan];
    let points = 0;
    let chunks = 0;
    for (const layerName of ['land', 'borders', 'coastlines']) for (const entry of index.layers[layerName]) {
      if (!isVisible(entry.bbox, view)) continue;
      points += entry.pointCount;
      chunks++;
    }
    maxVisiblePoints = Math.max(maxVisiblePoints, points);
    maxVisibleChunks = Math.max(maxVisibleChunks, chunks);
  }

  return {
    chunks: parseTimes.length,
    parseP50Ms: Number(percentile(0.50).toFixed(2)),
    parseP95Ms: Number(percentile(0.95).toFixed(2)),
    parseMaxMs: Number(parseTimes[parseTimes.length - 1].toFixed(2)),
    maxChunkBytes,
    maxVisiblePoints,
    maxVisibleChunks
  };
}

function validateMetrics(metrics, budgets = {}) {
  const failures = [];
  if (metrics.parseP95Ms > budgets.parseP95Ms) failures.push(`Preview chunk parse p95 exceeds ${budgets.parseP95Ms}ms: ${metrics.parseP95Ms}ms.`);
  if (metrics.maxChunkBytes > budgets.maxChunkBytes) failures.push(`Preview chunk exceeds ${budgets.maxChunkBytes} bytes: ${metrics.maxChunkBytes}.`);
  if (metrics.maxVisiblePoints > budgets.maxVisiblePoints) failures.push(`Sample viewport exceeds ${budgets.maxVisiblePoints} points: ${metrics.maxVisiblePoints}.`);
  if (metrics.maxVisibleChunks > budgets.maxVisibleChunks) failures.push(`Sample viewport exceeds ${budgets.maxVisibleChunks} chunks: ${metrics.maxVisibleChunks}.`);
  return failures;
}

if (require.main === module) {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'config', 'performance-budgets.json'), 'utf8'));
  const metrics = measurePreview();
  console.log(JSON.stringify(metrics, null, 2));
  const failures = validateMetrics(metrics, policy.previewVector);
  if (failures.length) {
    failures.forEach(failure => console.error(`FAIL: ${failure}`));
    process.exit(1);
  }
}

module.exports = { measurePreview, validateMetrics };
