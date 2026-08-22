// ==========================================
// OpenGeo ExtendScript Host: Layered Vector Map Synthesis Engine
// ==========================================

function opengeoVectorEscapeExpressionString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, ' ');
}

function opengeoVectorBindToMap(layer, innerCompName) {
  var safeCompName = opengeoVectorEscapeExpressionString(innerCompName);
  layer.property("Position").expression = 'thisComp.layer("' + safeCompName + '").transform.position';
  layer.property("Anchor Point").expression = 'comp("' + safeCompName + '").layer("MapPivot").transform.anchorPoint / 32';
  layer.property("Scale").expression = 'comp("' + safeCompName + '").layer("MapPivot").transform.scale * 32';
}

function opengeoVectorAddCheckbox(fx, name, value) {
  var control = fx.addProperty("ADBE Checkbox Control");
  control.name = name;
  control.property("Checkbox").setValue(value ? 1 : 0);
  return control;
}

function opengeoVectorAddSlider(fx, name, value) {
  var control = fx.addProperty("ADBE Slider Control");
  control.name = name;
  control.property("Slider").setValue(value);
  return control;
}

function opengeoVectorAddColor(fx, name, value) {
  var control = fx.addProperty("ADBE Color Control");
  control.name = name;
  control.property("Color").setValue(value);
  return control;
}

function opengeoVectorFindEffect(layer, name) {
  try {
    var effects = layer && layer.property('ADBE Effect Parade');
    return effects ? effects.property(name) : null;
  } catch (error) { return null; }
}

function opengeoVectorReadEffectValue(layer, name, fallback) {
  try {
    var effect = opengeoVectorFindEffect(layer, name);
    return effect && effect.property(1) ? effect.property(1).value : fallback;
  } catch (error) { return fallback; }
}

function opengeoVectorNormalizeFeatureId(value) {
  var normalized = String(value || '').replace(/[^A-Za-z0-9._-]/g, '-');
  return normalized.substring(0, 160);
}

function opengeoVectorFeaturePrefix(featureId) {
  return 'opengeo:feature:' + opengeoVectorNormalizeFeatureId(featureId) + ':';
}

function opengeoVectorCreateController(outerComp, innerCompName, payload, featureId, prefix) {
  var controller = outerComp.layers.addNull();
  if (!controller) return null;
  controller.name = 'OG • ' + String(payload.displayName || payload.layerName || featureId) + ' • CTRL';
  controller.comment = prefix + 'controller';
  var anchor = payload.anchor || {};
  var point = anchor.point instanceof Array ? anchor.point : null;
  if (point && point.length >= 2) {
    var safeCompName = opengeoVectorEscapeExpressionString(innerCompName);
    controller.property('Position').expression =
      'var map = thisComp.layer("' + safeCompName + '");\n' +
      'var pivot = map.source.layer("MapPivot").transform;\n' +
      'var point = [' + Number(point[0]) + ', ' + Number(point[1]) + '];\n' +
      'map.transform.position + [(point[0] - pivot.anchorPoint[0]) * pivot.scale[0] / 100, (point[1] - pivot.anchorPoint[1]) * pivot.scale[1] / 100];';
  }
  try {
    var marker = new MarkerValue(String(payload.displayName || payload.layerName || featureId));
    marker.chapter = String(payload.sourceId || payload.sourceName || '');
    marker.cuePointName = featureId;
    controller.property('Marker').setValueAtTime(0, marker);
  } catch (markerError) {}
  return controller;
}

