/** Independent schema versions and deterministic N-2 migration rules. */
const OpenGeoVersions = Object.freeze({
  app: '1.0.1',
  settingsSchema: '2.0.0',
  metadataSchema: '2.2.0',
  bridgeProtocol: '2.0.0',
  vectorBundle: '2.0.0',
  cartographyPolicy: '1.0.0'
});

const OpenGeoVersionMigrations = {
  versions: OpenGeoVersions,

  migratePreferences(input, defaults, targetAppVersion) {
    const raw = input && typeof input === 'object' ? input : {};
    const hasPersistedState = Object.keys(raw).length > 0;
    const target = targetAppVersion || OpenGeoVersions.app;
    const future = hasPersistedState && this._compare(raw.version || '0.0.0', target) > 0;
    const value = {
      version: target,
      schemaVersion: OpenGeoVersions.settingsSchema,
      source: typeof raw.source === 'string' && raw.source ? raw.source : defaults.tileSource,
      tileSize: raw.tileSize === 512 ? 512 : (defaults.tileSize || 256),
      lat: Number.isFinite(raw.lat) ? raw.lat : defaults.centerLat,
      lng: Number.isFinite(raw.lng) ? raw.lng : defaults.centerLng,
      zoom: Number.isFinite(raw.zoom) ? raw.zoom : defaults.zoom,
      documentId: typeof raw.documentId === 'string' && raw.documentId ? raw.documentId : null,
      isNewVersion: !hasPersistedState
    };
    return { value, migrated: !future && raw.version !== target, future, from: raw.version || null, to: target };
  },

  migrateMetadata(input) {
    const raw = input && typeof input === 'object' ? input : null;
    if (!raw) return { ok: false, error: { code: 'METADATA_INVALID', message: 'Metadata must be an object.' } };
    const source = raw.opengeo && typeof raw.opengeo === 'object' ? raw.opengeo : raw;
    const future = this._major(source.version) > this._major(OpenGeoVersions.metadataSchema);
    const value = {
      version: OpenGeoVersions.metadataSchema,
      centerLat: source.centerLat !== undefined ? source.centerLat : source.lat,
      centerLng: source.centerLng !== undefined ? source.centerLng : source.lng,
      zoom: source.zoom,
      tileSize: source.tileSize,
      source: source.source || source.providerId,
      documentId: source.documentId,
      isFinalized: source.isFinalized,
      compWidth: source.compWidth || source.width,
      compHeight: source.compHeight || source.height,
      displayName: String(source.displayName || source.mapName || 'OpenGeo Map').slice(0, 80),
      activeRevision: source.activeRevision || null,
      features: Array.isArray(source.features) ? source.features.slice(0, 500) : [],
      cartography: source.cartography && typeof source.cartography === 'object' ? {
        policyId: source.cartography.policyId || null,
        policyVersion: source.cartography.policyVersion || null,
        dataBundleVersion: source.cartography.dataBundleVersion || null,
        activeProfileIds: Array.isArray(source.cartography.activeProfileIds) ? source.cartography.activeProfileIds.slice() : [],
        sourcePolicySha256: source.cartography.sourcePolicySha256 || null
      } : null
    };
    return { ok: true, value, migrated: source.version !== OpenGeoVersions.metadataSchema, future, from: source.version || null, to: OpenGeoVersions.metadataSchema };
  },

  _major(version) {
    const value = parseInt(String(version || '0').split('.')[0], 10);
    return Number.isFinite(value) ? value : 0;
  },

  _compare(left, right) {
    const a = String(left || '0').split('.').map(value => parseInt(value, 10) || 0);
    const b = String(right || '0').split('.').map(value => parseInt(value, 10) || 0);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
    }
    return 0;
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = OpenGeoVersionMigrations;
else if (typeof window !== 'undefined') {
  window.OpenGeoVersions = OpenGeoVersions;
  window.OpenGeoVersionMigrations = OpenGeoVersionMigrations;
}
