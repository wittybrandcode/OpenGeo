const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'docs', 'BASELINE_MANIFEST.json');
const trackedRoots = ['client', 'host', 'scripts'];
const trackedRootFiles = ['CSXS/manifest.xml', 'package.json'];

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'release' && entry.name !== 'dist') {
        files.push(...walk(fullPath));
      }
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function buildManifest() {
  const files = [];
  for (const relativeRoot of trackedRoots) {
    const fullRoot = path.join(root, relativeRoot);
    if (fs.existsSync(fullRoot)) files.push(...walk(fullRoot));
  }
  for (const relativeFile of trackedRootFiles) {
    const fullFile = path.join(root, relativeFile);
    if (fs.existsSync(fullFile)) files.push(fullFile);
  }

  const checksums = {};
  files.sort().forEach(file => {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    checksums[relative] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  });
  return {
    format: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch
    },
    sourceOfTruth: ['client/', 'host/', 'scripts/', 'CSXS/manifest.xml', 'package.json'],
    excludedGeneratedPaths: ['release/', 'dist/', 'node_modules/'],
    files: checksums
  };
}

function record() {
  const manifest = buildManifest();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[OpenGeo] Baseline recorded: ${Object.keys(manifest.files).length} files.`);
}

function verify() {
  if (!fs.existsSync(manifestPath)) throw new Error('Baseline manifest is missing. Run npm run baseline:record.');
  const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const current = buildManifest();
  const changed = [];
  const fileNames = new Set(Object.keys(expected.files || {}).concat(Object.keys(current.files)));
  Array.from(fileNames).sort().forEach(file => {
    if (expected.files[file] !== current.files[file]) changed.push(file);
  });
  if (changed.length) throw new Error(`Baseline differs in ${changed.length} file(s): ${changed.join(', ')}`);
  console.log(`[OpenGeo] Baseline verified: ${Object.keys(current.files).length} files.`);
}

if (process.argv[2] === 'verify') verify();
else record();
