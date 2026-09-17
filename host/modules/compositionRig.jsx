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
  mapLayer.threeDLayer = true;
  mapLayer.property('Anchor Point').setValue([compWidth / 2, compHeight / 2]);
  mapLayer.property('Position').setValue([compWidth / 2, compHeight / 2]);

  var effects = mapLayer.property('ADBE Effect Parade');
  if (!hasEffect(mapLayer, 'Latitude')) {
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

  if (!hasEffect(mapLayer, 'Pitch')) {
    var pitchCtrl = effects.addProperty('ADBE Angle Control');
    pitchCtrl.name = 'Pitch';
    pitchCtrl.property(1).setValue(camera.pitch || 0);
  }

  // Ensure real 3D Camera layer in the containing composition
  var cameraCreated = false;
  if (containingComp.layers && typeof containingComp.layers.addCamera === 'function') {
    try {
      var cameraLayer = findLayerByComment(containingComp, 'opengeo:camera') || findLayerByName(containingComp, 'OpenGeo Camera');
      if (!cameraLayer) {
        cameraLayer = containingComp.layers.addCamera('OpenGeo Camera', [compWidth / 2, compHeight / 2]);
        cameraLayer.comment = 'opengeo:camera';
        cameraLayer.moveToBeginning();
      }
      if (cameraLayer) {
        cameraCreated = true;
        var ctrlNameEscaped = String(mapLayer.name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        var defaultZoom = 1874;
        try {
          if (cameraLayer.property('Camera Options') && cameraLayer.property('Camera Options').property('Zoom')) {
            defaultZoom = cameraLayer.property('Camera Options').property('Zoom').value;
          }
        } catch(zErr) {}

        var camPoi = cameraLayer.property('Point of Interest');
        if (camPoi) {
          camPoi.expression =
            'var ctrl = null;\n' +
            'try { ctrl = thisComp.layer("' + ctrlNameEscaped + '"); } catch(e) {}\n' +
            'if (!ctrl || !ctrl.transform || !ctrl.transform.position) {\n' +
            '  for (var i = 1; i <= thisComp.numLayers; i++) {\n' +
            '    try {\n' +
            '      var l = thisComp.layer(i);\n' +
            '      if (l.effect && l.effect("Pitch")) { ctrl = l; break; }\n' +
            '    } catch(err) {}\n' +
            '  }\n' +
            '}\n' +
            'if (ctrl && ctrl.transform && ctrl.transform.position) {\n' +
            '  [ctrl.transform.position[0], ctrl.transform.position[1], 0];\n' +
            '} else {\n' +
            '  [' + (compWidth / 2) + ', ' + (compHeight / 2) + ', 0];\n' +
            '}\n';
        }

        var camPos = cameraLayer.property('Position');
        if (camPos) {
          camPos.expression =
            'var ctrl = null;\n' +
            'try { ctrl = thisComp.layer("' + ctrlNameEscaped + '"); } catch(e) {}\n' +
            'if (!ctrl || !ctrl.effect || !ctrl.effect("Pitch")) {\n' +
            '  for (var i = 1; i <= thisComp.numLayers; i++) {\n' +
            '    try {\n' +
            '      var l = thisComp.layer(i);\n' +
            '      if (l.effect && l.effect("Pitch")) { ctrl = l; break; }\n' +
            '    } catch(err) {}\n' +
            '  }\n' +
            '}\n' +
            'if (!ctrl || !ctrl.effect || !ctrl.effect("Pitch")) {\n' +
            '  value;\n' +
            '} else {\n' +
            '  var p = 0;\n' +
            '  try { p = ctrl.effect("Pitch")(1).value; } catch(e) {}\n' +
            '  var rad = Math.max(0, Math.min(45, p)) * Math.PI / 180;\n' +
            '  var d = ' + defaultZoom + ';\n' +
            '  try { d = cameraOption("Zoom").value; } catch(err) {\n' +
            '    try { d = cameraOption("Zoom"); } catch(err2) {\n' +
            '      try { d = cameraOption.zoom.value; } catch(err3) {\n' +
            '        try { d = cameraOption.zoom; } catch(err4) {}\n' +
            '      }\n' +
            '    }\n' +
            '  }\n' +
            '  var poi = [' + (compWidth / 2) + ', ' + (compHeight / 2) + ', 0];\n' +
            '  try { poi = pointOfInterest; } catch(err) {}\n' +
            '  [poi[0], poi[1] + d * Math.sin(rad), -d * Math.cos(rad)];\n' +
            '}\n';
        }
      }
    } catch(camErr) {}
  }

  try {
    var xRot = mapLayer.property('X Rotation') || mapLayer.property('ADBE Rotate X');
    if (xRot) {
      if (cameraCreated) {
        xRot.expression = '';
        xRot.setValue(0);
      } else {
        xRot.expression =
          'var p = 0;\n' +
          'try { p = effect("Pitch")(1).value; } catch(e) {}\n' +
          'p;\n';
      }
    }
  } catch(ignoreXRot) {}
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
  var latEffect = effects.property('Latitude');
  var latitudeProperty = latEffect ? latEffect.property(1) : null;
  var lonEffect = effects.property('Longitude');
  var longitudeProperty = lonEffect ? lonEffect.property(1) : null;
  var zoomEffect = effects.property('Zoom');
  var zoomProperty = zoomEffect ? zoomEffect.property(1) : null;
  var pitchEffect = effects.property('Pitch');
  var pitchProperty = pitchEffect ? pitchEffect.property(1) : null;
  // Composition rebuilds and Finalize own map assets, not camera animation.
  // Treat the controls as one transaction: if any control is animated,
  // preserve all keys and values regardless of the CTI when the async build
  // happens to finish. Explicit Add Key/Record/camera.update remain the only
  // commands allowed to edit animated controls.
  var hasCameraAnimation = (latitudeProperty && latitudeProperty.numKeys > 0) ||
    (longitudeProperty && longitudeProperty.numKeys > 0) ||
    (zoomProperty && zoomProperty.numKeys > 0) ||
    (pitchProperty && pitchProperty.numKeys > 0);
  if (hasCameraAnimation) return { applied: false, preservedAnimation: true };
  if (latitudeProperty) latitudeProperty.setValue(camera.lat);
  if (longitudeProperty) longitudeProperty.setValue(camera.lon);
  if (zoomProperty) zoomProperty.setValue(camera.zoom);
  if (pitchProperty && camera.pitch !== undefined && camera.pitch !== null) {
    pitchProperty.setValue(camera.pitch);
  }
  return { applied: true, preservedAnimation: false };
}

function opengeoEscapeExpressionString(value) {
  var str = String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, ' ');
  return str.replace(/[\u007f-\uffff]/g, function(c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

function opengeoInstallMapPivotExpressions(mapPivot, containingCompName, mapcompName, compWidth, compHeight) {
  var safeContainingComp = opengeoEscapeExpressionString(containingCompName);
  var safeMapcompName = opengeoEscapeExpressionString(mapcompName);

  var preamble =
    'var ctrl = null;\n' +
    'try { ctrl = comp(\'' + safeContainingComp + '\').layer(\'' + safeMapcompName + '\'); } catch(e) {}\n';

  var scaleExpr =
    preamble +
    'if (!ctrl) {\n' +
    '  value;\n' +
    '} else {\n' +
    '  try {\n' +
    '    var diffTime = ctrl.startTime;\n' +
    '    var myTime = time + diffTime;\n' +
    '    var zoomEff = ctrl.effect("Zoom")(1);\n' +
    '    var zoom = zoomEff ? zoomEff.valueAtTime(myTime) : 0;\n' +
    '    var s = (100 * Math.pow(2, Math.max(0, Math.min(' + MAX_ZOOM + ', zoom))) * ' + TILE_REF_SIZE + ') / ' + MAP_SIZE + ';\n' +
    '    [s, s, s];\n' +
    '  } catch(scaleErr) { value; }\n' +
    '}';
  mapPivot.property('Scale').expression = scaleExpr;

  var anchorExpr =
    preamble +
    'if (!ctrl) {\n' +
    '  value;\n' +
    '} else {\n' +
    '  try {\n' +
    '    var diffTime = ctrl.startTime;\n' +
    '    var myTime = time + diffTime;\n' +
    '    var latEff = ctrl.effect("Latitude")(1);\n' +
    '    var lonEff = ctrl.effect("Longitude")(1);\n' +
    '    var rawLat = latEff ? latEff.valueAtTime(myTime) : 0;\n' +
    '    var lat = Math.max(-85.05112878, Math.min(85.05112878, rawLat));\n' +
    '    var lon = lonEff ? lonEff.valueAtTime(myTime) : 0;\n' +
    '    var mapSize = ' + MAP_SIZE + ';\n' +
    '    var latRad = lat * Math.PI / 180;\n' +
    '    var mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));\n' +
    '    var worldX = ((lon + 180) / 360) * mapSize;\n' +
    '    var worldY = ((1 - mercN / Math.PI) / 2) * mapSize;\n' +
    '    [worldX, worldY, 0];\n' +
    '  } catch(anchorErr) { value; }\n' +
    '}';
  mapPivot.property('Anchor Point').expression = anchorExpr;
  mapPivot.threeDLayer = true;
  try { mapPivot.property('Position').expression = ''; } catch (ignoreExpression) {}
  mapPivot.property('Position').setValue([compWidth / 2, compHeight / 2, 0]);
}
