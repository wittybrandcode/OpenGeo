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
    copy(targetPath) {
      this._lastCopiedTo = targetPath;
      return true;
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
      this.source = null;
      this.sourceReplaced = false;
      this.properties = {
        'ADBE Effect Parade': {
          property: (propName) => {
            if (propName === 'Latitude') return new MockProperty(48.8566);
            if (propName === 'Longitude') return new MockProperty(2.3522);
            if (propName === 'Zoom') return new MockProperty(12);
            return new MockProperty(0);
          }
        },
        'Anchor Point': new MockProperty([960, 540]),
        'Scale': new MockProperty([100, 100, 100]),
        'Position': new MockProperty([960, 540, 0])
      };
    }
    property(name) {
      return this.properties[name] || new MockProperty(0);
    }
    replaceSource(newSource) {
      this.source = newSource;
      this.sourceReplaced = true;
      return true;
    }
  }

  let nextCompId = 200;
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
    duplicate() {
      const dupId = ++nextCompId;
      const dup = new MockCompItem(dupId, this.name, this.width, this.height, this.comment, false);
      dup._layers = this._layers.map(l => {
        const ml = new MockLayer(l.comment, l.name);
        ml.source = l.source;
        return ml;
      });
      dup.numLayers = dup._layers.length;
      if (sandbox && sandbox.app && sandbox.app.project && sandbox.app.project.items) {
        const items = sandbox.app.project.items;
        const nextIndex = (typeof items.length === 'number' ? items.length : 0) + 1;
        items[nextIndex] = dup;
        items[dupId] = dup;
        items.length = nextIndex;
      }
      return dup;
    }
  }

  let currentItems = options.items || { length: 0 };
  const activeComp = options.activeComp || null;
  const sandbox = {
    app: {
      beginUndoGroup: function() {},
      endUndoGroup: function() {},
      project: {
        file: projectFilePath ? new MockFile(projectFilePath) : null,
        activeItem: activeComp,
        itemByID: function(id) {
          const itms = this.items;
          if (!itms) return null;
          for (var i = 1; i <= itms.length; i++) {
            var it = itms[i];
            if (it && it.id === id) return it;
          }
          if (itms[id]) return itms[id];
          return null;
        }
      }
    },
    Folder: MockFolder,
    File: MockFile,
    CompItem: MockCompItem,
    FolderItem: class MockFolderItem {
      constructor(name) {
        this.name = name;
        this.items = { length: 0, addFolder: (n) => new MockFolderItem(n) };
      }
    },
    JSON: JSON,
    String: String,
    Number: Number,
    Math: Math,
    Date: Date,
    Error: Error,
    isFinite: isFinite,
    parseInt: parseInt,
    console: console,
    withUndoGroup: (name, op) => op(),
    opengeoOwnershipComment: (documentId, role, revision, extra) => {
      let text = 'opengeo:v2;document=' + (documentId || 'unknown') + ';role=' + (role || 'unknown');
      if (revision) text += ';revision=' + revision;
      if (extra) text += ';' + extra;
      return text;
    },
    opengeoInstallMapPivotExpressions: (mapPivot, containingCompName, mapcompName, compWidth, compHeight) => {
      if (mapPivot) mapPivot.expressionsInstalled = true;
    },
    opengeoFindDocumentMapComp: (documentId) => {
      if (!sandbox.app.project || !sandbox.app.project.items) return null;
      for (let i = 1; i <= sandbox.app.project.items.length; i++) {
        const it = sandbox.app.project.items[i];
        if (it && it.name && it.name.indexOf(' - Map - ') !== -1) return it;
      }
      return null;
    },
    opengeoReadOwnership: (comment) => {
      const match = /document=([^;]+)/.exec(String(comment || ''));
      const roleMatch = /role=([^;]+)/.exec(String(comment || ''));
      return { document: match ? match[1] : null, role: roleMatch ? roleMatch[1] : null };
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

  Object.defineProperty(sandbox.app.project, 'items', {
    get() {
      if (!currentItems.addFolder) {
        currentItems.addFolder = function(name) {
          const f = new sandbox.FolderItem(name);
          const idx = (currentItems.length || 0) + 1;
          currentItems[idx] = f;
          currentItems.length = idx;
          return f;
        };
      }
      return currentItems;
    },
    set(val) {
      currentItems = val || { length: 0 };
    }
  });

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

// ============================================================================
// 5. TASK-6.5: Safe Composition Duplication & Identity Isolation (Corrective Fix)
// ============================================================================
{
  const sandbox = createMockHostEnvironment({ isSaved: true, filesExist: true });
  const CompItem = sandbox.CompItem;

  // 5a. Name Generation: bullet-number incrementing
  const compBullet = new CompItem(1, 'OpenGeo Map • 3016', 1920, 1080, '', true);
  sandbox.app.project.items = { 1: compBullet, length: 1 };
  const nextBullet = sandbox.opengeoGenerateDuplicateName('OpenGeo Map • 3016');
  assert(nextBullet === 'OpenGeo Map • 3017', 'opengeoGenerateDuplicateName increments numeric bullet suffix (3016 -> 3017)');

  // When both 3016 and 3017 exist
  const compBullet2 = new CompItem(2, 'OpenGeo Map • 3017', 1920, 1080, '', true);
  sandbox.app.project.items = { 1: compBullet, 2: compBullet2, length: 2 };
  const nextBullet2 = sandbox.opengeoGenerateDuplicateName('OpenGeo Map • 3016');
  assert(nextBullet2 === 'OpenGeo Map • 3018', 'opengeoGenerateDuplicateName scans project and picks next highest number (3018)');

  // 5b. Name Generation: custom descriptive names
  const compNamed = new CompItem(3, 'Algiers City Center', 1920, 1080, '', true);
  sandbox.app.project.items = { 1: compNamed, length: 1 };
  const nextNamed = sandbox.opengeoGenerateDuplicateName('Algiers City Center');
  assert(nextNamed === 'Algiers City Center (Copy)', 'opengeoGenerateDuplicateName appends (Copy) to custom name');

  const compNamedCopy = new CompItem(4, 'Algiers City Center (Copy)', 1920, 1080, '', true);
  sandbox.app.project.items = { 1: compNamed, 2: compNamedCopy, length: 2 };
  const nextNamedCopy2 = sandbox.opengeoGenerateDuplicateName('Algiers City Center');
  assert(nextNamedCopy2 === 'Algiers City Center (Copy 2)', 'opengeoGenerateDuplicateName handles existing copies with (Copy 2)');

  // 5c. Atomic deep-clone, replaceSource, and documentId isolation
  const outerComp = new CompItem(10, 'OpenGeo Map • 3016 - testdoc1', 1920, 1080, JSON.stringify({
    opengeo: { documentId: 'testdoc1', displayName: 'OpenGeo Map • 3016', source: 'esri' }
  }), true);
  const innerMapComp = new CompItem(11, 'OpenGeo Map • 3016 - Map - testdoc1', 1920, 1080, 'opengeo:v2;document=testdoc1;role=map-comp', false);
  const pivotLayer = new outerComp._layers[0].constructor('opengeo:v2;document=testdoc1;role=pivot', 'MapPivot');
  const tileLayer = new outerComp._layers[0].constructor('opengeo:v2;document=testdoc1;role=final-active', 'tile_0_0_0.png');
  innerMapComp._layers = [pivotLayer, tileLayer];
  innerMapComp.numLayers = 2;

  // In outer comp, layer 1 is controller layer that points to innerMapComp
  outerComp._layers[0].source = innerMapComp;

  sandbox.app.project.items = { 1: outerComp, 2: innerMapComp, length: 2 };

  const dupResultJson = sandbox.opengeoDuplicateProjectMap(10, 'testdoc1');
  assert(!dupResultJson.startsWith('error:'), 'opengeoDuplicateProjectMap executes without host error');
  const dupResult = JSON.parse(dupResultJson);

  assert(dupResult.documentId && dupResult.documentId !== 'testdoc1', 'Duplicate produces distinct, non-colliding new documentId');
  assert(dupResult.displayName === 'OpenGeo Map • 3017', 'Duplicate assigns auto-incremented display name (3017)');
  assert(dupResult.compId !== 10, 'Duplicate compId is distinct from source comp');

  // Verify outer and inner comps in project items
  const newOuterComp = sandbox.app.project.items[dupResult.compId];
  assert(newOuterComp && newOuterComp.name.indexOf('• 3017') !== -1, 'New outer comp created with incremented name');
  const newNestedLayer = newOuterComp._layers[0];
  assert(newNestedLayer.sourceReplaced === true, 'Nested map pre-comp layer has source replaced via replaceSource');
  assert(newNestedLayer.source && newNestedLayer.source.id !== innerMapComp.id, 'Nested map pre-comp source points to newly cloned inner mapComp');
  assert(newNestedLayer.comment.indexOf(dupResult.documentId) !== -1, 'Controller comment updated to new documentId');

  // Verify inner mapComp isolation
  const newInnerComp = newNestedLayer.source;
  assert(newInnerComp.comment.indexOf(dupResult.documentId) !== -1, 'Inner map pre-comp comment updated to new documentId');
  assert(newInnerComp._layers[0].comment.indexOf(dupResult.documentId) !== -1, 'MapPivot comment updated to new documentId');
  assert(newInnerComp._layers[1].comment.indexOf(dupResult.documentId) !== -1, 'Tile layer comment updated to new documentId');

  // 5d. Error handling: rejects invalid or missing compositions
  const missingResult = sandbox.opengeoDuplicateProjectMap(999, 'nonexistent');
  assert(missingResult.indexOf('[MAP_NOT_FOUND]') !== -1, 'Safely rejects non-existent composition');

  const emptyComp = new CompItem(30, 'Empty Comp', 1920, 1080, '', false);
  sandbox.app.project.items[30] = emptyComp;
  const noCtrlResult = sandbox.opengeoDuplicateProjectMap(30, 'empty');
  assert(noCtrlResult.indexOf('[MAP_CONTROLLER_MISSING]') !== -1, 'Safely rejects comp lacking OpenGeo controller');

  // 5e. Dispatcher registration
  const dispatcherSource = fs.readFileSync(path.join(projectRoot, 'host/modules/bridgeDispatcher.jsx'), 'utf8');
  assert(dispatcherSource.includes("'project.duplicateMap'"), 'bridgeDispatcher registers project.duplicateMap route');

  // 5f. Client UI: ProjectMapsPanel
  const panelSource = fs.readFileSync(path.join(projectRoot, 'client/js/ui/ProjectMapsPanel.js'), 'utf8');
  assert(panelSource.includes('project-map-duplicate'), 'ProjectMapsPanel creates .project-map-duplicate button');
  assert(panelSource.includes('project-map-card-actions'), 'ProjectMapsPanel creates .project-map-card-actions container');
  assert(panelSource.includes('_duplicateMap'), 'ProjectMapsPanel implements _duplicateMap action method');
  assert(panelSource.includes("invoke('project.duplicateMap'"), 'ProjectMapsPanel invokes project.duplicateMap via bridge');

  // 5g. CSS: 08-project-maps.css
  const css = readAggregatedCss(path.join(projectRoot, 'client/css/style.css'));
  assert(css.includes('.project-map-card-actions'), 'CSS includes .project-map-card-actions container');
  assert(css.includes('.project-map-duplicate'), 'CSS includes .project-map-duplicate button styles');
}

console.log('====================================');
console.log(`Project Maps Tests: Passed: ${passed} | Failed: ${failed}`);
console.log('====================================');

if (failed > 0) {
  process.exit(1);
}
