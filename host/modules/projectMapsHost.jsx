// ============================================================================
// OpenGeo Project Maps — read-only project index and explicit map activation
// ============================================================================

function opengeoProjectThumbnailInfo(documentId) {
  try {
    if (!app.project || !app.project.file) return null;
    var safeDocumentId = opengeoSanitizeIdentity(documentId || '');
    if (!safeDocumentId || safeDocumentId === 'unknown') return null;
    var projectPath = getProjectPath();
    if (!projectPath) return null;
    var file = new File(projectPath + '/OpenGeo_Assets/Thumbnails/thumb_' + safeDocumentId + '.png');
    if (!file.exists || file.length <= 0) return null;
    var revision = 0;
    try { revision = file.modified ? file.modified.getTime() : file.length; } catch (modifiedError) { revision = file.length; }
    return { path: file.fsName.replace(/\\/g, '/'), revision: revision, bytes: file.length };
  } catch (error) {
    return null;
  }
}

function opengeoEnsureProjectThumbnailFolder() {
  var projectPath = getProjectPath();
  if (!projectPath) throw new Error('[PROJECT_NOT_SAVED] Save the After Effects project before capturing a thumbnail');
  var assetsFolder = new Folder(projectPath + '/OpenGeo_Assets');
  if (!assetsFolder.exists && !assetsFolder.create()) throw new Error('[THUMBNAIL_FOLDER_FAILED] Could not create OpenGeo_Assets');
  var thumbnailFolder = new Folder(assetsFolder.fsName + '/Thumbnails');
  if (!thumbnailFolder.exists && !thumbnailFolder.create()) throw new Error('[THUMBNAIL_FOLDER_FAILED] Could not create the thumbnail folder');
  return thumbnailFolder;
}

function opengeoProjectMapDescriptor(comp, activeCompId) {
  var controller = findLayerByComment(comp, 'opengeo:controller');
  if (!controller) return null;
  var ownership = opengeoReadOwnership(controller.comment);
  var metadata = {};
  var metadataValid = true;
  try {
    var parsed = JSON.parse(comp.comment || '{}');
    metadata = parsed && parsed.opengeo && typeof parsed.opengeo === 'object' ? parsed.opengeo : {};
  } catch (metadataError) {
    metadataValid = false;
    metadata = {};
  }
  var effects = null;
  var camera = null;
  try {
    effects = controller.property('ADBE Effect Parade');
    camera = {
      lat: Number(effects.property('Latitude').property(1).valueAtTime(comp.time, false)),
      lng: Number(effects.property('Longitude').property(1).valueAtTime(comp.time, false)),
      zoom: Number(effects.property('Zoom').property(1).valueAtTime(comp.time, false))
    };
  } catch (cameraError) {}
  var displayName = String(metadata.displayName || comp.name || 'OpenGeo Map').substring(0, 80);
  var documentId = String(metadata.documentId || ownership.document || '');
  var thumbnail = opengeoProjectThumbnailInfo(documentId);
  return {
    compId: comp.id,
    documentId: documentId,
    displayName: displayName,
    compName: String(comp.name || ''),
    width: comp.width,
    height: comp.height,
    duration: comp.duration,
    frameRate: comp.frameRate,
    providerId: String(metadata.source || ''),
    camera: camera,
    isFinalized: metadata.isFinalized === true,
    featureCount: metadata.features && typeof metadata.features.length === 'number' ? metadata.features.length : 0,
    metadataValid: metadataValid,
    needsRepair: !metadataValid || !documentId,
    active: comp.id === activeCompId,
    thumbnailPath: thumbnail ? thumbnail.path : null,
    thumbnailRevision: thumbnail ? thumbnail.revision : null,
    thumbnailBytes: thumbnail ? thumbnail.bytes : 0,
    thumbnailCaptureSupported: !!(app.project && app.project.file),
    thumbnailCaptureApiVersion: 5
  };
}

