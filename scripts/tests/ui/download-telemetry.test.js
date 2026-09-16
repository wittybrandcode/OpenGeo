const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('====================================');
console.log('OpenGeo Download Telemetry HUD Test Suite');
console.log('====================================');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

// Mock DOM elements
function createMockElement(id) {
  return {
    id,
    textContent: '',
    style: {},
    className: ''
  };
}

const elements = {
  'download-modal': createMockElement('download-modal'),
  'dl-cancel': createMockElement('dl-cancel'),
  'dl-title': createMockElement('dl-title'),
  'dl-subtitle': createMockElement('dl-subtitle'),
  'dl-phase-badge': createMockElement('dl-phase-badge'),
  'dl-info': createMockElement('dl-info'),
  'dl-percent': createMockElement('dl-percent'),
  'dl-progress-bar': createMockElement('dl-progress-bar'),
  'dl-done': createMockElement('dl-done'),
  'dl-total': createMockElement('dl-total'),
  'dl-remaining-tiles': createMockElement('dl-remaining-tiles'),
  'dl-remaining-size': createMockElement('dl-remaining-size'),
  'dl-total-size': createMockElement('dl-total-size'),
  'dl-speed': createMockElement('dl-speed'),
  'dl-eta': createMockElement('dl-eta'),
  'dl-resolution-text': createMockElement('dl-resolution-text'),
  'dl-transferred-text': createMockElement('dl-transferred-text')
};

global.document = {
  getElementById: (id) => elements[id] || null
};

const OperationPresenter = require('../../../client/js/ui/OperationPresenter');

const presenter = new OperationPresenter(
  { emit: () => {} },
  { subscribe: () => {} }
);

test('Renders active downloading state with live decreasing size and ETA', () => {
  presenter._applyDownloadModal({
    show: true,
    cancelable: true,
    phase: 'downloading',
    title: 'Downloading Tiles',
    subtitle: 'High-Resolution Map Finalize',
    phaseBadge: 'Stage 1 of 2: Map Imagery',
    info: 'Downloading tiles… 9.8 MB remaining (13 left)',
    pct: 32,
    done: 6,
    total: 19,
    remainingTiles: 13,
    downloadedMB: 4.7,
    totalMB: 14.5,
    remainingMB: 9.8,
    speed: '2.4 MB/s',
    eta: '~4s',
    resolution: '1920×1080'
  });

  assert.strictEqual(elements['download-modal'].style.display, 'flex');
  assert.strictEqual(elements['dl-cancel'].style.display, 'block');
  assert.strictEqual(elements['dl-title'].textContent, 'Downloading Tiles');
  assert.strictEqual(elements['dl-phase-badge'].textContent, 'Stage 1 of 2: Map Imagery');
  assert.strictEqual(elements['dl-percent'].textContent, '32%');
  assert.strictEqual(elements['dl-progress-bar'].style.width, '32%');
  assert.strictEqual(elements['dl-done'].textContent, 6);
  assert.strictEqual(elements['dl-total'].textContent, 19);
  assert.strictEqual(elements['dl-remaining-tiles'].textContent, '13 left');
  assert.strictEqual(elements['dl-remaining-size'].textContent, '9.8 MB');
  assert.strictEqual(elements['dl-total-size'].textContent, 'Total: ~14.5 MB');
  assert.strictEqual(elements['dl-speed'].textContent, '2.4 MB/s');
  assert.strictEqual(elements['dl-eta'].textContent, 'ETA: ~4s');
  assert.strictEqual(elements['dl-resolution-text'].textContent, '1920×1080');
  assert.strictEqual(elements['dl-transferred-text'].textContent, '4.7 MB downloaded');
});

test('Renders stitching phase with completed 0.0 MB remaining', () => {
  presenter._applyDownloadModal({
    show: true,
    cancelable: true,
    phase: 'stitching',
    title: 'Assembling MegaTiles',
    subtitle: 'Lossless Canvas Compilation',
    phaseBadge: 'Stage 2 of 2: MegaTile Stitch',
    info: 'Assembling MegaTile layer 1 of 4...',
    pct: 25,
    done: 1,
    total: 4,
    remainingTiles: 3,
    totalMB: 14.5,
    speed: 'Stitching',
    resolution: '3840×2160'
  });

  assert.strictEqual(elements['dl-title'].textContent, 'Assembling MegaTiles');
  assert.strictEqual(elements['dl-remaining-size'].textContent, '0.0 MB');
  assert.strictEqual(elements['dl-total-size'].textContent, 'Downloaded 100%');
  assert.strictEqual(elements['dl-phase-badge'].textContent, 'Stage 2 of 2: MegaTile Stitch');
  assert.strictEqual(elements['dl-resolution-text'].textContent, '3840×2160');
});

test('Hides modal when show is false', () => {
  presenter._applyDownloadModal({ show: false });
  assert.strictEqual(elements['download-modal'].style.display, 'none');
  assert.strictEqual(elements['dl-cancel'].style.display, 'none');
  assert.strictEqual(elements['dl-speed'].textContent, '--');
});

console.log('====================================');
console.log(`Download Telemetry Tests: Passed: ${passed} | Failed: ${failed}`);
console.log('====================================');

if (failed > 0) process.exit(1);
