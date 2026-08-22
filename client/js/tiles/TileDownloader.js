class TileDownloader {
  constructor(options = {}) {
    this.maxConcurrency = options.concurrency || 4;
    this.maxRetries = options.retries === undefined ? 1 : options.retries;
    this.timeout = options.timeout || 15000;
    
    this._queue = [];
    this._active = 0;
    this._pending = new Map();
    this._completedCount = 0;
    this._errors = new Map();
  }

  addTile(key, urls, priority) {
    // The bitmap cache is the source of truth for completed tiles. Keeping a
    // permanent loaded-key set here prevented a tile from being downloaded
    // again after LRU eviction.
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
      controller: null 
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
  }

  getStats() {
    return { 
      active: this._active, 
      queued: this._queue.length, 
      loaded: this._completedCount,
      errors: this._errors.size, 
      pending: this._pending.size 
    };
  }

  _processNext() {
    while (this._active < this.maxConcurrency && this._queue.length) {
      const task = this._queue.shift();
      if (!task || task.cancelled) continue;
      
      this._active++;
      task.active = true;
      
      this._fetchWithFallback(task).finally(() => {
        this._active--;
        task.active = false;
        this._pending.delete(task.key);
        this._processNext();
        
        if (this._active === 0 && this._queue.length === 0 && typeof globalEventBus !== 'undefined') {
          globalEventBus.emit('tiles:allLoaded');
        }
      });
    }
    
    if (this._active === 0 && this._queue.length === 0 && typeof globalEventBus !== 'undefined') {
      globalEventBus.emit('tiles:allLoaded');
    }
  }

  async _fetchWithFallback(task) {
    let lastError = null;
    
    for (let attempt = 0; attempt <= task.retries && !task.cancelled; attempt++) {
      const urlEntry = task.urls[task.urlIndex % task.urls.length];
      task.urlIndex++;
      
      try {
        const bitmap = await this._fetch(urlEntry.url, task);
        if (task.cancelled) return;
        
        this._completedCount++;
        this._errors.delete(task.key);
        
        if (typeof globalEventBus !== 'undefined') {
          globalEventBus.emit('tiles:loaded', { key: task.key, bitmap });
        }
        return;
      } catch (error) {
        if (task.cancelled || (error && error.name === 'AbortError')) return;
        lastError = error;
        if (attempt < task.retries) await this._delay(250);
      }
    }
    
    if (!task.cancelled) {
      this._errors.set(task.key, lastError || new Error('Tile request failed'));
      if (typeof globalEventBus !== 'undefined') {
        globalEventBus.emit('tiles:error', { key: task.key, error: lastError || new Error('Tile request failed') });
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

  _delay(ms) { 
    return new Promise(resolve => setTimeout(resolve, ms)); 
  }
}