function opengeoVectorCreateShapeLayer(outerComp, innerCompName, payload, definition, comment) {
  var shapeLayer = outerComp.layers.addShape();
  if (!shapeLayer) return null;
  shapeLayer.name = (payload.layerName || 'Vector Map') + ' — ' + (definition.title || definition.id || 'VECTOR');
  shapeLayer.comment = comment;
  opengeoVectorBindToMap(shapeLayer, innerCompName);

  var contents = shapeLayer.property("ADBE Root Vectors Group") || shapeLayer.property("Contents") || shapeLayer.property(2);
  if (!contents) return null;

  var features = definition.features || [];
  var totalPaths = 0;
  for (var i = 0; i < features.length; i++) {
    var feature = features[i] || {};
    var rings = feature.rings || [];
    var featName = feature.name || feature.iso2 || ("Feature " + (i + 1));
    var featGroup = contents.addProperty("ADBE Vector Group");
    if (!featGroup) continue;
    featGroup.name = featName;
    var groupContents = featGroup.property("ADBE Vectors Group") || featGroup.property("Contents") || featGroup.property(2);
    if (!groupContents) continue;

    for (var r = 0; r < rings.length; r++) {
      var ptArray = rings[r];
      if (!ptArray || ptArray.length < 2) continue;
      var vertices = [];
      var inT = [];
      var outT = [];
      for (var v = 0; v < ptArray.length; v++) {
        var pt = ptArray[v];
        if (!pt || pt.length < 2) continue;
        vertices.push([pt[0] / 32, pt[1] / 32]);
        inT.push([0, 0]);
        outT.push([0, 0]);
      }
      if (vertices.length < 2) continue;
      var shapePath = groupContents.addProperty("ADBE Vector Shape - Group");
      if (!shapePath) continue;
      var shape = new Shape();
      shape.vertices = vertices;
      shape.inTangents = inT;
      shape.outTangents = outT;
      shape.closed = definition.isClosed !== false && feature.isClosed !== false;
      var shapeProp = shapePath.property("ADBE Vector Shape") || shapePath.property(1);
      if (shapeProp) shapeProp.setValue(shape);
      totalPaths++;
    }
  }

  try {
    var fx = shapeLayer.property("ADBE Effect Parade");
    var anchor = payload.anchor || {};
    var fillVisible = definition.fillOpacity !== undefined ? definition.fillOpacity > 0 : true;
    var strokeVisible = definition.strokeOpacity !== undefined ? definition.strokeOpacity > 0 : true;
    opengeoVectorAddCheckbox(fx, "Visible", true);
    opengeoVectorAddSlider(fx, "Anchor Latitude", Number(anchor.lat) || 0);
    opengeoVectorAddSlider(fx, "Anchor Longitude", Number(anchor.lng) || 0);
    opengeoVectorAddCheckbox(fx, "Show Fill", fillVisible);
    opengeoVectorAddColor(fx, "Fill Color", payload.fillColor || [0.12, 0.28, 0.42, 1.0]);
    opengeoVectorAddSlider(fx, "Fill Opacity", definition.fillOpacity !== undefined ? definition.fillOpacity : 15);
    opengeoVectorAddCheckbox(fx, "Show Stroke", strokeVisible);
    opengeoVectorAddColor(fx, "Stroke Color", payload.strokeColor || [1.0, 0.8, 0.2, 1.0]);
    opengeoVectorAddSlider(fx, "Stroke Width", payload.strokeWidth || 3);
    opengeoVectorAddSlider(fx, "Stroke Opacity", definition.strokeOpacity !== undefined ? definition.strokeOpacity : 100);
    opengeoVectorAddSlider(fx, "Trim Start", 0);
    opengeoVectorAddSlider(fx, "Trim End", 100);
    opengeoVectorAddSlider(fx, "Trim Offset", 0);

    shapeLayer.property('Opacity').expression = 'effect("Visible")("Checkbox") == 1 ? 100 : 0';

    if (definition.isClosed !== false) {
      var fill = contents.addProperty("ADBE Vector Graphic - Fill");
      if (fill) {
        var fColor = fill.property("ADBE Vector Fill Color") || fill.property("Color") || fill.property(4) || fill.property(10);
        if (fColor) fColor.expression = 'effect("Fill Color")("Color")';
        var fOpacity = fill.property("ADBE Vector Fill Opacity") || fill.property("Opacity") || fill.property(5) || fill.property(11);
        if (fOpacity) fOpacity.expression = 'effect("Show Fill")("Checkbox") == 1 ? effect("Fill Opacity")("Slider") : 0';
      }
    }

    var stroke = contents.addProperty("ADBE Vector Graphic - Stroke");
    if (stroke) {
      var sColor = stroke.property("ADBE Vector Stroke Color") || stroke.property("Color") || stroke.property(3) || stroke.property(1);
      if (sColor) sColor.expression = 'effect("Stroke Color")("Color")';
      var sOpacity = stroke.property("ADBE Vector Stroke Opacity") || stroke.property("Opacity") || stroke.property(4) || stroke.property(2);
      if (sOpacity) sOpacity.expression = 'effect("Show Stroke")("Checkbox") == 1 ? effect("Stroke Opacity")("Slider") : 0';
      var sWidth = stroke.property("ADBE Vector Stroke Width") || stroke.property("Stroke Width") || stroke.property(5) || stroke.property(2);
      if (sWidth) sWidth.expression = 'effect("Stroke Width")("Slider") / (transform.scale[0] / 100)';
    }

    // Land borders are kept as open source paths. Exposing Trim Paths here
    // gives animators a safe reveal control without closing or rebuilding the
    // precise local geometry.
    var trim = contents.addProperty("ADBE Vector Filter - Trim");
    if (trim) {
      trim.name = "Trim Paths";
      var trimStart = trim.property("ADBE Vector Trim Start") || trim.property("Start") || trim.property(1);
      var trimEnd = trim.property("ADBE Vector Trim End") || trim.property("End") || trim.property(2);
      var trimOffset = trim.property("ADBE Vector Trim Offset") || trim.property("Offset") || trim.property(3);
      if (trimStart) trimStart.expression = 'effect("Trim Start")("Slider")';
      if (trimEnd) trimEnd.expression = 'effect("Trim End")("Slider")';
      if (trimOffset) trimOffset.expression = 'effect("Trim Offset")("Slider")';
    }
  } catch (styleError) {
    hLog('Vector style controls warning: ' + styleError.toString());
  }

  return { layer: shapeLayer, paths: totalPaths };
}

