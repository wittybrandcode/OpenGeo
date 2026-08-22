class TileManager {
  constructor(options = {}) {
    this.source = options.source || 'osm';
    this.sourceSignature = options.sourceSignature || this.source;
    this.cache = new MemoryCache({ memoryLimit: options.cacheMemoryLimit });
    this.downloader = new TileDownloader({
      concurrency: options.downloadConcurrency,
      retries: options.downloadRetries,
      timeout: options.downloadTimeout
    });
    
    this._activeTiles = new Map();
    this._loadedCount = 0;
    this._totalNeeded = 0;
    
    if (typeof globalEventBus !== 'undefined') {
      this._unsubscribeLoaded = globalEventBus.on('tiles:loaded', (data) => {
        this.cache.set(data.key, data.bitmap);
        this._onTileReceived(data.key);
      });
      
      this._unsubscribeError = globalEventBus.on('tiles:error', (data) => {
        let changed = false;
        for (const entry of this._activeTiles.values()) {
          if (entry.cacheKey !== data.key) continue;
          entry.loading = false;
          entry.error = data.error;
          // On error, try to find a parent tile as placeholder
          this._assignParentFallback(entry);
          changed = true;
        }
        if (changed) globalEventBus.emit('overlay:changed');
      });
    }
  }

  setSource(source, sourceSignature) {
    this.source = source;
    this.sourceSignature = sourceSignature || source;
    this.downloader.reset();
    this.cache.clear();
    this._activeTiles.clear();
  }

  clearCache() {
    this.cache.clear();
  }

  update(viewport, tileUrlsProvider) {
    const visible = TileGrid.getVisibleTiles(viewport);
    const newKeys = new Set();
    
    this._totalNeeded = visible.length;
    this._loadedCount = 0;
    
    for (let i = 0; i < visible.length; i++) {
      const t = visible[i];
      // cacheKey identifies the remote tile. renderKey identifies a physical
      // screen slot. At low zoom the same wrapped world tile appears more
      // than once at the left/right edges; collapsing those slots created the
      // black side bands visible on first open.
      const cacheKey = MemoryCache.computeKey(t.x, t.y, t.z, this.sourceSignature);
      const renderKey = this._getRenderKey(t);
      newKeys.add(renderKey);
      
      if (this._activeTiles.has(renderKey)) {
        const existing = this._activeTiles.get(renderKey);
        existing.screenX = t.screenX;
        existing.screenY = t.screenY;
        existing.drawSize = t.drawSize;
        if (existing.loaded) this._loadedCount++;
        continue;
      }
      
      const entry = {
        key: renderKey, cacheKey, x: t.x, y: t.y, z: t.z,
        screenX: t.screenX, screenY: t.screenY, drawSize: t.drawSize,
        loaded: false, bitmap: null, loading: false, error: null,
        // Parent fallback fields
        parentBitmap: null, parentCropX: 0, parentCropY: 0, parentCropSize: 0
      };
      
      this._activeTiles.set(renderKey, entry);
      
      // Check full-res cache first
      const cached = this.cache.get(cacheKey);
      if (cached) {
        entry.loaded = true;
        entry.bitmap = cached;
        this._loadedCount++;
        continue;
      }
      
      // While loading, try to find a parent tile as temporary placeholder
      this._assignParentFallback(entry);
      
      // Queue the actual tile download
      entry.loading = true;
      const urls = tileUrlsProvider(this.source, t.x, t.y, t.z);
      if (urls && urls.length > 0) {
        const priority = t.distance < 3 ? 0 : (t.distance < 6 ? 1 : 2);
        this.downloader.addTile(cacheKey, urls, priority);
      }
    }
    
    // Cleanup old tiles
    for (const [renderKey, entry] of this._activeTiles) {
      if (!newKeys.has(renderKey)) {
        this._activeTiles.delete(renderKey);
        if (!this._hasActiveCacheKey(entry.cacheKey)) this.downloader.cancelTile(entry.cacheKey);
      }
    }
    
    if (typeof globalEventBus !== 'undefined') {
      globalEventBus.emit('tiles:renderReady', this.getTilesForRender());
    }
  }

  _getRenderKey(tile) {
    return CachePolicy.renderKey(this.sourceSignature, tile);
  }

  _hasActiveCacheKey(cacheKey) {
    for (const entry of this._activeTiles.values()) {
      if (entry.cacheKey === cacheKey) return true;
    }
    return false;
  }

  /**
   * Search up to 3 zoom levels for a cached parent tile.
   * When found, calculate the sub-quadrant crop so MapRenderer
   * can draw the correct scaled segment as a placeholder.
   */
  _assignParentFallback(entry) {
    for (let dz = 1; dz <= 3; dz++) {
      const pz = entry.z - dz;
      if (pz < 0) break;
      
      const scale = Math.pow(2, dz);
      const px = Math.floor(entry.x / scale);
      const py = Math.floor(entry.y / scale);
      const parentKey = MemoryCache.computeKey(px, py, pz, this.sourceSignature);
      const parentBitmap = this.cache.get(parentKey);
      
      if (parentBitmap) {
        // Which sub-quadrant of the parent tile contains this child?
        const subX = entry.x % scale;
        const subY = entry.y % scale;
        
        // Calculate crop region within the parent bitmap
        let parentPixelSize;
        if (parentBitmap.width) {
          parentPixelSize = parentBitmap.width;
        } else if (parentBitmap.naturalWidth) {
          parentPixelSize = parentBitmap.naturalWidth;
        } else {
          parentPixelSize = 256;
        }
        
        const segmentSize = parentPixelSize / scale;
        
        entry.parentBitmap = parentBitmap;
        entry.parentCropX = subX * segmentSize;
        entry.parentCropY = subY * segmentSize;
        entry.parentCropSize = segmentSize;
        return;
      }
    }
    // No parent found — tile will show shimmer animation
    entry.parentBitmap = null;
  }

  _onTileReceived(cacheKey) {
    const bitmap = this.cache.get(cacheKey);
    if (!bitmap) return;
    let updated = 0;
    for (const entry of this._activeTiles.values()) {
      if (entry.cacheKey !== cacheKey) continue;
      entry.loaded = true;
      entry.bitmap = bitmap;
      entry.loading = false;
      entry.parentBitmap = null; // Clear fallback now that real tile arrived
      updated++;
    }
    if (updated) {
      this._loadedCount += updated;
      if (typeof globalEventBus !== 'undefined') globalEventBus.emit('tiles:renderReady', this.getTilesForRender());
    }
  }

  getTilesForRender() {
    return Array.from(this._activeTiles.values());
  }

  getStats() {
    return {
      cache: this.cache.getStats(),
      download: this.downloader.getStats(),
      visibleTiles: this._activeTiles.size,
      loadedTiles: this._loadedCount
    };
  }

  dispose() {
    if (this._unsubscribeLoaded) this._unsubscribeLoaded();
    if (this._unsubscribeError) this._unsubscribeError();
    this._unsubscribeLoaded = null;
    this._unsubscribeError = null;
    const activeCacheKeys = new Set(Array.from(this._activeTiles.values()).map(entry => entry.cacheKey));
    for (const cacheKey of activeCacheKeys) this.downloader.cancelTile(cacheKey);
    this._activeTiles.clear();
    this.cache.clear();
  }
}
