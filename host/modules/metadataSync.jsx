// ==========================================
// OpenGeo ExtendScript Host: Metadata & Sync Modules
// ==========================================

function opengeoIsValidObject(obj) {
  if (!obj) return false;
  try {
    var test = obj.name;
    return true;
  } catch (e) {
    return false;
  }
}

var OPEN_GEO_ACTIVE_STATE_CACHE = {
  activeItemId: null,
  comp: null,
  controller: null
};

function opengeoGetCachedActiveMapState() {
  var activeItem = null;
  try {
    activeItem = app.project ? app.project.activeItem : null;
  } catch (e) {
    return null;
  }
  var cache = OPEN_GEO_ACTIVE_STATE_CACHE;

  if (!activeItem || !opengeoIsValidObject(activeItem)) {
    // When focus leaves AE to the CEP panel, app.project.activeItem is null.
    // Preserve the cached active composition if it is still valid in AE.
    if (cache.comp && opengeoIsValidObject(cache.comp) && cache.controller && opengeoIsValidObject(cache.controller)) {
      try {
        var cachedLayer = cache.comp.layer(cache.controller.index);
        if (cachedLayer === cache.controller) return cache;
      } catch (ignoreCachedState) {}
    }
    // If cache is not populated (e.g. extension restarted/reloaded), look for
    // any existing OpenGeo map composition in the project.
    if (app.project && app.project.items) {
      for (var itemIndex = 1; itemIndex <= app.project.items.length; itemIndex++) {
        try {
          var item = app.project.items[itemIndex];
          if (item && opengeoIsValidObject(item) && (item instanceof CompItem)) {
            var ctrl = findLayerByComment(item, 'opengeo:controller');
            if (ctrl && opengeoIsValidObject(ctrl)) {
              cache.activeItemId = item.id;
              cache.comp = item;
              cache.controller = ctrl;
              return cache;
            }
          }
        } catch (ignoreItem) {}
      }
    }
    return null;
  }

  var activeItemId = null;
  try {
    activeItemId = activeItem.id;
  } catch (e) {
    return null;
  }

  if (cache.activeItemId === activeItemId && cache.comp && cache.controller) {
    try {
      if (opengeoIsValidObject(cache.comp) && opengeoIsValidObject(cache.controller)) {
        var cachedLayer = cache.comp.layer(cache.controller.index);
        if (cachedLayer === cache.controller) return cache;
      }
    } catch (ignoreCachedState) {}
  }

  var comp = resolveOpenGeoMapComp(activeItem);
  if (!comp || !opengeoIsValidObject(comp) || !(comp instanceof CompItem)) return null;
  cache.activeItemId = activeItemId;
  cache.comp = comp;
  cache.controller = findLayerByComment(comp, 'opengeo:controller');
  return cache;
}

function opengeoGetSyncRevision(effects) {
  if (!effects) return 0;
  try {
    var revisionEffect = effects.property('OpenGeo Sync Revision');
    if (!revisionEffect) return 0;
    var value = Number(revisionEffect.property(1).value);
    return isFinite(value) && value >= 0 ? value : 0;
  } catch (ignoreRevisionRead) {
    return 0;
  }
}

function opengeoSetSyncRevision(effects, revision) {
  if (!effects) throw new Error('Camera effects are missing');
  var normalizedRevision = Number(revision);
  if (!isFinite(normalizedRevision) || normalizedRevision < 0) normalizedRevision = 0;
  normalizedRevision = Math.floor(normalizedRevision) % 1000000;
  var revisionEffect = effects.property('OpenGeo Sync Revision');
  if (!revisionEffect) {
    revisionEffect = effects.addProperty('ADBE Slider Control');
    revisionEffect.name = 'OpenGeo Sync Revision';
    revisionEffect.enabled = false;
  }
  revisionEffect.property(1).setValue(normalizedRevision);
  return normalizedRevision;
}

function opengeoSetCompMetadata(compId, dataString) {
  try {
    if (typeof dataString !== 'string') return 'error: [METADATA_INVALID] Composition metadata must be a JSON string';
    if (dataString.length > 262144) return 'error: [METADATA_SIZE_LIMIT] Composition metadata exceeds 256 KB';
    var parsedMetadata = null;
    try { parsedMetadata = JSON.parse(dataString); } catch (parseError) {
      return 'error: [METADATA_INVALID] Composition metadata is not valid JSON';
    }
    if (!parsedMetadata || typeof parsedMetadata !== 'object' || !parsedMetadata.opengeo || typeof parsedMetadata.opengeo !== 'object') {
      return 'error: [METADATA_INVALID] OpenGeo metadata root is missing';
    }
    if (parsedMetadata.opengeo.features !== undefined && (!(parsedMetadata.opengeo.features instanceof Array) || parsedMetadata.opengeo.features.length > 500)) {
      return 'error: [METADATA_FEATURE_LIMIT] Composition feature registry is invalid';
    }
    var comp = ensureComp(compId);
    if (!comp) return 'error: comp not found';
    comp.comment = dataString;
    return 'success';
  } catch (e) {
    return 'error: ' + e.toString();
  }
}

