const fs = require('fs');
const path = require('path');
const runtimeDataContract = require('./runtime-data-contract');

const ROOT = path.resolve(__dirname, '..');
const STAGE_DIR = path.join(ROOT, 'release', 'stage');
const SOURCE_DATA_DIR = path.join(ROOT, 'client', 'assets', 'data');
const runtimeDataManifest = runtimeDataContract.loadManifest(SOURCE_DATA_DIR);

// Directories and files to copy
const INCLUDES = [
  'client',
  'host',
  'CSXS'
];

// Patterns to exclude
const EXCLUDES = [
  '.debug',
  'node_modules',
  'src',
  'dist',
  'temp',
  'tests',
  '.git'
];

function shouldExclude(sourcePath) {
  const relativePath = path.relative(ROOT, sourcePath).replace(/\\/g, '/');
  for (const exclude of EXCLUDES) {
    if (relativePath === exclude || relativePath.startsWith(exclude + '/')) {
      return true;
    }
    // Also exclude generic file names anywhere in the tree if they match
    if (path.basename(sourcePath) === exclude) {
      return true;
    }
  }
  return false;
}

function copyRecursiveSync(src, dest) {
  if (shouldExclude(src)) return;

  const stats = fs.statSync(src);
  const isDirectory = stats.isDirectory();

  if (!isDirectory) {
    const resolvedSource = path.resolve(src);
    const dataRoot = path.resolve(SOURCE_DATA_DIR) + path.sep;
    if (resolvedSource.indexOf(dataRoot) === 0) {
      const relativeDataPath = path.relative(SOURCE_DATA_DIR, resolvedSource).replace(/\\/g, '/');
      if (!runtimeDataContract.isAllowedRuntimeFile(relativeDataPath, runtimeDataManifest)) {
        console.log(`  ↷ Skipped build-only data: ${relativeDataPath}`);
        return;
      }
    }
  }

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
    console.log(`  ✅ Copied: ${path.relative(ROOT, src)}`);
  }
}

function build() {
  console.log('====================================');
  console.log('[OpenGeo] Starting Build Pipeline...');
  console.log('====================================');

  // 1. Clean the stage directory
  if (fs.existsSync(STAGE_DIR)) {
    console.log('[OpenGeo] Cleaning old stage directory...');
    fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(STAGE_DIR, { recursive: true });

  // 2. Copy allowed directories
  console.log('[OpenGeo] Copying source files to stage...');
  INCLUDES.forEach(item => {
    const srcPath = path.join(ROOT, item);
    const destPath = path.join(STAGE_DIR, item);
    if (fs.existsSync(srcPath)) {
      copyRecursiveSync(srcPath, destPath);
    } else {
      console.error(`  ❌ Critical Error: Missing core directory ${item}`);
      process.exit(1);
    }
  });

  console.log('====================================');
  console.log(`[OpenGeo] Build complete → ${STAGE_DIR}`);
  console.log('====================================');
}

function clean() {
  console.log('====================================');
  console.log('[OpenGeo] Cleaning stage directory...');
  console.log('====================================');
  if (fs.existsSync(STAGE_DIR)) {
    fs.rmSync(STAGE_DIR, { recursive: true, force: true });
    console.log(`[OpenGeo] Stage directory cleaned: ${STAGE_DIR}`);
  } else {
    console.log('[OpenGeo] Stage directory already clean.');
  }
}

if (process.argv.includes('--clean') || process.argv.includes('clean')) {
  clean();
} else {
  build();
}
