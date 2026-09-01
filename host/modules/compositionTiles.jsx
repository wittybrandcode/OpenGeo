// ============================================================================
// OpenGeo ExtendScript Host: Tile footage import and placement
// ============================================================================

function opengeoTilePlacementIdentity(tile, fallbackIndex) {
  if (tile && tile.placementKey) return String(tile.placementKey);
  if (tile && tile.key) {
    try { $.writeln('[OpenGeo][DEPRECATED_TILE_KEY] Host adapted legacy tile.key to placement identity.'); } catch (ignoreWarning) {}
    return String(tile.key);
  }
  if (tile) return String(tile.z + '/' + tile.x + '/' + tile.y);
  return String(fallbackIndex);
}

function opengeoImportCompositionTiles(mapComp, mapPivot, folders, tiles, data, documentAssetComment) {
  var importedCount = 0;
  var sourcePrefix = data.source ? (data.source + '_') : '';
  var isPreviewStaging = data.isPreview === true && data.previewStaging === true;
  var tileTypePrefix = isPreviewStaging ? 'preview_' + opengeoSanitizeIdentity(data.operationId || data.previewGeneration || 'legacy') + '_' : (data.isPreview === true ? 'preview_' : 'final_');
  var revision = opengeoSanitizeIdentity(data.operationId || data.previewGeneration || 'legacy');
  var ownershipRole = isPreviewStaging ? 'preview-staging' : (data.isPreview === true ? 'preview' : 'final-active');

  for (var tileIndex = 0; tileIndex < tiles.length; tileIndex++) {
    var tile = tiles[tileIndex];
    var tileFile = new File(String(tile.filePath).replace(/\\/g, '/'));
    if (!tileFile.exists) continue;

    var tileName = tileTypePrefix + sourcePrefix + tile.z + '_' + tile.x + '_' + tile.y;
    if (findLayerByName(mapComp, tileName)) {
      importedCount++;
      continue;
    }

    var footageItem = null;
    try {
      footageItem = app.project.importFile(new ImportOptions(tileFile));
      footageItem.parentFolder = data.isPreview === true ? folders.previewTiles : folders.finalTiles;
      footageItem.comment = opengeoOwnershipComment(data.documentId || 'legacy', ownershipRole, revision, 'placement=' + opengeoTilePlacementIdentity(tile, tileIndex));
    } catch (importError) {
      hError('Import failed for tile ' + tileName + ': ' + importError.toString());
      continue;
    }
    if (!footageItem) continue;

    var tileLayer = mapComp.layers.add(footageItem);
    tileLayer.name = tileName;
    tileLayer.comment = opengeoOwnershipComment(data.documentId || 'legacy', ownershipRole, revision, 'placement=' + opengeoTilePlacementIdentity(tile, tileIndex));
    if (isPreviewStaging) tileLayer.enabled = false;
    var worldTileSize = MAP_SIZE / Math.pow(2, tile.z);
    var tileActualSize = footageItem.width || 256;
    tileLayer.property('Anchor Point').setValue([0, 0]);
    tileLayer.parent = mapPivot;
    tileLayer.property('Position').setValue([tile.x * worldTileSize, tile.y * worldTileSize]);
    tileLayer.property('Scale').setValue([(worldTileSize / tileActualSize) * 100, (worldTileSize / tileActualSize) * 100]);
    try {
      tileLayer.quality = LayerQuality.BEST;
      tileLayer.blendingMode = BlendingMode.ALPHA_ADD;
    } catch (qualityError) {}
    importedCount++;
  }
  return importedCount;
}
