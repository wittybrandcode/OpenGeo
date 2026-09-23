// ============================================================================
// OpenGeo Project Maps — read-only project index and explicit map activation
// ============================================================================

var $ = typeof $ !== 'undefined' ? $ : {};
$._opengeo = $._opengeo || {};

function opengeoIsValidObject(obj) {
  if (!obj) return false;
  try {
    var test = obj.name;
    return true;
  } catch (e) {
    return false;
  }
}

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
    
    // Check if a high-quality PNG sequence exists for this map
    var seqFrames = [];
    var seqRevision = 0;
    for (var seqIdx = 0; seqIdx < 60; seqIdx++) {
      var seqFile = new File(projectPath + '/OpenGeo_Assets/Thumbnails/thumb_' + safeDocumentId + '_' + seqIdx + '.png');
      if (!seqFile.exists || seqFile.length <= 0) break;
      seqFrames.push(seqFile.fsName.replace(/\\/g, '/'));
      try {
        var m = seqFile.modified ? seqFile.modified.getTime() : seqFile.length;
        if (m > seqRevision) seqRevision = m;
      } catch (seqM) {
        /* sequence file stat fallback */
      }
    }
    var hasSequence = seqFrames.length > 1;

    // Check if an animated filmstrip sprite sheet exists for this map
    var stripFile = new File(projectPath + '/OpenGeo_Assets/Thumbnails/thumb_' + safeDocumentId + '_strip.png');
    var stripRevision = 0;
    var hasStrip = false;
    if (stripFile.exists && stripFile.length > 0) {
      hasStrip = true;
      try { stripRevision = stripFile.modified ? stripFile.modified.getTime() : stripFile.length; } catch (stripErr) { stripRevision = stripFile.length; }
    }

    return {
      path: file.fsName.replace(/\\/g, '/'),
      revision: revision,
      bytes: file.length,
      stripPath: hasStrip ? stripFile.fsName.replace(/\\/g, '/') : null,
      stripRevision: stripRevision,
      hasFilmstrip: hasStrip,
      hasSequence: hasSequence,
      sequenceFrames: seqFrames,
      sequenceCount: seqFrames.length,
      sequenceRevision: seqRevision
    };
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
  } catch (cameraError) {
    /* camera effect property lookup fallback */
  }
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
    stripPath: thumbnail ? thumbnail.stripPath : null,
    stripRevision: thumbnail ? thumbnail.stripRevision : null,
    hasFilmstrip: thumbnail ? thumbnail.hasFilmstrip : false,
    hasSequence: thumbnail ? thumbnail.hasSequence : false,
    sequenceFrames: thumbnail && thumbnail.sequenceFrames ? thumbnail.sequenceFrames : [],
    sequenceCount: thumbnail ? thumbnail.sequenceCount : 0,
    sequenceRevision: thumbnail ? thumbnail.sequenceRevision : 0,
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
      try {
        var item = app.project.items[itemIndex];
        if (!item || !opengeoIsValidObject(item) || !(item instanceof CompItem)) continue;
        var descriptor = opengeoProjectMapDescriptor(item, activeCompId);
        if (!descriptor) continue;
        if (maps.length >= maxMaps) { truncated = true; skippedCount++; continue; }
        maps.push(descriptor);
      } catch (itemError) {
        /* item inspection error fallback */
      }
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
    var stripTarget = new File(folder.fsName + '/thumb_' + actualDocument + '_strip.png');
    return JSON.stringify({
      compId: comp.id,
      documentId: actualDocument,
      thumbnailTargetPath: target.fsName.replace(/\\/g, '/'),
      thumbnailStripTargetPath: stripTarget.fsName.replace(/\\/g, '/'),
      thumbnailCaptureApiVersion: 5,
      thumbnailSource: 'opengeo-preview-canvas'
    });
  } catch (error) {
    return 'error: [PROJECT_MAP_THUMBNAIL_PREPARE_FAILED] ' + error.toString();
  }
}