function opengeoVectorCreateLabelLayer(outerComp, innerCompName, payload, label, index, comment, visibilityLayerName) {
  if (!label || !label.name || !label.point || label.point.length < 2) return null;
  var textLayer = outerComp.layers.addText(String(label.name));
  if (!textLayer) return null;
  textLayer.name = (payload.layerName || 'Vector Map') + ' — LABEL — ' + String(label.name);
  textLayer.comment = comment;
  try {
    var sourceText = textLayer.property("ADBE Text Properties").property("ADBE Text Document");
    var document = sourceText.value;
    document.fontSize = 22;
    document.fillColor = payload.labelColor || [0.86, 0.93, 0.97];
    document.justification = ParagraphJustification.CENTER_JUSTIFY;
    sourceText.setValue(document);
  } catch (textStyleError) {}

  var safeCompName = opengeoVectorEscapeExpressionString(innerCompName);
  var x = Number(label.point[0]) || 0;
  var y = Number(label.point[1]) || 0;
  textLayer.property("Position").expression =
    'var map = thisComp.layer("' + safeCompName + '");\n' +
    'var pivot = map.source.layer("MapPivot").transform;\n' +
    'var point = [' + x + ', ' + y + '];\n' +
    'map.transform.position + [(point[0] - pivot.anchorPoint[0]) * pivot.scale[0] / 100, (point[1] - pivot.anchorPoint[1]) * pivot.scale[1] / 100];';
  textLayer.property("Scale").expression =
    'var pivot = comp("' + safeCompName + '").layer("MapPivot").transform; [pivot.scale[0] * 32, pivot.scale[1] * 32];';
  if (visibilityLayerName) {
    var safeVisibilityLayerName = opengeoVectorEscapeExpressionString(visibilityLayerName);
    textLayer.property('Opacity').expression = 'thisComp.layer("' + safeVisibilityLayerName + '").effect("Visible")("Checkbox") == 1 ? 100 : 0';
  }
  return textLayer;
}

var OPENGEO_VECTOR_LIMITS = {
  fileBytes: 25 * 1024 * 1024,
  layers: 20,
  features: 500,
  points: 100000,
  labels: 500,
  stringLength: 512,
  depth: 12
};

function opengeoVectorValidationError(code, message) {
  return { ok: false, code: code, message: message };
}

