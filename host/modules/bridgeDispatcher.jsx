// ============================================================================
// OpenGeo Bridge Protocol v2
// ============================================================================

var OPENGEO_BRIDGE_PROTOCOL_VERSION = '2.0.0';

function opengeoBridgeOk(data, requestId, command) {
  return JSON.stringify({
    protocolVersion: OPENGEO_BRIDGE_PROTOCOL_VERSION,
    ok: true,
    data: data === undefined ? null : data,
    requestId: requestId || null,
    command: command || null
  });
}

function opengeoBridgeError(code, message, requestId, command, details) {
  return JSON.stringify({
    protocolVersion: OPENGEO_BRIDGE_PROTOCOL_VERSION,
    ok: false,
    error: { code: code || 'HOST_ERROR', message: String(message || 'Unknown host error'), details: details || null },
    requestId: requestId || null,
    command: command || null
  });
}

var opengeoBridgeHandlers = {
  'project.getState': { kind: 'json', run: function(args) { return opengeoCheckProjectState(); } },
  'project.listOpenGeoMaps': { kind: 'json', run: function(args) { return opengeoListProjectMaps(); } },
  'project.openOpenGeoMap': { kind: 'json', run: function(args) { return opengeoOpenProjectMap(args.compId, args.documentId); } },
  'project.prepareOpenGeoMapThumbnail': { kind: 'json', run: function(args) { return opengeoPrepareProjectMapThumbnail(args.compId, args.documentId); } },
  'camera.getActive': { kind: 'json', run: function(args) { return opengeoGetActiveState(); } },
  'camera.update': { kind: 'json', run: function(args) { return opengeoUpdateCamera(args.compId, args.lat, args.lng, args.zoom, args.recordKeyframe === true, args.revision); } },
  'metadata.get': { kind: 'json', run: function(args) { return opengeoGetCompMetadata(args.compId); } },
  'metadata.set': { kind: 'empty', run: function(args) { return opengeoSetCompMetadata(args.compId, args.data); } },
  'composition.build': { kind: 'json', run: function(args) { return opengeoBuildComposition(args.payloadFile ? opengeoReadPayloadFile(args.payloadFile) : args.payload); } },
  'composition.prepare': { kind: 'json', run: function(args) { return opengeoPrepareCompositionRevision(args.payloadFile ? opengeoReadPayloadFile(args.payloadFile) : args.payload); } },
  'composition.commit': { kind: 'json', run: function(args) { return opengeoCommitCompositionRevision(args); } },
  'composition.rollback': { kind: 'json', run: function(args) { return opengeoRollbackCompositionRevision(args); } },
  'composition.getRevision': { kind: 'json', run: function(args) { return opengeoGetCompositionRevision(args); } },
  'trajectory.scan': { kind: 'json', run: function(args) { return opengeoGetTimelineTrajectory(args.compId, args.sampleStep); } },
  'vector.import': { kind: 'json', run: function(args) { return opengeoImportVectorMapFromFile(args.compId, args.filePath, args.layerName, args.featureSignature); } },
  'feature.list': { kind: 'json', run: function(args) { return opengeoFeatureList(args.compId); } },
  'feature.normalizeControls': { kind: 'json', run: function(args) { return opengeoNormalizeVectorFeatureControls(args.compId); } },
  'feature.visibility': { kind: 'json', run: function(args) { return opengeoFeatureSetVisibility(args.compId, args.featureId, args.visible === true); } },
  'feature.delete': { kind: 'json', run: function(args) { return opengeoFeatureDelete(args.compId, args.featureId); } },
  'pin.add': { kind: 'scalar', run: function(args) { return opengeoAddSpatialPin(args.compId, args.lat, args.lng, args.name, args); } },
  'keyframe.add': { kind: 'empty', run: function(args) { return opengeoAddKeyframe(args.compId, args.lat, args.lng, args.zoom); } },
  'keyframe.clear': { kind: 'json', run: function(args) { return opengeoClearCameraKeyframes(args.compId); } }
};

function opengeoBridgeFailureFromText(text, requestId, command) {
  var message = text.substring(6).replace(/^\s+/, '');
  var match = /^\[([A-Z0-9_]+)\]\s*/.exec(message);
  var code = match ? match[1] : 'HOST_COMMAND_FAILED';
  if (match) message = message.substring(match[0].length);
  return opengeoBridgeError(code, message, requestId, command);
}

function opengeoBridgeNormalizeCommandResult(handler, result, requestId, command) {
  if (result === undefined || result === null || result === '' || result === 'success' || result === 'ok') {
    return opengeoBridgeOk(null, requestId, command);
  }
  if (typeof result === 'object') return opengeoBridgeOk(result, requestId, command);
  var text = String(result);
  if (text.indexOf('error:') === 0) return opengeoBridgeFailureFromText(text, requestId, command);
  if (handler.kind === 'empty') return opengeoBridgeError('HOST_RESPONSE_MALFORMED', 'Command returned unexpected data.', requestId, command);
  if (handler.kind === 'scalar') return opengeoBridgeOk(text, requestId, command);
  try {
    var parsed = JSON.parse(text);
    if (parsed && parsed.error) return opengeoBridgeError('HOST_COMMAND_FAILED', parsed.error, requestId, command);
    return opengeoBridgeOk(parsed, requestId, command);
  } catch (parseError) {
    return opengeoBridgeError('HOST_RESPONSE_MALFORMED', 'Command did not return valid JSON.', requestId, command);
  }
}

function opengeoDispatch(requestJson) {
  var request = null;
  var requestId = null;
  var command = null;
  try {
    request = typeof requestJson === 'string' ? JSON.parse(requestJson) : requestJson;
    if (!request || typeof request !== 'object') return opengeoBridgeError('INVALID_REQUEST', 'Request must be an object.', null, null);
    requestId = request.requestId || null;
    command = request.command || null;
    if (request.protocolVersion !== OPENGEO_BRIDGE_PROTOCOL_VERSION) return opengeoBridgeError('BRIDGE_PROTOCOL_UNSUPPORTED', 'Bridge protocol 2.0.0 is required.', requestId, command);
    if (!requestId || typeof requestId !== 'string') return opengeoBridgeError('INVALID_REQUEST_ID', 'Request id is required.', null, command);
    if (!command || typeof command !== 'string') return opengeoBridgeError('INVALID_REQUEST', 'Command is required.', requestId, null);
    if (!opengeoBridgeHandlers.hasOwnProperty(command)) return opengeoBridgeError('UNKNOWN_COMMAND', command, requestId, command);
    var args = request.args === undefined ? {} : request.args;
    if (!args || typeof args !== 'object') return opengeoBridgeError('INVALID_ARGUMENTS', 'Command arguments must be an object.', requestId, command);
    var handler = opengeoBridgeHandlers[command];
    return opengeoBridgeNormalizeCommandResult(handler, handler.run(args), requestId, command);
  } catch (error) {
    return opengeoBridgeError('HOST_EXCEPTION', error.toString(), requestId, command, { line: error.line || null });
  }
}
