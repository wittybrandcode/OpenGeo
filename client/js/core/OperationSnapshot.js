/**
 * Immutable identity and rendering inputs for one asynchronous map operation.
 * Long-running callbacks must consult isCurrent() before publishing UI state or
 * committing a result to After Effects.
 */
class OperationSnapshot {
  constructor(data) {
    this.operationId = data.operationId;
    this.kind = data.kind;
    this.generation = data.generation;
    this.documentId = data.documentId;
    this.compId = data.compId;
    this.sourceKey = data.sourceKey;
    this.providerSignature = data.providerSignature;
    this.resolvedTemplate = data.resolvedTemplate;
    this.sourceTileSize = data.sourceTileSize;
    this.tileSize = data.tileSize;
    this.maxSourceZoom = data.maxSourceZoom;
    this.isFinalized = data.isFinalized;
    this.quality = data.quality;
    this.camera = Object.freeze(Object.assign({}, data.camera));
    this.composition = Object.freeze(Object.assign({}, data.composition));
    this.compSettings = data.compSettings
      ? Object.freeze(Object.assign({}, data.compSettings))
      : null;
    this.features = Object.freeze((Array.isArray(data.features) ? data.features : []).map(feature =>
      Object.freeze(Object.assign({}, feature, {
        bounds: Array.isArray(feature.bounds) ? Object.freeze(feature.bounds.slice()) : null,
        anchor: feature.anchor ? Object.freeze(Object.assign({}, feature.anchor)) : null,
        ae: feature.ae ? Object.freeze(Object.assign({}, feature.ae)) : null
      }))
    ));
    Object.freeze(this);
  }

  isCurrent(app) {
    if (!app || !app.session || !app.tileManager || !app.providerManager) return false;
    if (app.session.documentId !== this.documentId) return false;
    if (app.tileManager.source !== this.sourceKey) return false;
    // A provider can keep the same public id while its Custom XYZ template or
    // credential changes. Source id alone cannot protect an in-flight export:
    // pin both the non-secret cache signature and the resolved in-memory
    // template so an older request can never commit after settings changed.
    if (app.providerManager.getSignature(this.sourceKey) !== this.providerSignature) return false;
    if (app.providerManager.getResolvedTemplate(this.sourceKey) !== this.resolvedTemplate) return false;
    if (app.mapState && (app.mapState.tileSize === 512 ? 512 : 256) !== this.tileSize) return false;
    if (this.compId !== null && this.compId !== undefined &&
        String(app.activeCompId) !== String(this.compId)) return false;
    if (app.session.generations &&
        Object.prototype.hasOwnProperty.call(app.session.generations, this.kind) &&
        app.session.generations[this.kind] !== this.generation) return false;
    return true;
  }

  static capture(app, options = {}) {
    if (!app || !app.session || !app.providerManager || !app.tileManager) {
      throw new Error('Cannot capture a map operation without an initialized application session.');
    }

    const sourceCandidate = app.tileManager.source;
    const sourceKey = app.providerManager.getProvider(sourceCandidate)
      ? sourceCandidate
      : app.config.defaults.tileSource;
    const validation = app.providerManager.validateProvider(sourceKey);
    if (!validation.ok) throw new Error(validation.message);
    const resolvedTemplate = app.providerManager.getResolvedTemplate(sourceKey);
    if (!resolvedTemplate) {
      throw new Error('The selected map provider is unavailable or requires an API key.');
    }

    const sourceConfig = app.providerManager.getProvider(sourceKey) || {};
    const mapState = app.mapState;
    const kind = options.kind || 'sync';
    const generation = options.generation;
    const compId = options.compId !== undefined ? options.compId : (app.activeCompId || null);
    const documentId = app.session.documentId;

    return new OperationSnapshot({
      operationId: app.session.getOperationId && app.session.getOperationId(kind, generation) ||
        [kind, documentId, generation, Date.now().toString(36)].join(':'),
      kind,
      generation,
      documentId,
      compId,
      sourceKey,
      providerSignature: app.providerManager.getSignature(sourceKey),
      resolvedTemplate,
      sourceTileSize: sourceConfig.tileSize || 256,
      tileSize: mapState.tileSize === 512 ? 512 : 256,
      maxSourceZoom: sourceConfig.maxZoom || 19,
      isFinalized: app.session.isFinalized === true,
      quality: options.quality || null,
      camera: {
        lat: mapState.latitude,
        lon: mapState.longitude,
        zoom: mapState.compZoom
      },
      composition: {
        width: (app.session.composition && app.session.composition.width) || mapState.compWidth || 1920,
        height: (app.session.composition && app.session.composition.height) || mapState.compHeight || 1080,
        displayName: String(app.session.composition && app.session.composition.displayName || options.compSettings && options.compSettings.displayName || 'OpenGeo Map').slice(0, 80)
      },
      features: app.session.featureRegistry ? app.session.featureRegistry.serialize() : [],
      compSettings: options.compSettings || null
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OperationSnapshot;
} else if (typeof window !== 'undefined') {
  window.OperationSnapshot = OperationSnapshot;
}
