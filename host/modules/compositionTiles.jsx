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
      footageItem.comment = opengeoOwnershipComment(data.documentId || 'legacy', ownershipRole, revision, 'placement=' + placementIdentity);
    } catch (importError) {
      hError('Import failed for tile ' + tileName + ': ' + importError.toString());
      continue;
    }
    if (!footageItem) continue;

    var tileLayer = mapComp.layers.add(footageItem);
    tileLayer.name = tileName;
    tileLayer.comment = opengeoOwnershipComment(data.documentId || 'legacy', ownershipRole, revision, 'placement=' + placementIdentity);
    if (isPreviewStaging) tileLayer.enabled = false;
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
      /* quality and sampling fallback */
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