function opengeoVectorValidateTree(value, depth) {
  if (depth > OPENGEO_VECTOR_LIMITS.depth) return opengeoVectorValidationError('VECTOR_DEPTH_LIMIT', 'payload nesting exceeds ' + OPENGEO_VECTOR_LIMITS.depth + ' levels');
  if (typeof value === 'string' && value.length > OPENGEO_VECTOR_LIMITS.stringLength) return opengeoVectorValidationError('VECTOR_STRING_LIMIT', 'payload text exceeds ' + OPENGEO_VECTOR_LIMITS.stringLength + ' characters');
  if (typeof value === 'number' && !isFinite(value)) return opengeoVectorValidationError('VECTOR_NUMBER_INVALID', 'payload contains a non-finite number');
  if (!value || typeof value !== 'object') return { ok: true };
  var key;
  if (value instanceof Array) {
    for (var arrayIndex = 0; arrayIndex < value.length; arrayIndex++) {
      var itemResult = opengeoVectorValidateTree(value[arrayIndex], depth + 1);
      if (!itemResult.ok) return itemResult;
    }
  } else {
    for (key in value) {
      if (!value.hasOwnProperty(key)) continue;
      if (String(key).length > OPENGEO_VECTOR_LIMITS.stringLength) return opengeoVectorValidationError('VECTOR_STRING_LIMIT', 'payload property name is too long');
      var propertyResult = opengeoVectorValidateTree(value[key], depth + 1);
      if (!propertyResult.ok) return propertyResult;
    }
  }
  return { ok: true };
}

function opengeoVectorValidatePayload(payload) {
  if (!payload || typeof payload !== 'object') return opengeoVectorValidationError('VECTOR_PAYLOAD_INVALID', 'vector payload must be an object');
  var treeResult = opengeoVectorValidateTree(payload, 0);
  if (!treeResult.ok) return treeResult;

  var definitions;
  if (payload.layers !== undefined) {
    if (!(payload.layers instanceof Array)) return opengeoVectorValidationError('VECTOR_LAYERS_INVALID', 'layers must be an array');
    if (payload.layers.length > OPENGEO_VECTOR_LIMITS.layers) return opengeoVectorValidationError('VECTOR_LAYER_LIMIT', 'payload exceeds ' + OPENGEO_VECTOR_LIMITS.layers + ' vector layers');
    definitions = payload.layers;
  } else {
    if (!(payload.features instanceof Array)) return opengeoVectorValidationError('VECTOR_FEATURES_INVALID', 'features must be an array');
    definitions = [{ id: 'legacy', title: 'VECTOR', isClosed: true, features: payload.features, fillOpacity: payload.fillOpacity, strokeOpacity: 100 }];
  }
  if (!definitions.length) return opengeoVectorValidationError('VECTOR_LAYERS_EMPTY', 'payload has no vector layers');

  var featureCount = 0;
  var pointCount = 0;
  for (var layerIndex = 0; layerIndex < definitions.length; layerIndex++) {
    var definition = definitions[layerIndex];
    if (!definition || !(definition.features instanceof Array)) return opengeoVectorValidationError('VECTOR_FEATURES_INVALID', 'every vector layer requires a features array');
    featureCount += definition.features.length;
    if (featureCount > OPENGEO_VECTOR_LIMITS.features) return opengeoVectorValidationError('VECTOR_FEATURE_LIMIT', 'payload exceeds ' + OPENGEO_VECTOR_LIMITS.features + ' features');
    for (var featureIndex = 0; featureIndex < definition.features.length; featureIndex++) {
      var feature = definition.features[featureIndex];
      if (!feature || !(feature.rings instanceof Array) || !feature.rings.length) return opengeoVectorValidationError('VECTOR_RINGS_INVALID', 'every vector feature requires at least one ring');
      for (var ringIndex = 0; ringIndex < feature.rings.length; ringIndex++) {
        var ring = feature.rings[ringIndex];
        if (!(ring instanceof Array) || ring.length < 2) return opengeoVectorValidationError('VECTOR_RING_TOO_SHORT', 'every vector ring requires at least two points');
        pointCount += ring.length;
        if (pointCount > OPENGEO_VECTOR_LIMITS.points) return opengeoVectorValidationError('VECTOR_POINT_LIMIT', 'payload exceeds ' + OPENGEO_VECTOR_LIMITS.points + ' points');
        for (var pointIndex = 0; pointIndex < ring.length; pointIndex++) {
          var point = ring[pointIndex];
          if (!(point instanceof Array) || point.length < 2 || typeof point[0] !== 'number' || typeof point[1] !== 'number' || !isFinite(point[0]) || !isFinite(point[1])) {
            return opengeoVectorValidationError('VECTOR_POINT_INVALID', 'every vector point requires two finite numbers');
          }
        }
      }
    }
  }

  var labels = payload.labels === undefined ? [] : payload.labels;
  if (!(labels instanceof Array) || labels.length > OPENGEO_VECTOR_LIMITS.labels) return opengeoVectorValidationError('VECTOR_LABEL_LIMIT', 'payload labels are invalid or exceed ' + OPENGEO_VECTOR_LIMITS.labels);
  for (var labelIndex = 0; labelIndex < labels.length; labelIndex++) {
    var label = labels[labelIndex];
    if (!label || typeof label.name !== 'string' || !(label.point instanceof Array) || label.point.length < 2 ||
        typeof label.point[0] !== 'number' || typeof label.point[1] !== 'number' || !isFinite(label.point[0]) || !isFinite(label.point[1])) {
      return opengeoVectorValidationError('VECTOR_LABEL_INVALID', 'every vector label requires a name and two finite point values');
    }
  }
  return { ok: true, definitions: definitions, labels: labels, featureCount: featureCount, pointCount: pointCount };
}

