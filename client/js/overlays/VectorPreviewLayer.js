/**
 * Offline vector preview with progressive detail.
 *
 * 50m is loaded asynchronously as the overview. At zoom >= 4.2 the layer
 * reads a small spatial index and only the visible 10m chunks. The monolithic
 * 10m source is never read by the runtime render path.
 */
class VectorPreviewLayer {
  constructor(viewport, repository, options) {
    this.viewport = viewport;
    this.repository = repository;
    this.dataset = null;
    this.datasets = {};
    this.features = [];
    this.mapSize = 262144;
    this._bounds = new Map();
    this._loadError = null;
    this._requestedDetail = '50m';
    this._index10m = null;
    this._pendingLoads = new Map();
    this._chunkLoadQueue = [];
    this._queuedChunkIds = new Set();
    this._activeChunkLoads = 0;
    this._chunkLoadConcurrency = 2;
    this._chunks = new Map();
    this._loadedChunkPoints = 0;
    this._chunkPointBudget = 400000;
    this._renderTick = 0;
    this._unload10mTimer = null;
    this._disposed = false;
    this.options = this._normalizeOptions(options);
  }

  _normalizeOptions(options) {
    const input = options || {};
    return {
      land: input.land !== false,
      borders: input.borders !== false,
      coastlines: input.coastlines !== false,
      labels: input.labels !== false
    };
  }

  setOptions(options) {
    this.options = this._normalizeOptions(options);
  }

  load(detail) {
    if (!this.repository) return false;
    const requestedDetail = detail === '10m' ? '10m' : '50m';
    this._requestedDetail = requestedDetail;
    this._requestOverview();
    if (requestedDetail === '10m') {
      if (this._unload10mTimer) clearTimeout(this._unload10mTimer);
      this._unload10mTimer = null;
      this._request10mIndex();
    } else {
      this._schedule10mUnload();
    }
    // Loading is progressive. Returning true means the bundled package is
    // available to load, not that every chunk is already in memory.
    return !!(this.repository.dataDir && this.repository.loadDatasetAsync);
  }

  _requestOverview() {
    const filename = 'world_vector_layers_50m.json';
    if (this.datasets['50m'] || this._pendingLoads.has(filename)) return;
    const request = this.repository.loadDatasetAsync(filename, { maxBytes: 5 * 1024 * 1024 }).then(dataset => {
      if (!dataset) {
        this._loadError = 'Offline 50m vector overview is unavailable.';
        return;
      }
      this.datasets['50m'] = dataset;
      this.dataset = dataset;
      this.mapSize = Number(dataset.mapSize) || this.mapSize;
      this.features = this.repository.getDatasetLayer(dataset, 'land');
      this._emitRenderInvalidation();
    });
    this._trackLoad(filename, request);
  }

  _request10mIndex() {
    const filename = 'vector-preview/10m/index.json';
    if (this._index10m || this._pendingLoads.has(filename)) return;
    const request = this.repository.loadDatasetAsync(filename, { maxBytes: 1024 * 1024 }).then(index => {
      if (!index || !index.layers || !Array.isArray(index.layers.land)) {
        this._loadError = 'Offline 10m vector index is unavailable.';
        return;
      }
      this._index10m = index;
      this.mapSize = Number(index.mapSize) || this.mapSize;
      this._emitRenderInvalidation();
    });
    this._trackLoad(filename, request);
  }

  _trackLoad(key, promise) {
    this._pendingLoads.set(key, promise);
    promise.then(() => this._pendingLoads.delete(key), () => this._pendingLoads.delete(key));
  }

