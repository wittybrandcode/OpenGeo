/**
 * OpenGeo — EngineSyncBridge (Engine Synchronization Delegate)
 *
 * Manages cache namespace isolation and camera state mapping
 * between CEP Viewport/MapState and Engine.
 */

class EngineSyncBridge {
  /**
   * Applies camera position and viewport dimensions to an Engine instance.
   * @param {object} engine
   * @param {number} lat
   * @param {number} lon
   * @param {number} [zoom]
   * @param {number} [width]
   * @param {number} [height]
   */
  static syncCamera(engine, lat, lon, zoom, width, height) {
    if (engine && typeof engine.setCamera === 'function') {
      engine.setCamera(lat, lon, zoom);
      if (width !== undefined && height !== undefined) {
        engine.setViewport(width, height);
      }
    }
  }

  /**
   * Normalizes provider cache namespace for cache disk isolation.
   * @param {string} namespace
   * @returns {string}
   */
  static normalizeNamespace(namespace) {
    if (typeof CachePolicy !== 'undefined' && CachePolicy.sanitizeNamespace) {
      return CachePolicy.sanitizeNamespace(namespace);
    }
    return (namespace || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = EngineSyncBridge;
}
if (typeof window !== 'undefined') {
  window.EngineSyncBridge = EngineSyncBridge;
}
