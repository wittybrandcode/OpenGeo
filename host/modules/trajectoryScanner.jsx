// ==========================================
// OpenGeo ExtendScript Host: Trajectory & Baking Module
// ==========================================

function opengeoGetTimelineTrajectory(compId, sampleStepFrames) {
  try {
    var comp = ensureComp(compId);
    if (!comp) return 'error: comp not found';
    
    var controller = findLayerByComment(comp, 'opengeo:controller');
    if (!controller) return 'error: controller not found. Please select the OpenGeo Map composition.';
    
    var effects = controller.property("ADBE Effect Parade");
    var latProp = effects.property('Latitude').property(1);
    var lonProp = effects.property('Longitude').property(1);
    var zoomProp = effects.property('Zoom').property(1);
    
    var fps = comp.frameRate;
    var workStart = comp.workAreaStart;
    var workEnd = comp.workAreaStart + comp.workAreaDuration;
    var firstKeyTime = null;
    var lastKeyTime = null;
    var cameraProperties = [latProp, lonProp, zoomProp];
    for (var propertyIndex = 0; propertyIndex < cameraProperties.length; propertyIndex++) {
      var cameraProperty = cameraProperties[propertyIndex];
      if (cameraProperty.numKeys < 1) continue;
      var propertyFirst = cameraProperty.keyTime(1);
      var propertyLast = cameraProperty.keyTime(cameraProperty.numKeys);
      if (firstKeyTime === null || propertyFirst < firstKeyTime) firstKeyTime = propertyFirst;
      if (lastKeyTime === null || propertyLast > lastKeyTime) lastKeyTime = propertyLast;
    }

    // Static regions before the first key and after the last key repeat the
    // same viewport and add no spatial coverage. Scan only the animated range
    // intersecting the Work Area. If there are no keys (or no intersection),
    // one sample is sufficient for the visible static map.
    var start = workStart;
    var end = workStart;
    if (firstKeyTime !== null && lastKeyTime !== null) {
      start = Math.max(workStart, firstKeyTime);
      end = Math.min(workEnd, lastKeyTime);
      if (end < start) {
        start = workStart;
        end = workStart;
      }
    }
    
    var frames = [];
    var stepFrames = Math.max(1, Math.round(parseFloat(sampleStepFrames) || 1));
    var step = stepFrames / fps;
    var maxSamples = 5000;
    var expectedSamples = Math.ceil(Math.max(0, end - start) / step) + 1;
    if (expectedSamples > maxSamples) {
      return 'error: Work Area produces ' + expectedSamples + ' camera samples; limit is ' + maxSamples + '. Reduce the Work Area or increase the sample step.';
    }
    var lastSampleTime = null;
    for (var t = start; t <= end + (step * 0.001); t += step) {
      var sampleTime = Math.min(t, end);
      if (lastSampleTime !== null && Math.abs(sampleTime - lastSampleTime) < 0.000001) continue;
      var lat = latProp.valueAtTime(sampleTime, false);
      var lon = lonProp.valueAtTime(sampleTime, false);
      var zoom = zoomProp.valueAtTime(sampleTime, false);
      frames.push('{"lat":' + lat + ',"lon":' + lon + ',"zoom":' + zoom + '}');
      lastSampleTime = sampleTime;
    }
    if (lastSampleTime === null || Math.abs(lastSampleTime - end) >= 0.000001) {
      frames.push('{"lat":' + latProp.valueAtTime(end, false) + ',"lon":' + lonProp.valueAtTime(end, false) + ',"zoom":' + zoomProp.valueAtTime(end, false) + '}');
    }
    
    return '{"frames":[' + frames.join(',') + ']}';
  } catch (e) {
    var errStr = e.toString().replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return 'error: ' + errStr;
  }
}

function opengeoAddKeyframe(compId, lat, lon, zoom) {
  return withUndoGroup("OpenGeo: Add Keyframe", function() {
    try {
    var comp = ensureComp(compId);
    if (!comp) return 'error: comp not found';
    
    var controller = findLayerByComment(comp, 'opengeo:controller');
    if (!controller) return 'error: controller not found. Please select the OpenGeo Map composition.';
    
    var effects = controller.property("ADBE Effect Parade");
    var latProp = effects.property('Latitude').property(1);
    var lonProp = effects.property('Longitude').property(1);
    var zoomProp = effects.property('Zoom').property(1);
    
    var t = comp.time;
    
    // Atomic keyframe seeding: If the camera was static (no keyframes) and the
    // new keyframe is being added at t > 0, preserve the initial framing by
    // setting an anchor keyframe at t = 0 first.
    var isStatic = latProp.numKeys === 0 && lonProp.numKeys === 0 && zoomProp.numKeys === 0;
    if (isStatic && t > 0.001) {
      latProp.setValueAtTime(0, latProp.valueAtTime(0, false));
      lonProp.setValueAtTime(0, lonProp.valueAtTime(0, false));
      zoomProp.setValueAtTime(0, zoomProp.valueAtTime(0, false));
    }
    
    latProp.setValueAtTime(t, lat);
    lonProp.setValueAtTime(t, lon);
    zoomProp.setValueAtTime(t, zoom);
    
    return 'success';
    } catch (e) {
      var errStr = e.toString().replace(/"/g, '\\"').replace(/\n/g, '\\n');
      return 'error: ' + errStr;
    }
  });
}

function opengeoClearCameraKeyframes(compId) {
  return withUndoGroup("OpenGeo: Clear Camera Keyframes", function() {
    try {
      var comp = ensureComp(compId);
      if (!comp) return 'error: comp not found';

      var controller = findLayerByComment(comp, 'opengeo:controller');
      if (!controller) return 'error: controller not found. Please select the OpenGeo Map composition.';

      var effects = controller.property("ADBE Effect Parade");
      var latProp = effects.property('Latitude').property(1);
      var lonProp = effects.property('Longitude').property(1);
      var zoomProp = effects.property('Zoom').property(1);
      var properties = [latProp, lonProp, zoomProp];
      var values = [
        latProp.valueAtTime(comp.time, false),
        lonProp.valueAtTime(comp.time, false),
        zoomProp.valueAtTime(comp.time, false)
      ];
      var removed = 0;

      for (var propertyIndex = 0; propertyIndex < properties.length; propertyIndex++) {
        var property = properties[propertyIndex];
        removed += property.numKeys;
        for (var keyIndex = property.numKeys; keyIndex >= 1; keyIndex--) property.removeKey(keyIndex);
        property.setValue(values[propertyIndex]);
      }

      return JSON.stringify({
        status: 'success',
        keysRemoved: removed,
        camera: { lat: values[0], lng: values[1], zoom: values[2] }
      });
    } catch (e) {
      var errStr = e.toString().replace(/"/g, '\\"').replace(/\n/g, '\\n');
      return 'error: ' + errStr;
    }
  });
}
