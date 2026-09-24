/**
 * MapSession is the authoritative client-side document state.  MapState stays
 * as the projection/layout implementation used by Viewport during the
 * migration, but callers mutate camera and composition through this class.
 */
class MapSession {
  constructor(config, preferences = {}) {
    this.config = config;
    this.contracts = typeof OpenGeoStateContracts !== 'undefined' ? OpenGeoStateContracts : null;
    this.mapState = new MapState();
    this.composition = null;
    this.documentId = preferences.documentId || this._createDocumentId();
    this.providerId = config.defaults.tileSource;
    this.isFinalized = false;
    this.finalizedCamera = null;
    this.generations = { preview: 0, sync: 0, finalize: 0 };
    this.operations = { preview: 'idle', sync: 'idle', finalize: 'idle' };
    this.operationIds = { preview: null, sync: null, finalize: null };
    this.revision = 0;
    this._listeners = [];
    this.featureRegistry = null;

    this.mapState.setCompSize(1920, 1080);
    this.hydratePreferences(preferences);
  }

  hydratePreferences(preferences = {}) {
    const defaults = this.config.defaults;
    const normalized = this.contracts ? this.contracts.fromPreferences(preferences, defaults) : preferences;
    this.providerId = normalized.source || defaults.tileSource;
    this.mapState.tileSize = normalized.tileSize === 512 ? 512 : defaults.tileSize;
    this.mapState.setCenter(
      Number.isFinite(normalized.lat) ? normalized.lat : defaults.centerLat,
      Number.isFinite(normalized.lng) ? normalized.lng : defaults.centerLng
    );
    // Existing preferences store compZoom. Fresh/default preferences retain the
    // historic UI-default behavior exactly once, then persist the resulting compZoom.
    if (normalized.isNewVersion || !Number.isFinite(normalized.zoom)) {
      this.mapState.setUIZoom(defaults.zoom);
    } else {
      this.mapState.compZoom = this._clampCompZoom(normalized.zoom);
    }
  }

  setCamera(camera, options = {}) {
    if (!camera) return;
    const normalized = this.contracts ? this.contracts.normalizeCamera({
      lat: Number.isFinite(camera.lat) ? camera.lat : this.mapState.latitude,
      lng: Number.isFinite(camera.lng) ? camera.lng : this.mapState.longitude,
      compZoom: Number.isFinite(camera.compZoom) ? camera.compZoom : this.mapState.compZoom
    }) : camera;
    if (Number.isFinite(camera.lat) && Number.isFinite(camera.lng)) {
      this.mapState.setCenter(normalized.lat, normalized.lng);
    }
    if (Number.isFinite(camera.compZoom)) {
      this.mapState.compZoom = this._clampCompZoom(normalized.compZoom);
    } else if (Number.isFinite(camera.uiZoom)) {
      this.mapState.setUIZoom(camera.uiZoom);
    }
    if (Number.isFinite(camera.pitch)) {
      this.mapState.setPitch(camera.pitch);
    }
    this._notify({ type: 'camera', origin: options.origin || 'system' });
  }

  updateFromViewport(viewport, origin = 'ui') {
    this.setCamera({
      lat: viewport.centerLat,
      lng: viewport.centerLng,
      compZoom: viewport.mapState.compZoom,
      pitch: viewport.pitch
    }, { origin });
  }

  setComposition(composition, options = {}) {
    this.composition = composition ? Object.assign({}, composition) : null;
    if (composition && Number.isFinite(composition.width) && Number.isFinite(composition.height)) {
      this.mapState.setCompSize(composition.width, composition.height);
    }
    this._notify({ type: 'composition', origin: options.origin || 'system' });
  }

  createDocument() {
    const previewDrafts = this.featureRegistry
      ? this.featureRegistry.list().filter(item => item.hostPresent === false && item.previewPayload)
      : [];
    this.documentId = this._createDocumentId();
    this.composition = null;
    this.isFinalized = false;
    this.finalizedCamera = null;
    this.operationIds = { preview: null, sync: null, finalize: null };
    if (this.featureRegistry) this.featureRegistry.replaceAll(previewDrafts);
    this._notify({ type: 'document', origin: 'ui' });
    return this.documentId;
  }

  setProvider(providerId, options = {}) {
    this.providerId = providerId;
    this._notify({ type: 'provider', origin: options.origin || 'ui' });
  }

  setTileSize(tileSize, options = {}) {
    this.mapState.tileSize = tileSize === 512 ? 512 : 256;
    this._notify({ type: 'tileSize', origin: options.origin || 'ui' });
  }

