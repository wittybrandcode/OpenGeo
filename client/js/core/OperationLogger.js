/** Bounded, redacted JSONL diagnostics stored under CEP user data. */
class OperationLogger {
  constructor(eventBus, options = {}) {
    this.eventBus = eventBus || null;
    this.maxBytes = Number(options.maxBytes) || 1024 * 1024;
    this.maxFiles = Number(options.maxFiles) || 3;
    this.consoleEnabled = options.consoleEnabled === true;
    this._startedAt = new Map();
    this._unsubscribers = [];
    this._writeQueue = Promise.resolve();
    this.fs = null;
    this.path = null;
    this.logDir = null;
    this.logFile = null;
    this._initializeFilesystem(options.logDir);
    this._subscribe();
  }

  _initializeFilesystem(explicitDirectory) {
    try {
      this.fs = require('fs');
      this.path = require('path');
      this.logDir = explicitDirectory || this._resolveLogDirectory();
      if (!this.logDir) return;
      this.fs.mkdirSync(this.logDir, { recursive: true });
      this.logFile = this.path.join(this.logDir, 'operations.jsonl');
    } catch (error) {
      this.fs = null;
      this.path = null;
      this.logDir = null;
      this.logFile = null;
    }
  }

  _resolveLogDirectory() {
    try {
      const cs = typeof CSInterface !== 'undefined' ? new CSInterface() : null;
      if (cs && typeof SystemPath !== 'undefined') {
        const userData = cs.getSystemPath(SystemPath.USER_DATA);
        if (userData) return this.path.join(decodeURIComponent(userData).replace(/^file:\/{2,3}/, ''), 'OpenGeo', 'logs');
      }
    } catch (ignoreCepPath) {}
    const appData = typeof process !== 'undefined' && process.env && process.env.APPDATA;
    return appData ? this.path.join(appData, 'OpenGeo', 'logs') : null;
  }

  _subscribe() {
    if (!this.eventBus) return;
    this._unsubscribers.push(this.eventBus.on('operation:progress', payload => this.record('operation:progress', payload)));
    this._unsubscribers.push(this.eventBus.on('operation:result', payload => this.record('operation:result', payload)));
    this._unsubscribers.push(this.eventBus.on('error:report', payload => this.record('error:report', payload)));
    this._unsubscribers.push(this.eventBus.on('sync:health', payload => this.record('sync:health', payload)));
    // T7: Pipeline phase events
    this._unsubscribers.push(this.eventBus.on('tile:pipeline:plan', payload => this.record('tile:pipeline:plan', payload)));
    this._unsubscribers.push(this.eventBus.on('tile:pipeline:download', payload => this.record('tile:pipeline:download', payload)));
    this._unsubscribers.push(this.eventBus.on('tile:pipeline:stitch', payload => this.record('tile:pipeline:stitch', payload)));
    this._unsubscribers.push(this.eventBus.on('tile:pipeline:prepare', payload => this.record('tile:pipeline:prepare', payload)));
    this._unsubscribers.push(this.eventBus.on('tile:pipeline:commit', payload => this.record('tile:pipeline:commit', payload)));
  }

  record(event, payload) {
    const now = Date.now();
    const safePayload = this._redact(payload, 0);
    const operationId = safePayload && safePayload.operationId;
    if (event === 'operation:progress' && operationId && safePayload.phase === 'started') this._startedAt.set(operationId, now);
    if (event === 'operation:result' && operationId) {
      const startedAt = this._startedAt.get(operationId);
      if (startedAt) safePayload.durationMs = Math.max(0, now - startedAt);
      this._startedAt.delete(operationId);
    }
    const entry = {
      timestamp: new Date(now).toISOString(),
      event,
      operationId: operationId || null,
      phase: safePayload && safePayload.phase || null,
      durationMs: safePayload && Number.isFinite(safePayload.durationMs) ? safePayload.durationMs : null,
      errorCode: safePayload && safePayload.errorCode || null,
      data: safePayload
    };
    if (this.consoleEnabled) console.log('[OpenGeo.Operation]', entry);
    if (!this.fs || !this.logFile) return Promise.resolve(false);
    const line = JSON.stringify(entry) + '\n';
    this._writeQueue = this._writeQueue.then(() => this._rotateIfNeeded(Buffer.byteLength(line))).then(() => this._append(line)).catch(error => {
      if (this.consoleEnabled) console.warn('[OpenGeo.OperationLogger] Write failed:', error);
      return false;
    });
    return this._writeQueue;
  }

