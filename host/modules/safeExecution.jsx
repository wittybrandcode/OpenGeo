// ==========================================
// OpenGeo ExtendScript Host: Safe Execution & Error Recovery
// ==========================================

var $ = typeof $ !== 'undefined' ? $ : {};
$._opengeo = $._opengeo || {};

/**
 * Execute an ExtendScript operation safely without throwing or silently swallowing errors.
 * Logs any caught exception and returns a standardized result object.
 *
 * @param {Function} actionFn - The function to execute.
 * @param {string} [contextName='Operation'] - Context name for error logging.
 * @param {*} [fallbackValue=null] - Value to return in result.value if actionFn throws.
 * @returns {{ ok: boolean, value: *, error: string|null }}
 */
function opengeoSafeExec(actionFn, contextName, fallbackValue) {
  if (typeof actionFn !== 'function') {
    return { ok: false, value: fallbackValue !== undefined ? fallbackValue : null, error: 'actionFn must be a function' };
  }
  var ctx = contextName || 'Action';
  try {
    var res = actionFn();
    return { ok: true, value: res, error: null };
  } catch (err) {
    var errMsg = err ? (err.message || String(err)) : 'Unknown ExtendScript error';
    if (typeof hError === 'function') {
      hError('[' + ctx + '] Handled failure: ' + errMsg);
    } else {
      try { $.writeln('[OpenGeo ERROR] [' + ctx + '] ' + errMsg); } catch (e) { /* logging fallback */ }
    }
    return {
      ok: false,
      value: fallbackValue !== undefined ? fallbackValue : null,
      error: errMsg
    };
  }
}

/**
 * Execute a property access or evaluation that may fail when property is missing.
 *
 * @param {Function} getterFn - Accessor function
 * @param {*} defaultValue - Value returned on error
 * @param {string} [debugContext] - Optional context for debug trace
 * @returns {*}
 */
function opengeoSafeGet(getterFn, defaultValue, debugContext) {
  try {
    var val = getterFn();
    return val !== undefined ? val : defaultValue;
  } catch (err) {
    if (debugContext && typeof hLog === 'function') {
      hLog('[SafeGet:' + debugContext + '] Defaulting due to: ' + (err.message || String(err)));
    }
    return defaultValue;
  }
}
