/**
 * OpenGeo — ViewportAnchor (Functional Core Delegate)
 *
 * Handles camera focus point anchoring during mouse wheel zoom,
 * panning deltas, and guard-band minimum zoom calculations.
 * Zero DOM or side-effect dependencies.
 */

class ViewportAnchor {
  /**
   * Calculates new camera center so that (geoLat, geoLng) remains invariant
   * at screen position (px, py) after zooming to newZoom.
   * @param {number} targetZoom
   * @param {number} geoLat
   * @param {number} geoLng
   * @param {number} px
   * @param {number} py
   * @param {number} width
   * @param {number} height
   * @param {number} tileSize
   * @returns {{lat: number, lng: number}}
   */
  static calculateZoomAtGeoPoint(targetZoom, geoLat, geoLng, px, py, width, height, tileSize) {
    const toWorld = typeof MercatorMath !== 'undefined'
      ? (lat, lng, z, ts) => MercatorMath.latLngToWorldPoint(lat, lng, z, ts)
      : (lat, lng, z, ts) => MercatorProjection.latLngToWorldPoint(lat, lng, z, ts);

    const toLatLng = typeof MercatorMath !== 'undefined'
      ? (x, y, z, ts) => MercatorMath.worldPointToLatLng(x, y, z, ts)
      : (x, y, z, ts) => MercatorProjection.worldPointToLatLng(x, y, z, ts);

    const focusWorld = toWorld(geoLat, geoLng, targetZoom, tileSize);
    const centerWorldX = focusWorld.x - (px - width / 2);
    const centerWorldY = focusWorld.y - (py - height / 2);

    return toLatLng(centerWorldX, centerWorldY, targetZoom, tileSize);
  }

  /**
   * Calculates new camera center after a pan delta (dx, dy) in screen pixels.
   * @param {number} dx
   * @param {number} dy
   * @param {number} centerLat
   * @param {number} centerLng
   * @param {number} zoom
   * @param {number} width
   * @param {number} height
   * @param {number} tileSize
   * @returns {{lat: number, lng: number}}
   */
  static calculatePanCenter(dx, dy, centerLat, centerLng, zoom, width, height, tileSize) {
    if (typeof ViewportTransform !== 'undefined') {
      return ViewportTransform.screenToLatLng(width / 2 - dx, height / 2 - dy, centerLat, centerLng, zoom, width, height, tileSize);
    }
    // Fallback using MercatorProjection
    const center = MercatorProjection.latLngToWorldPoint(centerLat, centerLng, zoom, tileSize);
    const size = MercatorProjection.getWorldSize(zoom, tileSize);
    let targetWorldX = center.x + (width / 2 - dx) - width / 2;
    const targetWorldY = center.y + (height / 2 - dy) - height / 2;
    if (targetWorldX < 0) targetWorldX = ((targetWorldX % size) + size) % size;
    if (targetWorldX > size) targetWorldX = targetWorldX % size;
    return MercatorProjection.worldPointToLatLng(targetWorldX, targetWorldY, zoom, tileSize);
  }

  /**
   * Computes the dynamic safe minimum zoom to prevent empty edge rendering on resize.
   * @param {number} width
   * @param {number} tileSize
   * @param {number} minZoom
   * @param {number} maxZoom
   * @returns {number}
   */
  static calculateSafeMinZoom(width, tileSize, minZoom, maxZoom) {
    const panelWidth = Math.max(1, width || 0);
    const guardBandPixels = tileSize * 2;
    const coverageZoom = Math.log2((panelWidth + guardBandPixels) / tileSize);
    return Math.max(minZoom, Math.min(maxZoom, coverageZoom));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ViewportAnchor;
}
if (typeof window !== 'undefined') {
  window.ViewportAnchor = ViewportAnchor;
}
