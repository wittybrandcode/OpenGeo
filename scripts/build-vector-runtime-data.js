const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCleanData, outputRecords, classifyOutput } = require('./verify-vector-data-reproducibility');
const { verifyRuntimeData } = require('./runtime-data-contract');

const root = path.resolve(__dirname, '..');
const runtimeDataDir = path.join(root, 'client', 'assets', 'data');
const forbiddenArtifacts = [
  'countries_ar.json',
  'ne_50m_admin_0_countries.json',
  'world_mercator_boundaries.json',
  'world_vector_layers_10m.json',
  'vectors/land-borders-10m.json',
  'vectors/manifest.json'
];

function assertInsideData(relativePath) {
  const target = path.resolve(runtimeDataDir, relativePath);
  const rootWithSeparator = path.resolve(runtimeDataDir) + path.sep;
  if (target.indexOf(rootWithSeparator) !== 0) throw new Error(`Unsafe runtime data target: ${relativePath}`);
  return target;
}

function removeTarget(relativePath) {
  const target = assertInsideData(relativePath);
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function copyPackagedOutputs(temporaryDataDir) {
  removeTarget('vector-preview/10m');
  removeTarget('world_vector_layers_50m.json');
  removeTarget('vectors/cartography-policy.json');
  removeTarget('vectors/country-index-10m.json');
  removeTarget('vectors/country-outlines-10m.json');
  forbiddenArtifacts.forEach(removeTarget);

  const packaged = outputRecords(temporaryDataDir).filter(record => classifyOutput(record.path).packaged);
  for (const record of packaged) {
    const source = path.join(temporaryDataDir, record.path);
    const destination = assertInsideData(record.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  return packaged;
}

function buildRuntimeData() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-vector-runtime-'));
  const temporaryDataDir = path.join(tempRoot, 'client', 'assets', 'data');
  try {
    buildCleanData(temporaryDataDir);
    const packaged = copyPackagedOutputs(temporaryDataDir);
    const verification = verifyRuntimeData(runtimeDataDir);
    if (!verification.ok) throw new Error(verification.failures.join('; '));
    console.log(`[OpenGeo] Runtime vector data built: ${packaged.length} generated files; ${verification.fileCount} total owned data files.`);
    return verification;
  } finally {
    const safeRoot = path.resolve(os.tmpdir()) + path.sep;
    const resolved = path.resolve(tempRoot);
    if (resolved.indexOf(safeRoot) === 0 && path.basename(resolved).startsWith('opengeo-vector-runtime-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  try {
    buildRuntimeData();
  } catch (error) {
    console.error(`[OpenGeo] Runtime vector-data build failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { buildRuntimeData };
