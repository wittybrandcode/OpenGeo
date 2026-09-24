// ============================================================================
// Atomic Finalize transaction: prepare hidden revision, commit one visible
// revision, or roll the prepared revision back without touching the active one.
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

function opengeoSanitizeIdentity(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function opengeoOwnershipComment(documentId, role, revision, extra) {
  var text = 'opengeo:v2;document=' + opengeoSanitizeIdentity(documentId) +
    ';role=' + String(role || 'unknown');
  if (revision) text += ';revision=' + opengeoSanitizeIdentity(revision);
  if (extra) text += ';' + String(extra);
  return text;
}

function opengeoReadOwnership(comment) {
  var result = {};
  var text = String(comment || '');
  if (text.indexOf('opengeo:v2;') !== 0) return result;
  var parts = text.split(';');
  for (var i = 1; i < parts.length; i++) {
    var equalsIndex = parts[i].indexOf('=');
    if (equalsIndex > 0) result[parts[i].substring(0, equalsIndex)] = parts[i].substring(equalsIndex + 1);
  }
  return result;
}

function opengeoOwnershipMatches(comment, documentId, role, revision) {
  var ownership = opengeoReadOwnership(comment);
  if (ownership.document !== opengeoSanitizeIdentity(documentId)) return false;
  if (role && ownership.role !== role) return false;
  if (revision && ownership.revision !== opengeoSanitizeIdentity(revision)) return false;
  return true;
}

function opengeoDiscardPreviewRevision(mapComp, folders, documentId, revision) {
  for (var layerIndex = mapComp.numLayers; layerIndex >= 1; layerIndex--) {
    var layer = mapComp.layer(layerIndex);
    try {
      if (opengeoOwnershipMatches(layer.comment, documentId, 'preview-staging', revision)) layer.remove();
    } catch (ignoreLayer) {
      /* preview staging layer remove fallback */
    }
  }
  if (!folders || !folders.previewTiles) return;
  for (var assetIndex = folders.previewTiles.numItems; assetIndex >= 1; assetIndex--) {
    var asset = folders.previewTiles.item(assetIndex);
    try {
      if (opengeoOwnershipMatches(asset.comment, documentId, 'preview-staging', revision)) asset.remove();
    } catch (ignoreAsset) {
      /* preview staging asset remove fallback */
    }
  }
}

/**
 * Atomically promotes a fully imported hidden preview revision. The previous
 * preview (and, only when requested, previous final) stays visible until every
 * new layer exists, preventing AE's viewer from revealing tiles one by one.
 */
function opengeoCommitPreviewRevision(mapComp, folders, documentId, revision, replaceFinal, expectedCount) {
  var expectedDocument = opengeoSanitizeIdentity(documentId);
  var expectedRevision = opengeoSanitizeIdentity(revision);
  var stagingLayers = [];
  var oldLayers = [];
  var layerIndex;
  for (layerIndex = 1; layerIndex <= mapComp.numLayers; layerIndex++) {
    var layer = mapComp.layer(layerIndex);
    var ownership = opengeoReadOwnership(layer.comment);
    if (ownership.document !== expectedDocument) continue;
    var isCurrentStage = ownership.role === 'preview-staging' && ownership.revision === expectedRevision;
    var isOldPreview = ownership.role === 'preview' || (ownership.role === 'preview-staging' && !isCurrentStage);
    var isReplaceableFinal = replaceFinal === true && ownership.role === 'final-active';
    if (isCurrentStage) stagingLayers.push(layer);
    else if (isOldPreview || isReplaceableFinal) oldLayers.push(layer);
  }

  // Validate the complete hidden revision before touching the visible one.
  var requiredCount = parseInt(expectedCount, 10) || 0;
  if (requiredCount > 0 && stagingLayers.length !== requiredCount) return 0;

  var promoted = 0;
  try {
    for (var stageIndex = 0; stageIndex < stagingLayers.length; stageIndex++) {
      var stageLayer = stagingLayers[stageIndex];
      var stageOwnership = opengeoReadOwnership(stageLayer.comment);
      var stagePlacement = stageOwnership.placement || stageOwnership.key || '';
      stageLayer.comment = opengeoOwnershipComment(documentId, 'preview', revision, stagePlacement ? 'placement=' + stagePlacement : '');
      if (stageLayer.source) stageLayer.source.comment = opengeoOwnershipComment(documentId, 'preview', revision, stagePlacement ? 'placement=' + stagePlacement : '');
      stageLayer.enabled = true;
      if (replaceFinal !== true && typeof stageLayer.moveToEnd === 'function') {
        try {
          stageLayer.moveToEnd();
        } catch (ignoreMove) {
          /* moveToEnd layer order fallback */
        }
      }
      promoted++;
    }
  } catch (promotionError) {
    // Roll the new revision back to an invisible staging state. The previous
    // preview/final was not modified, so AE never exposes a blank map.
    for (var rollbackIndex = 0; rollbackIndex < stagingLayers.length; rollbackIndex++) {
      try {
        var rollbackLayer = stagingLayers[rollbackIndex];
        var rollbackOwnership = opengeoReadOwnership(rollbackLayer.comment);
        var rollbackPlacement = rollbackOwnership.placement || rollbackOwnership.key || '';
        rollbackLayer.comment = opengeoOwnershipComment(documentId, 'preview-staging', revision, rollbackPlacement ? 'placement=' + rollbackPlacement : '');
        if (rollbackLayer.source) rollbackLayer.source.comment = opengeoOwnershipComment(documentId, 'preview-staging', revision, rollbackPlacement ? 'placement=' + rollbackPlacement : '');
        rollbackLayer.enabled = false;
      } catch (ignoreRollback) {
        /* staging rollback disable fallback */
      }
    }
    return 0;
  }

  if (requiredCount > 0 && promoted !== requiredCount) return 0;

  // Remove the prior visible revision only after the new one is complete.
  for (var oldLayerIndex = oldLayers.length - 1; oldLayerIndex >= 0; oldLayerIndex--) {
    try {
      oldLayers[oldLayerIndex].remove();
    } catch (ignoreOldLayer) {
      /* prior layer remove fallback */
    }
  }

  var foldersToClean = [folders && folders.previewTiles];
  if (replaceFinal === true) foldersToClean.push(folders && folders.finalTiles);
  for (var folderIndex = 0; folderIndex < foldersToClean.length; folderIndex++) {
    var folder = foldersToClean[folderIndex];
    if (!folder) continue;
    for (var assetIndex = folder.numItems; assetIndex >= 1; assetIndex--) {
      var asset = folder.item(assetIndex);
      var assetOwnership = opengeoReadOwnership(asset.comment);
      if (assetOwnership.document !== expectedDocument) continue;
      var keepCurrentRevision = assetOwnership.revision === expectedRevision &&
        (assetOwnership.role === 'preview' || assetOwnership.role === 'preview-staging');
      var keepFinal = replaceFinal !== true && assetOwnership.role === 'final-active';
      if (!keepCurrentRevision && !keepFinal) {
        try {
          asset.remove();
        } catch (ignoreOldAsset) {
          /* old asset remove fallback */
        }
      }
    }
  }
  return promoted;
}

function opengeoResolveTransactionComps(compId, documentId) {
  var containingComp = ensureComp(compId);
  if (!containingComp) throw new Error('Target OpenGeo composition was not found');
  containingComp = resolveOpenGeoMapComp(containingComp);
  var controller = findLayerByComment(containingComp, 'opengeo:controller');
  if (!controller || !controller.source || !(controller.source instanceof CompItem)) {
    throw new Error('OpenGeo controller or inner map composition is missing');
  }
  return { containingComp: containingComp, mapComp: controller.source, controller: controller };
}

function opengeoRemovePreparedRevision(mapComp, folders, documentId, revision) {
  var removedLayers = 0;
  var removedAssets = 0;
  if (!mapComp || !opengeoIsValidObject(mapComp)) return { layers: 0, assets: 0 };
  for (var layerIndex = mapComp.numLayers; layerIndex >= 1; layerIndex--) {
    try {
      var layer = mapComp.layer(layerIndex);
      if (layer && opengeoIsValidObject(layer) && opengeoOwnershipMatches(layer.comment, documentId, 'final-staging', revision)) {
        layer.remove();
        removedLayers++;
      }
    } catch (ignoreLayer) {
      /* final staging layer remove fallback */
    }
  }
  if (folders && folders.finalTiles && opengeoIsValidObject(folders.finalTiles)) {
    for (var assetIndex = folders.finalTiles.numItems; assetIndex >= 1; assetIndex--) {
      try {
        var asset = folders.finalTiles.item(assetIndex);
        if (asset && opengeoIsValidObject(asset) && opengeoOwnershipMatches(asset.comment, documentId, 'final-staging', revision)) {
          asset.remove();
          removedAssets++;
        }
      } catch (ignoreAsset) {
        /* final staging asset remove fallback */
      }
    }
  }
  return { layers: removedLayers, assets: removedAssets };
}

function opengeoPrepareCompositionRevision(jsonData) {
  var data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
  var operationId = opengeoSanitizeIdentity(data && data.operationId);
  var documentId = opengeoSanitizeIdentity(data && data.documentId);
  var tiles = data && data.tiles;
  var result = {
    ok: false,
    operationId: operationId,
    documentId: documentId,
    expected: tiles instanceof Array ? tiles.length : 0,
    imported: 0,
    reused: 0,
    assetIds: [],
    failed: [],
    warnings: [],
    phase: 'prepare'
  };

  if (!data || !data.compId || !operationId || !documentId || !(tiles instanceof Array) || tiles.length === 0) {
    result.failed.push({ key: '', code: 'INVALID_PREPARE_PAYLOAD' });
    return JSON.stringify(result);
  }
  if (tiles.length > 10000) {
    result.failed.push({ key: '', code: 'TILE_LIMIT_EXCEEDED' });
    return JSON.stringify(result);
  }

  var resolved;
  try {
    resolved = opengeoResolveTransactionComps(data.compId, documentId);
  } catch (resolveError) {
    result.failed.push({ key: '', code: 'TARGET_NOT_FOUND', message: resolveError.toString() });
    return JSON.stringify(result);
  }
  var folders = getOpenGeoFolderStructure();

  // Validate every file before the first project mutation.
  for (var validationIndex = 0; validationIndex < tiles.length; validationIndex++) {
    var validationTile = tiles[validationIndex];
    var validationFile = new File(String(validationTile.filePath || '').replace(/\\/g, '/'));
    if (!validationFile.exists || validationFile.length < 500) {
      result.failed.push({ placementKey: opengeoTilePlacementIdentity(validationTile, validationIndex), code: 'TILE_FILE_INVALID' });
    }
  }
  if (result.failed.length > 0) return JSON.stringify(result);

  return withUndoGroup('OpenGeo: Prepare Finalize', function() {
    opengeoRemovePreparedRevision(resolved.mapComp, folders, documentId, operationId);
    var createdLayers = [];
    var createdAssets = [];
    var mapPivot = findLayerByName(resolved.mapComp, 'MapPivot');
    if (!mapPivot) {
      result.failed.push({ key: '', code: 'MAP_PIVOT_MISSING' });
      return JSON.stringify(result);
    }
    mapPivot.threeDLayer = true;

    if (tiles instanceof Array && tiles.length > 1) {
      tiles.sort(function(a, b) {
        var za = (a && a.sourceZoom !== undefined ? a.sourceZoom : (a ? a.z : 0)) || 0;
        var zb = (b && b.sourceZoom !== undefined ? b.sourceZoom : (b ? b.z : 0)) || 0;
        return za - zb;
      });
    }

    for (var tileIndex = 0; tileIndex < tiles.length; tileIndex++) {
      var tile = tiles[tileIndex];
      var tileKey = opengeoTilePlacementIdentity(tile, tileIndex);
      var tileFile = new File(String(tile.filePath).replace(/\\/g, '/'));
      var footageItem = null;
      try {
        footageItem = app.project.importFile(new ImportOptions(tileFile));
        if (!footageItem) throw new Error('Import returned no footage item');
        footageItem.parentFolder = folders.finalTiles;
        footageItem.comment = opengeoOwnershipComment(documentId, 'final-staging', operationId, 'placement=' + tileKey);
        createdAssets.push(footageItem);

        var tileLayer = resolved.mapComp.layers.add(footageItem);
        tileLayer.name = 'staging_' + operationId + '_' + tile.z + '_' + tile.x + '_' + tile.y;
        tileLayer.comment = opengeoOwnershipComment(documentId, 'final-staging', operationId, 'placement=' + tileKey);
        tileLayer.enabled = false;
        tileLayer.threeDLayer = true;
        var worldTileSize = MAP_SIZE / Math.pow(2, tile.z);
        var tileActualSize = footageItem.width || 256;
        tileLayer.property('Anchor Point').setValue([0, 0, 0]);
        tileLayer.parent = mapPivot;
        tileLayer.property('Position').setValue([tile.x * worldTileSize, tile.y * worldTileSize, 0]);
        // Sub-pixel seam-seal scale: overlaps borders by exactly 1.5 texels to eliminate AE 3D antialiasing seam gaps across all zoom keyframes
        var exactScale = (worldTileSize / tileActualSize) * 100;
        var oneScreenPixelInWorld = worldTileSize / tileActualSize;
        var subpixelBleed = oneScreenPixelInWorld * 1.5;
        var seamSealScale = ((worldTileSize + subpixelBleed) / tileActualSize) * 100;
        tileLayer.property('Scale').setValue([seamSealScale, seamSealScale, 100]);
        try {
          tileLayer.quality = LayerQuality.BEST;
          tileLayer.samplingQuality = LayerSamplingQuality.BILINEAR;
        } catch (qualityError) {
          /* layer quality/sampling fallback */
        }
        try {
          tileLayer.blendingMode = BlendingMode.NORMAL;
        } catch (blendError) {
          /* layer blending fallback */
        }

        // Apply smooth solid-base opacity transitions (eliminates crossfade darkening dip / alpha hole)
        if (data.zoomTransitions && data.zoomTransitions.length > 0) {
          try {
            var opacityProp = tileLayer.property('Opacity') || (tileLayer.property('ADBE Transform Group') && tileLayer.property('ADBE Transform Group').property('ADBE Opacity'));
            if (opacityProp && typeof opacityProp.setValueAtTime === 'function') {
              var effectiveZ = (tile.sourceZoom !== undefined ? tile.sourceZoom : tile.z);
              for (var trIdx = 0; trIdx < data.zoomTransitions.length; trIdx++) {
                var tr = data.zoomTransitions[trIdx];
                var isZoomIn = tr.toZoom > tr.fromZoom;
                var lowerZ = Math.min(tr.fromZoom, tr.toZoom);
                var higherZ = Math.max(tr.fromZoom, tr.toZoom);

                if (effectiveZ === higherZ) {
                  // Higher zoom layer sits on TOP: animate its opacity across the transition
                  if (isZoomIn) {
                    // Zoom-in: higher detail dissolves IN (0% -> 100%) over solid lower layer
                    opacityProp.setValueAtTime(tr.startTime, 0);
                    opacityProp.setValueAtTime(tr.endTime, 100);
                  } else {
                    // Zoom-out: higher detail dissolves OUT (100% -> 0%) revealing solid lower layer
                    opacityProp.setValueAtTime(tr.startTime, 100);
                    opacityProp.setValueAtTime(tr.endTime, 0);
                  }
                } else if (effectiveZ === lowerZ) {
                  // Lower zoom layer sits UNDERNEATH: MUST REMAIN 100% SOLID throughout transition window!
                  // This eliminates any alpha hole or darkness dip (sum of alpha is always 100%).
                  opacityProp.setValueAtTime(tr.startTime, 100);
                  opacityProp.setValueAtTime(tr.endTime, 100);
                }
              }
            }
          } catch (opacityError) {
            /* opacity transition animation fallback */
          }
        }

        createdLayers.push(tileLayer);
        result.imported++;
        result.assetIds.push(tileKey);
        footageItem = null;
        tileLayer = null;
      } catch (importError) {
        result.failed.push({ key: tileKey, code: 'IMPORT_FAILED', message: importError.toString() });
        break;
      }
    }

    if (result.failed.length > 0 || result.imported !== result.expected) {
      for (var cleanupLayer = createdLayers.length - 1; cleanupLayer >= 0; cleanupLayer--) {
        try {
          createdLayers[cleanupLayer].remove();
        } catch (ignoreCreatedLayer) {
          /* abort cleanup created layer fallback */
        }
      }
      for (var cleanupAsset = createdAssets.length - 1; cleanupAsset >= 0; cleanupAsset--) {
        try {
          createdAssets[cleanupAsset].remove();
        } catch (ignoreCreatedAsset) {
          /* abort cleanup created asset fallback */
        }
      }
      result.imported = 0;
      result.assetIds = [];
      if (result.failed.length === 0) result.failed.push({ key: '', code: 'IMPORTED_COUNT_MISMATCH' });
      return JSON.stringify(result);
    }

    result.ok = true;
    result.compId = resolved.containingComp.id;
    result.mapCompId = resolved.mapComp.id;
    return JSON.stringify(result);
  });
}

function opengeoCommitCompositionRevision(args) {
  var data = args || {};
  var operationId = opengeoSanitizeIdentity(data.operationId);
  var documentId = opengeoSanitizeIdentity(data.documentId);
  var expected = parseInt(data.expected, 10) || 0;
  var result = {
    ok: false,
    operationId: operationId,
    documentId: documentId,
    expected: expected,
    imported: 0,
    reused: 0,
    assetIds: [],
    failed: [],
    warnings: [],
    phase: 'commit',
    commitState: 'not-started',
    metadataApplied: false,
    previousRevision: null
  };

  var resolved;
  try {
    resolved = opengeoResolveTransactionComps(data.compId, documentId);
  } catch (resolveError) {
    result.failed.push({ key: '', code: 'TARGET_NOT_FOUND', message: resolveError.toString() });
    return JSON.stringify(result);
  }
  var folders = getOpenGeoFolderStructure();
  var stagingLayers = [];
  var oldFinalLayers = [];
  var previewLayers = [];
  for (var layerIndex = 1; layerIndex <= resolved.mapComp.numLayers; layerIndex++) {
    var layer = resolved.mapComp.layer(layerIndex);
    var ownership = opengeoReadOwnership(layer.comment);
    if (opengeoOwnershipMatches(layer.comment, documentId, 'final-staging', operationId)) {
      stagingLayers.push(layer);
    } else if (opengeoOwnershipMatches(layer.comment, documentId, 'final-active') ||
        opengeoOwnershipMatches(layer.comment, documentId, 'final-staging') && ownership.revision !== operationId) {
      oldFinalLayers.push(layer);
      if (!result.previousRevision && ownership.revision) result.previousRevision = ownership.revision;
    } else if ((layer.name.indexOf('final_') === 0 || layer.name.indexOf('tile_') === 0) &&
        layer.source && layer.source.comment === 'opengeo:document:' + documentId) {
      oldFinalLayers.push(layer);
      if (!result.previousRevision) result.previousRevision = 'legacy';
    } else if (opengeoOwnershipMatches(layer.comment, documentId, 'preview') ||
        layer.name.indexOf('preview_') === 0 && layer.source && layer.source.comment === 'opengeo:document:' + documentId) {
      previewLayers.push(layer);
    }
  }

  if (expected < 1 || stagingLayers.length !== expected) {
    result.imported = stagingLayers.length;
    result.failed.push({ key: '', code: 'STAGING_COUNT_MISMATCH' });
    return JSON.stringify(result);
  }

  return withUndoGroup('OpenGeo: Commit Finalize', function() {
    result.commitState = 'commit-in-progress';
    var activated = false;
    try {
      // The reversible visibility swap occurs before any destructive cleanup.
      for (var oldIndex = 0; oldIndex < oldFinalLayers.length; oldIndex++) oldFinalLayers[oldIndex].enabled = false;
      for (var previewIndex = 0; previewIndex < previewLayers.length; previewIndex++) previewLayers[previewIndex].enabled = false;
      for (var stageIndex = 0; stageIndex < stagingLayers.length; stageIndex++) {
        stagingLayers[stageIndex].enabled = true;
      }
      activated = true;

      // After the visibility swap succeeds, metadata/rig/cleanup are
      // best-effort operations. They cannot turn a visible coherent revision
      // into a reported rollback that would delete only part of that revision.
      for (var tagIndex = 0; tagIndex < stagingLayers.length; tagIndex++) {
        try {
          var stageLayer = stagingLayers[tagIndex];
          var stageOwnership = opengeoReadOwnership(stageLayer.comment);
          var stagePlacement = stageOwnership.placement || stageOwnership.key || '';
          if (stagePlacement) {
            result.assetIds.push(stagePlacement);
          } else {
            result.assetIds.push(opengeoTilePlacementIdentity(null, tagIndex));
          }
          stageLayer.name = 'final_' + operationId + '_' + tagIndex;
          stageLayer.comment = opengeoOwnershipComment(documentId, 'final-active', operationId, stagePlacement ? 'placement=' + stagePlacement : '');
          if (stageLayer.source) {
            stageLayer.source.comment = opengeoOwnershipComment(documentId, 'final-active', operationId, stagePlacement ? 'placement=' + stagePlacement : '');
          }
        } catch (tagError) { result.warnings.push('REVISION_TAG_WARNING'); }
      }

      try {
        if (data.camera) opengeoSynchronizeControllerCamera(resolved.controller, resolved.containingComp.time, data.camera);
      } catch (cameraError) { result.warnings.push('CAMERA_SYNC_WARNING'); }
      var mapPivot = findLayerByName(resolved.mapComp, 'MapPivot');
      if (mapPivot) {
        try {
          mapPivot.comment = opengeoOwnershipComment(documentId, 'pivot', operationId);
          opengeoInstallMapPivotExpressions(
            mapPivot, resolved.containingComp.name, resolved.controller.name,
            resolved.containingComp.width, resolved.containingComp.height
          );
        } catch (rigError) { result.warnings.push('RIG_UPDATE_WARNING'); }
      }
      try {
        var existingBalance = findLayerByName(resolved.mapComp, 'OpenGeo Color Balance');
        if (!existingBalance && resolved.mapComp.layers && typeof resolved.mapComp.layers.addSolid === 'function') {
          var balLayer = resolved.mapComp.layers.addSolid(
            [1, 1, 1],
            'OpenGeo Color Balance',
            resolved.mapComp.width,
            resolved.mapComp.height,
            resolved.mapComp.pixelAspect || 1,
            resolved.mapComp.duration
          );
          balLayer.adjustmentLayer = true;
          balLayer.guideLayer = false;
          balLayer.comment = opengeoOwnershipComment(documentId, 'color-balance', operationId);
          if (typeof balLayer.moveToBeginning === 'function') {
            balLayer.moveToBeginning();
          }
        }
      } catch (colorBalanceError) {
        /* color balance layer creation fallback */
      }
      try {
        resolved.controller.comment = opengeoOwnershipComment(documentId, 'controller', null);
      } catch (controllerTagError) {
        /* controller comment fallback */
      }
      try {
        resolved.mapComp.comment = opengeoOwnershipComment(documentId, 'map-comp', operationId, 'source=' + String(data.source || ''));
      } catch (mapTagError) {
        /* mapComp comment fallback */
      }
      try {
        if (data.metadata) {
          var metadataResult = opengeoSetCompMetadata(resolved.containingComp.id, String(data.metadata));
          result.metadataApplied = metadataResult === 'success';
          if (!result.metadataApplied) result.warnings.push('METADATA_COMMIT_WARNING');
        }
      } catch (metadataError) { result.warnings.push('METADATA_COMMIT_WARNING'); }

      // Cleanup is deliberately best-effort and only begins after activation.
      for (var removeOld = oldFinalLayers.length - 1; removeOld >= 0; removeOld--) {
        try { oldFinalLayers[removeOld].remove(); } catch (oldLayerError) { result.warnings.push('OLD_LAYER_CLEANUP_FAILED'); }
      }
      for (var removePreview = previewLayers.length - 1; removePreview >= 0; removePreview--) {
        try { previewLayers[removePreview].remove(); } catch (previewLayerError) { result.warnings.push('PREVIEW_LAYER_CLEANUP_FAILED'); }
      }
      for (var assetIndex = folders.finalTiles.numItems; assetIndex >= 1; assetIndex--) {
        var asset = folders.finalTiles.item(assetIndex);
        try {
          var assetOwnership = opengeoReadOwnership(asset.comment);
          var isCurrent = assetOwnership.document === documentId &&
            (assetOwnership.role === 'final-active' || assetOwnership.role === 'final-staging') &&
            assetOwnership.revision === operationId;
          var isOldOwned = assetOwnership.document === documentId && !isCurrent;
          var isLegacyOwned = asset.comment === 'opengeo:document:' + documentId;
          if (isOldOwned || isLegacyOwned) asset.remove();
        } catch (assetCleanupError) { result.warnings.push('OLD_ASSET_CLEANUP_FAILED'); }
      }
      opengeoRemoveDocumentAssets(folders.previewTiles, 'opengeo:document:' + documentId);

      try { resolved.containingComp.openInViewer(); } catch (viewerError) { result.warnings.push('VIEWER_OPEN_WARNING'); }
      result.ok = true;
      result.imported = stagingLayers.length;
      result.compId = resolved.containingComp.id;
      result.mapCompId = resolved.mapComp.id;
      result.commitState = 'committed';
      return JSON.stringify(result);
    } catch (commitError) {
      if (!activated) {
        for (var restoreOld = 0; restoreOld < oldFinalLayers.length; restoreOld++) {
          try {
            oldFinalLayers[restoreOld].enabled = true;
          } catch (ignoreRestoreOld) {
            /* rollback restore old final fallback */
          }
        }
        for (var restorePreview = 0; restorePreview < previewLayers.length; restorePreview++) {
          try {
            previewLayers[restorePreview].enabled = true;
          } catch (ignoreRestorePreview) {
            /* rollback restore preview fallback */
          }
        }
        for (var hideStage = 0; hideStage < stagingLayers.length; hideStage++) {
          try {
            stagingLayers[hideStage].enabled = false;
          } catch (ignoreHideStage) {
            /* rollback hide staging fallback */
          }
        }
      }
      result.commitState = activated ? 'reconciliation-required' : 'not-started';
      result.failed.push({ key: '', code: 'COMMIT_FAILED', message: commitError.toString() });
      return JSON.stringify(result);
    }
  });
}

function opengeoRollbackCompositionRevision(args) {
  var data = args || {};
  var operationId = opengeoSanitizeIdentity(data.operationId);
  var documentId = opengeoSanitizeIdentity(data.documentId);
  var result = {
    ok: true,
    operationId: operationId,
    documentId: documentId,
    phase: 'rollback',
    commitState: 'cancelled-before-commit',
    removedLayers: 0,
    removedAssets: 0,
    warnings: []
  };
  try {
    var resolved = opengeoResolveTransactionComps(data.compId, documentId);
    var folders = getOpenGeoFolderStructure();
    return withUndoGroup('OpenGeo: Rollback Finalize', function() {
      var removed = opengeoRemovePreparedRevision(resolved.mapComp, folders, documentId, operationId);
      result.removedLayers = removed.layers;
      result.removedAssets = removed.assets;
      return JSON.stringify(result);
    });
  } catch (rollbackError) {
    result.ok = false;
    result.warnings.push(rollbackError.toString());
    return JSON.stringify(result);
  }
}

function opengeoGetCompositionRevision(args) {
  var data = args || {};
  var documentId = opengeoSanitizeIdentity(data.documentId);
  try {
    var resolved = opengeoResolveTransactionComps(data.compId, documentId);
    for (var layerIndex = 1; layerIndex <= resolved.mapComp.numLayers; layerIndex++) {
      var ownership = opengeoReadOwnership(resolved.mapComp.layer(layerIndex).comment);
      if (ownership.document === documentId &&
          (ownership.role === 'final-active' || ownership.role === 'final-staging') &&
          resolved.mapComp.layer(layerIndex).enabled === true) {
        var metadataApplied = false;
        try {
          var metadata = JSON.parse(resolved.containingComp.comment || '{}');
          metadataApplied = !!(metadata.opengeo && metadata.opengeo.activeRevision === ownership.revision);
        } catch (ignoreMetadata) {
          /* metadata JSON parse fallback */
        }
        return JSON.stringify({ ok: true, documentId: documentId, activeRevision: ownership.revision || null, commitState: 'committed', metadataApplied: metadataApplied });
      }
    }
    return JSON.stringify({ ok: true, documentId: documentId, activeRevision: null, commitState: 'not-started' });
  } catch (revisionError) {
    return JSON.stringify({ ok: false, documentId: documentId, activeRevision: null, commitState: 'unknown', warnings: [revisionError.toString()] });
  }
}

// Register transaction helpers on $._opengeo namespace
$._opengeo.transaction = {
  prepareCompositionRevision: opengeoPrepareCompositionRevision,
  commitCompositionRevision: opengeoCommitCompositionRevision,
  rollbackCompositionRevision: opengeoRollbackCompositionRevision,
  getCompositionRevision: opengeoGetCompositionRevision
};
