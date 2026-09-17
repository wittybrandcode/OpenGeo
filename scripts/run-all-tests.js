'use strict';

/**
 * OpenGeo Master Automated QA Runner
 * Executes all test suites and generates the unified sign-off report.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const suites = [
  { name: 'Smoke, Security & Regression Suite', script: 'scripts/test.js' },
  { name: '4K Tile Pipeline & Fault-Injection Suite', script: 'scripts/tests/tile-pipeline/fault-injection.test.js' },
  { name: 'Viewport Resize & Camera Event Suite', script: 'scripts/tests/map/viewport-resize.test.js' },
  { name: 'Vector Rigging & Expression Architecture Suite', script: 'scripts/tests/vector/vector-rigging.test.js' },
  { name: 'Project Maps & Thumbnail Architecture Suite', script: 'scripts/tests/project-maps/project-maps.test.js' },
  { name: 'Universal Geo Link & Coordinate Parser Suite', script: 'scripts/tests/map/universal-geo-parser.test.js' },
  { name: 'Download Telemetry HUD Suite', script: 'scripts/tests/ui/download-telemetry.test.js' },
  { name: 'Tooltip Manager & Z-Index Suite', script: 'scripts/tests/ui/tooltip-manager.test.js' },
  { name: '3D Map Pitch & Horizon Architecture Suite', script: 'scripts/tests/map/pitch-3d.test.js' },
  { name: 'End-to-End Production Stress Suite', script: 'scripts/tests/e2e/production-stress.test.js' }
];

console.log('================================================================');
console.log('🚀 [OpenGeo] Launching Unified Master Quality Assurance Runner');
console.log('================================================================\n');

let allPassed = true;
const summary = [];

for (const suite of suites) {
  console.log(`▶ Executing Suite: ${suite.name} (${suite.script})...`);
  const start = Date.now();
  const result = spawnSync(process.execPath, [path.join(projectRoot, suite.script)], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.env
  });
  const duration = Date.now() - start;

  if (result.status === 0) {
    console.log(`  ✅ [PASSED] ${suite.name} in ${duration}ms\n`);
    summary.push({ name: suite.name, status: 'PASSED', duration });
  } else {
    console.error(`  ❌ [FAILED] ${suite.name} in ${duration}ms`);
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    allPassed = false;
    summary.push({ name: suite.name, status: 'FAILED', duration });
    break;
  }
}

console.log('================================================================');
console.log('📊 MASTER QA EXECUTION SUMMARY');
console.log('================================================================');
for (const item of summary) {
  const icon = item.status === 'PASSED' ? '✅' : '❌';
  console.log(` ${icon} [${item.status}] - ${item.name} (${item.duration}ms)`);
}
console.log('================================================================');

if (!allPassed) {
  console.error('\n❌ ONE OR MORE TEST SUITES FAILED. ABORTING DEPLOYMENT.');
  process.exit(1);
} else {
  console.log('\n🎉 ALL MASTER SUITES PASSED (100% GREEN). READY FOR SIGN-OFF.\n');
  process.exit(0);
}
