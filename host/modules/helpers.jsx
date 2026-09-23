// ==========================================
// OpenGeo ExtendScript Host: Helpers & Utilities
// ==========================================

var $ = typeof $ !== 'undefined' ? $ : {};
$._opengeo = $._opengeo || {};

// Core Mercator & Tile Constants (Encapsulated on $._opengeo namespace)
$._opengeo.MAP_SIZE = 262144;         // Core Mercator World Size at Zoom 0
$._opengeo.TILE_REF_SIZE = 256;       // Reference tile size for scale calculation
$._opengeo.MAX_ZOOM = 23;             // Maximum allowed zoom level
$._opengeo.OVERSHOOT_PERCENT = 5;     // Extra % to scale tiles to fix seams

// Global aliases for backward-compatibility across host includes (single combined declaration)
var MAP_SIZE = $._opengeo.MAP_SIZE,
    TILE_REF_SIZE = $._opengeo.TILE_REF_SIZE,
    MAX_ZOOM = $._opengeo.MAX_ZOOM,
    OVERSHOOT_PERCENT = $._opengeo.OVERSHOOT_PERCENT;

function hLog(msg) {
  try { $.writeln('[OpenGeo] ' + msg); } catch (e) { /* ExtendScript logging fallback */ }
}

function hError(msg) {
  try { $.writeln('[OpenGeo ERROR] ' + msg); } catch (e) { /* ExtendScript error logging fallback */ }
}

function opengeoSafeCall(fn, contextName, fallbackValue) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    hError('[' + (contextName || 'Anonymous') + '] Handled error: ' + (err.message || String(err)));
    return { ok: false, error: (err.message || String(err)), value: fallbackValue };
  }
}

// Centralized mutation boundary: every host write that uses this helper closes
// its undo group exactly once, including early returns and thrown errors.
function withUndoGroup(name, operation) {
  var started = false;
  try {
    app.beginUndoGroup(name);
    started = true;
    return operation();
  } finally {
    if (started) app.endUndoGroup();
  }
}

// Payload files crossing CEP -> ExtendScript must originate from the one
// OpenGeo job directory. This prevents a forged bridge request from turning
// the host into an arbitrary local-file JSON reader.
function opengeoIsManagedPayloadFile(file) {
  try {
    if (!file) return false;
    var rootFolder = new Folder(Folder.userData.fsName + '/OpenGeo/temp');
    var rootPath = String(rootFolder.fsName || '').replace(/\\/g, '/').toLowerCase();
    var filePath = String(file.fsName || '').replace(/\\/g, '/').toLowerCase();
    if (!rootPath || !filePath) return false;
    if (rootPath.charAt(rootPath.length - 1) !== '/') rootPath += '/';
    return filePath.indexOf(rootPath) === 0;
  } catch (error) {
    return false;
  }
}

function opengeoIsValidObject(obj) {
  if (!obj) return false;
  try {
    var test = obj.name;
    return true;
  } catch (e) {
    return false;
  }
}

function ensureComp(compId) {
  if (!app.project) return null;
  if (!compId) return null;
  try {
    var item = app.project.itemByID(parseInt(compId, 10));
    if (!item || !opengeoIsValidObject(item)) return null;
    return item instanceof CompItem ? item : null;
  } catch (e) {
    return null;
  }
}

function findLayerByName(comp, name) {
  if (!comp || !opengeoIsValidObject(comp)) return null;
  try {
    for (var i = 1; i <= comp.numLayers; i++) {
      try {
        var layer = comp.layer(i);
        if (layer && opengeoIsValidObject(layer) && layer.name === name) return layer;
      } catch (e) {
        /* layer index out of bounds or transient layer error */
      }
    }
  } catch (compError) {
    /* composition access error */
  }
  return null;
}


function hasEffect(layer, effectName) {
  if (!layer || !opengeoIsValidObject(layer)) return false;
  try {
    var effects = layer.property("ADBE Effect Parade");
    if (!effects) return false;
    for (var i = 1; i <= effects.numProperties; i++) {
      if (effects.property(i).name === effectName) return true;
    }
  } catch (e) {
    /* effect parade access fallback */
  }
  return false;
}