function opengeoVectorReadPayload(filePath) {
  var file = new File(filePath);
  if (!opengeoIsManagedPayloadFile(file)) return opengeoVectorValidationError('VECTOR_FILE_PATH', 'payload file is outside OpenGeo managed temporary storage');
  if (!file.exists) return opengeoVectorValidationError('VECTOR_FILE_MISSING', 'temp file was not found');
  if (file.length > OPENGEO_VECTOR_LIMITS.fileBytes) return opengeoVectorValidationError('VECTOR_FILE_LIMIT', 'vector payload exceeds the 25 MB limit');
  if (!file.open('r')) return opengeoVectorValidationError('VECTOR_FILE_READ', 'vector payload could not be opened');
  var raw = '';
  try { raw = file.read(); } catch (readError) {
    file.close();
    return opengeoVectorValidationError('VECTOR_FILE_READ', 'vector payload could not be read');
  }
  file.close();
  var payload = null;
  try { payload = JSON.parse(raw); } catch (parseError) {
    return opengeoVectorValidationError('VECTOR_PARSE_ERROR', 'vector payload contains invalid JSON');
  }
  var validation = opengeoVectorValidatePayload(payload);
  if (!validation.ok) return validation;
  validation.payload = payload;
  return validation;
}

function opengeoImportVectorMapFromFile(compId, filePath, layerName, featureSignature) {
  // All untrusted file parsing and resource validation happens before an Undo
  // group is opened or any composition/layer is mutated.
  var prepared = opengeoVectorReadPayload(filePath);
  if (!prepared.ok) return 'error: [' + prepared.code + '] ' + prepared.message;
  if (layerName && String(layerName).length > OPENGEO_VECTOR_LIMITS.stringLength) return 'error: [VECTOR_STRING_LIMIT] layer name is too long';
  if (featureSignature && String(featureSignature).length > OPENGEO_VECTOR_LIMITS.stringLength) return 'error: [VECTOR_STRING_LIMIT] feature signature is too long';

  var payload = prepared.payload;
  payload.layerName = layerName || payload.layerName || 'Vector Map';
  payload.featureSignature = featureSignature || payload.featureSignature || payload.layerName;
  payload.featureId = opengeoVectorNormalizeFeatureId(payload.featureId || payload.featureSignature);
  if (!payload.featureId) return 'error: [VECTOR_FEATURE_ID_INVALID] vector feature identity is invalid';

  return withUndoGroup('OpenGeo: Synthesize Vector Map', function() {
    try {

      var outerComp = ensureComp(compId);
      if (!outerComp) return 'error: target map composition was not found.';
      var mapLayer = findLayerByComment(outerComp, 'opengeo:controller');
      if (!mapLayer || !mapLayer.source) return 'error: OpenGeo map controller layer not found in the target composition.';
      var innerCompName = mapLayer.source.name;
      var vectorComment = 'opengeo:vector:' + payload.featureSignature;
      var featurePrefix = opengeoVectorFeaturePrefix(payload.featureId);

      var replacedLayers = 0;
      for (var previousIndex = outerComp.numLayers; previousIndex >= 1; previousIndex--) {
        var priorLayer = outerComp.layer(previousIndex);
        if (priorLayer && priorLayer.comment && (priorLayer.comment.indexOf(featurePrefix) === 0 || priorLayer.comment === vectorComment || priorLayer.comment.indexOf(vectorComment + ':') === 0)) {
          priorLayer.remove();
          replacedLayers++;
        }
      }

      var definitions = prepared.definitions;
      var controller = opengeoVectorCreateController(outerComp, innerCompName, payload, payload.featureId, featurePrefix);
      var totalPaths = 0;
      var createdLayers = 0;
      var featureCount = 0;
      var visibilityLayerName = null;
      for (var layerIndex = 0; layerIndex < definitions.length; layerIndex++) {
        var definition = definitions[layerIndex];
        if (!definition || !definition.features || !definition.features.length) continue;
        featureCount += definition.features.length;
        var result = opengeoVectorCreateShapeLayer(outerComp, innerCompName, payload, definition, featurePrefix + 'shape:' + (definition.id || layerIndex));
        if (result) {
          if (!visibilityLayerName && result.layer) visibilityLayerName = result.layer.name;
          totalPaths += result.paths;
          createdLayers++;
        }
      }

      var labels = prepared.labels;
      for (var labelIndex = 0; labelIndex < labels.length; labelIndex++) {
        if (opengeoVectorCreateLabelLayer(outerComp, innerCompName, payload, labels[labelIndex], labelIndex, featurePrefix + 'label:' + labelIndex, visibilityLayerName)) createdLayers++;
      }

      hLog('Vector Map Engine: generated ' + totalPaths + ' paths across ' + featureCount + ' features and ' + createdLayers + ' AE layers.');
      return '{"status":"success","compId":"' + outerComp.id.toString() + '","featureId":"' + payload.featureId + '","controllerId":' + (controller ? controller.index : 'null') + ',"features":' + featureCount + ',"paths":' + totalPaths + ',"layers":' + createdLayers + ',"replaced":' + replacedLayers + '}';
    } catch (error) {
      hError('importVectorMapFromFile: ' + error.toString());
      return 'error: ' + error.toString();
    }
  });
}

