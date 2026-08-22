const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const clientDir = path.join(root, 'client');
const allowedClientNodeModules = new Set(['buffer', 'crypto', 'fs', 'os', 'path', 'process']);

function walk(directory, predicate) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(fullPath, predicate));
    else if (predicate(fullPath)) output.push(fullPath);
  }
  return output;
}

function auditSecurity() {
  const failures = [];
  const indexPath = path.join(clientDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const cspMatch = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=(["'])(.*?)\1/i);
  if (!cspMatch) failures.push('client/index.html has no Content-Security-Policy meta tag.');
  const csp = cspMatch ? cspMatch[2] : '';
  const requiredCsp = [
    "default-src 'self'",
    "script-src 'self'",
    'connect-src https:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ];
  for (const directive of requiredCsp) {
    if (!csp.includes(directive)) failures.push(`CSP is missing: ${directive}`);
  }
  if (/script-src[^;]*(?:unsafe-eval|https?:|\*)/i.test(csp)) failures.push('script-src permits remote or evaluated code.');

  const remoteStaticAsset = /<(?:script|link)\b[^>]*(?:src|href)=["'](?:https?:)?\/\//i;
  if (remoteStaticAsset.test(html)) failures.push('A script or stylesheet is loaded remotely.');

  const sourceFiles = walk(path.join(clientDir, 'js'), file => file.endsWith('.js'));
  const firstPartyFiles = sourceFiles.filter(file => !file.includes(`${path.sep}lib${path.sep}`));
  let nodeRequireCount = 0;
  const xhrOwners = [];
  const forbiddenSinkPattern = /\b(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(|\beval\s*\(|new\s+Function\s*\(|window\.open\s*\(|\blocation\s*=/;
  for (const file of firstPartyFiles) {
    const source = fs.readFileSync(file, 'utf8');
    if (/new\s+XMLHttpRequest\s*\(/.test(source)) xhrOwners.push(path.relative(root, file).replace(/\\/g, '/'));
    if (forbiddenSinkPattern.test(source)) failures.push(`Forbidden executable/HTML sink: ${path.relative(root, file)}`);
    const requirePattern = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = requirePattern.exec(source)) !== null) {
      nodeRequireCount++;
      if (!allowedClientNodeModules.has(match[1])) failures.push(`Client Node capability is not allowlisted: ${match[1]} in ${path.relative(root, file)}`);
    }
  }

  const providerManager = fs.readFileSync(path.join(clientDir, 'js', 'core', 'ProviderManager.js'), 'utf8');
  if (!/Custom XYZ URL must use HTTPS/.test(providerManager)) failures.push('Custom XYZ does not enforce HTTPS.');
  const settingsPanel = fs.readFileSync(path.join(clientDir, 'js', 'ui', 'SettingsPanel.js'), 'utf8');
  if (!/SecurityPolicy\.normalizeHttpsUrl/.test(settingsPanel)) failures.push('Attribution navigation does not use SecurityPolicy.');
  const expectedXhrOwners = ['client/js/tiles/TileTransport.js', 'client/js/ui/SearchPanel.js'];
  if (xhrOwners.sort().join('|') !== expectedXhrOwners.sort().join('|')) {
    failures.push(`XHR ownership changed without a network-policy review: ${xhrOwners.join(', ')}`);
  }
  const tileTransport = fs.readFileSync(path.join(clientDir, 'js', 'tiles', 'TileTransport.js'), 'utf8');
  const searchPanel = fs.readFileSync(path.join(clientDir, 'js', 'ui', 'SearchPanel.js'), 'utf8');
  if (!/validateHttpsUrl/.test(tileTransport) || !/maxBytes/.test(tileTransport) || !/validateFinalUrl/.test(tileTransport)) {
    failures.push('TileTransport does not enforce the shared HTTPS/size/redirect policy.');
  }
  if (!/request\.timeout\s*=/.test(searchPanel) || !/maxResponseBytes/.test(searchPanel) || !/validateFinalUrl/.test(searchPanel)) {
    failures.push('SearchPanel does not enforce timeout/size/redirect limits.');
  }

  if (failures.length) {
    const error = new Error(`Security audit failed:\n- ${failures.join('\n- ')}`);
    error.failures = failures;
    throw error;
  }
  return {
    csp,
    firstPartyFiles: firstPartyFiles.length,
    clientNodeRequireCount: nodeRequireCount,
    allowedClientNodeModules: Array.from(allowedClientNodeModules).sort(),
    xhrOwners: xhrOwners.sort()
  };
}

if (require.main === module) {
  try {
    const result = auditSecurity();
    console.log(`[OpenGeo] Security audit passed: ${result.firstPartyFiles} first-party JS files; ${result.clientNodeRequireCount} Node imports limited to ${result.allowedClientNodeModules.join(', ')}.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { auditSecurity };
