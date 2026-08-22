const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const stageDir = path.join(root, 'release', 'stage');
let failed = false;

function fail(message) {
  failed = true;
  console.error(`FAIL: ${message}`);
}

function runNode(args, input) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    input,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    fail(`${process.execPath} ${args.join(' ')}\n${result.stdout || ''}${result.stderr || ''}`);
  }
}

function walk(directory, predicate) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'release') results.push(...walk(fullPath, predicate));
    } else if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

console.log('[OpenGeo] Running release verification...');
runNode(['scripts/verify-vector-data-reproducibility.js']);
runNode(['scripts/test.js']);
runNode(['scripts/security-audit.js']);
runNode(['scripts/compatibility-audit.js']);
runNode(['scripts/performance-audit.js']);
runNode(['scripts/supply-chain-audit.js']);
runNode(['scripts/build.js']);
runNode(['scripts/verify-package.js']);

for (const file of walk(path.join(root, 'client', 'js'), file => file.endsWith('.js'))) {
  runNode(['--check', file]);
}
for (const file of walk(path.join(root, 'host'), file => file.endsWith('.jsx'))) {
  const hostSource = fs.readFileSync(file, 'utf8');
  if (path.basename(file) === 'index.jsx') {
    const includePattern = /^\s*#include\s+"([^"]+)"\s*$/gm;
    let include;
    let includesFound = 0;
    while ((include = includePattern.exec(hostSource)) !== null) {
      includesFound++;
      if (!fs.existsSync(path.resolve(path.dirname(file), include[1]))) {
        fail(`Host include is missing: ${include[1]}`);
      }
    }
    if (includesFound === 0) fail('Host index has no module includes.');
    runNode(['--check', '-'], hostSource.replace(/^\s*#include.*$/gm, ''));
  } else {
    runNode(['--check', '-'], hostSource);
  }
}

const sourceFiles = [
  ...walk(path.join(root, 'client'), file => /\.(js|html|css)$/.test(file)),
  ...walk(path.join(root, 'host'), file => file.endsWith('.jsx'))
];
const allSource = sourceFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
if (/sourceMappingURL\s*=/.test(allSource)) fail('A bundled source-map reference remains without a packaged map.');

const bridgeFile = fs.readFileSync(path.join(root, 'client', 'js', 'core', 'AEBridge.js'), 'utf8');
const nonBridgeClient = walk(path.join(root, 'client', 'js'), file => file.endsWith('.js') && !file.endsWith(path.join('core', 'AEBridge.js')))
  .map(file => fs.readFileSync(file, 'utf8')).join('\n');
if (/_evalScript\s*\(/.test(nonBridgeClient)) fail('A client module bypasses AEBridge with _evalScript.');
if (!/opengeoDispatch\(/.test(bridgeFile)) fail('AEBridge does not target the host dispatcher.');

const legacyEndpoints = ['opengeoInitMap', 'opengeoSetMapRaster', 'opengeoClearTiles', 'opengeoGetCompState', 'opengeoSetLayerProperties', 'opengeoBakeTimeline'];
for (const endpoint of legacyEndpoints) {
  if (allSource.indexOf(endpoint) !== -1) fail(`Legacy endpoint still exists: ${endpoint}`);
}

if (!fs.existsSync(path.join(stageDir, 'client', 'lib', 'lucide.min.js'))) fail('Staged Lucide bundle is missing.');
runNode(['scripts/artifact-manifest.js']);
runNode(['scripts/artifact-manifest.js', '--verify']);
if (failed) process.exit(1);
console.log('[OpenGeo] Release verification passed.');