function opengeoVectorEnsureShapeControl(layer, name, kind, value) {
  var effects = layer.property('ADBE Effect Parade');
  if (!effects) return null;
  var effect = effects.property(name);
  if (!effect) {
    if (kind === 'checkbox') effect = opengeoVectorAddCheckbox(effects, name, value === 1 || value === true);
    else if (kind === 'color') effect = opengeoVectorAddColor(effects, name, value);
    else effect = opengeoVectorAddSlider(effects, name, value);
  }
  try {
    var valueProperty = effect.property(1);
    if (valueProperty.expression) valueProperty.expression = '';
    valueProperty.setValue(value);
  } catch (setError) {}
  return effect;
}

function opengeoVectorOrderShapeControls(layer) {
  var order = [
    'Visible', 'Anchor Latitude', 'Anchor Longitude',
    'Show Fill', 'Fill Color', 'Fill Opacity',
    'Show Stroke', 'Stroke Color', 'Stroke Width', 'Stroke Opacity',
    'Trim Start', 'Trim End', 'Trim Offset'
  ];
  var effects = layer.property('ADBE Effect Parade');
  if (!effects) return;
  for (var index = order.length - 1; index >= 0; index--) {
    try {
      var effect = effects.property(order[index]);
      if (effect && typeof effect.moveTo === 'function') effect.moveTo(1);
    } catch (moveError) {}
  }
}

function opengeoVectorCollectFeatureLayers(comp) {
  var prefix = 'opengeo:feature:';
  var groups = {};
  for (var index = 1; index <= comp.numLayers; index++) {
    var layer = comp.layer(index);
    var comment = String(layer && layer.comment || '');
    if (comment.indexOf(prefix) !== 0) continue;
    var rest = comment.substring(prefix.length);
    var separator = rest.indexOf(':');
    if (separator < 1) continue;
    var id = rest.substring(0, separator);
    var role = rest.substring(separator + 1);
    if (!groups[id]) groups[id] = { id: id, controller: null, shapes: [], labels: [] };
    if (role === 'controller') groups[id].controller = layer;
    else if (role.indexOf('shape:') === 0) groups[id].shapes.push(layer);
    else if (role.indexOf('label:') === 0) groups[id].labels.push(layer);
  }
  return groups;
}