function opengeoListProjectMaps() {
  try {
    if (!app.project) return JSON.stringify({ maps: [], skippedCount: 0, truncated: false });
    var activeResolved = resolveOpenGeoMapComp(app.project.activeItem);
    var activeCompId = activeResolved && activeResolved instanceof CompItem && findLayerByComment(activeResolved, 'opengeo:controller')
      ? activeResolved.id : null;
    var maps = [];
    var skippedCount = 0;
    var truncated = false;
    var maxMaps = 200;
    for (var itemIndex = 1; itemIndex <= app.project.items.length; itemIndex++) {
      var item = app.project.items[itemIndex];
      if (!(item instanceof CompItem)) continue;
      var descriptor = opengeoProjectMapDescriptor(item, activeCompId);
      if (!descriptor) continue;
      if (maps.length >= maxMaps) { truncated = true; skippedCount++; continue; }
      maps.push(descriptor);
    }
    maps.sort(function(left, right) {
      if (left.active !== right.active) return left.active ? -1 : 1;
      var leftName = String(left.displayName || '').toLowerCase();
      var rightName = String(right.displayName || '').toLowerCase();
      if (leftName < rightName) return -1;
      if (leftName > rightName) return 1;
      return left.compId - right.compId;
    });
    return JSON.stringify({ maps: maps, skippedCount: skippedCount, truncated: truncated });
  } catch (error) {
    return 'error: [PROJECT_MAPS_LIST_FAILED] ' + error.toString();
  }
}

function opengeoOpenProjectMap(compId, documentId) {
  try {
    var comp = ensureComp(compId);
    if (!comp) return 'error: [MAP_NOT_FOUND] OpenGeo map composition was not found';
    var controller = findLayerByComment(comp, 'opengeo:controller');
    if (!controller) return 'error: [MAP_CONTROLLER_MISSING] OpenGeo map controller is missing';
    var descriptor = opengeoProjectMapDescriptor(comp, comp.id);
    var actualDocument = opengeoSanitizeIdentity(descriptor && descriptor.documentId || '');
    var expectedDocument = opengeoSanitizeIdentity(documentId || actualDocument || '');
    if (!actualDocument || actualDocument === 'unknown' || actualDocument !== expectedDocument) {
      return 'error: [MAP_IDENTITY_MISMATCH] OpenGeo map identity does not match the selected composition';
    }
    comp.openInViewer();
    descriptor = opengeoProjectMapDescriptor(comp, comp.id);
    return JSON.stringify(descriptor || { compId: comp.id, documentId: actualDocument, active: true });
  } catch (error) {
    return 'error: [PROJECT_MAP_OPEN_FAILED] ' + error.toString();
  }
}

function opengeoPrepareProjectMapThumbnail(compId, documentId) {
  try {
    if (!app.project || !app.project.file) return 'error: [PROJECT_NOT_SAVED] Save the After Effects project first';
    var comp = ensureComp(compId);
    if (!comp || !(comp instanceof CompItem)) return 'error: [MAP_NOT_FOUND] OpenGeo map composition was not found';
    var controller = findLayerByComment(comp, 'opengeo:controller');
    if (!controller) return 'error: [MAP_CONTROLLER_MISSING] OpenGeo map controller is missing';
    var descriptor = opengeoProjectMapDescriptor(comp, comp.id);
    var actualDocument = opengeoSanitizeIdentity(descriptor && descriptor.documentId || '');
    var expectedDocument = opengeoSanitizeIdentity(documentId || '');
    if (!actualDocument || actualDocument === 'unknown' || actualDocument !== expectedDocument) {
      return 'error: [MAP_IDENTITY_MISMATCH] OpenGeo map identity does not match the selected composition';
    }
    var folder = opengeoEnsureProjectThumbnailFolder();
    var target = new File(folder.fsName + '/thumb_' + actualDocument + '.png');
    return JSON.stringify({
      compId: comp.id,
      documentId: actualDocument,
      thumbnailTargetPath: target.fsName.replace(/\\/g, '/'),
      thumbnailCaptureApiVersion: 5,
      thumbnailSource: 'opengeo-preview-canvas'
    });
  } catch (error) {
    return 'error: [PROJECT_MAP_THUMBNAIL_PREPARE_FAILED] ' + error.toString();
  }
}
