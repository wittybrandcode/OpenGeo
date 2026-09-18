// ============================================================================
// OpenGeo ExtendScript Host: Vector Path Builder Module
// Converts Geo coordinates into AE Shape() bezier vectors (32x vertex compression)
// ============================================================================

var $ = typeof $ !== 'undefined' ? $ : {};
$._opengeo = $._opengeo || {};
$._opengeo.vector = $._opengeo.vector || {};

(function(namespace) {
  'use strict';

  function buildBezierShape(ringPoints, isClosed) {
    if (!ringPoints || ringPoints.length < 2) return null;
    var vertices = [];
    var inT = [];
    var outT = [];
    for (var v = 0; v < ringPoints.length; v++) {
      var pt = ringPoints[v];
      if (!pt || pt.length < 2) continue;
      // 32x vertex compression to stay within After Effects 32767 coordinate limit
      vertices.push([pt[0] / 32, pt[1] / 32]);
      inT.push([0, 0]);
      outT.push([0, 0]);
    }
    if (vertices.length < 2) return null;

    var shape = new Shape();
    shape.vertices = vertices;
    shape.inTangents = inT;
    shape.outTangents = outT;
    shape.closed = isClosed !== false;
    return shape;
  }

  function addPathToGroup(groupContents, ringPoints, isClosed) {
    if (!groupContents) return null;
    var shape = buildBezierShape(ringPoints, isClosed);
    if (!shape) return null;

    var shapePath = groupContents.addProperty("ADBE Vector Shape - Group");
    if (!shapePath) return null;

    var shapeProp = shapePath.property("ADBE Vector Shape") || shapePath.property(1);
    if (shapeProp) shapeProp.setValue(shape);
    return shapePath;
  }

  namespace.pathBuilder = {
    buildBezierShape: buildBezierShape,
    addPathToGroup: addPathToGroup
  };
})($._opengeo.vector);
