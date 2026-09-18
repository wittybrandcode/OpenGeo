// ============================================================================
// OpenGeo ExtendScript Host: Vector Style Engine Module
// Manages vector effect controls, stroke/fill styling, and property expressions
// ============================================================================

var $ = typeof $ !== 'undefined' ? $ : {};
$._opengeo = $._opengeo || {};
$._opengeo.vector = $._opengeo.vector || {};

(function(namespace) {
  'use strict';

  function attachStyleControls(shapeLayer, payload, definition) {
    if (!shapeLayer) return null;
    var fx = shapeLayer.property("ADBE Effect Parade");
    if (!fx) return null;

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
    opengeoVectorAddCheckbox(fx, "Show Label", true);
    opengeoVectorAddCheckbox(fx, "Auto-Orient Label to Camera", true);
    opengeoVectorAddSlider(fx, "Label Size", 100);
    opengeoVectorAddSlider(fx, "Label Offset X", 0);
    opengeoVectorAddSlider(fx, "Label Offset Y", 0);
    opengeoVectorAddCheckbox(fx, "Scale with Zoom", false);
    opengeoVectorAddSlider(fx, "Reference Zoom", Number(payload.referenceZoom) || 6);
    opengeoVectorAddSlider(fx, "Min Zoom Scale", 25);
    opengeoVectorAddSlider(fx, "Max Zoom Scale", 400);

    return fx;
  }

  function bindStyleExpressions(shapeLayer, contents, isClosed) {
    if (!shapeLayer || !contents) return;

    shapeLayer.property('Opacity').expression = 'effect("Visible")("Checkbox") == 1 ? 100 : 0';

    if (isClosed !== false) {
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
      if (sWidth) sWidth.expression = 'effect("Stroke Width")("Slider")';
    }

    var trim = contents.addProperty("ADBE Vector Filter - Trim");
    if (trim) {
      var tStart = trim.property("ADBE Vector Trim Start") || trim.property(1);
      if (tStart) tStart.expression = 'effect("Trim Start")("Slider")';
      var tEnd = trim.property("ADBE Vector Trim End") || trim.property(2);
      if (tEnd) tEnd.expression = 'effect("Trim End")("Slider")';
      var tOffset = trim.property("ADBE Vector Trim Offset") || trim.property(3);
      if (tOffset) tOffset.expression = 'effect("Trim Offset")("Slider")';
    }
  }

  namespace.styleEngine = {
    attachStyleControls: attachStyleControls,
    bindStyleExpressions: bindStyleExpressions
  };
})($._opengeo.vector);
