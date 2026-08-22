/** Pure state contracts shared by preferences, Session, and the AE bridge. */
const OpenGeoStateContracts = {
  clampLatitude(lat) {
    return Math.max(-85.05112878, Math.min(85.05112878, Number.isFinite(lat) ? lat : 0));
  },

  normalizeLongitude(lng) {
    const value = Number.isFinite(lng) ? lng : 0;
    return ((value + 180) % 360 + 360) % 360 - 180;
  },

  clampCompZoom(zoom) {
    return Math.max(1, Math.min(22, Number.isFinite(zoom) ? zoom : 2));
  },

  normalizeCamera(camera = {}) {
    return {
      lat: this.clampLatitude(camera.lat),
      lng: this.normalizeLongitude(camera.lng),
      compZoom: this.clampCompZoom(camera.compZoom)
    };
  },

  fromPreferences(preferences = {}, defaults = {}) {
    const camera = this.normalizeCamera({
      lat: Number.isFinite(preferences.lat) ? preferences.lat : (defaults.centerLat || 0),
      lng: Number.isFinite(preferences.lng) ? preferences.lng : (defaults.centerLng || 0),
      compZoom: Number.isFinite(preferences.zoom) ? preferences.zoom : defaults.zoom
    });
    return {
      source: preferences.source || defaults.tileSource,
      tileSize: preferences.tileSize === 512 ? 512 : (defaults.tileSize || 256),
      lat: camera.lat,
      lng: camera.lng,
      zoom: camera.compZoom,
      documentId: typeof preferences.documentId === 'string' ? preferences.documentId : null,
      isNewVersion: preferences.isNewVersion === true
    };
  },

  toPreferences(state, version) {
    return {
      version: version,
      source: state.providerId,
      tileSize: state.camera.tileSize,
      lat: state.camera.lat,
      lng: state.camera.lng,
      zoom: state.camera.compZoom,
      documentId: state.documentId
    };
  },

  toAeCamera(camera) {
    const normalized = this.normalizeCamera(camera);
    return { lat: normalized.lat, lng: normalized.lng, zoom: normalized.compZoom };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OpenGeoStateContracts;
} else if (typeof window !== 'undefined') {
  window.OpenGeoStateContracts = OpenGeoStateContracts;
}
