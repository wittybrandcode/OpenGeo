// ============================================================================
// OpenGeo ExtendScript Host: Vector Layer Factory Module
// Creates controller nulls, shape layers, and text label layers
// ============================================================================

var $ = typeof $ !== 'undefined' ? $ : {};
$._opengeo = $._opengeo || {};
$._opengeo.vector = $._opengeo.vector || {};

(function(namespace) {
  'use strict';

  function createController(outerComp, mapLayerName, payload, featureId, prefix) {
    if (!outerComp) return null;
    return opengeoVectorCreateController(outerComp, mapLayerName, payload, featureId, prefix);
  }

  function createShape(outerComp, mapLayerName, payload, definition, comment) {
    if (!outerComp) return null;
    return opengeoVectorCreateShapeLayer(outerComp, mapLayerName, payload, definition, comment);
  }

  function createLabel(outerComp, mapLayerName, payload, label, index, comment, visibilityLayerName, controller) {
    if (!outerComp) return null;
    return opengeoVectorCreateLabelLayer(outerComp, mapLayerName, payload, label, index, comment, visibilityLayerName, controller);
  }

  namespace.layerFactory = {
    createController: createController,
    createShape: createShape,
    createLabel: createLabel
  };
})($._opengeo.vector);
