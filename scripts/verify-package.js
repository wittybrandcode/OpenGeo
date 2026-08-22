const fs = require('fs');
const path = require('path');
const runtimeDataContract = require('./runtime-data-contract');

const STAGE_DIR = path.resolve(__dirname, '..', 'release', 'stage');

console.log('====================================');
console.log('[OpenGeo] Verifying Package Integrity...');
console.log('====================================');

if (!fs.existsSync(STAGE_DIR)) {
  console.error('❌ Stage directory missing. Run build first.');
  process.exit(1);
}

// 1. Core structural files
const coreFiles = [
  'CSXS/manifest.xml',
  'client/index.html',
  'host/index.jsx'
];

let failed = false;

try {
  const runtimeData = runtimeDataContract.verifyRuntimeData(path.join(STAGE_DIR, 'client', 'assets', 'data'));
  if (!runtimeData.ok) {
    runtimeData.failures.forEach(message => console.error(`❌ Runtime data: ${message}`));
    failed = true;
  }
} catch (error) {
  console.error(`❌ Runtime data verification crashed: ${error.message}`);
  failed = true;
}

coreFiles.forEach(file => {
  const p = path.join(STAGE_DIR, file);
  if (!fs.existsSync(p)) {
    console.error(`❌ Missing core file: ${file}`);
    failed = true;
  }
});

// 2. Parse index.html and ensure assets exist
const htmlPath = path.join(STAGE_DIR, 'client', 'index.html');
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  
  // Find scripts
  const scriptRegex = /<script\s+[^>]*src="([^"]+)"/g;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const src = match[1];
    if (src.startsWith('http')) continue;
    
    // Resolve relative to client/
    const assetPath = path.join(STAGE_DIR, 'client', src.split(/[?#]/)[0]);
    if (!fs.existsSync(assetPath)) {
      console.error(`❌ Broken script link in index.html: ${src}`);
      failed = true;
    }
  }

  // Find styles
  const linkRegex = /<link\s+[^>]*href="([^"]+)"/g;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    if (href.startsWith('http')) continue;
    
    const assetPath = path.join(STAGE_DIR, 'client', href.split(/[?#]/)[0]);
    if (!fs.existsSync(assetPath)) {
      console.error(`❌ Broken style link in index.html: ${href}`);
      failed = true;
    }
  }
}

// 3. Security Checks
const disallowed = [
  '.debug',
  'temp',
  'node_modules'
];

disallowed.forEach(d => {
  if (fs.existsSync(path.join(STAGE_DIR, d)) || fs.existsSync(path.join(STAGE_DIR, 'client', d))) {
    console.error(`❌ Security failure: Disallowed item found in build: ${d}`);
    failed = true;
  }
});

if (failed) {
  console.error('\n❌ VERIFICATION FAILED. Do not distribute this build.');
  process.exit(1);
} else {
  console.log('✅ Package Verified Successfully!');
  process.exit(0);
}
