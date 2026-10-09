// ============================================================================
// OpenGeo ExtendScript Host: Tile footage import and placement
// ============================================================================

var $ = typeof $ !== 'undefined' ? $ : {};
$._opengeo = $._opengeo || {};

function opengeoTilePlacementIdentity(tile, fallbackIndex) {
  if (tile && tile.placementKey) return String(tile.placementKey);
  if (tile && tile.key) {
    try { $.writeln('[OpenGeo][DEPRECATED_TILE_KEY] Host adapted legacy tile.key to placement identity.'); } catch (ignoreWarning) { /* writeln fallback */ }
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

    // z/x/y is not a unique identity after hierarchical MegaTile packing:
    // assets originating at different source zooms may collapse to the same
    // output coordinate while retaining different extents/resolutions. Keep
    // the request index in the AE layer name and the canonical placement in
    // ownership metadata. Never report a name collision as an imported tile.
    var placementIdentity = opengeoTilePlacementIdentity(tile, tileIndex);
    var tileName = tileTypePrefix + sourcePrefix + tileIndex + '_' + tile.z + '_' + tile.x + '_' + tile.y;

    var footageItem = null;
    try {
      footageItem = app.project.importFile(new ImportOptions(tileFile));
      footageItem.parentFolder = data.isPreview === true ? folders.previewTiles : folders.finalTiles;
    } catch (importError) {
      hError('Import failed for tile ' + tileName + ': ' + importError.toString());
      continue;
    }
    if (!footageItem) continue;

    var tileLayer = mapComp.layers.add(footageItem);
    tileLayer.name = tileName;
    if (isPreviewStaging) tileLayer.enabled = false;
    tileLayer.threeDLayer = true;
    var worldTileSize = MAP_SIZE / Math.pow(2, tile.z);
    var tileGeometry = opengeoResolveTileGeometry(tile, footageItem, worldTileSize);
    var tileOwnershipExtra = opengeoTileGeometryExtra(
      placementIdentity, tileGeometry.contentPixels, tileGeometry.gutterPixels, tile.z
    );
    footageItem.comment = opengeoOwnershipComment(data.documentId || 'legacy', ownershipRole, revision, tileOwnershipExtra);
    tileLayer.comment = opengeoOwnershipComment(data.documentId || 'legacy', ownershipRole, revision, tileOwnershipExtra);
    tileLayer.property('Anchor Point').setValue([tileGeometry.gutterPixels, tileGeometry.gutterPixels, 0]);
    tileLayer.parent = mapPivot;
    tileLayer.property('Position').setValue([tile.x * worldTileSize, tile.y * worldTileSize, 0]);
    // The client writes a one-pixel edge-extruded gutter. It overlaps only
    // duplicated edge texels while this exact scale keeps map features fixed.
    tileLayer.property('Scale').setValue([tileGeometry.exactScale, tileGeometry.exactScale, 100]);
    try {
      tileLayer.quality = LayerQuality.BEST;
      tileLayer.samplingQuality = LayerSamplingQuality.BILINEAR;
    } catch (qualityError) {
      /* quality fallback */
    }
    try {
      tileLayer.blendingMode = BlendingMode.NORMAL;
    } catch (blendError) {
      /* blending mode fallback */
    }
    importedCount++;
  }
  return importedCount;
}

// Register tile import helpers on $._opengeo namespace
$._opengeo.tiles = {
  tilePlacementIdentity: opengeoTilePlacementIdentity,
  importCompositionTiles: opengeoImportCompositionTiles
};
