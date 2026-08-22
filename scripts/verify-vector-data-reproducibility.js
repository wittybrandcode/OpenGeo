const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { verifyGeometry } = require('./verify-vector-geometry');

const root = path.resolve(__dirname, '..');
const canonicalDataDir = path.join(root, 'client', 'assets', 'data');
const sourceDirectory = path.join(root, 'scripts', 'vector-data-sources');
const sourceManifestPath = path.join(sourceDirectory, 'SOURCES_MANIFEST.json');
const baselinePath = path.join(root, 'scripts', 'vector-data-reproducibility-manifest.json');
const recordMode = process.argv.includes('--record');
const buildTools = [
  'scripts/build-vector-data.js',
  'scripts/build-vector-preview-index.js',
  'scripts/build-land-border-data.js',
  'scripts/verify-vector-geometry.js',
  'package-lock.json'
];

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function normalizeRelative(filePath, baseDirectory) {
  return path.relative(baseDirectory, filePath).replace(/\\/g, '/');
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const results = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((first, second) => first.name.localeCompare(second.name));
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...walk(fullPath));
    else if (entry.isFile()) results.push(fullPath);
  }
  return results;
}

function outputFiles(dataDirectory) {
  const roots = [
    path.join(dataDirectory, 'world_vector_layers_50m.json'),
    path.join(dataDirectory, 'world_vector_layers_10m.json')
  ];
  const files = roots.filter(filePath => fs.existsSync(filePath));
  files.push(...walk(path.join(dataDirectory, 'vector-preview', '10m')));
  files.push(...walk(path.join(dataDirectory, 'vectors')));
  return files.filter(filePath => filePath.endsWith('.json'))
    .sort((first, second) => normalizeRelative(first, dataDirectory).localeCompare(normalizeRelative(second, dataDirectory)));
}

function outputRecords(dataDirectory) {
  return outputFiles(dataDirectory).map(filePath => {
    const buffer = fs.readFileSync(filePath);
    return {
      path: normalizeRelative(filePath, dataDirectory),
      bytes: buffer.length,
      sha256: sha256Buffer(buffer)
    };
  });
}

function aggregateOutputHash(records) {
  const contract = records.map(record => `${record.path}\0${record.bytes}\0${record.sha256}`).join('\n');
  return sha256Buffer(Buffer.from(contract, 'utf8'));
}

function classifyOutput(relativePath) {
  if (relativePath === 'world_vector_layers_50m.json') {
    return { classification: 'runtime', packaged: true, purpose: 'offline 50m overview' };
  }
  if (relativePath.indexOf('vector-preview/10m/') === 0) {
    return { classification: 'runtime', packaged: true, purpose: 'spatially indexed offline 10m preview' };
  }
  if (relativePath === 'vectors/cartography-policy.json' || relativePath === 'vectors/country-index-10m.json' ||
      relativePath === 'vectors/country-outlines-10m.json') {
    return { classification: 'runtime', packaged: true, purpose: 'country identity, policy or drawing geometry' };
  }
  if (relativePath === 'world_vector_layers_10m.json') {
    return { classification: 'build-intermediate', packaged: false, purpose: 'monolithic input used only to generate 10m preview chunks' };
  }
  return { classification: 'build-evidence', packaged: false, purpose: 'build-time provenance or validation output' };
}

function packageVersion(packageName) {
  return require(path.join(root, 'node_modules', packageName, 'package.json')).version;
}

function validateToolchain(sourceManifest) {
  const expected = sourceManifest.toolchain || {};
  const actualNode = process.versions.node;
  if (actualNode !== expected.node) throw new Error(`Node version mismatch: expected ${expected.node}, received ${actualNode}`);
  const dependencies = expected.dependencies || {};
  Object.keys(dependencies).forEach(packageName => {
    const actual = packageVersion(packageName);
    if (actual !== dependencies[packageName]) {
      throw new Error(`Tool version mismatch for ${packageName}: expected ${dependencies[packageName]}, received ${actual}`);
    }
  });
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  if (lockfile.lockfileVersion !== expected.npmLockfileVersion) {
    throw new Error(`npm lockfile version mismatch: expected ${expected.npmLockfileVersion}, received ${lockfile.lockfileVersion}`);
  }
}

function validateSources(sourceManifest) {
  if (!sourceManifest || sourceManifest.schemaVersion !== '2.0.0' || !Array.isArray(sourceManifest.sources)) {
    throw new Error('Vector source manifest schema is invalid.');
  }
  for (const source of sourceManifest.sources) {
    const sourcePath = path.resolve(sourceDirectory, source.path || '');
    if (!source.path || sourcePath.indexOf(sourceDirectory + path.sep) !== 0 || !fs.existsSync(sourcePath)) {
      throw new Error(`Pinned vector source is missing or unsafe: ${source.path || 'unknown'}`);
    }
    const buffer = fs.readFileSync(sourcePath);
    if (buffer.length !== source.bytes || sha256Buffer(buffer) !== source.sha256) {
      throw new Error(`Pinned vector source integrity failed: ${source.path}`);
    }
    if (!source.filename || !source.role || !source.license || (!source.url && !source.sourceLocator)) {
      throw new Error(`Pinned vector source provenance is incomplete: ${source.path}`);
    }
  }
}

