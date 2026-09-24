/** Coordinates composition feature metadata, preview state and AE host state. */
class FeatureManager {
  constructor(appOrDeps, registry) {
    const isDeps = appOrDeps && (appOrDeps.registry || appOrDeps.jobManager || appOrDeps.session);
    this.app = isDeps && appOrDeps.app ? appOrDeps.app : (appOrDeps || {});
    this.registry = registry || (isDeps && appOrDeps.registry) || (this.app && this.app.featureRegistry) || null;
    this.jobManager = (isDeps && appOrDeps.jobManager) || (this.app && this.app.jobManager) || null;
    this.aeBridge = (isDeps && appOrDeps.aeBridge) || (this.app && this.app.aeBridge) || null;
    this.session = (isDeps && appOrDeps.session) || (this.app && this.app.session) || null;
    this.fs = require('fs');
    this.path = require('path');
    const tempRoot = this.jobManager && this.jobManager.tempDir ? this.path.dirname(this.jobManager.tempDir) : null;
    this.storageDir = tempRoot ? this.path.join(tempRoot, 'features') : null;
    try {
      if (this.storageDir && !this.fs.existsSync(this.storageDir)) this.fs.mkdirSync(this.storageDir, { recursive: true });
    } catch (error) {
      console.warn('[FeatureManager] Managed preview storage is unavailable:', error.message);
      this.storageDir = null;
    }
    this._featureOperations = new Map();
    this._hydrateRevision = 0;
    this._disposed = false;
    this._unsubscribe = this.registry && typeof this.registry.onChange === 'function'
      ? this.registry.onChange(() => {
          if (this.app && typeof this.app._schedulePreviewRender === 'function') {
            this.app._schedulePreviewRender();
          }
        })
      : null;
  }

  async registerImported(payload, type, hostResult) {
    this._validatePreviewPayload(payload);
    const id = payload.featureId || payload.featureSignature;
    let sourcePath = null;
    if (type === 'geojson') sourcePath = await this._persistPayload(id, payload);
    const descriptor = {
      id, type, name: payload.displayName || payload.layerName || id,
      sourceId: payload.sourceId || payload.sourceName || '',
      featureSignature: payload.featureSignature || id,
      layerName: payload.layerName || id,
      visible: true, hostPresent: true, previewPayload: payload,
      sourcePath, bounds: this._boundsFromPayload(payload),
      anchor: payload.anchor && Number.isFinite(payload.anchor.lat) ? payload.anchor : this._anchorFromPayload(payload),
      ae: hostResult || null
    };
    this.registry.upsert(descriptor);
    this.app._scheduleMetadataSave();
    return descriptor;
  }

  async registerPreview(payload, type) {
    this._assertFeatureMutationAllowed();
    this._validatePreviewPayload(payload);
    const id = payload.featureId || payload.featureSignature;
    const existing = this.registry.get(id);
    let sourcePath = existing && existing.sourcePath || null;
    if (type === 'geojson') sourcePath = await this._persistPayload(id, payload);
    const descriptor = {
      id, type, name: payload.displayName || payload.layerName || id,
      sourceId: payload.sourceId || payload.sourceName || '',
      featureSignature: payload.featureSignature || id,
      layerName: payload.layerName || id,
      visible: true, hostPresent: false, previewPayload: payload,
      sourcePath, bounds: this._boundsFromPayload(payload),
      anchor: payload.anchor && Number.isFinite(payload.anchor.lat) ? payload.anchor : this._anchorFromPayload(payload),
      ae: null
    };
    this.registry.upsert(descriptor);
    return descriptor;
  }

  async importPreviewToAE(id) {
    return this._queueFeatureOperation(id, async () => {
      this._assertFeatureMutationAllowed();
      const compId = this.app.compositionController
        ? await this.app.compositionController.resolveActiveMapTarget()
        : this.app.activeCompId;
      if (!compId) throw new Error('Create or open an OpenGeo composition first.');
      const item = this.registry.get(id);
      if (!item) throw new Error('The selected preview map no longer exists.');
      let payload = item.previewPayload;
      if (!payload && item.sourcePath) payload = await this._readManagedPayload(item.sourcePath, item.id);
      if (!payload) throw new Error('Preview geometry is unavailable and cannot be drawn in AE.');
      const result = await this._drawPayloadInCurrentComp(payload, item.type, compId);
      if (!result.registryDeferred) {
        globalEventBus.emit('toast:show', { message: `${item.name} was drawn in After Effects.`, type: 'success' });
      }
      return result;
    });
  }