  setFinalized(isFinalized, options = {}) {
    this.isFinalized = !!isFinalized;
    if (this.isFinalized) {
      const cam = options.camera || {
        lat: this.mapState.latitude,
        lng: this.mapState.longitude,
        zoom: this.mapState.compZoom
      };
      this.finalizedCamera = {
        lat: cam.lat,
        lng: cam.lng,
        zoom: cam.zoom !== undefined ? cam.zoom : (cam.compZoom !== undefined ? cam.compZoom : this.mapState.compZoom)
      };
    } else {
      this.finalizedCamera = null;
    }
    this._notify({ type: 'finalization', origin: options.origin || 'system' });
  }

  hydrateDocument(documentState, options = {}) {
    if (!documentState || typeof documentState !== 'object') throw new Error('Document hydration state is required.');
    const before = this.snapshot();
    try {
      if (documentState.documentId !== undefined) {
        if (typeof documentState.documentId !== 'string' || !documentState.documentId) throw new Error('Document identity is invalid.');
        this.documentId = documentState.documentId;
      }
      if (documentState.composition !== undefined) {
        const composition = documentState.composition;
        if (!composition || !Number.isFinite(composition.width) || composition.width <= 0 ||
            !Number.isFinite(composition.height) || composition.height <= 0) throw new Error('Composition dimensions are invalid.');
        this.composition = Object.assign({}, composition);
        this.mapState.setCompSize(composition.width, composition.height);
      }
      if (documentState.providerId !== undefined) {
        if (typeof documentState.providerId !== 'string' || !documentState.providerId) throw new Error('Provider identity is invalid.');
        this.providerId = documentState.providerId;
      }
      if (documentState.tileSize !== undefined) {
        if (documentState.tileSize !== 256 && documentState.tileSize !== 512) throw new Error('Tile size is invalid.');
        this.mapState.tileSize = documentState.tileSize;
      }
      if (documentState.camera !== undefined) {
        if (!documentState.camera || !Number.isFinite(documentState.camera.lat) || !Number.isFinite(documentState.camera.lng) || !Number.isFinite(documentState.camera.compZoom)) throw new Error('Camera state is invalid.');
        const camera = this.contracts ? this.contracts.normalizeCamera(documentState.camera) : documentState.camera;
        this.mapState.setCenter(camera.lat, camera.lng);
        this.mapState.compZoom = this._clampCompZoom(camera.compZoom);
      }
      if (documentState.isFinalized !== undefined) {
        if (typeof documentState.isFinalized !== 'boolean') throw new Error('Finalization state is invalid.');
        this.isFinalized = documentState.isFinalized;
        if (this.isFinalized && documentState.camera) {
          this.finalizedCamera = {
            lat: documentState.camera.lat,
            lng: documentState.camera.lng,
            zoom: documentState.camera.compZoom
          };
        } else if (!this.isFinalized) {
          this.finalizedCamera = null;
        }
      }
      if (documentState.features !== undefined && this.featureRegistry) {
        if (!Array.isArray(documentState.features) || documentState.features.length > 500) throw new Error('Feature registry is invalid.');
        this.featureRegistry.replaceAll(documentState.features, { silent: true });
      }
    } catch (error) {
      this._restoreSnapshot(before);
      throw error;
    }
    this._notify({ type: 'hydration', origin: options.origin || 'metadata' });
    return this.snapshot();
  }

  nextGeneration(kind) {
    if (!Object.prototype.hasOwnProperty.call(this.generations, kind)) throw new Error(`Unknown operation kind: ${kind}`);
    this.generations[kind] += 1;
    return this.generations[kind];
  }

  beginOperation(kind) {
    const generation = this.nextGeneration(kind);
    this.operations[kind] = 'running';
    this.operationIds[kind] = [kind, this.documentId, generation, Date.now().toString(36)].join(':');
    this._notify({ type: 'operation', kind, status: 'running', origin: 'system' });
    this._emitOperationEvent('operation:progress', { operationId: this.operationIds[kind], kind, phase: 'started', generation });
    return generation;
  }

  completeOperation(kind, generation) {
    if (this.generations[kind] !== generation) return false;
    this.operations[kind] = 'completed';
    this._notify({ type: 'operation', kind, status: 'completed', origin: 'system' });
    this._emitOperationEvent('operation:result', { operationId: this.operationIds[kind], kind, ok: true, status: 'completed', generation });
    return true;
  }

