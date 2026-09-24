class TileDownloader {
  constructor(options = {}) {
    this.maxConcurrency = options.concurrency || 4;
    this.maxRetries = options.retries === undefined ? 2 : options.retries;
    this.timeout = options.timeout || 15000;

    this._queue = [];
    this._active = 0;
    this._pending = new Map();
    this._completedCount = 0;
    this._errors = new Map();
    this._retryTimers = new Map();
    this._settledErrors = new Map();
  }

  addTile(key, urls, priority) {
    if (this._pending.has(key)) return;

    const urlList = Array.isArray(urls) ? urls : [{ source: 'default', url: urls }];
    if (!urlList.length) return;

    const task = {
      key,
      urls: urlList,
      urlIndex: 0,
      priority: priority || 1,
      retries: this.maxRetries,
      active: false,
      cancelled: false,
      controller: null,
      state: 'queued',
      attempt: 0,
      lastError: null
    };

    this._pending.set(key, task);
    this._queue.push(task);
    this._queue.sort((a, b) => a.priority - b.priority);
    this._processNext();
  }

  cancelTile(key) {
    const task = this._pending.get(key);
    if (!task) return;

    task.cancelled = true;
    if (task.controller) task.controller.abort();
    this._clearRetryTimer(key);

    const idx = this._queue.indexOf(task);
    if (idx !== -1) this._queue.splice(idx, 1);

    if (!task.active) this._pending.delete(key);
  }

  cancelAll() {
    const tasks = Array.from(this._pending.values());
    for (const task of tasks) {
      this.cancelTile(task.key);
    }
    this._queue = [];
  }

  reset() {
    this.cancelAll();
    this._completedCount = 0;
    this._errors.clear();
    this._settledErrors.clear();
  }

  dispose() {
    this.cancelAll();
    this._retryTimers.forEach(handle => clearTimeout(handle));
    this._retryTimers.clear();
    this._settledErrors.clear();
    this._queue = [];
    this._pending = new Map();
    this._completedCount = 0;
    this._errors = new Map();
  }

  getStats() {
    return {
      active: this._active,
      queued: this._queue.length,
      loaded: this._completedCount,
      errors: this._errors.size,
      pending: this._pending.size,
      retryWait: Array.from(this._pending.values()).filter(t => t.state === 'retry-wait').length,
      errorFinal: Array.from(this._pending.values()).filter(t => t.state === 'error-final').length
    };
  }

  _processNext() {
    while (this._active < this.maxConcurrency && this._queue.length) {
      const task = this._queue.shift();
      if (!task || task.cancelled) continue;

      this._active++;
      task.active = true;
      task.state = 'loading';

      this._fetchWithFallback(task).finally(() => {
        this._active--;
        task.active = false;
        this._pending.delete(task.key);
        this._processNext();

        if (this._active === 0 && this._queue.length === 0 && typeof globalEventBus !== 'undefined') {
          const hasUnsettled = Array.from(this._pending.values()).some(t =>
            t.state === 'retry-wait' || t.state === 'error-final' || t.state === 'loading' || t.state === 'queued'
          );
          if (!hasUnsettled) {
            globalEventBus.emit('tiles:allLoaded');
          }
        }
      });
    }

    if (this._active === 0 && this._queue.length === 0 && typeof globalEventBus !== 'undefined') {
      const hasUnsettled = Array.from(this._pending.values()).some(t =>
        t.state === 'retry-wait' || t.state === 'error-final' || t.state === 'loading' || t.state === 'queued'
      );
      if (!hasUnsettled) {
        globalEventBus.emit('tiles:allLoaded');
      }
    }
  }

  async _fetchWithFallback(task) {
    let lastError = null;

    for (let attempt = 0; attempt <= task.retries && !task.cancelled; attempt++) {
      const urlEntry = task.urls[task.urlIndex % task.urls.length];
      task.urlIndex++;
      task.attempt = attempt + 1;

      try {
        const bitmap = await this._fetch(urlEntry.url, task);
        if (task.cancelled) return;

        this._completedCount++;
        this._errors.delete(task.key);
        this._settledErrors.delete(task.key);
        task.state = 'loaded';

        if (typeof globalEventBus !== 'undefined') {
          globalEventBus.emit('tiles:loaded', { key: task.key, bitmap });
        }
        return;
      } catch (error) {
        if (task.cancelled || (error && error.name === 'AbortError')) return;
        lastError = error;
        if (attempt < task.retries) {
          task.state = 'retry-wait';
          const delay = this._getBackoffDelay(attempt);
          await this._delayWithTimer(task.key, delay);
          if (task.cancelled) return;
          task.state = 'loading';
        }
      }
    }

    if (!task.cancelled) {
      this._errors.set(task.key, lastError || new Error('Tile request failed'));
      this._settledErrors.set(task.key, lastError || new Error('Tile request failed'));
      task.state = 'error-final';
      task.lastError = lastError || new Error('Tile request failed');
      if (typeof globalEventBus !== 'undefined') {
        globalEventBus.emit('tiles:error', { key: task.key, error: task.lastError });
      }
    }
  }

  _fetch(url, task) {
    return new Promise((resolve, reject) => {
      if (!url) { reject(new Error('No URL provided')); return; }
      const transport = TileTransport.request(url, { responseType: 'blob', timeoutMs: this.timeout, minBytes: 128, maxBytes: 16 * 1024 * 1024 });
      task.controller = { abort: transport.abort };
      transport.promise.then((blob) => {
          const objectUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Image decode error'));
          };
          img.src = objectUrl;
      }).catch(reject);
    });
  }

  _getBackoffDelay(attempt) {
    const base = [300, 900, 2200][attempt] || 2200;
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.max(50, base + jitter);
  }

  _delayWithTimer(key, ms) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this._clearRetryTimer(key);
        resolve();
      };
      if (typeof setTimeout !== 'undefined') {
        const handle = setTimeout(done, ms);
        this._retryTimers.set(key, handle);
      }
      Promise.resolve(this._delay(ms)).then(done).catch(done);
    });
  }

  _clearRetryTimer(key) {
    const handle = this._retryTimers.get(key);
    if (handle) {
      if (typeof clearTimeout !== 'undefined') {
        try { clearTimeout(handle); } catch (_) { /* timer clear fallback */ }
      }
      this._retryTimers.delete(key);
    }
  }

  _delay(ms) {
    if (typeof setTimeout === 'undefined') return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}