  render(ctx) {
    const viewport = this.viewport;
    if (!ctx || !viewport) return;
    const detail = viewport.zoom >= 4.2 ? '10m' : '50m';
    this.load(detail);
    this._renderTick++;

    const scale = MercatorProjection.getWorldSize(viewport.zoom, viewport.tileSize) / this.mapSize;
    const center = MercatorProjection.latLngToWorldPoint(viewport.centerLat, viewport.centerLng, viewport.zoom, viewport.tileSize);
    const centerX = center.x / scale;
    const centerY = center.y / scale;
    const viewWindow = this._createViewWindow(centerX, centerY, scale, viewport);
    const simplifyStep = detail === '10m'
      ? (viewport.zoom < 5 ? 5 : viewport.zoom < 6.5 ? 2 : 1)
      : (viewport.zoom < 3 ? 7 : viewport.zoom < 4.2 ? 3 : 1);
    const labels = [];

    // Build one protection set for the complete frame. Evicting per semantic
    // layer allowed land, borders and coastline chunks to evict one another.
    const protectedChunkIds = this._getVisibleChunkIds(detail, viewWindow);
    this._pruneChunkQueue(protectedChunkIds);
    const landFeatures = this._getRenderableFeatures(detail, 'land', viewWindow);
    const borderFeatures = this._getRenderableFeatures(detail, 'borders', viewWindow);
    const coastlineFeatures = this._getRenderableFeatures(detail, 'coastlines', viewWindow);
    this._evictChunks(protectedChunkIds);

    ctx.save();
    ctx.fillStyle = '#102033';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (this.options.land) this._drawLayer(ctx, landFeatures, centerX, centerY, scale, simplifyStep, { fill: '#1c3850' }, viewWindow);
    if (this.options.borders) this._drawLayer(ctx, borderFeatures, centerX, centerY, scale, simplifyStep, { stroke: '#a5c1d0', width: 0.8 }, viewWindow);
    if (this.options.coastlines) this._drawLayer(ctx, coastlineFeatures, centerX, centerY, scale, simplifyStep, { stroke: 'rgba(128, 169, 188, 0.72)', width: 0.7 }, viewWindow);

    if (this.options.labels) for (let featureIndex = 0; featureIndex < landFeatures.length; featureIndex++) {
      const feature = landFeatures[featureIndex];
      const bounds = this._getBounds(feature);
      if (!this._isVisible(bounds, viewWindow)) continue;
      if (viewport.zoom >= 3.6 && labels.length < 22) {
        const label = this._getLabel(feature, bounds, centerX, centerY, scale, viewport);
        if (label) labels.push(label);
      }
    }

    this._drawLabels(ctx, labels);
    ctx.restore();
  }