  failOperation(kind, generation, errorCode = 'OPERATION_FAILED') {
    if (this.generations[kind] !== generation) return false;
    this.operations[kind] = 'failed';
    this._notify({ type: 'operation', kind, status: 'failed', origin: 'system' });
    this._emitOperationEvent('operation:result', { operationId: this.operationIds[kind], kind, ok: false, status: 'failed', errorCode, generation });
    return true;
  }

  cancelOperation(kind, generation) {
    if (this.generations[kind] !== generation) return false;
    this.operations[kind] = 'cancelled';
    this._notify({ type: 'operation', kind, status: 'cancelled', origin: 'system' });
    this._emitOperationEvent('operation:result', { operationId: this.operationIds[kind], kind, ok: false, status: 'cancelled', errorCode: 'OPERATION_CANCELLED', generation });
    return true;
  }

  snapshot() {
    return {
      camera: {
        lat: this.mapState.latitude,
        lng: this.mapState.longitude,
        compZoom: this.mapState.compZoom,
        uiZoom: this.mapState.getUIZoom(),
        pitch: this.mapState.getPitch(),
        tileSize: this.mapState.tileSize
      },
      layout: {
        compWidth: this.mapState.compWidth,
        compHeight: this.mapState.compHeight
      },
      composition: this.composition ? Object.assign({}, this.composition) : null,
      documentId: this.documentId,
      providerId: this.providerId,
      isFinalized: this.isFinalized,
      finalizedCamera: this.finalizedCamera ? Object.assign({}, this.finalizedCamera) : null,
      generations: Object.assign({}, this.generations),
      operations: Object.assign({}, this.operations),
      operationIds: Object.assign({}, this.operationIds),
      revision: this.revision,
      features: this.featureRegistry ? this.featureRegistry.serialize() : []
    };
  }

  get camera() {
    return {
      lat: this.mapState.latitude,
      lng: this.mapState.longitude,
      compZoom: this.mapState.compZoom,
      uiZoom: this.mapState.getUIZoom(),
      pitch: this.mapState.getPitch(),
      tileSize: this.mapState.tileSize
    };
  }

  getCamera() {
    return this.camera;
  }

  attachFeatureRegistry(registry) { this.featureRegistry = registry || null; }

  onChange(callback) {
    this._listeners.push(callback);
    return () => {
      const index = this._listeners.indexOf(callback);
      if (index !== -1) this._listeners.splice(index, 1);
    };
  }

  _notify(change) {
    this.revision += 1;
    const snapshot = this.snapshot();
    this._listeners.slice().forEach(listener => {
      try {
        listener(snapshot, change);
      } catch (error) {
        this._emitOperationEvent('error:report', {
          source: 'MapSession.onChange',
          code: 'SESSION_LISTENER_FAILED',
          message: error && error.message ? error.message : String(error)
        });
      }
    });
  }

  _restoreSnapshot(snapshot) {
    this.documentId = snapshot.documentId;
    this.providerId = snapshot.providerId;
    this.isFinalized = snapshot.isFinalized;
    this.finalizedCamera = snapshot.finalizedCamera ? Object.assign({}, snapshot.finalizedCamera) : null;
    this.composition = snapshot.composition ? Object.assign({}, snapshot.composition) : null;
    this.generations = Object.assign({}, snapshot.generations);
    this.operations = Object.assign({}, snapshot.operations);
    this.operationIds = Object.assign({}, snapshot.operationIds);
    this.revision = snapshot.revision;
    this.mapState.setCompSize(snapshot.layout.compWidth, snapshot.layout.compHeight);
    this.mapState.tileSize = snapshot.camera.tileSize;
    this.mapState.setCenter(snapshot.camera.lat, snapshot.camera.lng);
    this.mapState.compZoom = this._clampCompZoom(snapshot.camera.compZoom);
    if (this.featureRegistry) this.featureRegistry.replaceAll(snapshot.features || [], { silent: true });
  }

  getOperationId(kind, generation) {
    if (this.generations[kind] !== generation) return null;
    return this.operationIds[kind] || null;
  }

  _emitOperationEvent(eventName, payload) {
    if (typeof globalEventBus !== 'undefined') globalEventBus.emit(eventName, payload);
  }

  _clampCompZoom(zoom) {
    return this.contracts ? this.contracts.clampCompZoom(zoom) : Math.max(1, Math.min(22, Number(zoom)));
  }

  _createDocumentId() {
    return 'map_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MapSession;
} else if (typeof window !== 'undefined') {
  window.MapSession = MapSession;
}