function runBuilder(scriptName, args, dataDirectory) {
  const result = spawnSync(process.execPath, [path.join('scripts', scriptName), ...args, `--data-dir=${dataDirectory}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(`${scriptName} failed:\n${result.stdout || ''}${result.stderr || ''}`);
  }
  const summary = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
  if (summary) console.log(`  ${summary}`);
}

function buildCleanData(dataDirectory) {
  runBuilder('build-vector-data.js', ['--scale=50m'], dataDirectory);
  runBuilder('build-vector-data.js', ['--scale=10m'], dataDirectory);
  runBuilder('build-vector-preview-index.js', [], dataDirectory);
  runBuilder('build-land-border-data.js', [], dataDirectory);
  const geometry = verifyGeometry({ dataDir: dataDirectory });
  if (!geometry.ok) throw new Error(`Generated geometry failed: ${geometry.failures.join('; ')}`);
  console.log(`  [OpenGeo] Generated geometry: ${geometry.checks} golden checks passed.`);
}

function compareRecordSets(generated, canonical) {
  const generatedMap = new Map(generated.map(record => [record.path, record]));
  const canonicalMap = new Map(canonical.map(record => [record.path, record]));
  const failures = [];
  for (const [filePath, record] of generatedMap) {
    const approved = canonicalMap.get(filePath);
    if (!approved) failures.push(`generated-only output: ${filePath}`);
    else if (record.bytes !== approved.bytes || record.sha256 !== approved.sha256) failures.push(`content drift: ${filePath}`);
  }
  for (const filePath of canonicalMap.keys()) {
    if (!generatedMap.has(filePath)) failures.push(`canonical-only output: ${filePath}`);
  }
  if (failures.length) throw new Error(`Clean data build differs from checked-in runtime data:\n  - ${failures.slice(0, 20).join('\n  - ')}`);
}

function createManifest(sourceManifest, outputs) {
  return {
    schemaVersion: '1.0.0',
    purpose: 'Deterministic clean-build baseline for all OpenGeo vector runtime artifacts.',
    sourceManifest: {
      path: 'scripts/vector-data-sources/SOURCES_MANIFEST.json',
      version: sourceManifest.version,
      sha256: sha256File(sourceManifestPath)
    },
    toolchain: sourceManifest.toolchain,
    buildTools: buildTools.map(relativePath => {
      const filePath = path.join(root, relativePath);
      return { path: relativePath, bytes: fs.statSync(filePath).size, sha256: sha256File(filePath) };
    }),
    outputCount: outputs.length,
    outputBytes: outputs.reduce((sum, output) => sum + output.bytes, 0),
    aggregateSha256: aggregateOutputHash(outputs),
    outputs: outputs.map(output => Object.assign({}, output, classifyOutput(output.path)))
  };
}

function compareBaseline(actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  if (actual.sourceManifest.sha256 !== expected.sourceManifest.sha256) throw new Error('Source manifest SHA-256 differs from the approved reproducibility baseline.');
  if (JSON.stringify(actual.toolchain) !== JSON.stringify(expected.toolchain)) throw new Error('Toolchain differs from the approved reproducibility baseline.');
  if (JSON.stringify(actual.buildTools) !== JSON.stringify(expected.buildTools)) throw new Error('A build tool differs from the approved reproducibility baseline.');
  if (actual.aggregateSha256 !== expected.aggregateSha256 || actual.outputCount !== expected.outputCount) {
    throw new Error('Generated output hashes differ from the approved reproducibility baseline.');
  }
  throw new Error('Reproducibility manifest metadata differs from the approved baseline.');
}

function verifyReproducibility(options = {}) {
  const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
  validateSources(sourceManifest);
  validateToolchain(sourceManifest);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opengeo-vector-repro-'));
  const temporaryDataDirectory = path.join(tempRoot, 'client', 'assets', 'data');
  try {
    buildCleanData(temporaryDataDirectory);
    const generated = outputRecords(temporaryDataDirectory);
    const generatedRuntime = generated.filter(record => classifyOutput(record.path).packaged);
    const canonical = outputRecords(canonicalDataDir);
    compareRecordSets(generatedRuntime, canonical);
    const manifest = createManifest(sourceManifest, generated);
    if (options.record || recordMode) {
      fs.writeFileSync(baselinePath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      console.log(`[OpenGeo] Reproducibility baseline recorded: ${normalizeRelative(baselinePath, root)}`);
    } else {
      if (!fs.existsSync(baselinePath)) throw new Error('Reproducibility baseline is missing.');
      compareBaseline(manifest, JSON.parse(fs.readFileSync(baselinePath, 'utf8')));
    }
    return { ok: true, outputCount: manifest.outputCount, outputBytes: manifest.outputBytes, aggregateSha256: manifest.aggregateSha256 };
  } finally {
    const safeTempRoot = path.resolve(os.tmpdir()) + path.sep;
    const resolved = path.resolve(tempRoot);
    if (resolved.indexOf(safeTempRoot) === 0 && path.basename(resolved).startsWith('opengeo-vector-repro-')) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
}

if (require.main === module) {
  try {
    console.log(`[OpenGeo] Verifying clean vector-data reproduction${recordMode ? ' and recording baseline' : ''}...`);
    const result = verifyReproducibility({ record: recordMode });
    console.log(`[OpenGeo] Vector data reproducible: ${result.outputCount} files, ${result.outputBytes} bytes, aggregate ${result.aggregateSha256}.`);
  } catch (error) {
    console.error(`[OpenGeo] Vector-data reproducibility failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { verifyReproducibility, outputRecords, aggregateOutputHash, buildCleanData, classifyOutput };
