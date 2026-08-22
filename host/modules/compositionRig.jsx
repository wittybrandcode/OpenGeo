// ============================================================================
// OpenGeo ExtendScript Host: Map controller rig and expressions
// ============================================================================

function opengeoEnsureMapController(containingComp, mapComp, mapcompName, compWidth, compHeight, camera, documentId) {
  var mapLayer = findLayerByComment(containingComp, 'opengeo:controller') || findLayerByName(containingComp, mapcompName);
  if (!mapLayer) {
    mapLayer = containingComp.layers.add(mapComp);
  }
  mapLayer.name = mapcompName;

  mapLayer.collapseTransformation = true;
  mapLayer.property('Anchor Point').setValue([compWidth / 2, compHeight / 2]);
  mapLayer.property('Position').setValue([compWidth / 2, compHeight / 2]);

  if (!hasEffect(mapLayer, 'Latitude')) {
    var effects = mapLayer.property('ADBE Effect Parade');
    var latCtrl = effects.addProperty('ADBE Angle Control');
    latCtrl.name = 'Latitude';
    latCtrl.property(1).setValue(camera.lat);

    var lonCtrl = effects.addProperty('ADBE Angle Control');
    lonCtrl.name = 'Longitude';
    lonCtrl.property(1).setValue(camera.lon);

    var zoomCtrl = effects.addProperty('ADBE Slider Control');
    zoomCtrl.name = 'Zoom';
    zoomCtrl.property(1).setValue(camera.zoom);
  }
  // A composition rebuild may be the first operation after a restored panel
  // or a provider switch. Synchronize its controller now rather than relying
  // on a later polling round-trip, otherwise CEP and AE can show different
  // framing for a visible moment (or indefinitely when polling is busy).
  opengeoSynchronizeControllerCamera(mapLayer, containingComp.time, camera);
  mapLayer.comment = documentId
    ? opengeoOwnershipComment(documentId, 'controller', null)
    : 'opengeo:controller';
  return mapLayer;
}

function opengeoSynchronizeControllerCamera(mapLayer, time, camera) {
  if (!mapLayer || !camera) return;
  var effects = mapLayer.property('ADBE Effect Parade');
  if (!effects) return;
  var latitudeProperty = effects.property('Latitude').property(1);
  var longitudeProperty = effects.property('Longitude').property(1);
  var zoomProperty = effects.property('Zoom').property(1);
  // Composition rebuilds and Finalize own map assets, not camera animation.
  // Treat the three controls as one transaction: if any control is animated,
  // preserve all keys and values regardless of the CTI when the async build
  // happens to finish. Explicit Add Key/Record/camera.update remain the only
  // commands allowed to edit animated controls.
  var hasCameraAnimation = latitudeProperty.numKeys > 0 ||
    longitudeProperty.numKeys > 0 || zoomProperty.numKeys > 0;
  if (hasCameraAnimation) return { applied: false, preservedAnimation: true };
  latitudeProperty.setValue(camera.lat);
  longitudeProperty.setValue(camera.lon);
  zoomProperty.setValue(camera.zoom);
  return { applied: true, preservedAnimation: false };
}

function opengeoInstallMapPivotExpressions(mapPivot, containingCompName, mapcompName, compWidth, compHeight) {
  var scaleExpr =
    "var ctrl = comp('" + containingCompName + "').layer('" + mapcompName + "');\n" +
    'var diffTime = ctrl.startTime;\n' +
    'var myTime = time + diffTime;\n' +
    "var zoom = ctrl.effect('Zoom')(1).valueAtTime(myTime);\n" +
    'var s = (100 * Math.pow(2, Math.max(0, Math.min(' + MAX_ZOOM + ', zoom))) * ' + TILE_REF_SIZE + ') / ' + MAP_SIZE + ';\n' +
    '[s, s, s];';
  mapPivot.property('Scale').expression = scaleExpr;

  var anchorExpr =
    "var ctrl = comp('" + containingCompName + "').layer('" + mapcompName + "');\n" +
    'var diffTime = ctrl.startTime;\n' +
    'var myTime = time + diffTime;\n' +
    "var lat = ctrl.effect('Latitude')(1).valueAtTime(myTime);\n" +
    "var lon = ctrl.effect('Longitude')(1).valueAtTime(myTime);\n" +
    'var mapSize = ' + MAP_SIZE + ';\n' +
    'var latRad = lat * Math.PI / 180;\n' +
    'var mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));\n' +
    'var worldX = ((lon + 180) / 360) * mapSize;\n' +
    'var worldY = ((1 - mercN / Math.PI) / 2) * mapSize;\n' +
    '[worldX, worldY];';
  mapPivot.property('Anchor Point').expression = anchorExpr;
  try { mapPivot.property('Position').expression = ''; } catch (ignoreExpression) {}
  mapPivot.property('Position').setValue([compWidth / 2, compHeight / 2]);
}
