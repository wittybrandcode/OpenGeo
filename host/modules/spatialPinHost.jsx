// ==========================================
// OpenGeo ExtendScript Host: Spatial Pin & Boundaries Module
// ==========================================

var $ = typeof $ !== 'undefined' ? $ : {};
$._opengeo = $._opengeo || {};

function opengeoParseRgbColor(color, defaultRgb) {
  if (color && typeof color === 'object' && color.length >= 3) {
    return [
      Math.max(0, Math.min(1, color[0])),
      Math.max(0, Math.min(1, color[1])),
      Math.max(0, Math.min(1, color[2])),
      color.length > 3 ? Math.max(0, Math.min(1, color[3])) : 1
    ];
  }
  if (typeof color === 'string') {
    var hex = color.replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (hex.length === 6) {
      var r = parseInt(hex.substring(0, 2), 16) / 255;
      var g = parseInt(hex.substring(2, 4), 16) / 255;
      var b = parseInt(hex.substring(4, 6), 16) / 255;
      return [r, g, b, 1];
    }
  }
  return defaultRgb || [0.078, 0.45, 0.9, 1]; // #1473e6
}

function opengeoAddSpatialPin(compId, lat, lng, name, options) {
  return withUndoGroup('OpenGeo: Add Spatial Pin', function() {
    try {
      options = options || {};
      var comp = ensureComp(compId);
      if (!comp) return 'error: comp not found';
      if (typeof lat !== 'number' || typeof lng !== 'number') return 'error: invalid pin coordinates';

      var mapLayer = findLayerByComment(comp, 'opengeo:controller');
      if (!mapLayer || !mapLayer.source) return 'error: OpenGeo map controller layer not found';
      var mapLayerName = String(mapLayer.name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      
      var folders = getOpenGeoFolderStructure();
      
      var pin = comp.layers.addNull();
      pin.name = name || 'Spatial Pin';
      pin.comment = 'opengeo:pin:' + lat + ',' + lng;
      pin.threeDLayer = true;

      // Add interactive Effect Controls to the Pin Null
      var effects = pin.property('ADBE Effect Parade');
      if (effects) {
        var latCtrl = effects.addProperty('ADBE Angle Control');
        latCtrl.name = 'Latitude';
        latCtrl.property(1).setValue(lat);

        var lonCtrl = effects.addProperty('ADBE Angle Control');
        lonCtrl.name = 'Longitude';
        lonCtrl.property(1).setValue(lng);

        var sizeCtrl = effects.addProperty('ADBE Slider Control');
        sizeCtrl.name = 'Size';
        sizeCtrl.property(1).setValue(typeof options.scale === 'number' ? options.scale : 100);

        var keepCtrl = effects.addProperty('ADBE Checkbox Control');
        keepCtrl.name = 'Maintain Screen Size';
        keepCtrl.property(1).setValue(options.maintainScreenSize !== false ? 1 : 0);

        var orientCtrl = effects.addProperty('ADBE Checkbox Control');
        orientCtrl.name = 'Auto-Orient to Camera';
        orientCtrl.property(1).setValue(options.autoOrient !== false ? 1 : 0);

        var altCtrl = effects.addProperty('ADBE Slider Control');
        altCtrl.name = 'Altitude (Z)';
        altCtrl.property(1).setValue(typeof options.altitude === 'number' ? options.altitude : 0);

        var offsetCtrl = effects.addProperty('ADBE Point Control');
        offsetCtrl.name = 'Label Offset';
        var defOffset = (options.labelOffset && options.labelOffset.length >= 2) ? options.labelOffset : [0, -45];
        offsetCtrl.property(1).setValue(defOffset);
      }

      // Generate the position expression referencing the map controller and Pin's own controls
      pin.property('Position').expression =
        'var ctrl = null;\n' +
        'if (thisComp.layer("' + mapLayerName + '")) { ctrl = thisComp.layer("' + mapLayerName + '"); }\n' +
        'if (!ctrl || !ctrl.effect || !ctrl.effect("Latitude")) { value; } else {\n' +
        '  var latEff = effect("Latitude");\n' +
        '  var pinLat = (latEff && latEff.numProperties > 0) ? latEff(1).value : ' + lat + ';\n' +
        '  var lonEff = effect("Longitude");\n' +
        '  var pinLng = (lonEff && lonEff.numProperties > 0) ? lonEff(1).value : ' + lng + ';\n' +
        '  var sinLat = Math.sin(pinLat * 0.017453292519943295);\n' +
        '  var worldX = ((pinLng + 180) / 360) * 262144;\n' +
        '  var worldY = ((1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2) * 262144;\n' +
        '  var camLat = Math.max(-85.05112878, Math.min(85.05112878, ctrl.effect("Latitude")(1).value));\n' +
        '  var camLng = ctrl.effect("Longitude")(1).value;\n' +
        '  var camSin = Math.sin(camLat * 0.017453292519943295);\n' +
        '  var camX = ((camLng + 180) / 360) * 262144;\n' +
        '  var camY = ((1 - Math.log((1 + camSin) / (1 - camSin)) / (2 * Math.PI)) / 2) * 262144;\n' +
        '  var zoom = Math.max(0, Math.min(22, ctrl.effect("Zoom")(1).value));\n' +
        '  var s = (Math.pow(2, zoom) * 256) / 262144;\n' +
        '  var ctrlPos = ctrl.transform.position;\n' +
        '  var alt = (effect("Altitude (Z)") && effect("Altitude (Z)").numProperties > 0) ? effect("Altitude (Z)")(1).value : 0;\n' +
        '  [ctrlPos[0] + (worldX - camX) * s, ctrlPos[1] + (worldY - camY) * s, -(alt !== 0 ? alt : 2)];\n' +
        '}';

      // Scale expression supporting Constant Screen Size vs World Scale with map zoom
      var baseZoom = 6;
      try {
        if (mapLayer.effect && mapLayer.effect('Zoom')) {
          baseZoom = Math.round(mapLayer.effect('Zoom')(1).value);
        }
      } catch (zErr) {
        /* zoom effect lookup fallback */
      }

      pin.property('Scale').expression =
        'var baseScale = effect("Size") ? effect("Size")(1).value : 100;\n' +
        'var maintain = effect("Maintain Screen Size") ? effect("Maintain Screen Size")(1).value : 1;\n' +
        'if (maintain == 1) {\n' +
        '  var cam = thisComp.activeCamera;\n' +
        '  if (cam && cam.hasVideo) {\n' +
        '    var camPos = cam.toWorld([0,0,0]);\n' +
        '    var myPos = toWorld(anchorPoint);\n' +
        '    var dist = length(myPos, camPos);\n' +
        '    var refDist = (cam.cameraOption && cam.cameraOption.zoom) ? cam.cameraOption.zoom : 1874;\n' +
        '    var mult = dist / Math.max(1, refDist);\n' +
        '    var sc = baseScale * mult;\n' +
        '    [sc, sc, sc];\n' +
        '  } else {\n' +
        '    [baseScale, baseScale, baseScale];\n' +
        '  }\n' +
        '} else {\n' +
        '  var ctrl = thisComp.layer("' + mapLayerName + '");\n' +
        '  if (!ctrl || !ctrl.effect || !ctrl.effect("Zoom")) {\n' +
        '    [baseScale, baseScale, baseScale];\n' +
        '  } else {\n' +
        '    var curZ = ctrl.effect("Zoom")(1).value;\n' +
        '    var zFactor = Math.pow(2, curZ - ' + baseZoom + ');\n' +
        '    var sc = baseScale * zFactor;\n' +
        '    [sc, sc, sc];\n' +
        '  }\n' +
        '}';

      // Orientation expression for 3D Camera Billboarding
      pin.property('Orientation').expression =
        'var autoOrient = effect("Auto-Orient to Camera") ? effect("Auto-Orient to Camera")(1).value : 0;\n' +
        'if (autoOrient == 1) {\n' +
        '  var cam = thisComp.activeCamera;\n' +
        '  if (cam && cam.hasVideo) {\n' +
        '    lookAt(toWorld(anchorPoint), cam.toWorld([0,0,0]));\n' +
        '  } else { value; }\n' +
        '} else { value; }';

      // Attach Built-in Vector Shape Graphic Marker
      if (options.attachGraphic !== false) {
        try {
          var marker = comp.layers.addShape();
          marker.name = (name || 'Spatial Pin') + ' Marker';
          marker.threeDLayer = true;
          marker.parent = pin;
          marker.property('Position').setValue([0, 0, 0]);

          var contents = marker.property("ADBE Root Vectors Group") || marker.property("Contents") || marker.property(2);
          if (contents) {
            // Group 1: Outer Marker Ring
            var outerGroup = contents.addProperty("ADBE Vector Group");
            outerGroup.name = "Pin Ring";
            var outerContents = outerGroup.property("ADBE Vectors Group") || outerGroup.property("Contents") || outerGroup.property(2);

            var outerEllipse = outerContents.addProperty("ADBE Vector Shape - Ellipse");
            outerEllipse.property("ADBE Vector Ellipse Size").setValue([26, 26]);

            var outerStroke = outerContents.addProperty("ADBE Vector Graphic - Stroke");
            outerStroke.property("ADBE Vector Stroke Color").setValue([1, 1, 1, 1]);
            outerStroke.property("ADBE Vector Stroke Width").setValue(2.5);

            var outerFill = outerContents.addProperty("ADBE Vector Graphic - Fill");
            var markerColor = opengeoParseRgbColor(options.color, [0.078, 0.45, 0.9, 1]);
            outerFill.property("ADBE Vector Fill Color").setValue(markerColor);

            // Group 2: Inner Core Dot
            var innerGroup = contents.addProperty("ADBE Vector Group");
            innerGroup.name = "Core Dot";
            var innerContents = innerGroup.property("ADBE Vectors Group") || innerGroup.property("Contents") || innerGroup.property(2);

            var innerEllipse = innerContents.addProperty("ADBE Vector Shape - Ellipse");
            innerEllipse.property("ADBE Vector Ellipse Size").setValue([9, 9]);

            var innerFill = innerContents.addProperty("ADBE Vector Graphic - Fill");
            innerFill.property("ADBE Vector Fill Color").setValue([1, 1, 1, 1]);
          }
        } catch (markerErr) {
          hError('addSpatialPin marker: ' + markerErr.toString());
        }
      }

      // Attach Built-in Styled Text Label
      if (options.attachLabel !== false) {
        try {
          var textLayer = comp.layers.addText(name || 'Pin Label');
          textLayer.name = (name || 'Spatial Pin') + ' Label';
          textLayer.parent = pin;
          textLayer.threeDLayer = true;
          textLayer.property('Position').expression =
            'parent.effect && parent.effect("Label Offset") ? parent.effect("Label Offset")(1).value : [0, -45, 0];';

          var sourceText = textLayer.property("Source Text");
          if (sourceText) {
            var textDoc = sourceText.value;
            textDoc.fontSize = 30;
            textDoc.fillColor = [1, 1, 1];
            textDoc.applyFill = true;
            try {
              textDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
            } catch (jErr) {
              /* text justification property fallback */
            }
            sourceText.setValue(textDoc);
          }
        } catch (textErr) {
          hError('addSpatialPin text: ' + textErr.toString());
        }
      }

      // Attach Any Selected AE Layers to the Pin Null
      if (options.attachSelected === true) {
        try {
          var selected = comp.selectedLayers;
          if (selected && selected.length > 0) {
            for (var sIdx = 0; sIdx < selected.length; sIdx++) {
              var sel = selected[sIdx];
              if (!sel || sel === pin) continue;
              sel.threeDLayer = true;
              sel.parent = pin;
              if (options.zeroSelectedOffset) {
                sel.property('Position').setValue([0, 0, 0]);
              }
            }
          }
        } catch (selErr) {
          hError('addSpatialPin attachSelected: ' + selErr.toString());
        }
      }

      comp.openInViewer();
      return pin.id.toString();
    } catch (e) {
      hError('addSpatialPin: ' + e.toString());
      return 'error: ' + e.toString();
    }
  });
}

// Register spatial pin helpers on $._opengeo namespace
$._opengeo.spatialPin = {
  parseRgbColor: opengeoParseRgbColor,
  addSpatialPin: opengeoAddSpatialPin
};
