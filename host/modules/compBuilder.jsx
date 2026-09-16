// ==========================================
// OpenGeo ExtendScript Host: Composition Builder Module
// ==========================================

function opengeoBuildComposition(jsonData) {
  hLog('opengeoBuildComposition called');
  try {
    var data = (typeof jsonData === 'string') ? JSON.parse(jsonData) : jsonData;
    if (!data) return JSON.stringify({ error: "Invalid composition payload" });
    var tiles = data.tiles;
    var camera = data.camera;

    if (!data || !(tiles instanceof Array) || tiles.length === 0) {
      return JSON.stringify({ error: "No tiles provided" });
    }
    if (tiles.length > 10000) return JSON.stringify({ error: "Too many tiles provided" });
    if (!camera || typeof camera.lat !== 'number' || typeof camera.lon !== 'number' || typeof camera.zoom !== 'number') {
      return JSON.stringify({ error: "Invalid camera payload" });
    }

    if (!app.project) { app.newProject(); }
    return withUndoGroup("OpenGeo: Build Map", function() {
    var resultStr = null;
    var folders = getOpenGeoFolderStructure();

    var compSettings = data.compSettings || {};
    var documentId = String(data.documentId || 'legacy').replace(/[^a-zA-Z0-9_-]/g, '_');
    var existingOuterComp = opengeoFindDocumentOuterComp(documentId);
    var existingMapComp = opengeoFindDocumentMapComp(documentId);
    var existingComp = existingOuterComp || existingMapComp;

    var compWidth = compSettings.width || (data.composition && data.composition.width) || (existingComp ? existingComp.width : 0) || (camera && camera.viewportWidth) || 1920;
    var compHeight = compSettings.height || (data.composition && data.composition.height) || (existingComp ? existingComp.height : 0) || (camera && camera.viewportHeight) || 1080;
    var fps = compSettings.fps || (existingComp ? existingComp.frameRate : 30) || 30;
    var duration = compSettings.duration || (existingComp ? existingComp.duration : 30) || 30;

    var requestedDisplayName = String(data.displayName || compSettings.displayName || 'OpenGeo Map')
      .replace(/[\\\/\'\"\r\n\t]/g, ' ').replace(/^\s+|\s+$/g, '').substring(0, 80) || 'OpenGeo Map';
    var identitySuffix = documentId.length > 10 ? documentId.substring(documentId.length - 10) : documentId;
    var containingCompName = requestedDisplayName + " - " + identitySuffix;
    var mapcompName = requestedDisplayName + " - Map - " + identitySuffix;
    var documentAssetComment = 'opengeo:document:' + documentId;

    // STEP 1: Inner pre-comp (uses actual comp dimensions, NOT hardcoded 1000x1000)
    var mapComp = existingMapComp || opengeoEnsureComposition(mapcompName, folders.comps, compWidth, compHeight, duration, fps);
    mapComp.name = mapcompName;

    // STEP 2: MapPivot
    var mapPivot = findLayerByName(mapComp, "MapPivot");
    if (!mapPivot) {
      mapPivot = mapComp.layers.addNull();
      mapPivot.name = "MapPivot";
    }
    mapPivot.comment = opengeoOwnershipComment(documentId, 'pivot', data.operationId || data.previewGeneration || 'legacy');

    // STEP 2.5: Deep Cleanup & Map Source Changes
    var currentSource = mapComp.comment || "";
    var isPreview = data.isPreview === true;

    if (!isPreview) {
      // DEEP CLEANUP: Doing Finalize. Remove ALL preview layers, old final layers, and legacy layers!
      opengeoClearMapLayers(mapComp, true, documentId);
      // Remove only assets owned by this map document. Other OpenGeo maps can
      // coexist in the same AE project without losing their footage.
      opengeoRemoveDocumentAssets(folders.previewTiles, documentAssetComment);
      opengeoRemoveDocumentAssets(folders.finalTiles, documentAssetComment);
      mapComp.comment = opengeoOwnershipComment(documentId, 'map-comp', data.operationId || 'legacy', 'source=' + String(data.source || ''));
    } else {
      // Import the next preview as a hidden staging revision. The prior visible
      // generation remains intact until the full manifest is available.
      var replaceFinal = data.replaceFinal === true;
      data.previewStaging = true;
    }

    // STEP 3: Import and place the request-scoped tile manifest.
    var importedCount = opengeoImportCompositionTiles(mapComp, mapPivot, folders, tiles, data, documentAssetComment);
    if (isPreview) {
      var previewRevision = opengeoSanitizeIdentity(data.operationId || data.previewGeneration || 'preview');
      if (importedCount !== tiles.length) {
        opengeoDiscardPreviewRevision(mapComp, folders, documentId, previewRevision);
        throw new Error('Preview import incomplete: ' + importedCount + '/' + tiles.length + ' tiles');
      }
      var promotedCount = opengeoCommitPreviewRevision(mapComp, folders, documentId, previewRevision, replaceFinal, importedCount);
      if (promotedCount !== importedCount) {
        opengeoDiscardPreviewRevision(mapComp, folders, documentId, previewRevision);
        throw new Error('Preview commit incomplete: ' + promotedCount + '/' + importedCount + ' layers');
      }
      if (data.source) mapComp.comment = opengeoOwnershipComment(documentId, 'map-comp', data.operationId || data.previewGeneration || 'preview', 'source=' + String(data.source));
    }

    // STEP 4: Main Containing Comp
    var containingComp = opengeoFindDocumentOuterComp(documentId) || opengeoEnsureComposition(containingCompName, folders.comps, compWidth, compHeight, duration, fps);
    containingComp.name = containingCompName;

    // STEP 5/6: Controller rig and dynamic MapPivot expressions.
    opengeoEnsureMapController(containingComp, mapComp, mapcompName, compWidth, compHeight, camera, documentId);
    opengeoInstallMapPivotExpressions(mapPivot, containingCompName, mapcompName, compWidth, compHeight);

    containingComp.openInViewer();
    
    resultStr = opengeoSerializeCompositionResult(containingComp, importedCount, tiles.length);
    return resultStr;
    });

  } catch (e) {
    var lineInfo = (e.line ? " at line " + e.line : "");
    hError('opengeoBuildComposition error: ' + e.toString() + lineInfo);
    return '{"error":"' + (e.toString() + lineInfo).replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"}';
  }
}

function opengeoReadPayloadFile(filePath) {
  var file = new File(String(filePath || ''));
  if (!opengeoIsManagedPayloadFile(file)) throw new Error('Payload file is outside OpenGeo managed temporary storage');
  if (!file.exists) throw new Error('Payload file not found');
  if (file.length > 50 * 1024 * 1024) throw new Error('Payload file exceeds 50 MB limit');
  if (!file.open('r')) throw new Error('Unable to open payload file');
  try {
    return file.read();
  } finally {
    file.close();
  }
}