function opengeoGenerateDuplicateName(baseDisplayName) {
  var name = String(baseDisplayName || 'OpenGeo Map').replace(/^\s+|\s+$/g, '');
  if (!app.project || !app.project.items) return name + ' (Copy)';

  // Check if baseName follows bullet-number format e.g. "OpenGeo Map • 3016"
  var dotPattern = /^(.*?)\s*•\s*(\d+)$/;
  var dotMatch = dotPattern.exec(name);
  if (dotMatch) {
    var prefix = dotMatch[1];
    var maxNum = parseInt(dotMatch[2], 10);
    for (var i = 1; i <= app.project.items.length; i++) {
      try {
        var item = app.project.items[i];
        if (item && item instanceof CompItem) {
          var itemDotMatch = dotPattern.exec(item.name);
          if (itemDotMatch && itemDotMatch[1] === prefix) {
            var n = parseInt(itemDotMatch[2], 10);
            if (n > maxNum) maxNum = n;
          }
        }
      } catch (e) {
        /* item inspection fallback */
      }
    }
    return prefix + ' • ' + (maxNum + 1);
  }

  // Handle custom display names e.g. "Algiers City Center" -> "(Copy)"
  var cleanBase = name.replace(/\s*\(Copy(\s+\d+)?\)$/i, '');
  var existingNames = {};
  for (var j = 1; j <= app.project.items.length; j++) {
    try {
      var it = app.project.items[j];
      if (it && it instanceof CompItem) {
        existingNames[it.name.toLowerCase()] = true;
      }
    } catch (e) {
      /* item name reading fallback */
    }
  }

  var candidate = cleanBase + ' (Copy)';
  if (!existingNames[candidate.toLowerCase()]) return candidate;

  var copyIdx = 2;
  while (copyIdx < 1000) {
    candidate = cleanBase + ' (Copy ' + copyIdx + ')';
    if (!existingNames[candidate.toLowerCase()]) return candidate;
    copyIdx++;
  }
  return cleanBase + ' (Copy ' + (new Date()).getTime() + ')';
}

