// ============================================================================
// OpenGeo ExtendScript Host: Composition build result serialization
// ============================================================================

function opengeoSerializeCompositionResult(containingComp, importedCount, tilesTotal) {
  var compName = String(containingComp.name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return '{"success":true,"tilesImported":' + importedCount +
    ',"tilesTotal":' + tilesTotal +
    ',"compId":' + containingComp.id +
    ',"compName":"' + compName + '"}';
}
