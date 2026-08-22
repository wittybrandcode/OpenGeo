const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const defaultPolicyPath = path.join(root, 'config', 'compatibility-policy.json');
const defaultManifestPath = path.join(root, 'CSXS', 'manifest.xml');
const defaultReportPath = path.join(root, 'release', 'compatibility-report.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function parseManifest(source) {
  const host = source.match(/<Host\s+Name="AEFT"\s+Version="([^"]+)"\s*\/>/);
  const runtime = source.match(/<RequiredRuntime\s+Name="CSXS"\s+Version="([^"]+)"\s*\/>/);
  const flags = Array.from(source.matchAll(/<Parameter>([^<]+)<\/Parameter>/g), match => match[1].trim());
  return {
    hostId: host ? 'AEFT' : null,
    hostRange: host ? host[1] : null,
    runtimeName: runtime ? 'CSXS' : null,
    runtimeVersion: runtime ? runtime[1] : null,
    flags
  };
}

function walk(directory, predicate) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath, predicate));
    else if (predicate(fullPath)) files.push(fullPath);
  }
  return files;
}

function sourceInventory(projectRoot = root) {
  const clientRoot = path.join(projectRoot, 'client');
  const jsFiles = walk(clientRoot, file => file.endsWith('.js'));
  const hostFiles = walk(path.join(projectRoot, 'host'), file => file.endsWith('.jsx'));
  const read = relativePath => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  const combined = jsFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const app = read('client/js/app.js');
  const stitcher = read('client/js/engine/MegaTileStitcher.js');
  const lucide = read('client/lib/lucide.min.js');
  const networkFiles = [
    read('client/js/tiles/TileTransport.js'),
    read('client/js/ui/SearchPanel.js')
  ].join('\n');
  const hostSource = hostFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const hostCode = hostSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return {
    javascriptFiles: jsFiles.length,
    extendScriptFiles: hostFiles.length,
    modernSyntax: {
      optionalChaining: /\?\./.test(lucide),
      objectSpread: /\{\.\.\./.test(lucide),
      asyncAwait: /\basync\b/.test(combined) && /\bawait\b/.test(combined)
    },
    nodeBuiltins: Array.from(new Set(Array.from(combined.matchAll(/require\(['"]([^'"]+)['"]\)/g), match => match[1]))).sort(),
    fallbacks: {
      resizeObserver: /if\s*\(window\.ResizeObserver\)/.test(app) && /_listen\(window,\s*['"]resize['"]/.test(app),
      workerOffscreenCanvas: /typeof window\.Worker\s*!==\s*['"]undefined['"]/.test(stitcher) &&
        /typeof OffscreenCanvas\s*!==\s*['"]undefined['"]/.test(stitcher) &&
        /Main Thread Fallback/.test(stitcher),
      xhrTransport: /XMLHttpRequest/.test(networkFiles)
    },
    extendScriptLegacySyntax: !/(^|[^.$\w])(let|const|class)\s|=>|`/.test(hostCode)
  };
}

function auditCompatibility(options = {}) {
  const policyPath = options.policyPath || defaultPolicyPath;
  const manifestPath = options.manifestPath || defaultManifestPath;
  const policy = readJson(policyPath);
  const manifest = parseManifest(fs.readFileSync(manifestPath, 'utf8'));
  const inventory = sourceInventory(options.root || root);
  const failures = [];

  if (manifest.hostId !== policy.host.id) failures.push(`Manifest host must be ${policy.host.id}.`);
  if (manifest.hostRange !== policy.host.manifestRange) failures.push(`Manifest host range must be ${policy.host.manifestRange}.`);
  if (manifest.runtimeName !== policy.runtime.name) failures.push(`Manifest runtime must be ${policy.runtime.name}.`);
  if (manifest.runtimeVersion !== policy.runtime.minimumVersion) failures.push(`Manifest runtime must be ${policy.runtime.minimumVersion}.`);
  for (const flag of policy.runtime.requiredManifestFlags) {
    if (!manifest.flags.includes(flag)) failures.push(`Manifest flag is missing: ${flag}.`);
  }
  if (!inventory.modernSyntax.optionalChaining || !inventory.modernSyntax.objectSpread || !inventory.modernSyntax.asyncAwait) {
    failures.push('Modern JavaScript syntax inventory is incomplete; review the CEP baseline before changing the contract.');
  }
  for (const [feature, available] of Object.entries(inventory.fallbacks)) {
    if (!available) failures.push(`Required compatibility fallback is missing: ${feature}.`);
  }
  if (!inventory.extendScriptLegacySyntax) failures.push('Host JSX contains syntax outside the legacy ExtendScript baseline.');
  const allowedNodeBuiltins = new Set(['buffer', 'crypto', 'fs', 'os', 'path', 'process']);
  const unexpectedBuiltins = inventory.nodeBuiltins.filter(moduleName => !allowedNodeBuiltins.has(moduleName));
  if (unexpectedBuiltins.length) failures.push(`Unexpected client Node modules: ${unexpectedBuiltins.join(', ')}.`);
  if (!policy.sources.length || policy.sources.some(source => !/^https:\/\/github\.com\/Adobe-CEP\//.test(source.url))) {
    failures.push('Compatibility sources must be official Adobe CEP HTTPS resources.');
  }

  const report = {
    schemaVersion: '1.0.0',
    decisionId: policy.decisionId,
    status: failures.length ? 'failed' : 'passed',
    manifest,
    supportContract: {
      host: policy.host,
      runtime: policy.runtime,
      capabilities: policy.capabilities
    },
    inventory,
    locallyProbedEnvironments: policy.locallyProbedEnvironments,
    sources: policy.sources,
    failures
  };
  return report;
}

function writeReport(reportPath = defaultReportPath, options = {}) {
  const report = auditCompatibility(options);
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
    console.log(`[OpenGeo] Compatibility contract passed: AE ${report.manifest.hostRange}, ${report.manifest.runtimeName} ${report.manifest.runtimeVersion}, ${report.inventory.javascriptFiles} JavaScript files.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { auditCompatibility, parseManifest, sourceInventory, writeReport };