function opengeoVectorFeatureNeedsControlNormalization(group) {
  if (!group || !group.shapes.length) return false;
  try {
    var controllerEffects = group.controller && group.controller.property('ADBE Effect Parade');
    if (controllerEffects && controllerEffects.numProperties > 0) return true;
  } catch (controllerError) {}
  for (var shapeIndex = 0; shapeIndex < group.shapes.length; shapeIndex++) {
    var shape = group.shapes[shapeIndex];
    if (!opengeoVectorFindEffect(shape, 'Visible')) return true;
    var names = ['Fill Color', 'Fill Opacity', 'Stroke Color', 'Stroke Width'];
    for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {
      try {
        var effect = opengeoVectorFindEffect(shape, names[nameIndex]);
        var expression = effect && effect.property(1) ? String(effect.property(1).expression || '') : '';
        if (expression.indexOf('thisComp.layer') !== -1) return true;
      } catch (expressionError) {}
    }
  }
  return false;
}

function opengeoNormalizeVectorFeatureControls(compId) {
  var comp = ensureComp(compId);
  if (!comp) return 'error: target composition was not found.';
  var groups = opengeoVectorCollectFeatureLayers(comp);
  var pending = [];
  var key;
  for (key in groups) {
    if (groups.hasOwnProperty(key) && opengeoVectorFeatureNeedsControlNormalization(groups[key])) pending.push(groups[key]);
  }
  if (!pending.length) return JSON.stringify({ normalized: 0, controlsVersion: 2 });

  return withUndoGroup('OpenGeo: Consolidate Vector Controls', function() {
    var normalized = 0;
    for (var groupIndex = 0; groupIndex < pending.length; groupIndex++) {
      var group = pending[groupIndex];
      var controller = group.controller;
      var firstShape = group.shapes[0];
      var visible = Number(opengeoVectorReadEffectValue(controller, 'Visible', opengeoVectorReadEffectValue(firstShape, 'Visible', 1))) === 0 ? 0 : 1;
      var anchorLatitude = Number(opengeoVectorReadEffectValue(controller, 'Anchor Latitude', opengeoVectorReadEffectValue(firstShape, 'Anchor Latitude', 0))) || 0;
      var anchorLongitude = Number(opengeoVectorReadEffectValue(controller, 'Anchor Longitude', opengeoVectorReadEffectValue(firstShape, 'Anchor Longitude', 0))) || 0;
      var strokeColor = opengeoVectorReadEffectValue(controller, 'Stroke Color', opengeoVectorReadEffectValue(firstShape, 'Stroke Color', [1, 0.8, 0.2, 1]));
      var strokeWidth = Number(opengeoVectorReadEffectValue(controller, 'Stroke Width', opengeoVectorReadEffectValue(firstShape, 'Stroke Width', 3))) || 3;
      var fillColor = opengeoVectorReadEffectValue(controller, 'Fill Color', opengeoVectorReadEffectValue(firstShape, 'Fill Color', [0.12, 0.28, 0.42, 1]));
      var fillOpacity = Number(opengeoVectorReadEffectValue(controller, 'Fill Opacity', opengeoVectorReadEffectValue(firstShape, 'Fill Opacity', 0))) || 0;

      for (var shapeIndex = 0; shapeIndex < group.shapes.length; shapeIndex++) {
        var shape = group.shapes[shapeIndex];
        opengeoVectorEnsureShapeControl(shape, 'Visible', 'checkbox', visible);
        opengeoVectorEnsureShapeControl(shape, 'Anchor Latitude', 'slider', anchorLatitude);
        opengeoVectorEnsureShapeControl(shape, 'Anchor Longitude', 'slider', anchorLongitude);
        opengeoVectorEnsureShapeControl(shape, 'Stroke Color', 'color', strokeColor);
        opengeoVectorEnsureShapeControl(shape, 'Stroke Width', 'slider', strokeWidth);
        opengeoVectorEnsureShapeControl(shape, 'Fill Color', 'color', fillColor);
        opengeoVectorEnsureShapeControl(shape, 'Fill Opacity', 'slider', fillOpacity);
        try { shape.property('Opacity').expression = 'effect("Visible")("Checkbox") == 1 ? 100 : 0'; } catch (opacityError) {}
        shape.enabled = true;
        opengeoVectorOrderShapeControls(shape);
      }

      var safeShapeName = opengeoVectorEscapeExpressionString(firstShape.name);
      for (var labelIndex = 0; labelIndex < group.labels.length; labelIndex++) {
        try {
          group.labels[labelIndex].property('Opacity').expression = 'thisComp.layer("' + safeShapeName + '").effect("Visible")("Checkbox") == 1 ? 100 : 0';
          group.labels[labelIndex].enabled = true;
        } catch (labelError) {}
      }

      try {
        var controllerEffects = controller && controller.property('ADBE Effect Parade');
        if (controllerEffects) {
          for (var effectIndex = controllerEffects.numProperties; effectIndex >= 1; effectIndex--) controllerEffects.property(effectIndex).remove();
        }
      } catch (removeControlsError) {}
      normalized++;
    }
    return JSON.stringify({ normalized: normalized, controlsVersion: 2 });
  });
}