  /**
   * Single transaction boundary for every vector entry point. The target
   * composition is captured once; a late host response can never register its
   * feature in a composition that became active while AE was drawing.
   */
  async drawPayloadInAE(payload, type) {
    this._validatePreviewPayload(payload);
    const id = String(payload.featureId || payload.featureSignature);
    return this._queueFeatureOperation(id, async () => {
      this._assertFeatureMutationAllowed();
      const compId = this.app.activeCompId;
      if (!compId) throw new Error('Create or open an OpenGeo composition first.');
      return this._drawPayloadInCurrentComp(payload, type, compId);
    });
  }

  async _drawPayloadInCurrentComp(payload, type, compId) {
    this._validatePreviewPayload(payload);
    if (this.app.activeCompId !== compId) throw new Error('The active composition changed before vector import.');
    // Persist uploaded geometry before handing work to AE. If the user changes
    // compositions during the host call, reconciliation can still recover the
    // original composition's GeoJSON descriptor from managed storage.
    if (type === 'geojson') await this._persistPayload(payload.featureId || payload.featureSignature, payload);
    const jobId = this.app.jobManager && this.app.jobManager.startJob('feature_vector_import');
    if (!jobId) throw new Error('Could not start the vector import job.');
    try {
      const tempFile = this.app.jobManager.createTempFile(jobId, '.json');
      await this.fs.promises.writeFile(tempFile, JSON.stringify(payload), 'utf8');
      const result = await this.app.aeBridge.invoke('vector.import', {
        compId, filePath: tempFile, layerName: payload.layerName,
        featureSignature: payload.featureSignature
      }, { timeoutMs: 120000 });
      if (this.app.activeCompId !== compId) {
        return Object.assign({}, result || {}, { registryDeferred: true, compId });
      }
      await this.registerImported(payload, type, result);
      return Object.assign({}, result || {}, { registryDeferred: false, compId });
    } finally {
      this.app.jobManager.finishJob(jobId);
    }
  }

  async hydrate(items) {
    const revision = ++this._hydrateRevision;
    const compId = this.app.activeCompId || null;
    this.registry.replaceAll(items || []);
    const current = this.registry.list();
    const previews = {};
    for (let index = 0; index < current.length; index++) {
      const item = current[index];
      let payload = null;
      if (item.type === 'country' && this.app.geoDataRepository) {
        const resolved = this.app.geoDataRepository.getCountryOutline(item.sourceId);
        if (resolved && resolved.features && resolved.features.length) payload = this._buildCountryPayload(item, resolved);
      } else if (item.type === 'geojson' && item.sourcePath) {
        try { payload = await this._readManagedPayload(item.sourcePath, item.id); }
        catch (error) { console.warn('[FeatureManager] Preview payload rejected:', error.message); payload = null; }
      }
      if (revision !== this._hydrateRevision || this.app.activeCompId !== compId) return false;
      previews[item.id] = payload;
    }
    for (let index = 0; index < current.length; index++) this.registry.attachPreview(current[index].id, previews[current[index].id], { silent: true });
    await this.reconcileHost({ compId, hydrateRevision: revision });
    if (revision !== this._hydrateRevision || this.app.activeCompId !== compId) return false;
    // Publish one settled hydration snapshot after preview loading and host
    // reconciliation so the panel never renders an intermediate stale state.
    this.registry.replaceAll(this.registry.list());
    this.app._schedulePreviewRender();
    return true;
  }

  async reconcileHost(options = {}) {
    const compId = options.compId === undefined ? this.app.activeCompId : options.compId;
    if (!compId) return true;
    let response;
    try {
      await this.app.aeBridge.invoke('feature.normalizeControls', { compId });
    } catch (normalizationError) {
      // A stale in-memory Host may not know the migration command until AE is
      // restarted. Keep read-only reconciliation available in that session.
      console.warn('[FeatureManager] Vector control normalization deferred:', normalizationError.message);
    }
    try { response = await this.app.aeBridge.invoke('feature.list', { compId }); }
    catch (error) { console.warn('[FeatureManager] Host reconciliation deferred:', error.message); return false; }
    if (this.app.activeCompId !== compId || (options.hydrateRevision && options.hydrateRevision !== this._hydrateRevision)) return false;
    const hostItems = response && Array.isArray(response.features) ? response.features : [];
    const seen = {};
    for (let index = 0; index < hostItems.length; index++) {
      const host = hostItems[index];
      seen[host.id] = true;
      if (this.registry.get(host.id)) this.registry.setHostState(host.id, host, { silent: true });
      else {
        const type = host.id.indexOf('country-') === 0 ? 'country' : (host.id.indexOf('geojson-') === 0 ? 'geojson' : 'unmanaged');
        const sourceId = type === 'country' ? host.id.substring('country-'.length) : '';
        const sourcePath = type === 'geojson' ? this._getPayloadPath(host.id) : null;
        this.registry.upsert({ id: host.id, type, name: host.name || host.id, sourceId, sourcePath, visible: host.visible, hostPresent: true, ae: host }, { silent: true });
      }
    }
    this.registry.list().forEach(item => { if (!seen[item.id]) this.registry.setHostState(item.id, null, { silent: true }); });
  }

