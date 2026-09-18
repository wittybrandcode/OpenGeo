/**
 * OpenGeo — MercatorMath (Functional Core)
 *
 * Pure mathematical functions for Spherical Mercator projection (EPSG:3857).
 * Zero dependencies on DOM, Window, Canvas, or After Effects runtime.
 * Deterministic, idempotent, and 100% headless testable.
 */

class MercatorMath {
  /**
   * Clamps latitude to valid Mercator projection limits (-85.05112878 to 85.05112878).
   * @param {number} lat Latitude in degrees
   * @returns {number} Clamped latitude
   */
  static clampLat(lat) {
    return Math.max(-85.05112878, Math.min(85.05112878, Number(lat) || 0));
  }

  /**
   * Normalizes longitude to [-180, 180] degrees.
   * @param {number} lng Longitude in degrees
   * @returns {number} Normalized longitude
   */
  static normalizeLng(lng) {
    return ((((Number(lng) || 0) + 180) % 360) + 360) % 360 - 180;
  }

  /**
   * Calculates total pixel dimension of the world map at a given zoom level.
   * @param {number} zoom Zoom level
   * @param {number} [tileSize=256] Tile size in pixels
   * @returns {number} Total world size in pixels
   */
  static getWorldSize(zoom, tileSize = 256) {
    return Math.pow(2, zoom) * tileSize;
  }

  /**
   * Projects (lat, lng) to absolute world pixel coordinates.
   * @param {number} lat Latitude
   * @param {number} lng Longitude
   * @param {number} zoom Zoom level
   * @param {number} [tileSize=256] Tile size
   * @returns {{x: number, y: number}} World pixel coordinates
   */
  static latLngToWorldPoint(lat, lng, zoom, tileSize = 256) {
    const size = this.getWorldSize(zoom, tileSize);
    const safeLat = this.clampLat(lat) * Math.PI / 180;
    const sinLat = Math.sin(safeLat);
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * size;
    return {
      x: ((this.normalizeLng(lng) + 180) / 360) * size,
      y: Math.max(0, Math.min(size, y))
    };
  }

  /**
   * Unprojects absolute world pixel coordinates back to (lat, lng).
   * @param {number} px X pixel in world coordinates
   * @param {number} py Y pixel in world coordinates
   * @param {number} zoom Zoom level
   * @param {number} [tileSize=256] Tile size
   * @returns {{lat: number, lng: number}} Geographic coordinates
   */
  static worldPointToLatLng(px, py, zoom, tileSize = 256) {
    const size = this.getWorldSize(zoom, tileSize);
    const lng = this.normalizeLng((px / size) * 360 - 180);
    const safeY = Math.max(0, Math.min(size, py));
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * safeY / size))) * 180 / Math.PI;
    return { lat: this.clampLat(lat), lng: lng };
  }

  /**
   * Calculates ground resolution in meters per pixel at a given latitude and zoom.
   * @param {number} lat Latitude
   * @param {number} zoom Zoom level
   * @returns {number} Meters per pixel
   */
  static getMetersPerPixel(lat, zoom) {
    const latRad = this.clampLat(lat) * Math.PI / 180;
    return 156543.03392 * Math.cos(latRad) / Math.pow(2, zoom);
  }

  /**
   * Computes pixel distance between two camera states across antimeridian boundaries.
   * @param {{lat: number, lng: number, zoom?: number}} first
   * @param {{lat: number, lng: number, zoom?: number}} second
   * @param {number} [zoom]
   * @param {number} [tileSize=256]
   * @returns {number} Pixel distance
   */
  static cameraPixelDistance(first, second, zoom, tileSize = 256) {
    if (!first || !second) return Infinity;
    const comparisonZoom = isFinite(Number(zoom))
      ? Number(zoom)
      : Math.max(Number(first.zoom) || 0, Number(second.zoom) || 0);
    const worldSize = this.getWorldSize(comparisonZoom, tileSize);
    const a = this.latLngToWorldPoint(first.lat, first.lng !== undefined ? first.lng : first.lon, comparisonZoom, tileSize);
    const b = this.latLngToWorldPoint(second.lat, second.lng !== undefined ? second.lng : second.lon, comparisonZoom, tileSize);
    let dx = Math.abs(a.x - b.x);
    if (dx > worldSize / 2) dx = worldSize - dx;
    const dy = Math.abs(a.y - b.y);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Evaluates whether two camera positions are equivalent within tolerances.
   * @param {object} first
   * @param {object} second
   * @param {object} [options]
   * @returns {boolean}
   */
  static camerasEquivalent(first, second, options = {}) {
    if (!first || !second) return false;
    const zoomTolerance = options.zoomTolerance === undefined ? 0.001 : options.zoomTolerance;
    if (Math.abs((Number(first.zoom) || 0) - (Number(second.zoom) || 0)) > zoomTolerance) return false;
    const pixelTolerance = options.pixelTolerance === undefined ? 0.5 : options.pixelTolerance;
    const zoom = Math.max(Number(first.zoom) || 0, Number(second.zoom) || 0);
    return this.cameraPixelDistance(first, second, zoom, options.tileSize || 256) <= pixelTolerance;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MercatorMath;
}
if (typeof window !== 'undefined') {
  window.MercatorMath = MercatorMath;
}