function opengeoFeatureList(compId) {
  var comp = ensureComp(compId);
  if (!comp) return 'error: target composition was not found.';
  var prefix = 'opengeo:feature:';
  var features = {};
  for (var index = 1; index <= comp.numLayers; index++) {
    var layer = comp.layer(index);
    var comment = layer && layer.comment ? String(layer.comment) : '';
    if (comment.indexOf(prefix) !== 0) continue;
    var rest = comment.substring(prefix.length);
    var separator = rest.indexOf(':');
    if (separator < 1) continue;
    var id = rest.substring(0, separator);
    if (!features[id]) features[id] = { id: id, name: id, visible: true, controllerId: null, layerCount: 0, shapeVisibilityFound: false, legacyControllerVisible: null };
    features[id].layerCount++;
    var role = rest.substring(separator + 1);
    if (role === 'controller') {
      features[id].name = String(layer.name || id).replace(/^OG • /, '').replace(/ • CTRL$/, '');
      features[id].controllerId = layer.index;
      try { features[id].legacyControllerVisible = layer.property('ADBE Effect Parade').property('Visible').property(1).value === 1; } catch (visibilityError) {}
    } else if (role.indexOf('shape:') === 0) {
      try {
        var shapeVisible = layer.property('ADBE Effect Parade').property('Visible').property(1).value === 1;
        features[id].visible = features[id].shapeVisibilityFound ? features[id].visible && shapeVisible : shapeVisible;
        features[id].shapeVisibilityFound = true;
      } catch (shapeVisibilityError) { features[id].visible = features[id].visible && layer.enabled === true; }
    }
  }
  var result = [];
  for (var key in features) if (features.hasOwnProperty(key)) {
    if (!features[key].shapeVisibilityFound && features[key].legacyControllerVisible !== null) features[key].visible = features[key].legacyControllerVisible;
    delete features[key].shapeVisibilityFound;
    delete features[key].legacyControllerVisible;
    result.push(features[key]);
  }
  return JSON.stringify({ features: result });
}

function opengeoFeatureSetVisibility(compId, featureId, visible) {
  var comp = ensureComp(compId);
  if (!comp) return 'error: target composition was not found.';
  var prefix = opengeoVectorFeaturePrefix(featureId);
  var changed = 0;
  return withUndoGroup('OpenGeo: Feature Visibility', function() {
    for (var index = 1; index <= comp.numLayers; index++) {
      var layer = comp.layer(index);
      if (!layer || String(layer.comment || '').indexOf(prefix) !== 0) continue;
      var role = String(layer.comment).substring(prefix.length);
      if (role === 'controller') {
        // Spatial reference only. Legacy controllers retain fallback support
        // until the one-time control normalization removes their effects.
        try { layer.property('ADBE Effect Parade').property('Visible').property(1).setValue(visible ? 1 : 0); } catch (visibilityError) {}
        layer.enabled = true;
      } else if (role.indexOf('shape:') === 0) {
        try { layer.property('ADBE Effect Parade').property('Visible').property(1).setValue(visible ? 1 : 0); } catch (shapeVisibilityError) {}
        layer.enabled = true;
      } else layer.enabled = visible === true;
      changed++;
    }
    return JSON.stringify({ featureId: opengeoVectorNormalizeFeatureId(featureId), visible: visible === true, changed: changed });
  });
}

function opengeoFeatureDelete(compId, featureId) {
  var comp = ensureComp(compId);
  if (!comp) return 'error: target composition was not found.';
  var prefix = opengeoVectorFeaturePrefix(featureId);
  return withUndoGroup('OpenGeo: Delete Feature', function() {
    var removed = 0;
    for (var index = comp.numLayers; index >= 1; index--) {
      var layer = comp.layer(index);
      if (layer && String(layer.comment || '').indexOf(prefix) === 0) { layer.remove(); removed++; }
    }
    return JSON.stringify({ featureId: opengeoVectorNormalizeFeatureId(featureId), removed: removed });
  });
}
