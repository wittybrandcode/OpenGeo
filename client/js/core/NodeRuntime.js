/** Restores the CEP Node globals after a CEF DevTools page reload. */
(function bootstrapCepNodeRuntime(globalObject) {
  if (!globalObject) return;
  if (typeof globalObject.require !== 'function' && globalObject.cep_node && typeof globalObject.cep_node.require === 'function') {
    globalObject.require = function requireCepModule(moduleName) {
      return globalObject.cep_node.require(moduleName);
    };
  }
  if (typeof globalObject.require !== 'function') return;
  if (typeof globalObject.Buffer === 'undefined') {
    try { globalObject.Buffer = globalObject.require('buffer').Buffer; } catch (_bufferError) {}
  }
  if (typeof globalObject.process === 'undefined') {
    try { globalObject.process = globalObject.require('process'); } catch (_processError) {}
  }
})(typeof window !== 'undefined' ? window : null);