  _getRenderableFeatures(detail, layerName, viewWindow) {
    const overview = this.datasets['50m'];
    if (detail !== '10m' || !this._index10m) {
      return overview ? this.repository.getDatasetLayer(overview, layerName) : [];
    }

    const entries = this._index10m.layers[layerName] || [];
    const features = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (!this._isVisible(entry.bbox, viewWindow)) continue;
      const chunk = this._chunks.get(entry.id);
      if (chunk) {
        chunk.lastUsed = this._renderTick;
        for (let featureIndex = 0; featureIndex < chunk.features.length; featureIndex++) features.push(chunk.features[featureIndex]);
      } else {
        this._requestChunk(entry);
      }
    }
    // Never blank the map while visible 10m chunks are still arriving.
    return features.length ? features : (overview ? this.repository.getDatasetLayer(overview, layerName) : []);
  }

  _getVisibleChunkIds(detail, viewWindow) {
    const visible = new Set();
    if (detail !== '10m' || !this._index10m) return visible;
    const layerNames = ['land', 'borders', 'coastlines'];
    for (let layerIndex = 0; layerIndex < layerNames.length; layerIndex++) {
      const entries = this._index10m.layers[layerNames[layerIndex]] || [];
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        if (this._isVisible(entries[entryIndex].bbox, viewWindow)) visible.add(entries[entryIndex].id);
      }
    }
    return visible;
  }

  _pruneChunkQueue(visibleIds) {
    if (!this._chunkLoadQueue.length) return;
    const retained = [];
    for (let index = 0; index < this._chunkLoadQueue.length; index++) {
      const entry = this._chunkLoadQueue[index];
      if (visibleIds.has(entry.id)) retained.push(entry);
      else this._queuedChunkIds.delete(entry.id);
    }
    this._chunkLoadQueue = retained;
  }

  _requestChunk(entry) {
    if (!entry || this._disposed || this._chunks.has(entry.id) || this._pendingLoads.has(entry.id) || this._queuedChunkIds.has(entry.id)) return;
    this._queuedChunkIds.add(entry.id);
    this._chunkLoadQueue.push(entry);
    this._drainChunkQueue();
  }

  _drainChunkQueue() {
    while (!this._disposed && this._activeChunkLoads < this._chunkLoadConcurrency && this._chunkLoadQueue.length) {
      const entry = this._chunkLoadQueue.shift();
      this._activeChunkLoads++;
      this._loadChunk(entry);
    }
  }

  _loadChunk(entry) {
    const maxBytes = Math.max(2 * 1024 * 1024, Number(entry.bytes) + 1024);
    const request = this.repository.loadDatasetAsync(entry.file, { maxBytes }).then(chunk => {
      if (this._disposed) return;
      if (!chunk || chunk.layer !== entry.id.split('-')[0] || !Array.isArray(chunk.features)) return;
      this._chunks.set(entry.id, {
        file: entry.file,
        features: chunk.features,
        points: Number(entry.pointCount) || 0,
        sourceBytes: Number(entry.bytes) || 0,
        lastUsed: this._renderTick
      });
      this._loadedChunkPoints += Number(entry.pointCount) || 0;
      this._emitRenderInvalidation();
    });
    this._trackLoad(entry.id, request);
    request.then(() => this._completeChunkLoad(entry.id), () => this._completeChunkLoad(entry.id));
  }

  _completeChunkLoad(id) {
    this._queuedChunkIds.delete(id);
    this._activeChunkLoads = Math.max(0, this._activeChunkLoads - 1);
    // Yield between JSON parses so a group of visible chunks cannot occupy a
    // single continuous CEP UI task.
    setTimeout(() => this._drainChunkQueue(), 0);
  }

  _schedule10mUnload() {
    if (this._unload10mTimer || this._chunks.size === 0) return;
    this._unload10mTimer = setTimeout(() => {
      this._unload10mTimer = null;
      if (this._requestedDetail === '10m') return;
      for (const chunk of this._chunks.values()) this.repository.unloadDataset(chunk.file);
      this._chunks.clear();
      this._loadedChunkPoints = 0;
      this._bounds.clear();
    }, 15000);
  }

  _evictChunks(protectedIds) {
    if (this._loadedChunkPoints <= this._chunkPointBudget) return;
    const candidates = Array.from(this._chunks.entries())
      .filter(entry => !protectedIds.has(entry[0]))
      .sort((first, second) => first[1].lastUsed - second[1].lastUsed);
    for (let index = 0; index < candidates.length && this._loadedChunkPoints > this._chunkPointBudget; index++) {
      const id = candidates[index][0];
      const chunk = candidates[index][1];
      this.repository.unloadDataset(chunk.file);
      this._chunks.delete(id);
      this._loadedChunkPoints -= chunk.points;
    }
  }

  _createViewWindow(centerX, centerY, scale, viewport) {
    return {
      minX: centerX - viewport.width / (2 * scale),
      maxX: centerX + viewport.width / (2 * scale),
      minY: centerY - viewport.height / (2 * scale),
      maxY: centerY + viewport.height / (2 * scale)
    };
  }

  _isVisible(bounds, viewWindow) {
    if (!bounds || !viewWindow) return false;
    const minX = Array.isArray(bounds) ? Number(bounds[0]) : Number(bounds.minX);
    const minY = Array.isArray(bounds) ? Number(bounds[1]) : Number(bounds.minY);
    const maxX = Array.isArray(bounds) ? Number(bounds[2]) : Number(bounds.maxX);
    const maxY = Array.isArray(bounds) ? Number(bounds[3]) : Number(bounds.maxY);
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return false;
    if (maxY < viewWindow.minY || minY > viewWindow.maxY) return false;
    for (let wrap = -1; wrap <= 1; wrap++) {
      const shift = wrap * this.mapSize;
      if (maxX + shift >= viewWindow.minX && minX + shift <= viewWindow.maxX) return true;
    }
    return false;
  }

  _drawLayer(ctx, features, centerX, centerY, scale, step, style, viewWindow) {
    if (!Array.isArray(features)) return;
    for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
      const feature = features[featureIndex];
      if (!this._isVisible(this._getBounds(feature), viewWindow)) continue;
      this._drawFeature(ctx, feature, centerX, centerY, scale, step, style);
    }
  }

  _drawFeature(ctx, feature, centerX, centerY, scale, step, style) {
    ctx.beginPath();
    let hasPath = false;
    for (let ringIndex = 0; ringIndex < feature.rings.length; ringIndex++) {
      const ring = feature.rings[ringIndex];
      if (!ring || ring.length < 2) continue;
      let started = false;
      for (let pointIndex = 0; pointIndex < ring.length; pointIndex += step) {
        const point = ring[pointIndex];
        if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
        const screen = this._toScreen(point[0], point[1], centerX, centerY, scale);
        if (!started) {
          ctx.moveTo(screen.x, screen.y);
          started = true;
        } else {
          ctx.lineTo(screen.x, screen.y);
        }
        hasPath = true;
      }
      const last = ring[ring.length - 1];
      if (started && last && Number.isFinite(last[0]) && Number.isFinite(last[1])) {
        const screen = this._toScreen(last[0], last[1], centerX, centerY, scale);
        ctx.lineTo(screen.x, screen.y);
      }
      if (started && feature.isClosed !== false) ctx.closePath();
    }
    if (!hasPath) return;
    if (style.fill && feature.isClosed !== false) {
      ctx.fillStyle = style.fill;
      ctx.fill('evenodd');
    }
    if (style.stroke) {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.width || 0.7;
      ctx.stroke();
    }
  }

  _drawLabels(ctx, labels) {
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let index = 0; index < labels.length; index++) {
      const label = labels[index];
      ctx.fillStyle = 'rgba(7, 17, 28, 0.7)';
      ctx.fillText(label.name, label.x + 1, label.y + 1);
      ctx.fillStyle = '#d7e8f2';
      ctx.fillText(label.name, label.x, label.y);
    }
  }

  _getLabel(feature, bounds, centerX, centerY, scale, viewport) {
    const name = feature.name || feature.nameLong || feature.iso3;
    if (!name || !bounds) return null;
    const width = (bounds.maxX - bounds.minX) * scale;
    const height = (bounds.maxY - bounds.minY) * scale;
    if (width < 45 || height < 18) return null;
    const labelPoint = Array.isArray(feature.label) ? feature.label : [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
    const position = this._toScreen(labelPoint[0], labelPoint[1], centerX, centerY, scale);
    if (position.x < 20 || position.x > viewport.width - 20 || position.y < 14 || position.y > viewport.height - 14) return null;
    return { name, x: position.x, y: position.y };
  }

  _getBounds(feature) {
    if (!feature) return null;
    if (this._bounds.has(feature)) return this._bounds.get(feature);
    const raw = Array.isArray(feature.bbox) && feature.bbox.length >= 4
      ? { minX: Number(feature.bbox[0]), minY: Number(feature.bbox[1]), maxX: Number(feature.bbox[2]), maxY: Number(feature.bbox[3]) }
      : this.repository.computeMercatorRingsBBox(feature.rings || []);
    this._bounds.set(feature, raw);
    return raw;
  }

  _toScreen(worldX, worldY, centerX, centerY, scale) {
    let deltaX = worldX - centerX;
    if (deltaX > this.mapSize / 2) deltaX -= this.mapSize;
    if (deltaX < -this.mapSize / 2) deltaX += this.mapSize;
    return { x: deltaX * scale + this.viewport.width / 2, y: (worldY - centerY) * scale + this.viewport.height / 2 };
  }

  _emitRenderInvalidation() {
    if (typeof globalEventBus !== 'undefined') globalEventBus.emit('overlay:changed');
  }

  getMetrics() {
    const repository = this.repository && this.repository.getCacheStats ? this.repository.getCacheStats() : {};
    return {
      requestedDetail: this._requestedDetail,
      indexed10m: !!this._index10m,
      loadedChunks: this._chunks.size,
      loadedChunkPoints: this._loadedChunkPoints,
      chunkPointBudget: this._chunkPointBudget,
      pendingLoads: this._pendingLoads.size,
      queuedChunks: this._chunkLoadQueue.length,
      activeChunkLoads: this._activeChunkLoads,
      repository
    };
  }

  dispose() {
    this._disposed = true;
    if (this._unload10mTimer) clearTimeout(this._unload10mTimer);
    this._unload10mTimer = null;
    for (const chunk of this._chunks.values()) this.repository.unloadDataset(chunk.file);
    this._chunks.clear();
    this._chunkLoadQueue.length = 0;
    this._queuedChunkIds.clear();
    this._loadedChunkPoints = 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VectorPreviewLayer;
} else if (typeof window !== 'undefined') {
  window.VectorPreviewLayer = VectorPreviewLayer;
}