function opengeoGetCompMetadata(compId) {
  try {
    var comp = ensureComp(compId);
    if (!comp) return 'error: comp not found';
    var metadata = {};
    try {
      metadata = JSON.parse(comp.comment || '{}');
    } catch (ignoreInvalidComment) {
      return 'error: [METADATA_INVALID] Composition metadata is not valid JSON';
    }
    if (!metadata || typeof metadata !== 'object') metadata = {};
    if (!metadata.opengeo || typeof metadata.opengeo !== 'object') metadata.opengeo = {};
    // Ground-truth fallback: if camera or provider values are missing in comp comment,
    // recover them directly from the controller layer effects parade and precomp comment.
    var controller = findLayerByComment(comp, 'opengeo:controller');
    if (controller && opengeoIsValidObject(controller)) {
      try {
        var effects = controller.property("ADBE Effect Parade");
        if (effects && opengeoIsValidObject(effects)) {
          var latProp = effects.property('Latitude');
          var lngProp = effects.property('Longitude');
          var zoomProp = effects.property('Zoom');
          if (latProp && lngProp && zoomProp) {
            if (metadata.opengeo.centerLat === undefined) metadata.opengeo.centerLat = latProp.property(1).valueAtTime(comp.time, false);
            if (metadata.opengeo.centerLng === undefined) metadata.opengeo.centerLng = lngProp.property(1).valueAtTime(comp.time, false);
            if (metadata.opengeo.zoom === undefined) metadata.opengeo.zoom = zoomProp.property(1).valueAtTime(comp.time, false);
          }
        }
      } catch (cameraErr) {}
      if (metadata.opengeo.source === undefined && controller.source && controller.source.comment) {
        var ownership = opengeoReadOwnership(controller.source.comment);
        if (ownership && ownership.source) metadata.opengeo.source = ownership.source;
      }
    }
    // The CompItem is authoritative for format. Persisted dimensions may be
    // stale after a rapid composition switch or a manual AE resize.
    metadata.opengeo.compWidth = comp.width;
    metadata.opengeo.compHeight = comp.height;
    return JSON.stringify(metadata);
  } catch (e) {
    return 'error: ' + e.toString();
  }
}

function opengeoGetActiveState() {
  try {
    if (!app.project) return '{}';
    var cachedState = opengeoGetCachedActiveMapState();
    if (!cachedState) return '{}';
    var comp = cachedState.comp;
    var controller = cachedState.controller;
    // A regular AE composition is not an OpenGeo target. Returning its compId
    // without a controller leaves the panel pointing at a composition that can
    // never accept vector imports.
    if (!comp || !opengeoIsValidObject(comp) || !controller || !opengeoIsValidObject(controller)) return '{}';

    var stateStr = '{"compId":' + comp.id;
    try {
      var effects = controller.property("ADBE Effect Parade");
      if (!effects || !opengeoIsValidObject(effects)) return '{}';
      var latProp = effects.property('Latitude');
      var lngProp = effects.property('Longitude');
      var zoomProp = effects.property('Zoom');
      if (!latProp || !lngProp || !zoomProp) return '{}';
      var lat = latProp.property(1).value;
      var lng = lngProp.property(1).value;
      var zoom = zoomProp.property(1).value;
      var pitchProp = effects.property('Pitch');
      var pitch = (pitchProp && pitchProp.property(1)) ? pitchProp.property(1).value : 0;
      stateStr += ', "controllerId":' + controller.index;
      stateStr += ', "appliedRevision":' + opengeoGetSyncRevision(effects);
      stateStr += ', "camera":{"lat":' + lat + ', "lng":' + lng + ', "zoom":' + zoom + ', "pitch":' + pitch + '}';
    } catch (ex) {
      return '{}';
    }
    stateStr += '}';
    return stateStr;
  } catch (e) {
    return 'error: ' + e.toString();
  }
}

