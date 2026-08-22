const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const defaultDataDir = path.join(root, 'client', 'assets', 'data');

function normalize(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function loadManifest(dataDir = defaultDataDir) {
  const manifestPath = path.join(dataDir, 'RUNTIME_DATA_MANIFEST.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Runtime data manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest || manifest.schemaVersion !== '1.0.0' || manifest.policy !== 'default-deny' || !Array.isArray(manifest.groups)) {
    throw new Error('Runtime data manifest schema is invalid.');
  }
  return manifest;
}

function matchesGroup(relativePath, group) {
  if (group.path) return relativePath === group.path;
  if (group.regex) return new RegExp(group.regex).test(relativePath);
  return false;
}

function classify(relativePath, manifest) {
  const normalized = normalize(relativePath);
  return manifest.groups.filter(group => matchesGroup(normalized, group));
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function isAllowedRuntimeFile(relativePath, manifest) {
  return classify(relativePath, manifest).length === 1;
}

function verifyRuntimeData(dataDir = defaultDataDir) {
  const manifest = loadManifest(dataDir);
  const failures = [];
  const files = walk(dataDir);
  const records = files.map(filePath => {
    const relativePath = normalize(path.relative(dataDir, filePath));
    const matches = classify(relativePath, manifest);
    if (matches.length !== 1) failures.push(`${relativePath}: expected one ownership group, received ${matches.length}`);
    const buffer = fs.readFileSync(filePath);
    return { path: relativePath, bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  });
  for (const group of manifest.groups) {
    const count = records.filter(record => matchesGroup(record.path, group)).length;
    const expectedCount = Number.isInteger(group.expectedCount) ? group.expectedCount : 1;
    if (count !== expectedCount) failures.push(`${group.id}: expected ${expectedCount} files, received ${count}`);
    if (!group.purpose || !group.consumer || !group.origin) failures.push(`${group.id}: ownership metadata is incomplete`);
  }
  for (const forbidden of manifest.forbiddenRuntimeArtifacts || []) {
    if (fs.existsSync(path.join(dataDir, forbidden))) failures.push(`forbidden runtime artifact exists: ${forbidden}`);
  }
  if (records.length !== manifest.expectedFileCount) failures.push(`runtime file count ${records.length} != ${manifest.expectedFileCount}`);
  return {
    ok: failures.length === 0,
    failures,
    records,
    fileCount: records.length,
    totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
    manifest
  };
}

if (require.main === module) {
  try {
    const result = verifyRuntimeData();
    if (!result.ok) throw new Error(result.failures.join('\n'));
    console.log(`[OpenGeo] Runtime data verified: ${result.fileCount} owned files, ${result.totalBytes} bytes.`);
  } catch (error) {
    console.error(`[OpenGeo] Runtime data verification failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { loadManifest, classify, isAllowedRuntimeFile, verifyRuntimeData };