  async setVisibility(id, visible) {
    return this._queueFeatureOperation(id, async () => {
      this._assertFeatureMutationAllowed();
      const item = this.registry.get(id);
      if (!item) return false;
      const compId = this.app.activeCompId;
      if (item.hostPresent) await this.app.aeBridge.invoke('feature.visibility', { compId, featureId: id, visible: !!visible });
      if (this.app.activeCompId !== compId || !this.registry.get(id)) return false;
      this.registry.setVisibility(id, visible);
      this.app._scheduleMetadataSave();
      return true;
    });
  }

  async deleteFeature(id) {
    return this._queueFeatureOperation(id, async () => {
      this._assertFeatureMutationAllowed();
      const item = this.registry.get(id);
      if (!item) return false;
      const compId = this.app.activeCompId;
      if (item.hostPresent) await this.app.aeBridge.invoke('feature.delete', { compId, featureId: id });
      if (this.app.activeCompId !== compId || !this.registry.get(id)) return false;
      this.registry.remove(id);
      // Keep managed GeoJSON payloads as recoverable local data for AE Undo.
      this.app._scheduleMetadataSave();
      return true;
    });
  }

  async refresh() {
    await this.hydrate(this.registry.serialize());
    this.app._scheduleMetadataSave();
  }

  focusFeature(id) {
    const item = this.registry.get(id);
    if (!item) return false;
    if (item.bounds) this.app.viewport.fitBounds(item.bounds[0], item.bounds[1], item.bounds[2], item.bounds[3], 50);
    else if (item.anchor) this.app.viewport.setCenter(item.anchor.lat, item.anchor.lng);
    this.app._triggerTileUpdate();
    return true;
  }

  dispose() {
    this._disposed = true;
    this._hydrateRevision++;
    if (this._unsubscribe) this._unsubscribe();
  }

  async waitForIdle() {
    const pending = Array.from(this._featureOperations.values());
    if (!pending.length) return true;
    await Promise.all(pending.map(operation => Promise.resolve(operation).catch(() => null)));
    return true;
  }

  _assertFeatureMutationAllowed() {
    if (this.app.session && this.app.session.operations && this.app.session.operations.finalize === 'running') {
      const error = new Error('Vector layer changes are unavailable while Finalize is running.');
      error.code = 'FEATURE_MUTATION_DURING_FINALIZE';
      throw error;
    }
  }

  async _persistPayload(id, payload) {
    if (!this.storageDir) return null;
    this._validatePreviewPayload(payload);
    const target = this._getPayloadPath(id);
    await this.fs.promises.writeFile(target, JSON.stringify(payload), 'utf8');
    return target;
  }

  async _readManagedPayload(filePath, expectedId) {
    if (!this.storageDir || !filePath) throw new Error('Managed preview storage is unavailable.');
    const root = this.path.resolve(this.storageDir).toLowerCase() + this.path.sep;
    const resolved = this.path.resolve(String(filePath));
    if (resolved.toLowerCase().indexOf(root) !== 0) throw new Error('Preview source path is outside OpenGeo managed storage.');
    const stats = await this.fs.promises.stat(resolved);
    if (!stats.isFile() || stats.size > 25 * 1024 * 1024) throw new Error('Preview source is invalid or exceeds 25 MB.');
    const realRootPath = await this.fs.promises.realpath(this.storageDir);
    const realFilePath = await this.fs.promises.realpath(resolved);
    const realRoot = realRootPath.toLowerCase() + this.path.sep;
    if (realFilePath.toLowerCase().indexOf(realRoot) !== 0) throw new Error('Preview source resolves outside OpenGeo managed storage.');
    const payload = JSON.parse(await this.fs.promises.readFile(realFilePath, 'utf8'));
    this._validatePreviewPayload(payload);
    const payloadId = String(payload.featureId || payload.featureSignature || '');
    if (expectedId && payloadId !== String(expectedId)) throw new Error('Preview source identity does not match its registry descriptor.');
    return payload;
  }