function findLayerByComment(comp, comment) {
  if (!comp || !opengeoIsValidObject(comp)) return null;
  try {
    for (var i = 1; i <= comp.numLayers; i++) {
      try {
        var layer = comp.layer(i);
        if (!layer || !opengeoIsValidObject(layer)) continue;
        var layerComment = String(layer.comment || '');
        if (layerComment === comment || layerComment.indexOf(comment + ';') === 0) return layer;
        if (comment === 'opengeo:controller' && layerComment.indexOf('opengeo:v2;') === 0 && layerComment.indexOf(';role=controller') !== -1) return layer;
      } catch (e) {
        /* transient layer comment error */
      }
    }
  } catch (compError) {
    /* composition access error */
  }
  return null;
}

// AE users may open the generated inner pre-composition. Resolve that view back
// to the owning outer OpenGeo composition so commands never mutate a sibling map.
function resolveOpenGeoMapComp(candidate) {
  if (!candidate || !opengeoIsValidObject(candidate) || !app.project) return candidate;
  try {
    if (findLayerByComment(candidate, 'opengeo:controller')) return candidate;
    for (var itemIndex = 1; itemIndex <= app.project.items.length; itemIndex++) {
      try {
        var outer = app.project.items[itemIndex];
        if (!outer || !opengeoIsValidObject(outer) || !(outer instanceof CompItem)) continue;
        for (var layerIndex = 1; layerIndex <= outer.numLayers; layerIndex++) {
          try {
            var layer = outer.layer(layerIndex);
            if (!layer || !opengeoIsValidObject(layer)) continue;
            if ((layer.comment === 'opengeo:controller' || String(layer.comment || '').indexOf('opengeo:controller;') === 0 || String(layer.comment || '').indexOf('opengeo:v2;') === 0 && String(layer.comment || '').indexOf(';role=controller') !== -1) && layer.source && layer.source.id === candidate.id) return outer;
          } catch (ignoreLayer) {
            /* layer access fallback */
          }
        }
      } catch (ignoreOuter) {
        /* project item access fallback */
      }
    }
  } catch (ignoreCandidate) {
    /* candidate resolution fallback */
  }
  return candidate;
}


// AE Folder Hierarchy Manager
function getOrCreateFolder(name, parentFolder) {
  var targetList = parentFolder ? parentFolder.items : app.project.items;
  for (var i = 1; i <= targetList.length; i++) {
    if (targetList[i] instanceof FolderItem && targetList[i].name === name) {
      return targetList[i];
    }
  }
  var newFolder = app.project.items.addFolder(name);
  if (parentFolder) newFolder.parentFolder = parentFolder;
  return newFolder;
}

function getOpenGeoFolderStructure() {
  var rootFolder = getOrCreateFolder("OpenGeo Assets");
  var previewFolder = getOrCreateFolder("Preview Tiles", rootFolder);
  var finalFolder = getOrCreateFolder("Final MegaTiles", rootFolder);
  var compsFolder = getOrCreateFolder("Compositions", rootFolder);
  var pinsFolder = getOrCreateFolder("Pins & Trackers", rootFolder);
  return {
    root: rootFolder,
    previewTiles: previewFolder,
    finalTiles: finalFolder,
    comps: compsFolder,
    pins: pinsFolder
  };
}

function getProjectPath() {
  if (app.project && app.project.file) {
    // Return path using forward slashes for cross-platform JS compatibility
    return app.project.file.parent.fsName.replace(/\\/g, '/');
  }
  return null;
}

function opengeoCheckProjectState() {
  var path = getProjectPath();
  var projectName = '';
  try {
    if (app.project && app.project.file) {
      projectName = String(app.project.file.displayName || app.project.file.name || '');
    }
  } catch (nameError) {
    /* project file is unsaved or name unavailable */
  }
  if (path) {
    return JSON.stringify({ isSaved: true, path: path, projectName: projectName });
  } else {
    return JSON.stringify({ isSaved: false, projectName: projectName });
  }
}

// Register helpers on $._opengeo namespace
$._opengeo.helpers = {
  hLog: hLog,
  hError: hError,
  withUndoGroup: withUndoGroup,
  opengeoIsManagedPayloadFile: opengeoIsManagedPayloadFile,
  opengeoIsValidObject: opengeoIsValidObject,
  ensureComp: ensureComp,
  findLayerByName: findLayerByName,
  hasEffect: hasEffect,
  findLayerByComment: findLayerByComment,
  resolveOpenGeoMapComp: resolveOpenGeoMapComp,
  getOrCreateFolder: getOrCreateFolder,
  getOpenGeoFolderStructure: getOpenGeoFolderStructure,
  getProjectPath: getProjectPath,
  opengeoCheckProjectState: opengeoCheckProjectState
};
