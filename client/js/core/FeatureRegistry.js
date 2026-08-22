/** Composition-scoped registry for vector features managed by OpenGeo. */
class FeatureRegistry {
  constructor() {
    this._items = new Map();
    this._listeners = [];
    // Leave enough room in the 256 KB composition comment for camera,
    // cartography and revision metadata. Preview geometry is never serialized.
    this._descriptorBudget = 196608;
    this._maxItems = 500;
  }

  upsert(item, options = {}) {
    const normalized = this._normalize(item);
    const existing = this._items.get(normalized.id);
    if (existing && !normalized.previewPayload) normalized.previewPayload = existing.previewPayload || null;
    const candidate = new Map(this._items);
    candidate.set(normalized.id, normalized);
    this._assertBudget(candidate);
    this._items.set(normalized.id, normalized);
    if (!options.silent) this._notify({ type: existing ? 'updated' : 'added', id: normalized.id });
    return this.get(normalized.id);
  }

  replaceAll(items, options = {}) {
    if (!Array.isArray(items)) throw new Error('Feature registry state must be an array.');
    if (items.length > this._maxItems) throw new Error(`Feature registry exceeds ${this._maxItems} items.`);
    const source = items.slice();
    const candidate = new Map();
    for (let index = 0; index < source.length; index++) {
      const normalized = this._normalize(source[index]);
      candidate.set(normalized.id, normalized);
    }
    this._assertBudget(candidate);
    this._items = candidate;
    if (!options.silent) this._notify({ type: 'replaced' });
    return this.list();
  }

  get(id) {
    const item = this._items.get(String(id || ''));
    return item ? this._clone(item, true) : null;
  }

  list() {
    return Array.from(this._items.values())
      .map(item => this._clone(item, true))
      .sort((left, right) => left.createdAt - right.createdAt || left.name.localeCompare(right.name));
  }

  serialize() {
    return Array.from(this._items.values()).map(item => this._clone(item, false));
  }

  setVisibility(id, visible, options = {}) {
    const item = this._items.get(String(id || ''));
    if (!item) return false;
    item.visible = !!visible;
    item.hostPresent = item.hostPresent !== false;
    if (!options.silent) this._notify({ type: 'visibility', id: item.id, visible: item.visible });
    return true;
  }

  setHostState(id, state, options = {}) {
    const item = this._items.get(String(id || ''));
    if (!item) return false;
    if (state && typeof state.visible === 'boolean') item.visible = state.visible;
    item.hostPresent = !!state;
    item.ae = state ? {
      controllerId: state.controllerId || null,
      layerCount: Number(state.layerCount) || 0
    } : null;
    if (!options.silent) this._notify({ type: 'host', id: item.id });
    return true;
  }

  attachPreview(id, payload, options = {}) {
    const item = this._items.get(String(id || ''));
    if (!item) return false;
    item.previewPayload = payload || null;
    item.previewAvailable = !!payload;
    if (!options.silent) this._notify({ type: 'preview', id: item.id });
    return true;
  }

  remove(id, options = {}) {
    const key = String(id || '');
    const removed = this._items.delete(key);
    if (removed && !options.silent) this._notify({ type: 'removed', id: key });
    return removed;
  }

  clear(options = {}) {
    this._items.clear();
    if (!options.silent) this._notify({ type: 'cleared' });
  }

  onChange(callback) {
    if (typeof callback !== 'function') return () => {};
    this._listeners.push(callback);
    return () => {
      const index = this._listeners.indexOf(callback);
      if (index !== -1) this._listeners.splice(index, 1);
    };
  }

  _normalize(item) {
    if (!item || typeof item !== 'object') throw new Error('Feature registry item is required.');
    const id = String(item.id || '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 160);
    if (!id) throw new Error('Feature registry identity is invalid.');
    const type = item.type === 'country' ? 'country' : (item.type === 'geojson' ? 'geojson' : 'unmanaged');
    const bounds = Array.isArray(item.bounds) && item.bounds.length === 4 && item.bounds.every(Number.isFinite)
      ? item.bounds.slice() : null;
    const anchor = item.anchor && Number.isFinite(item.anchor.lat) && Number.isFinite(item.anchor.lng)
      ? { lat: item.anchor.lat, lng: item.anchor.lng } : null;
    return {
      id,
      type,
      name: String(item.name || id).slice(0, 160),
      sourceId: String(item.sourceId || '').slice(0, 160),
      featureSignature: String(item.featureSignature || id).slice(0, 160),
      layerName: String(item.layerName || item.name || id).slice(0, 160),
      visible: item.visible !== false,
      hostPresent: item.hostPresent !== false,
      previewAvailable: item.previewAvailable === true || !!item.previewPayload,
      previewPayload: item.previewPayload || null,
      sourcePath: typeof item.sourcePath === 'string' ? item.sourcePath.slice(0, 2048) : null,
      bounds,
      anchor,
      ae: item.ae && typeof item.ae === 'object' ? Object.assign({}, item.ae) : null,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now()
    };
  }

  _clone(item, includePreview) {
    const copy = Object.assign({}, item, {
      bounds: item.bounds ? item.bounds.slice() : null,
      anchor: item.anchor ? Object.assign({}, item.anchor) : null,
      ae: item.ae ? Object.assign({}, item.ae) : null
    });
    if (!includePreview) delete copy.previewPayload;
    return copy;
  }

  _assertBudget(items) {
    if (items.size > this._maxItems) throw new Error(`Feature registry exceeds ${this._maxItems} items.`);
    const descriptors = Array.from(items.values()).map(item => this._clone(item, false));
    if (JSON.stringify(descriptors).length > this._descriptorBudget) {
      const error = new Error('Feature registry exceeds the composition metadata safety budget.');
      error.code = 'FEATURE_REGISTRY_SIZE_LIMIT';
      throw error;
    }
  }

  _notify(change) {
    const snapshot = this.list();
    this._listeners.slice().forEach(listener => {
      try { listener(snapshot, change); }
      catch (error) { console.error('[FeatureRegistry] Change listener failed:', error); }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = FeatureRegistry;
else if (typeof window !== 'undefined') window.FeatureRegistry = FeatureRegistry;
