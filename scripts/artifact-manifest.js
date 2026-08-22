const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const defaultStageDir = path.join(root, 'release', 'stage');
const defaultManifestPath = path.join(root, 'release', 'artifact-manifest.json');

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function walkFiles(directory, baseDirectory = directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(fullPath, baseDirectory));
    else if (entry.isFile()) output.push(path.relative(baseDirectory, fullPath).replace(/\\/g, '/'));
  }
  return output.sort();
}

function buildManifest(stageDir = defaultStageDir, options = {}) {
  if (!fs.existsSync(stageDir) || !fs.statSync(stageDir).isDirectory()) throw new Error(`Stage directory is missing: ${stageDir}`);
  const files = walkFiles(stageDir).map(relativePath => {
    const filePath = path.join(stageDir, relativePath);
    const stats = fs.statSync(filePath);
    return { path: relativePath, bytes: stats.size, sha256: sha256File(filePath) };
  });
  const aggregateMaterial = files.map(file => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('');
  const packageJson = options.packageJson || JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const extensionManifest = fs.readFileSync(path.join(stageDir, 'CSXS', 'manifest.xml'), 'utf8');
  const bundleVersion = (extensionManifest.match(/ExtensionBundleVersion="([^"]+)"/) || [])[1] || null;
  const panelVersion = (extensionManifest.match(/<Extension\s+Id="com\.opengeo\.map\.panel"\s+Version="([^"]+)"/) || [])[1] || null;
  const extensionPropertiesPath = path.join(stageDir, 'CSXS', 'extension.properties');
  if (!fs.existsSync(extensionPropertiesPath)) throw new Error('CSXS/extension.properties is missing from the stage.');
  const extensionProperties = fs.readFileSync(extensionPropertiesPath, 'utf8');
  const propertiesVersion = (extensionProperties.match(/^version\s*=\s*([^\r\n]+)$/m) || [])[1] || null;
  const versions = [packageJson.version, bundleVersion, panelVersion, propertiesVersion];
  if (versions.some(version => !version || version !== packageJson.version)) {
    throw new Error(`Release version mismatch: package=${packageJson.version}, bundle=${bundleVersion}, panel=${panelVersion}, properties=${propertiesVersion}.`);
  }
  const sbomPath = options.sbomPath || path.join(root, 'release', 'sbom.cdx.json');
  if (!fs.existsSync(sbomPath)) throw new Error('SBOM is missing. Run the supply-chain audit first.');
  const compatibilityReportPath = options.compatibilityReportPath || path.join(root, 'release', 'compatibility-report.json');
  if (!fs.existsSync(compatibilityReportPath)) throw new Error('Compatibility report is missing. Run the compatibility audit first.');
  const performancePolicyPath = options.performancePolicyPath || path.join(root, 'config', 'performance-budgets.json');
  if (!fs.existsSync(performancePolicyPath)) throw new Error('Performance budget policy is missing.');
  return {
    schemaVersion: '1.0.0',
    artifact: 'release/stage',
    package: { name: packageJson.name, version: packageJson.version, bundleVersion, panelVersion, propertiesVersion },
    inputs: {
      packageLockSha256: sha256File(path.join(root, 'package-lock.json')),
      sbomSha256: sha256File(sbomPath),
      compatibilityReportSha256: sha256File(compatibilityReportPath),
      performancePolicySha256: sha256File(performancePolicyPath)
    },
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    aggregateSha256: sha256Buffer(Buffer.from(aggregateMaterial, 'utf8')),
    files
  };
}

function writeManifest(stageDir = defaultStageDir, manifestPath = defaultManifestPath, options = {}) {
  const manifest = buildManifest(stageDir, options);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

function verifyManifest(stageDir = defaultStageDir, manifestPath = defaultManifestPath, options = {}) {
  if (!fs.existsSync(manifestPath)) throw new Error('Artifact manifest is missing.');
  const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const actual = buildManifest(stageDir, options);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    const error = new Error(`Artifact manifest mismatch: expected ${expected.aggregateSha256 || 'unknown'}, got ${actual.aggregateSha256}.`);
    error.expected = expected;
    error.actual = actual;
    throw error;
  }
  return actual;
}

if (require.main === module) {
  try {
    const verify = process.argv.includes('--verify');
    const manifest = verify ? verifyManifest() : writeManifest();
    console.log(`[OpenGeo] Artifact manifest ${verify ? 'verified' : 'written'}: ${manifest.fileCount} files, ${manifest.totalBytes} bytes, ${manifest.aggregateSha256}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { buildManifest, writeManifest, verifyManifest, walkFiles };
