/**
 * OpenGeo — TileMath (Functional Core)
 *
 * Pure mathematical functions for Slippy Map tile addressing,
 * coordinate transformations, and grid bounding.
 * Zero dependencies on DOM, Window, Canvas, or After Effects runtime.
 * Deterministic, idempotent, and 100% headless testable.
 */

class TileMath {
  /**
   * Maximum tile count along one axis at a given zoom.
   * @param {number} zoom
   * @returns {number} 2^zoom
   */
  static maxTiles(zoom) {
    return Math.pow(2, Math.max(0, Math.floor(Number(zoom) || 0)));
  }

  /**
   * Wraps tile X coordinate across the antimeridian.
   * @param {number} x
   * @param {number} zoom
   * @returns {number} Wrapped integer in [0, 2^zoom - 1]
   */
  static wrapTileX(x, zoom) {
    const max = this.maxTiles(zoom);
    return ((Math.floor(x) % max) + max) % max;
  }

  /**
   * Clamps tile Y coordinate to valid Mercator range [0, 2^zoom - 1].
   * @param {number} y
   * @param {number} zoom
   * @returns {number} Clamped integer in [0, 2^zoom - 1]
   */
  static clampTileY(y, zoom) {
    const max = this.maxTiles(zoom);
    return Math.max(0, Math.min(max - 1, Math.floor(y)));
  }

  /**
   * Converts geographic (lat, lng) to floating-point tile coordinates.
   * @param {number} lat
   * @param {number} lng
   * @param {number} zoom
   * @returns {{x: number, y: number, z: number}}
   */
  static latLngToTileExact(lat, lng, zoom) {
    const z = Math.max(0, Math.floor(Number(zoom) || 0));
    const n = Math.pow(2, z);
    const rad = Math.max(-85.05112878, Math.min(85.05112878, Number(lat) || 0)) * Math.PI / 180;
    const x = ((Number(lng) || 0) + 180) / 360 * n;
    const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n;
    return { x, y, z };
  }

  /**
   * Converts geographic (lat, lng) to integer tile indices.
   * @param {number} lat
   * @param {number} lng
   * @param {number} zoom
   * @returns {{x: number, y: number, z: number}}
   */
  static latLngToTile(lat, lng, zoom) {
    const exact = this.latLngToTileExact(lat, lng, zoom);
    return {
      x: this.wrapTileX(exact.x, exact.z),
      y: this.clampTileY(exact.y, exact.z),
      z: exact.z
    };
  }

  /**
   * Converts tile index (x, y, zoom) to North-West corner (lat, lng).
   * @param {number} x
   * @param {number} y
   * @param {number} zoom
   * @returns {{lat: number, lng: number}}
   */
  static tileToLatLng(x, y, zoom) {
    const z = Math.max(0, Math.floor(Number(zoom) || 0));
    const n = Math.pow(2, z);
    const lng = (Number(x) / n) * 360 - 180;
    const rad = Math.atan(Math.sinh(Math.PI * (1 - 2 * Number(y) / n)));
    const lat = rad * 180 / Math.PI;
    return { lat, lng };
  }

  /**
   * Returns geographic bounding box for a given tile.
   * @param {number} x
   * @param {number} y
   * @param {number} zoom
   * @returns {{north: number, south: number, east: number, west: number}}
   */
  static tileBounds(x, y, zoom) {
    const nw = this.tileToLatLng(x, y, zoom);
    const se = this.tileToLatLng(Number(x) + 1, Number(y) + 1, zoom);
    return {
      north: nw.lat,
      south: se.lat,
      west: nw.lng,
      east: se.lng
    };
  }

  /**
   * Formats tile coordinates into a standard Slippy Map key string "z/x/y".
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {string}
   */
  static tileKey(x, y, z) {
    return `${z}/${x}/${y}`;
  }

  /**
   * Parses a tile key string "z/x/y" into numeric coordinates.
   * @param {string} key
   * @returns {{x: number, y: number, z: number}|null}
   */
  static parseTileKey(key) {
    if (!key || typeof key !== 'string') return null;
    const parts = key.split('/');
    if (parts.length !== 3) return null;
    const z = parseInt(parts[0], 10);
    const x = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (isNaN(z) || isNaN(x) || isNaN(y)) return null;
    return { x, y, z };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TileMath;
}
if (typeof window !== 'undefined') {
  window.TileMath = TileMath;
}
