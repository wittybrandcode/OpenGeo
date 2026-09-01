'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '../../..');
const oraclePath = path.join(projectRoot, 'scripts', 'fixtures', 'tile-pipeline', 'failure-oracle.json');
const suitePath = path.join(__dirname, 'fault-injection.test.js');
const oracle = JSON.parse(fs.readFileSync(oraclePath, 'utf8'));
const result = spawnSync(process.execPath, [suitePath], {
  cwd: projectRoot,
  encoding: 'utf8',
  windowsHide: true
});

const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const marker = output.split(/\r?\n/).find(line => line.startsWith('OPEN_GEO_FAULT_SUMMARY='));
if (!marker) {
  console.error(output);
  throw new Error('Fault-injection suite did not emit its machine-readable summary.');
}

const summary = JSON.parse(marker.slice('OPEN_GEO_FAULT_SUMMARY='.length));
const expected = oracle.expectedFailures.map(entry => `${entry.id}:${entry.code}`).sort();
const actual = summary.failed.map(entry => `${entry.id}:${entry.code}`).sort();
const exactOracleMatch = expected.length === actual.length && expected.every((value, index) => value === actual[index]);

if (result.status === 0 || !exactOracleMatch || summary.passed.length || summary.harnessErrors.length) {
  console.error(output);
  throw new Error([
    'Red-baseline verification failed.',
    `processExit=${result.status}`,
    `expected=${expected.join(',')}`,
    `actual=${actual.join(',')}`,
    `unexpectedGreen=${summary.passed.join(',') || 'none'}`,
    `harnessErrors=${summary.harnessErrors.map(item => item.id).join(',') || 'none'}`
  ].join(' '));
}

console.log(`Tile-pipeline red baseline verified: ${actual.length}/${expected.length} expected failures, 0 harness errors.`);
