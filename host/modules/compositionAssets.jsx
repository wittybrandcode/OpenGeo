// ============================================================================
// OpenGeo ExtendScript Host: Composition and asset ownership helpers
// ============================================================================

function opengeoFindCompositionByName(name) {
  for (var itemIndex = 1; itemIndex <= app.project.items.length; itemIndex++) {
    var item = app.project.items[itemIndex];
    if (item instanceof CompItem && item.name === name) return item;
  }
  return null;
}

function opengeoEnsureComposition(name, folder, width, height, duration, fps) {
  var comp = opengeoFindCompositionByName(name);
  if (!comp) {
    comp = app.project.items.addComp(name, width, height, 1, duration, fps);
    comp.parentFolder = folder;
  } else if (comp.width !== width || comp.height !== height) {
    comp.width = width;
    comp.height = height;
  }
  return comp;
}

function opengeoFindDocumentMapComp(documentId) {
  var expected = opengeoSanitizeIdentity(documentId);
  for (var itemIndex = 1; itemIndex <= app.project.items.length; itemIndex++) {
    var item = app.project.items[itemIndex];
    if (!(item instanceof CompItem)) continue;
    var ownership = opengeoReadOwnership(item.comment);
    if (ownership.document === expected && ownership.role === 'map-comp') return item;
  }
  return null;
}

function opengeoFindDocumentOuterComp(documentId) {
  var expected = opengeoSanitizeIdentity(documentId);
  for (var itemIndex = 1; itemIndex <= app.project.items.length; itemIndex++) {
    var item = app.project.items[itemIndex];
    if (!(item instanceof CompItem)) continue;
    var controller = findLayerByComment(item, 'opengeo:controller');
    if (!controller) continue;
    var ownership = opengeoReadOwnership(controller.comment);
    if (ownership.document === expected) return item;
  }
  return null;
}

function opengeoRemoveDocumentAssets(folder, documentAssetComment) {
  if (!folder) return;
  var documentId = String(documentAssetComment || '').replace('opengeo:document:', '');
  for (var assetIndex = folder.numItems; assetIndex >= 1; assetIndex--) {
    var asset = folder.item(assetIndex);
    try {
      var isStructuredOwner = typeof opengeoOwnershipMatches === 'function' &&
        opengeoOwnershipMatches(asset.comment, documentId, null, null);
      if (asset.comment === documentAssetComment || isStructuredOwner) asset.remove();
    } catch (ignoreAsset) {}
  }
}

function opengeoClearMapLayers(mapComp, removeFinal, documentId) {
  var legacyAssetComment = 'opengeo:document:' + String(documentId || 'legacy');
  for (var layerIndex = mapComp.numLayers; layerIndex >= 1; layerIndex--) {
    var layer = mapComp.layer(layerIndex);
    var layerOwnership = typeof opengeoReadOwnership === 'function' ? opengeoReadOwnership(layer.comment) : {};
    var sourceComment = '';
    try { sourceComment = layer.source ? String(layer.source.comment || '') : ''; } catch (ignoreSource) {}
    var isOwned = layerOwnership.document === String(documentId || 'legacy') || sourceComment === legacyAssetComment;
    var isPreview = isOwned && (layerOwnership.role === 'preview' || layer.name.indexOf('preview_') === 0);
    var isFinal = isOwned && (layerOwnership.role === 'final-active' || layer.name.indexOf('final_') === 0 || layer.name.indexOf('tile_') === 0);
    if (isPreview || (removeFinal && isFinal)) layer.remove();
  }
}