  _getPayloadPath(id) {
    if (!this.storageDir) return null;
    const safeId = String(id).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120);
    const safeDocumentId = String(this.app.session.documentId || 'document').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
    return this.path.join(this.storageDir, `${safeDocumentId}--${safeId}.json`);
  }

  _buildCountryPayload(item, resolved) {
    const point = resolved.country.label || null;
    const latLng = point ? MercatorProjection.worldPointToLatLng(point[0], point[1], 10, 256) : null;
    const currentZoom = (this.app.session && this.app.session.mapState && Number.isFinite(this.app.session.mapState.compZoom))
      ? this.app.session.mapState.compZoom : 6;
    return {
      dataset: 'vectors/country-outlines-10m.json',
      selectionRule: 'country exterior rings only (international land borders + coastline; no EEZ)',
      featureId: item.id, featureSignature: item.featureSignature,
      layerName: item.layerName, displayName: item.name, sourceId: item.sourceId,
      strokeWidth: 3, strokeColor: [1, 0.8, 0.2, 1], fillOpacity: 0,
      referenceZoom: currentZoom,
      anchor: latLng ? { lat: latLng.lat, lng: latLng.lng, point } : null,
      features: resolved.features,
      layers: [{ id: 'country-outline', title: 'COUNTRY OUTLINE', isClosed: true, features: resolved.features, fillOpacity: 0, strokeOpacity: 100 }],
      labels: point ? [{ name: item.name, point }] : []
    };
  }

  _validatePreviewPayload(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Preview payload must be an object.');
    const id = String(payload.featureId || payload.featureSignature || '');
    if (!id || !/^[A-Za-z0-9._-]{1,160}$/.test(id)) throw new Error('Preview payload identity is invalid.');
    if (!Array.isArray(payload.layers) || !payload.layers.length || payload.layers.length > 20) throw new Error('Preview payload layers are invalid.');
    let featureCount = 0;
    let pointCount = 0;
    for (let layerIndex = 0; layerIndex < payload.layers.length; layerIndex++) {
      const features = payload.layers[layerIndex] && payload.layers[layerIndex].features;
      if (!Array.isArray(features)) throw new Error('Preview payload features are invalid.');
      featureCount += features.length;
      if (featureCount > 500) throw new Error('Preview payload exceeds 500 features.');
      for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
        const rings = features[featureIndex] && features[featureIndex].rings;
        if (!Array.isArray(rings) || !rings.length) throw new Error('Preview payload rings are invalid.');
        for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
          const ring = rings[ringIndex];
          if (!Array.isArray(ring) || ring.length < 2) throw new Error('Preview payload contains a short ring.');
          pointCount += ring.length;
          if (pointCount > 100000) throw new Error('Preview payload exceeds 100,000 points.');
          for (let pointIndex = 0; pointIndex < ring.length; pointIndex++) {
            const point = ring[pointIndex];
            if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
              throw new Error('Preview payload contains invalid coordinates.');
            }
          }
        }
      }
    }
    if (payload.labels !== undefined && (!Array.isArray(payload.labels) || payload.labels.length > 500)) throw new Error('Preview payload labels are invalid.');
    return true;
  }

  _queueFeatureOperation(id, callback) {
    const key = String(id || '');
    const previous = this._featureOperations.get(key) || Promise.resolve();
    const operation = previous.catch(() => {}).then(() => {
      if (this._disposed) throw new Error('Feature manager is disposed.');
      return callback();
    });
    let tracked = null;
    tracked = operation.finally(() => {
      if (this._featureOperations.get(key) === tracked) this._featureOperations.delete(key);
    });
    this._featureOperations.set(key, tracked);
    return tracked;
  }

  _boundsFromPayload(payload) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (payload.layers || []).forEach(layer => (layer.features || []).forEach(feature => (feature.rings || []).forEach(ring => ring.forEach(point => {
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
      minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]); minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
    }))));
    if (!Number.isFinite(minX)) return null;
    const northWest = MercatorProjection.worldPointToLatLng(minX, minY, 10, 256);
    const southEast = MercatorProjection.worldPointToLatLng(maxX, maxY, 10, 256);
    return [southEast.lat, northWest.lat, northWest.lng, southEast.lng];
  }

  _anchorFromPayload(payload) {
    const bounds = this._boundsFromPayload(payload);
    return bounds ? { lat: (bounds[0] + bounds[1]) / 2, lng: (bounds[2] + bounds[3]) / 2 } : null;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = FeatureManager;
else if (typeof window !== 'undefined') window.FeatureManager = FeatureManager;
