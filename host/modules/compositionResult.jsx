// ============================================================================
// OpenGeo ExtendScript Host: Composition build result serialization
// ============================================================================

var $ = typeof $ !== 'undefined' ? $ : {};
$._opengeo = $._opengeo || {};

function opengeoSerializeCompositionResult(containingComp, importedCount, tilesTotal) {
  var compName = String(containingComp.name).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return '{"success":true,"tilesImported":' + importedCount +
    ',"tilesTotal":' + tilesTotal +
    ',"compId":' + containingComp.id +
    ',"compName":"' + compName + '"}';
}

// Register serialization helper on $._opengeo namespace
$._opengeo.result = {
  serializeCompositionResult: opengeoSerializeCompositionResult
};
