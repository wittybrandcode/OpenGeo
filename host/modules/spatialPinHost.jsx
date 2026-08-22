// ==========================================
// OpenGeo ExtendScript Host: Spatial Pin & Boundaries Module
// ==========================================

function opengeoAddSpatialPin(compId, lat, lng, name) {
  return withUndoGroup('OpenGeo: Add Spatial Pin', function() {
    try {
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
    
    // Generate the expression on the host after resolving the exact map layer
    // for this document. This avoids global composition names and keeps pins
    // attached to the same MapPivot as raster/vector layers.
    pin.property('Position').expression =
      'var ctrl = thisComp.layer("' + mapLayerName + '");\n' +
      'var pivot = ctrl.source.layer("MapPivot");\n' +
      'var pinLat = ' + lat + ';\n' +
      'var pinLng = ' + lng + ';\n' +
      'var sinLat = Math.sin(pinLat * Math.PI / 180);\n' +
      'var worldX = ((pinLng + 180) / 360) * 262144;\n' +
      'var worldY = ((1 - Math.log((1 + sinLat) / (1 - sinLat)) / Math.PI) / 2) * 262144;\n' +
      'var pivotAnchor = pivot.transform.anchorPoint;\n' +
      'var pivotScale = pivot.transform.scale[0] / 100;\n' +
      'var ctrlPos = ctrl.transform.position;\n' +
      '[ctrlPos[0] + (worldX - pivotAnchor[0]) * pivotScale, ctrlPos[1] + (worldY - pivotAnchor[1]) * pivotScale, 0];';
    
    var textLayer = comp.layers.addText(name || 'Pin Label');
    textLayer.parent = pin;
    textLayer.property('Position').setValue([0, 0, 0]);
    textLayer.threeDLayer = true;
    
    comp.openInViewer();
    return pin.id.toString();
    } catch (e) {
      hError('addSpatialPin: ' + e.toString());
      return 'error: ' + e.toString();
    }
  });
}
