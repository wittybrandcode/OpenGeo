class ProviderManager {
  constructor(config, storage, eventBus) {
    this.config = config || OpenGeoConfig;
    this.storage = storage || localStorage;
    this.eventBus = eventBus || (typeof globalEventBus !== 'undefined' ? globalEventBus : null);
    this.storageKey = 'opengeo_providers';
    this.userSettings = this._loadSettings();
    this.providers = this._buildRegistry(this.userSettings.customUrl);
  }

  _loadSettings() {
    let parsed = null;
    try {
      const data = this.storage.getItem(this.storageKey);
      if (data) parsed = JSON.parse(data);
    } catch (error) {
      console.error('[ProviderManager] Failed to load settings', error);
    }
    const keys = parsed && parsed.keys && typeof parsed.keys === 'object' ? parsed.keys : {};
    return {
      keys: Object.assign({}, keys),
      customUrl: parsed && typeof parsed.customUrl === 'string' ? parsed.customUrl : ''
    };
  }

  _buildRegistry(customUrl) {
    const registry = {};
    const source = this.config && this.config.tileSources ? this.config.tileSources : {};
    for (const id of Object.keys(source)) registry[id] = Object.freeze(Object.assign({}, source[id]));
    registry.customXYZ = Object.freeze({
      name: 'Custom XYZ Server',
      url: customUrl || 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxZoom: 19,
      minZoom: 1,
      requiresKey: false,
      attribution: 'Custom Server',
      attributionUrl: '',
      format: 'png',
      isCustom: true
    });
    return Object.freeze(registry);
  }

  saveSettings(settings) {
    const candidate = settings || {};
    const customUrl = String(candidate.customUrl || '').trim();
    const validation = this.validateCustomTemplate(customUrl);
    if (!validation.ok) return validation;
    const keys = {};
    for (const id of this.getKeyProviderIds()) keys[id] = String(candidate.keys && candidate.keys[id] || '').trim();
    this.userSettings = { keys, customUrl };
    this.providers = this._buildRegistry(customUrl);
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.userSettings));
    } catch (error) {
      console.error('[ProviderManager] Failed to save settings', error);
    }
    if (this.eventBus) this.eventBus.emit('providers:updated');
    return { ok: true };
  }

  validateCustomTemplate(template) {
    if (!template) return { ok: true };
    if (!/^https:\/\//i.test(template)) return { ok: false, code: 'CUSTOM_URL_PROTOCOL', message: 'Custom XYZ URL must use HTTPS.' };
    if (template.indexOf('{z}') === -1 || template.indexOf('{x}') === -1 || template.indexOf('{y}') === -1) {
      return { ok: false, code: 'CUSTOM_URL_TEMPLATE', message: 'Custom XYZ URL must contain {z}, {x}, and {y}.' };
    }
    return { ok: true };
  }

  getSettings() {
    return { keys: Object.assign({}, this.userSettings.keys), customUrl: this.userSettings.customUrl };
  }

  getProvider(id) { return this.providers[id] || null; }
  getProviderIds() { return Object.keys(this.providers); }
  getKeyProviderIds() { return Object.keys(this.providers).filter(id => this.providers[id].requiresKey === true); }
  getProviderSchema() {
    return this.getProviderIds().map(id => Object.freeze({
      id,
      name: this.providers[id].name,
      requiresKey: this.providers[id].requiresKey === true,
      isCustom: this.providers[id].isCustom === true
    }));
  }

  validateProvider(id) {
    const provider = this.getProvider(id);
    if (!provider) return { ok: false, code: 'UNKNOWN_PROVIDER', message: `Unknown provider: ${id}` };
    const key = this.userSettings.keys && this.userSettings.keys[id];
    if (provider.requiresKey && !key) return { ok: false, code: 'MISSING_PROVIDER_KEY', message: `A key is required for ${provider.name}` };
    return { ok: true, provider, key: key || '' };
  }

  getResolvedTemplate(id) {
    const validation = this.validateProvider(id);
    if (!validation.ok) return '';
    return validation.provider.url.replace('{key}', validation.key);
  }

  buildTileUrl(id, x, y, z) {
    const template = this.getResolvedTemplate(id);
    if (!template) return '';
    return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  }

  getSignature(id) {
    const provider = this.getProvider(id);
    if (!provider) return '';
    const material = `${id}|${provider.tileSize || 256}|${provider.url || ''}`;
    let hash = 2166136261;
    for (let i = 0; i < material.length; i++) {
      hash ^= material.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return `${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}_${provider.tileSize || 256}_${hash.toString(36)}`;
  }

}

if (typeof module !== 'undefined' && module.exports) module.exports = ProviderManager;
else if (typeof window !== 'undefined') window.ProviderManager = ProviderManager;
