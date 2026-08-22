/*
 * Builds the spatially indexed runtime package used by VectorPreviewLayer.
 * The checked-in 10m world source remains authoritative; runtime reads only
 * the small index plus visible chunks, never the full 20MB JSON document.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const requestedDataDir = process.argv.find(argument => argument.indexOf('--data-dir=') === 0);
const dataDir = requestedDataDir ? path.resolve(requestedDataDir.slice('--data-dir='.length))
  : path.join(root, 'client', 'assets', 'data');
const sourcePath = path.join(dataDir, 'world_vector_layers_10m.json');
const outputDir = path.resolve(dataDir, 'vector-preview', '10m');
const targetPointsPerChunk = 18000;

function featureMetrics(feature) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, points = 0;
  for (const ring of (feature && feature.rings) || []) {
    for (const point of ring || []) {
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      points++;
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
    }
  }
  return { bbox: [minX, minY, maxX, maxY], points };
}

function mergeBounds(target, bbox) {
  target[0] = Math.min(target[0], bbox[0]);
  target[1] = Math.min(target[1], bbox[1]);
  target[2] = Math.max(target[2], bbox[2]);
  target[3] = Math.max(target[3], bbox[3]);
}

function mortonKey(bbox, mapSize) {
  const centerX = Math.max(0, Math.min(mapSize - 1, (bbox[0] + bbox[2]) / 2));
  const centerY = Math.max(0, Math.min(mapSize - 1, (bbox[1] + bbox[3]) / 2));
  const x = Math.floor(centerX / mapSize * 1024);
  const y = Math.floor(centerY / mapSize * 1024);
  let key = 0;
  for (let bit = 0; bit < 10; bit++) {
    key |= ((x >> bit) & 1) << (bit * 2);
    key |= ((y >> bit) & 1) << (bit * 2 + 1);
  }
  return key >>> 0;
}

function build() {
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing vector preview source: ${sourcePath}`);
  const safeRoot = path.resolve(dataDir) + path.sep;
  if (!(outputDir + path.sep).startsWith(safeRoot)) throw new Error(`Unsafe vector preview output: ${outputDir}`);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const rawSource = fs.readFileSync(sourcePath);
  const source = JSON.parse(rawSource.toString('utf8'));
  const index = {
    version: '1.0.0',
    detail: '10m',
    mapSize: Number(source.mapSize) || 262144,
    generatedBy: 'scripts/build-vector-preview-index.js',
    sourceSha256: crypto.createHash('sha256').update(rawSource).digest('hex'),
    targetPointsPerChunk,
    layers: {},
    totals: { chunks: 0, features: 0, points: 0, bytes: 0 }
  };

  for (const layerName of ['land', 'borders', 'coastlines']) {
    const layer = source.layers && source.layers[layerName];
    const prepared = ((layer && layer.features) || []).map(feature => {
      const metrics = featureMetrics(feature);
      const copy = Object.assign({}, feature, { bbox: metrics.bbox });
      return { feature: copy, bbox: metrics.bbox, points: metrics.points };
    }).filter(item => item.points > 0 && Number.isFinite(item.bbox[0]));

    // Morton order preserves two-dimensional locality. The old latitude-first
    // ordering produced world-wide horizontal strips and forced a regional
    // viewport to parse many unrelated chunks.
    prepared.sort((first, second) => mortonKey(first.bbox, index.mapSize) - mortonKey(second.bbox, index.mapSize));

    const entries = [];
    let batch = [];
    let batchPoints = 0;
    let batchBounds = [Infinity, Infinity, -Infinity, -Infinity];
    const flush = () => {
      if (!batch.length) return;
      const chunkNumber = entries.length;
      const id = `${layerName}-${String(chunkNumber).padStart(3, '0')}`;
      const filename = `${id}.json`;
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (const item of batch) mergeBounds(bounds, item.bbox);
      const payload = JSON.stringify({
        version: '1.0.0',
        mapSize: index.mapSize,
        layer: layerName,
        features: batch.map(item => item.feature)
      });
      fs.writeFileSync(path.join(outputDir, filename), payload, 'utf8');
      entries.push({
        id,
        file: `vector-preview/10m/${filename}`,
        bbox: bounds,
        featureCount: batch.length,
        pointCount: batchPoints,
        bytes: Buffer.byteLength(payload),
        sha256: crypto.createHash('sha256').update(payload).digest('hex')
      });
      index.totals.chunks++;
      index.totals.features += batch.length;
      index.totals.points += batchPoints;
      index.totals.bytes += Buffer.byteLength(payload);
      batch = [];
      batchPoints = 0;
      batchBounds = [Infinity, Infinity, -Infinity, -Infinity];
    };

    for (const item of prepared) {
      const nextBounds = batchBounds.slice();
      mergeBounds(nextBounds, item.bbox);
      const exceedsSpatialCell = nextBounds[2] - nextBounds[0] > index.mapSize / 4 || nextBounds[3] - nextBounds[1] > index.mapSize / 4;
      if (batch.length && (batchPoints + item.points > targetPointsPerChunk || exceedsSpatialCell)) {
        flush();
        mergeBounds(batchBounds, item.bbox);
      } else {
        batchBounds = nextBounds;
      }
      batch.push(item);
      batchPoints += item.points;
      if (batchPoints >= targetPointsPerChunk) flush();
    }
    flush();
    index.layers[layerName] = entries;
  }

  fs.writeFileSync(path.join(outputDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log(`[OpenGeo] Vector preview index built: ${index.totals.chunks} chunks, ${index.totals.features} features, ${index.totals.points} points, ${index.totals.bytes} bytes`);
  return index;
}

if (require.main === module) build();
module.exports = { build };
