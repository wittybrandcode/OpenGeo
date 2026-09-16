// ==========================================
// OpenGeo ExtendScript Host: Helpers & Utilities
// ==========================================

var MAP_SIZE = 262144;         // Core Mercator World Size at Zoom 0
var TILE_REF_SIZE = 256;       // Reference tile size for scale calculation
var MAX_ZOOM = 23;             // Maximum allowed zoom level
var OVERSHOOT_PERCENT = 5;     // Extra % to scale tiles to fix seams

function hLog(msg) {
  try { $.writeln('[OpenGeo] ' + msg); } catch (e) {}
}

function hError(msg) {
  try { $.writeln('[OpenGeo ERROR] ' + msg); } catch (e) {}
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
      } catch (e) {}
    }
  } catch (compError) {}
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
  } catch (e) {}
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
      } catch (e) {}
    }
  } catch (compError) {}
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
          } catch (ignoreLayer) {}
        }
      } catch (ignoreOuter) {}
    }
  } catch (ignoreCandidate) {}
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
  } catch (nameError) {}
  if (path) {
    return JSON.stringify({ isSaved: true, path: path, projectName: projectName });
  } else {
    return JSON.stringify({ isSaved: false, projectName: projectName });
  }
}