function opengeoUpdateCamera(compId, lat, lng, zoom, recordKeyframe, revision, pitch) {
  try {
    var comp = ensureComp(compId);
    if (!comp) {
      return JSON.stringify({
        applied: false,
        disposition: 'comp-not-found',
        reason: 'Composition not found'
      });
    }
    
    var controller = findLayerByComment(comp, 'opengeo:controller');
    if (!controller || !opengeoIsValidObject(controller)) {
      return JSON.stringify({
        applied: false,
        disposition: 'controller-not-found',
        reason: 'Map controller not found'
      });
    }

    var effects = controller.property("ADBE Effect Parade");
    if (!effects || !opengeoIsValidObject(effects)) {
      return JSON.stringify({
        applied: false,
        disposition: 'effects-not-found',
        reason: 'Controller effects parade not found'
      });
    }

    var latEffect = effects.property('Latitude');
    var lngEffect = effects.property('Longitude');
    var zoomEffect = effects.property('Zoom');
    var pitchEffect = effects.property('Pitch');
    if (!latEffect || !lngEffect || !zoomEffect) {
      return JSON.stringify({
        applied: false,
        disposition: 'properties-not-found',
        reason: 'Camera control effects not found'
      });
    }

    var latitudeProperty = latEffect.property(1);
    var longitudeProperty = lngEffect.property(1);
    var zoomProperty = zoomEffect.property(1);
    var pitchProperty = pitchEffect ? pitchEffect.property(1) : null;
    if (!latitudeProperty || !longitudeProperty || !zoomProperty) {
      return JSON.stringify({
        applied: false,
        disposition: 'properties-not-found',
        reason: 'Camera property values not found'
      });
    }

    var canApplyCamera = opengeoCanSetCameraControlValue(latitudeProperty, comp.time, recordKeyframe === true) &&
      opengeoCanSetCameraControlValue(longitudeProperty, comp.time, recordKeyframe === true) &&
      opengeoCanSetCameraControlValue(zoomProperty, comp.time, recordKeyframe === true) &&
      (!pitchProperty || opengeoCanSetCameraControlValue(pitchProperty, comp.time, recordKeyframe === true));

    // Keyframed properties are evaluated from their timeline values. In
    // normal navigation we therefore leave an existing animation intact;
    // Record mode is the explicit opt-in that writes at the current CTI.
    if (canApplyCamera) {
      opengeoSetCameraControlValue(latitudeProperty, comp.time, lat, recordKeyframe === true);
      opengeoSetCameraControlValue(longitudeProperty, comp.time, lng, recordKeyframe === true);
      opengeoSetCameraControlValue(zoomProperty, comp.time, zoom, recordKeyframe === true);
      if (pitchProperty && pitch !== undefined && pitch !== null && isFinite(parseFloat(pitch))) {
        opengeoSetCameraControlValue(pitchProperty, comp.time, parseFloat(pitch), recordKeyframe === true);
      }
    }
    var appliedRevision = canApplyCamera
      ? opengeoSetSyncRevision(effects, revision)
      : opengeoGetSyncRevision(effects);
    var actualCamera = {
      lat: latitudeProperty.valueAtTime(comp.time, false),
      lng: longitudeProperty.valueAtTime(comp.time, false),
      zoom: zoomProperty.valueAtTime(comp.time, false),
      pitch: pitchProperty ? pitchProperty.valueAtTime(comp.time, false) : 0
    };
    OPEN_GEO_ACTIVE_STATE_CACHE.activeItemId = null;
    return JSON.stringify({
      applied: canApplyCamera,
      appliedRevision: appliedRevision,
      disposition: canApplyCamera ? (recordKeyframe === true ? 'recorded' : 'updated') : 'skipped-keyframed-outside-cti',
      camera: actualCamera
    });
  } catch (e) {
    if (String(e).indexOf('Object is invalid') !== -1) {
      OPEN_GEO_ACTIVE_STATE_CACHE.activeItemId = null;
      OPEN_GEO_ACTIVE_STATE_CACHE.comp = null;
      OPEN_GEO_ACTIVE_STATE_CACHE.controller = null;
      return JSON.stringify({
        applied: false,
        disposition: 'target-invalidated',
        reason: 'AE object invalidated during sync'
      });
    }
    return 'error: ' + e.toString();
  }
}

function opengeoFindCameraKeyAtTime(property, time) {
  if (!property || property.numKeys === 0) return 0;
  var keyIndex = property.nearestKeyIndex(time);
  var frameTolerance = 1 / 240;
  if (keyIndex > 0 && Math.abs(property.keyTime(keyIndex) - time) <= frameTolerance) return keyIndex;
  return 0;
}

function opengeoCanSetCameraControlValue(property, time, recordKeyframe) {
  if (!property) return false;
  return recordKeyframe === true || property.numKeys === 0 || opengeoFindCameraKeyAtTime(property, time) > 0;
}

function opengeoSetCameraControlValue(property, time, value, recordKeyframe) {
  if (!property) throw new Error('Camera control is missing');
  if (recordKeyframe) {
    property.setValueAtTime(time, value);
  } else if (property.numKeys === 0) {
    property.setValue(value);
  } else {
    // Editing an existing key at the CTI is safe and expected: it keeps the
    // CEP framing and AE Viewer identical without silently creating a new
    // animation key. A new key at another time still requires Record mode.
    var keyIndex = opengeoFindCameraKeyAtTime(property, time);
    if (keyIndex > 0) {
      property.setValueAtKey(keyIndex, value);
    }
  }
}
