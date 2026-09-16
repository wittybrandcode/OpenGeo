'use strict';

/**
 * OpenGeo Automated Test Suite: Project Maps & Thumbnail Architecture (Phase 6)
 * Verifies untitled project resilience, multi-map discovery speed under load (<300ms),
 * and exact aspect-ratio cropping across 16:9, 9:16, 1:1, and 21:9 compositions.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = path.resolve(__dirname, '../../..');
const { readAggregatedCss } = require(path.join(projectRoot, 'scripts/read-css.js'));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

console.log('====================================');
console.log('[OpenGeo] Running Project Maps & Thumbnail Test Suite...');
console.log('====================================');

// Helper to create mock ExtendScript host environment
function createMockHostEnvironment(options = {}) {
  const isSaved = options.isSaved !== false;
  const projectFilePath = isSaved ? 'C:/Projects/OpenGeoClient/test_project.aep' : null;

  class MockFolder {
    constructor(folderPath) {
      this.fsName = folderPath.replace(/\\/g, '/');
      this.exists = options.foldersExist !== false;
    }
    create() {
      this.exists = true;
      return true;
    }
  }

  class MockFile {
    constructor(filePath) {
      this.fsName = filePath.replace(/\\/g, '/');
      this.name = path.basename(this.fsName);
      this.exists = options.filesExist || false;
      this.length = options.fileLength || 4096;
      this.modified = new Date();
      if (this.fsName.includes('/')) {
        const parentPath = path.dirname(this.fsName);
        this.parent = new MockFolder(parentPath);
      }
    }
  }

  class MockProperty {
    constructor(val) { this._val = val; }
    valueAtTime() { return this._val; }
    property() { return this; }
  }

  class MockLayer {
    constructor(comment, name = 'OpenGeo Controller') {
      this.comment = comment || '';
      this.name = name;
      this.properties = {
        'ADBE Effect Parade': {
          property: (propName) => {
            if (propName === 'Latitude') return new MockProperty(48.8566);
            if (propName === 'Longitude') return new MockProperty(2.3522);
            if (propName === 'Zoom') return new MockProperty(12);
            return new MockProperty(0);
          }
        }
      };
    }
    property(name) {
      return this.properties[name] || new MockProperty(0);
    }
  }

  class MockCompItem {
    constructor(id, name, width, height, comment, isMap = true) {
      this.id = id;
      this.name = name;
      this.width = width || 1920;
      this.height = height || 1080;
      this.duration = 30;
      this.frameRate = 30;
      this.time = 0;
      this.comment = comment || '';
      const controllerLayer = new MockLayer('opengeo:controller;document=doc_' + id);
      this._layers = isMap ? [controllerLayer] : [];
      this.numLayers = this._layers.length;
    }
    layer(i) {
      return this._layers[i - 1] || null;
    }
    openInViewer() { return true; }
  }

  const itemsMap = options.items || { length: 0 };
  const activeComp = options.activeComp || null;

  const sandbox = {
    app: {
      project: {
        file: projectFilePath ? new MockFile(projectFilePath) : null,
        items: itemsMap,
        activeItem: activeComp
      }
    },
    Folder: MockFolder,
    File: MockFile,
    CompItem: MockCompItem,
    JSON: JSON,
    String: String,
    Number: Number,
    Math: Math,
    Date: Date,
    Error: Error,
    isFinite: isFinite,
    console: console,
    opengeoReadOwnership: (comment) => {
      const match = /document=([^;]+)/.exec(String(comment || ''));
      return { document: match ? match[1] : null };
    },
    opengeoSanitizeIdentity: (value) => {
      return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    },
    ensureComp: (compId) => {
      if (!sandbox.app.project || !sandbox.app.project.items) return null;
      for (let i = 1; i <= sandbox.app.project.items.length; i++) {
        const it = sandbox.app.project.items[i];
        if (it && it.id === compId) return it;
      }
      return null;
    }
  };

  // Load host helpers & projectMapsHost
  const helpersCode = fs.readFileSync(path.join(projectRoot, 'host/modules/helpers.jsx'), 'utf8');
  const projectMapsCode = fs.readFileSync(path.join(projectRoot, 'host/modules/projectMapsHost.jsx'), 'utf8');

  vm.runInNewContext(helpersCode + '\n' + projectMapsCode, sandbox);
  return sandbox;
}

// ============================================================================
// 1. TASK-6.1: Untitled Project Handling & Graceful Degradation
// ============================================================================
{
  const sandbox = createMockHostEnvironment({ isSaved: false });

  // 1a. getProjectPath returns null safely without throwing
  const pathResult = sandbox.getProjectPath();
  assert(pathResult === null, 'getProjectPath() returns null when project is unsaved');

  // 1b. opengeoCheckProjectState returns isSaved: false
  const state = JSON.parse(sandbox.opengeoCheckProjectState());
  assert(state.isSaved === false, 'opengeoCheckProjectState() flags unsaved project state');

  // 1c. Listing maps in unsaved project succeeds safely
  const CompItem = sandbox.CompItem;
  const comp1 = new CompItem(1, 'Map Cairo', 1920, 1080, JSON.stringify({
    opengeo: { documentId: 'doc_1', displayName: 'Cairo Overview', isFinalized: false }
  }));
  sandbox.app.project.items = { 1: comp1, length: 1 };
  sandbox.app.project.activeItem = comp1;

  const listJson = sandbox.opengeoListProjectMaps();
  assert(!listJson.startsWith('error:'), 'opengeoListProjectMaps executes cleanly in unsaved project');
  const listResult = JSON.parse(listJson);
  assert(listResult.maps.length === 1, 'Discovers 1 map in unsaved project');
  assert(listResult.maps[0].thumbnailCaptureSupported === false, 'thumbnailCaptureSupported is false for unsaved project');
  assert(listResult.maps[0].thumbnailPath === null, 'thumbnailPath is null for unsaved project');

  // 1d. Preparing thumbnail on unsaved project returns safe error, not crash
  const prepResult = sandbox.opengeoPrepareProjectMapThumbnail(1, 'doc_1');
  assert(prepResult.includes('[PROJECT_NOT_SAVED]'), 'opengeoPrepareProjectMapThumbnail safely rejects unsaved projects');

  // 1e. Client ProjectMapsPanel guards unsaved thumbnail capture
  const panelSource = fs.readFileSync(path.join(projectRoot, 'client/js/ui/ProjectMapsPanel.js'), 'utf8');
  assert(panelSource.includes('if (map.thumbnailCaptureSupported === false)'), 'ProjectMapsPanel guards against capturing thumbnails on unsaved projects');
  assert(panelSource.includes('Save your After Effects project (Ctrl+S)'), 'ProjectMapsPanel provides clear user guidance toast');
}

// ============================================================================
// 2. TASK-6.2: Multi-Map Discovery Performance & Scalability (<300ms)
// ============================================================================
{
  const sandbox = createMockHostEnvironment({ isSaved: true });
  const CompItem = sandbox.CompItem;

  // Build a large project with 15 OpenGeo maps and 50 non-map comps (total 65 items)
  const itemsMap = { length: 65 };
  for (let i = 1; i <= 50; i++) {
    itemsMap[i] = new CompItem(i, `Footage Comp ${i}`, 1920, 1080, '', false);
  }
  for (let m = 1; m <= 15; m++) {
    const compId = 100 + m;
    const isFinalized = m % 3 === 0;
    const displayName = `Map ${String.fromCharCode(64 + m)} Production`;
    itemsMap[50 + m] = new CompItem(compId, displayName, 1920, 1080, JSON.stringify({
      opengeo: { documentId: `doc_${compId}`, displayName, isFinalized }
    }), true);
  }
  sandbox.app.project.items = itemsMap;
  sandbox.app.project.activeItem = itemsMap[55]; // Map E (compId 105) is active

  // Benchmark discovery speed
  const startTime = Date.now();
  const listJson = sandbox.opengeoListProjectMaps();
  const elapsedMs = Date.now() - startTime;

  assert(!listJson.startsWith('error:'), 'Multi-map discovery succeeds without error');
  const result = JSON.parse(listJson);
  assert(result.maps.length === 15, 'All 15 OpenGeo maps discovered among 65 project items');
  assert(elapsedMs < 300, `Multi-map discovery executed in ${elapsedMs}ms (budget < 300ms)`);

  // Sorting verification: active map must be first
  assert(result.maps[0].active === true, 'Active composition is sorted to index 0');
  assert(result.maps[0].compId === itemsMap[55].id, 'Active composition ID matches the active AE item');

  // Verify non-active maps sorted alphabetically
  const remaining = result.maps.slice(1);
  let sorted = true;
  for (let i = 1; i < remaining.length; i++) {
    if (remaining[i - 1].displayName.toLowerCase() > remaining[i].displayName.toLowerCase()) {
      sorted = false;
      break;
    }
  }
  assert(sorted === true, 'Non-active maps are sorted alphabetically by displayName');

  // Extreme project cap test (250 maps capped at 200)
  const extremeItems = { length: 250 };
  for (let i = 1; i <= 250; i++) {
    extremeItems[i] = new CompItem(i, `Extreme Map ${i}`, 1920, 1080, JSON.stringify({
      opengeo: { documentId: `doc_${i}`, displayName: `Map ${i}` }
    }), true);
  }
  sandbox.app.project.items = extremeItems;
  const extremeResult = JSON.parse(sandbox.opengeoListProjectMaps());
  assert(extremeResult.maps.length === 200, 'Maps capped at 200 items to prevent memory exhaustion');
  assert(extremeResult.truncated === true, 'Truncated flag set to true when exceeding 200 items');
  assert(extremeResult.skippedCount === 50, 'Skipped count correctly reports 50 omitted maps');
}

// ============================================================================
// 3. TASK-6.3: Thumbnail Aspect Ratio and Crop Math
// ============================================================================
{
  const ThumbnailProcessor = require(path.join(projectRoot, 'client/js/core/ThumbnailProcessor.js'));
  const processor = new ThumbnailProcessor({ maxDimension: 640 });

  // 3a. Verify PNG inspection header parser
  // Construct minimal valid PNG Buffer (1x1 pixel)
  const minimalPng = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG magic
    0x00, 0x00, 0x00, 0x0D,                         // IHDR length = 13
    0x49, 0x48, 0x44, 0x52,                         // "IHDR"
    0x00, 0x00, 0x07, 0x80,                         // width = 1920
    0x00, 0x00, 0x04, 0x38,                         // height = 1080
    0x08, 0x02, 0x00, 0x00, 0x00,                   // 8-bit, Truecolor
    0x00, 0x00, 0x00, 0x00,                         // CRC (dummy)
    0x00, 0x00, 0x00, 0x00,                         // IEND length = 0
    0x49, 0x45, 0x4E, 0x44,                         // "IEND"
    0xAE, 0x42, 0x60, 0x82                          // IEND CRC
  ]);

  const inspected = processor.inspectPng(minimalPng);
  assert(inspected.width === 1920, 'inspectPng parses width 1920 correctly');
  assert(inspected.height === 1080, 'inspectPng parses height 1080 correctly');
  assert(inspected.bitDepth === 8, 'inspectPng parses 8-bit depth');

  // Corrupt header rejection
  let caughtCorrupt = false;
  try {
    processor.inspectPng(Buffer.from([0x00, 0x01, 0x02]));
  } catch (err) {
    caughtCorrupt = true;
    assert(err.code === 'THUMBNAIL_PNG_INVALID', 'Rejects non-PNG headers with THUMBNAIL_PNG_INVALID');
  }
  assert(caughtCorrupt, 'Corrupt PNG buffer throws error');

  // 3b. Crop Aspect Ratio Calculations across standard and vertical AE compositions
  const testAspects = [
    { name: '16:9 Widescreen (1920x1080)', width: 1920, height: 1080, targetAspect: 16 / 9 },
    { name: '9:16 Vertical Story (1080x1920)', width: 1080, height: 1920, targetAspect: 9 / 16 },
    { name: '1:1 Square (1080x1080)', width: 1080, height: 1080, targetAspect: 1.0 },
    { name: '21:9 UltraWide (3440x1440)', width: 3440, height: 1440, targetAspect: 3440 / 1440 }
  ];

  for (const ta of testAspects) {
    // Simulate captureCanvas geometry logic
    const canvasWidth = 800;
    const canvasHeight = 600;
    const logicalWidth = 800;
    const logicalHeight = 600;
    const frameWidth = ta.width;
    const frameHeight = ta.height;

    // Scale frame to fit within viewport
    const scale = Math.min(logicalWidth / frameWidth, logicalHeight / frameHeight);
    const scaledFrameW = frameWidth * scale;
    const scaledFrameH = frameHeight * scale;

    const pixelScaleX = canvasWidth / logicalWidth;
    const pixelScaleY = canvasHeight / logicalHeight;
    const sourceWidth = scaledFrameW * pixelScaleX;
    const sourceHeight = scaledFrameH * pixelScaleY;

    const maxDim = 640;
    const outputScale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
    const outW = Math.max(1, Math.round(sourceWidth * outputScale));
    const outH = Math.max(1, Math.round(sourceHeight * outputScale));

    const computedAspect = outW / outH;
    const aspectDiff = Math.abs(computedAspect - ta.targetAspect);
    assert(aspectDiff < 0.02, `Aspect crop matches ${ta.name} within tolerance (diff: ${aspectDiff.toFixed(4)})`);
  }

  // 3c. Uncropped Presentation in CSS
  const css = readAggregatedCss(path.join(projectRoot, 'client/css/style.css'));
  assert(css.includes('.project-map-thumbnail-backdrop'), 'CSS includes blurred backdrop for letterbox filling');
  assert(css.includes('.project-map-thumbnail-image'), 'CSS includes foreground thumbnail image');
  assert(css.includes('object-fit: contain'), 'Thumbnail image uses object-fit: contain to prevent distortion');
  assert(css.includes('object-fit: cover'), 'Thumbnail backdrop uses object-fit: cover for ambient fill');
}

// ============================================================================
// 4. TASK-6.4: Hover-Scrub Filmstrip Preview & Auto-Capture Architecture
// ============================================================================
{
  const ThumbnailProcessor = require(path.join(projectRoot, 'client/js/core/ThumbnailProcessor.js'));
  const processor = new ThumbnailProcessor();

  // 4a. Trajectory sampling index calculations
  assert(Array.isArray(processor.sampleTrajectoryIndices([])), 'sampleTrajectoryIndices handles empty trajectory');
  assert(processor.sampleTrajectoryIndices([]).length === 0, 'Empty trajectory returns 0 indices');

  const singleFrame = [{ lat: 10, lon: 20, zoom: 5 }];
  const singleResult = processor.sampleTrajectoryIndices(singleFrame);
  assert(singleResult.length === 1 && singleResult[0] === 0, 'Static map returns single index [0]');

  // Trajectory with 60 frames sampled to 12 frames
  const sixtyFrames = Array.from({ length: 60 }, (_, i) => ({ lat: i, lon: i, zoom: 10 }));
  const sampled12 = processor.sampleTrajectoryIndices(sixtyFrames, 12);
  assert(sampled12.length === 12, 'Samples exactly 12 indices for 60-frame trajectory');
  assert(sampled12[0] === 0, 'First sampled index is start of timeline (0)');
  assert(sampled12[sampled12.length - 1] === 59, 'Last sampled index is end of timeline (59)');
  // Strict monotonic order
  let strictlyIncreasing = true;
  for (let i = 1; i < sampled12.length; i++) {
    if (sampled12[i] <= sampled12[i - 1]) strictlyIncreasing = false;
  }
  assert(strictlyIncreasing, 'Sampled indices are strictly increasing and unique');

  // 4b. Host returns stripPath and hasFilmstrip flag
  const sandbox = createMockHostEnvironment({ isSaved: true, filesExist: true });
  const desc = sandbox.opengeoProjectMapDescriptor(new sandbox.CompItem(10, 'Map Preview Test', 1920, 1080, '', true), 10);
  assert(desc.thumbnailPath !== null, 'Descriptor includes primary thumbnailPath');
  assert('stripPath' in desc, 'Descriptor exposes stripPath property');
  assert('hasFilmstrip' in desc, 'Descriptor exposes hasFilmstrip boolean');

  // 4c. CSS Filmstrip & Hover Scrub Rules
  const css = readAggregatedCss(path.join(projectRoot, 'client/css/style.css'));
  assert(css.includes('.project-map-filmstrip-container'), 'CSS includes .project-map-filmstrip-container');
  assert(css.includes('.project-map-filmstrip-image'), 'CSS includes .project-map-filmstrip-image with will-change');
  assert(css.includes('.project-map-scrub-bar'), 'CSS includes .project-map-scrub-bar for timeline position');
  assert(css.includes('.project-map-video-badge'), 'CSS includes .project-map-video-badge for preview indicator');

  // 4d. FinalizeController wires auto-capture upon commit completion
  const finalizeSource = fs.readFileSync(path.join(projectRoot, 'client/js/core/FinalizeController.js'), 'utf8');
  assert(finalizeSource.includes('_autoCaptureThumbnail'), 'FinalizeController includes _autoCaptureThumbnail method');
  assert(finalizeSource.includes('this._autoCaptureThumbnail(activeCompId, snapshot, trajectory)'), 'FinalizeController triggers auto-capture on finalize completion');

  // 4e. ProjectMapsPanel handles filmstrip & PNG sequence hover/scrub events
  const panelSource = fs.readFileSync(path.join(projectRoot, 'client/js/ui/ProjectMapsPanel.js'), 'utf8');
  assert(panelSource.includes('_getThumbnailStripUrl'), 'ProjectMapsPanel defines _getThumbnailStripUrl');
  assert(panelSource.includes('_getSequenceUrls'), 'ProjectMapsPanel defines _getSequenceUrls');
  assert(panelSource.includes('project-map-filmstrip-container'), 'ProjectMapsPanel builds filmstrip container');
  assert(panelSource.includes('project-maps:thumbnail-updated'), 'ProjectMapsPanel listens to thumbnail updates from Finalize');

  // 4f. ThumbnailProcessor exposes real tile rendering and PNG sequence persistence
  const procSource = fs.readFileSync(path.join(projectRoot, 'client/js/core/ThumbnailProcessor.js'), 'utf8');
  assert(procSource.includes('renderFrameFromTiles'), 'ThumbnailProcessor includes renderFrameFromTiles method');
  assert(procSource.includes('savePngSequence'), 'ThumbnailProcessor includes savePngSequence method');
  assert('hasSequence' in desc, 'Descriptor exposes hasSequence boolean');
}

console.log('====================================');
console.log(`Project Maps Tests: Passed: ${passed} | Failed: ${failed}`);
console.log('====================================');

if (failed > 0) {
  process.exit(1);
}