function opengeoDuplicateProjectMap(compId, documentId) {
  try {
    if (!app.project) return 'error: [PROJECT_NOT_FOUND] No active project in After Effects';
    var sourceComp = ensureComp(compId);
    if (!sourceComp || !(sourceComp instanceof CompItem)) {
      return 'error: [MAP_NOT_FOUND] OpenGeo map composition was not found';
    }
    var sourceController = findLayerByComment(sourceComp, 'opengeo:controller');
    if (!sourceController) {
      return 'error: [MAP_CONTROLLER_MISSING] OpenGeo map controller is missing';
    }

    var descriptor = opengeoProjectMapDescriptor(sourceComp, sourceComp.id);
    var oldDocId = opengeoSanitizeIdentity(descriptor && descriptor.documentId ? descriptor.documentId : '');
    var expectedDocId = opengeoSanitizeIdentity(documentId || '');
    if (expectedDocId && oldDocId && oldDocId !== 'unknown' && oldDocId !== expectedDocId) {
      return 'error: [MAP_IDENTITY_MISMATCH] OpenGeo map identity does not match the requested composition';
    }

    return withUndoGroup('OpenGeo: Duplicate Map', function() {
      // 1. Generate unique new document ID and non-colliding names
      var timestamp = (new Date()).getTime().toString(36);
      var rand = Math.floor(Math.random() * 1679616).toString(36);
      var newDocumentId = opengeoSanitizeIdentity('doc_' + timestamp + '_' + rand);
      var newIdentitySuffix = newDocumentId.length > 10 ? newDocumentId.substring(newDocumentId.length - 10) : newDocumentId;
      var newDisplayName = opengeoGenerateDuplicateName(descriptor && descriptor.displayName ? descriptor.displayName : sourceComp.name);
      var newContainingCompName = newDisplayName + ' - ' + newIdentitySuffix;
      var newMapcompName = newDisplayName + ' - Map - ' + newIdentitySuffix;

      // 2. Locate source inner map pre-comp
      var sourceMapComp = null;
      for (var lIdx = 1; lIdx <= sourceComp.numLayers; lIdx++) {
        try {
          var lyr = sourceComp.layer(lIdx);
          if (lyr && lyr.source && lyr.source instanceof CompItem) {
            var lyrOwnership = typeof opengeoReadOwnership === 'function' ? opengeoReadOwnership(lyr.source.comment) : {};
            if (lyrOwnership.role === 'map-comp' || lyr.source.name.indexOf(' - Map - ') !== -1) {
              sourceMapComp = lyr.source;
              break;
            }
          }
        } catch (lErr) {
          /* inner layer inspection fallback */
        }
      }
      if (!sourceMapComp && typeof opengeoFindDocumentMapComp === 'function') {
        sourceMapComp = opengeoFindDocumentMapComp(oldDocId);
      }
      if (!sourceMapComp) {
        return 'error: [INNER_MAP_COMP_MISSING] Could not locate inner map pre-composition for duplication';
      }

      // 3. Deep-clone the inner mapComp
      var newMapComp = sourceMapComp.duplicate();
      newMapComp.name = newMapcompName;
      var folders = typeof getOpenGeoFolderStructure === 'function' ? getOpenGeoFolderStructure() : null;
      if (folders && folders.comps) {
        try {
          newMapComp.parentFolder = folders.comps;
        } catch (fErr) {
          /* folder move fallback */
        }
      }

      var sourceOwnership = typeof opengeoReadOwnership === 'function' ? opengeoReadOwnership(sourceMapComp.comment) : {};
      var sourceProvider = descriptor && descriptor.providerId ? descriptor.providerId : (sourceOwnership.source || '');
      newMapComp.comment = opengeoOwnershipComment(newDocumentId, 'map-comp', 'duplicate', sourceProvider ? 'source=' + sourceProvider : null);

      var newMapPivot = findLayerByName(newMapComp, 'MapPivot');
      if (newMapPivot) {
        newMapPivot.comment = opengeoOwnershipComment(newDocumentId, 'pivot', 'duplicate');
      }

      // Re-tag tile layers in newMapComp to newDocumentId so cache cleanups stay isolated
      for (var tileIdx = 1; tileIdx <= newMapComp.numLayers; tileIdx++) {
        try {
          var tLayer = newMapComp.layer(tileIdx);
          if (tLayer && tLayer !== newMapPivot) {
            var tComment = String(tLayer.comment || '');
            if (tComment.indexOf('document=' + oldDocId) !== -1) {
              tLayer.comment = tComment.replace('document=' + oldDocId, 'document=' + newDocumentId);
            } else if (tComment.indexOf('opengeo:') === 0 && typeof opengeoReadOwnership === 'function') {
              var tOwnership = opengeoReadOwnership(tComment);
              tLayer.comment = opengeoOwnershipComment(newDocumentId, tOwnership.role || 'tile', tOwnership.revision || 'duplicate');
            }
          }
        } catch (tErr) {
          /* tile layer tag update fallback */
        }
      }

      // 4. Duplicate the outer containing composition
      var newOuterComp = sourceComp.duplicate();
      newOuterComp.name = newContainingCompName;
      if (folders && folders.comps) {
        try {
          newOuterComp.parentFolder = folders.comps;
        } catch (fErr2) {
          /* folder move fallback */
        }
      }

      // 5. Replace nested pre-comp layer source in newOuterComp
      var newControllerLayer = null;
      for (var oIdx = 1; oIdx <= newOuterComp.numLayers; oIdx++) {
        try {
          var oLayer = newOuterComp.layer(oIdx);
          if (oLayer && oLayer.source && oLayer.source.id === sourceMapComp.id) {
            oLayer.replaceSource(newMapComp, false);
            oLayer.name = newMapcompName;
            oLayer.comment = opengeoOwnershipComment(newDocumentId, 'controller', null);
            newControllerLayer = oLayer;
          }
        } catch (repErr) {
          /* replace source fallback */
        }
      }

      if (!newControllerLayer) {
        newControllerLayer = findLayerByComment(newOuterComp, 'opengeo:controller');
        if (newControllerLayer) {
          newControllerLayer.comment = opengeoOwnershipComment(newDocumentId, 'controller', null);
        }
      }

      // 6. Re-install MapPivot expressions linking newMapPivot to newOuterComp & newMapComp
      if (newMapPivot && typeof opengeoInstallMapPivotExpressions === 'function') {
        opengeoInstallMapPivotExpressions(newMapPivot, newContainingCompName, newMapcompName, newOuterComp.width, newOuterComp.height);
      }

      // 7. Update camera expressions in newOuterComp if camera is present
      var newCameraLayer = findLayerByComment(newOuterComp, 'opengeo:camera') || findLayerByName(newOuterComp, 'OpenGeo Camera');
      if (newCameraLayer && newControllerLayer) {
        var ctrlNameEscaped = String(newControllerLayer.name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        var defaultZoom = 1874;
        try {
          if (newCameraLayer.property('Camera Options') && newCameraLayer.property('Camera Options').property('Zoom')) {
            defaultZoom = newCameraLayer.property('Camera Options').property('Zoom').value;
          }
        } catch (zErr) {
          /* camera zoom option fallback */
        }

        var camPoi = newCameraLayer.property('Point of Interest');
        if (camPoi) {
          camPoi.expression =
            'var ctrl = null;\n' +
            'try { ctrl = thisComp.layer("' + ctrlNameEscaped + '"); } catch(e) { /* ctrl layer fallback */ }\n' +
            'if (ctrl && ctrl.transform && ctrl.transform.position) {\n' +
            '  var p = ctrl.transform.position;\n' +
            '  [p[0], p[1], 0];\n' +
            '} else {\n' +
            '  [' + (newOuterComp.width / 2) + ', ' + (newOuterComp.height / 2) + ', 0];\n' +
            '}\n';
        }

        var camPos = newCameraLayer.property('Position');
        if (camPos) {
          camPos.expression =
            'var ctrl = null;\n' +
            'try { ctrl = thisComp.layer("' + ctrlNameEscaped + '"); } catch(e) { /* ctrl layer fallback */ }\n' +
            'if (!ctrl || !ctrl.effect || !ctrl.effect("Pitch")) {\n' +
            '  value;\n' +
            '} else {\n' +
            '  var p = ctrl.effect("Pitch")(1).value;\n' +
            '  var rad = Math.max(0, Math.min(45, p)) * 0.017453292519943295;\n' +
            '  var d = ' + defaultZoom + ';\n' +
            '  try { d = cameraOption.zoom.value; } catch(err) {\n' +
            '    try { d = cameraOption.zoom; } catch(err2) { /* camera zoom query fallback */ }\n' +
            '  }\n' +
            '  var poi = pointOfInterest;\n' +
            '  [poi[0], poi[1] + d * Math.sin(rad), -d * Math.cos(rad)];\n' +
            '}\n';
        }
      }

      // 8. Write independent JSON metadata into newOuterComp.comment
      var newMetadata = {};
      try {
        var parsedMeta = JSON.parse(sourceComp.comment || '{}');
        if (parsedMeta && parsedMeta.opengeo && typeof parsedMeta.opengeo === 'object') {
          for (var k in parsedMeta.opengeo) {
            if (parsedMeta.opengeo.hasOwnProperty(k)) {
              newMetadata[k] = parsedMeta.opengeo[k];
            }
          }
        }
      } catch (pErr) {
        /* source metadata parse fallback */
      }
      newMetadata.documentId = newDocumentId;
      newMetadata.displayName = newDisplayName;
      newMetadata.lastModified = (new Date()).getTime();
      newOuterComp.comment = JSON.stringify({ opengeo: newMetadata });

      // 9. Clone thumbnail files on disk if available
      try {
        var projectPath = typeof getProjectPath === 'function' ? getProjectPath() : null;
        if (projectPath && oldDocId) {
          var thumbsDir = projectPath + '/OpenGeo_Assets/Thumbnails';
          var srcThumb = new File(thumbsDir + '/thumb_' + oldDocId + '.png');
          if (srcThumb.exists && typeof srcThumb.copy === 'function') {
            srcThumb.copy(thumbsDir + '/thumb_' + newDocumentId + '.png');
          }
          var srcStrip = new File(thumbsDir + '/thumb_' + oldDocId + '_strip.png');
          if (srcStrip.exists && typeof srcStrip.copy === 'function') {
            srcStrip.copy(thumbsDir + '/thumb_' + newDocumentId + '_strip.png');
          }
          for (var sIdx = 0; sIdx < 60; sIdx++) {
            var seqSrc = new File(thumbsDir + '/thumb_' + oldDocId + '_' + sIdx + '.png');
            if (!seqSrc.exists) break;
            if (typeof seqSrc.copy === 'function') {
              seqSrc.copy(thumbsDir + '/thumb_' + newDocumentId + '_' + sIdx + '.png');
            }
          }
        }
      } catch (thumbCopyErr) {
        /* thumbnail file clone fallback */
      }

      // 10. Open in viewer, reset active cache, and return descriptor
      newOuterComp.openInViewer();
      if (typeof OPEN_GEO_ACTIVE_STATE_CACHE !== 'undefined') {
        OPEN_GEO_ACTIVE_STATE_CACHE.activeItemId = null;
        OPEN_GEO_ACTIVE_STATE_CACHE.comp = null;
        OPEN_GEO_ACTIVE_STATE_CACHE.controller = null;
      }

      var newDescriptor = opengeoProjectMapDescriptor(newOuterComp, newOuterComp.id);
      return JSON.stringify(newDescriptor || {
        compId: newOuterComp.id,
        documentId: newDocumentId,
        displayName: newDisplayName,
        active: true
      });
    });
  } catch (err) {
    return 'error: [PROJECT_MAP_DUPLICATE_FAILED] ' + err.toString();
  }
}

// Register project maps helpers on $._opengeo namespace
$._opengeo.projectMaps = {
  listProjectMaps: opengeoListProjectMaps,
  openProjectMap: opengeoOpenProjectMap,
  prepareProjectMapThumbnail: opengeoPrepareProjectMapThumbnail,
  duplicateProjectMap: opengeoDuplicateProjectMap,
  generateDuplicateName: opengeoGenerateDuplicateName
};
