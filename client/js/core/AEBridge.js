class AEBridge {
  constructor() {
    this._cs = null;
    this.isHostInitialized = false;
    this._sequence = 0;
    try {
      this._cs = new CSInterface();
    } catch (e) {
      console.warn('CSInterface init failed (not in CEP environment)');
    }
  }

  /**
   * Initializes the ExtendScript Host environment (loads index.jsx)
   * Ensures it is only loaded once per session.
   */
  async initializeHost() {
    if (!this._cs || this.isHostInitialized) return;

    return new Promise((resolve) => {
      // The manifest.xml already loads host/index.jsx automatically via <ScriptPath>.
      // Attempting to read and eval it manually via cep.fs.readFile often fails on Windows due to URI pathing.
      this.isHostInitialized = true;
      resolve(true);
    });
  }

  /**
   * Evaluates an ExtendScript string asynchronously.
   * Includes a timeout mechanism.
   * @param {string} script 
   * @param {number} timeoutMs 
   */
  _evalScript(script, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!this._cs) {
        reject(this._error('BRIDGE_UNAVAILABLE', 'CSInterface is not available.'));
        return;
      }
      
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(this._error('BRIDGE_TIMEOUT', 'After Effects did not answer before the bridge timeout.'));
      }, timeoutMs);
      
      this._cs.evalScript(script, (result) => {
        if (timedOut) return;
        clearTimeout(timer);
        if (result === 'EvalScript error.') {
          reject(this._error('BRIDGE_EVAL_ERROR', 'After Effects rejected the ExtendScript bridge call.'));
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * The only client-side gateway to ExtendScript.  Commands and arguments are
   * serialized once and host responses always use the bridge envelope.
   */
  async invoke(command, args = {}, options = {}) {
    if (!command || typeof command !== 'string') {
      throw this._error('BRIDGE_COMMAND_INVALID', 'AEBridge command must be a non-empty string');
    }
    const requestId = `ae_${Date.now().toString(36)}_${(++this._sequence).toString(36)}`;
    let request;
    try { request = JSON.stringify({ protocolVersion: '2.0.0', command, args, requestId }); }
    catch (error) { throw this._error('BRIDGE_REQUEST_SERIALIZE', `Could not serialize arguments for ${command}`); }
    const encodedRequest = JSON.stringify(request);
    const result = await this._evalScript(`opengeoDispatch(${encodedRequest})`, options.timeoutMs || 30000);
    let envelope;
    try {
      envelope = JSON.parse(result);
    } catch (error) {
      throw this._error('BRIDGE_RESPONSE_MALFORMED', `Invalid host response for ${command}`);
    }
    if (!envelope || envelope.protocolVersion !== '2.0.0' || envelope.requestId !== requestId || envelope.command !== command || typeof envelope.ok !== 'boolean') {
      throw this._error('BRIDGE_RESPONSE_MISMATCH', `Mismatched host response for ${command}`);
    }
    if (!envelope.ok) {
      const hostError = envelope.error || {};
      throw this._error(hostError.code || 'HOST_ERROR', hostError.message || `Host command failed: ${command}`, hostError.details);
    }
    return envelope.data;
  }

  /**
   * Sends large JSON through a temporary job file so the CEP-to-JSX command
   * remains small and safely serialized.  The file is removed only after the
   * host has completed reading it.
   */
  async invokeWithPayloadFile(command, payload, jobManager, options = {}) {
    if (!jobManager) throw new Error('A JobManager is required for payload-file commands');
    const fs = require('fs');
    const jobId = jobManager.startJob('bridge_payload');
    try {
      const payloadFile = jobManager.createTempFile(jobId, '.json');
      await new Promise((resolve, reject) => fs.writeFile(payloadFile, JSON.stringify(payload), 'utf8', error => error ? reject(error) : resolve()));
      return await this.invoke(command, { payloadFile }, options);
    } finally {
      jobManager.finishJob(jobId);
    }
  }

  _error(code, message, details) {
    const error = new Error(message);
    error.name = 'OpenGeoBridgeError';
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
  }

}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AEBridge;
} else if (typeof window !== 'undefined') {
  window.AEBridge = AEBridge;
}