  _rotateIfNeeded(incomingBytes) {
    return new Promise(resolve => {
      this.fs.stat(this.logFile, (error, stats) => {
        if (error || !stats || stats.size + incomingBytes <= this.maxBytes) { resolve(); return; }
        const rotated = this.path.join(this.logDir, `operations-${Date.now()}.jsonl`);
        this.fs.rename(this.logFile, rotated, () => {
          this.fs.readdir(this.logDir, (readError, files) => {
            if (readError) { resolve(); return; }
            const rotatedFiles = files.filter(name => /^operations-\d+\.jsonl$/.test(name)).sort().reverse();
            const stale = rotatedFiles.slice(Math.max(0, this.maxFiles - 1));
            if (!stale.length) { resolve(); return; }
            let remaining = stale.length;
            for (const name of stale) this.fs.unlink(this.path.join(this.logDir, name), () => { if (--remaining === 0) resolve(); });
          });
        });
      });
    });
  }

  _append(line) {
    return new Promise((resolve, reject) => this.fs.appendFile(this.logFile, line, 'utf8', error => error ? reject(error) : resolve(true)));
  }

  _redact(value, depth) {
    if (depth > 8) return '[DEPTH_LIMIT]';
    if (typeof value === 'string') {
      return value
        .replace(/([?&](?:api_?key|key|access_token|token|signature|sig)=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
        .replace(/\/Users\/[^\/]+/gi, '/Users/[REDACTED]')
        .replace(/\/home\/[^\/]+/gi, '/home/[REDACTED]')
        .replace(/[a-zA-Z]:\\(?:Users|Documents and Settings)\\[^\\]+/gi, m => m.replace(/\\[^\\]+$/, '\\[REDACTED]'))
        .replace(/[a-zA-Z]:\/(?:Users|Documents and Settings)\/[^\/]+/gi, m => m.replace(/\/[^\/]+$/, '/[REDACTED]'));
    }
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.slice(0, 100).map(item => this._redact(item, depth + 1));
    const result = {};
    for (const key of Object.keys(value)) {
      if (/(?:api.?keys?|keys?|tokens?|authorization|secret|password|signature)/i.test(key)) result[key] = '[REDACTED]';
      else if (key === 'stack') result[key] = String(value[key] || '').split('\n').slice(0, 8).join('\n');
      else if (/(?:path|filePath|url|href|src)/i.test(key) && typeof value[key] === 'string') {
        result[key] = this._redact(value[key], depth + 1);
      }
      else result[key] = this._redact(value[key], depth + 1);
    }
    return result;
  }

  getSupportFiles() {
    if (!this.fs || !this.logDir) return [];
    try {
      return this.fs.readdirSync(this.logDir)
        .filter(name => /^operations(?:-\d+)?\.jsonl$/.test(name))
        .map(name => this.path.join(this.logDir, name));
    } catch (error) { return []; }
  }


  getSummary(operationId) {
    if (!this.fs || !this.logFile) return null;
    try {
      const entries = [];
      const files = this.getSupportFiles();
      for (const file of files) {
        const content = this.fs.readFileSync(file, 'utf8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.operationId === operationId) entries.push(entry);
          } catch (_e) {}
        }
      }
      if (!entries.length) return null;
      const phases = {};
      const errors = [];
      let startedAt = null;
      let endedAt = null;
      for (const entry of entries) {
        if (entry.event === 'operation:progress' && entry.phase === 'started') {
          startedAt = entry.timestamp;
        }
        if (entry.event === 'operation:result') {
          endedAt = entry.timestamp;
        }
        if (entry.event.startsWith('tile:pipeline:')) {
          const phaseName = entry.event.replace('tile:pipeline:', '');
          phases[phaseName] = {
            timestamp: entry.timestamp,
            status: entry.phase,
            data: entry.data
          };
        }
        if (entry.event === 'error:report' || (entry.errorCode && entry.errorCode !== 'null')) {
          errors.push({
            timestamp: entry.timestamp,
            errorCode: entry.errorCode,
            message: entry.data && entry.data.message ? entry.data.message : null
          });
        }
      }
      return {
        operationId,
        startedAt,
        endedAt,
        durationMs: startedAt && endedAt ? new Date(endedAt) - new Date(startedAt) : null,
        phases,
        errors: errors.slice(-10),
        totalEntries: entries.length
      };
    } catch (error) {
      return null;
    }
  }

  getRecentErrors(limit = 20) {
    if (!this.fs || !this.logFile) return [];
    try {
      const errors = [];
      const files = this.getSupportFiles().slice().reverse();
      for (const file of files) {
        const content = this.fs.readFileSync(file, 'utf8');
        const lines = content.split('\n').reverse();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.event === 'error:report' || (entry.errorCode && entry.errorCode !== 'null')) {
              errors.push({
                timestamp: entry.timestamp,
                operationId: entry.operationId,
                errorCode: entry.errorCode,
                message: entry.data && entry.data.message ? entry.data.message : null
              });
              if (errors.length >= limit) break;
            }
          } catch (_e) {}
        }
        if (errors.length >= limit) break;
      }
      return errors.slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  dispose() {
    this._unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
    this._startedAt.clear();
    return this._writeQueue;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = OperationLogger;
else if (typeof window !== 'undefined') window.OperationLogger = OperationLogger;
