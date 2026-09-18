/**
 * OpenGeo — ViewportTransform (Functional Core Delegate)
 *
 * Handles pure screen-to-geographic and geographic-to-screen coordinate
 * transformations and boundary fitting for Viewport.
 * Zero DOM or side-effect dependencies.
 */

class ViewportTransform {
  /**
   * Calculates world coordinates of the viewport center.
   * @param {number} centerLat
   * @param {number} centerLng
   * @param {number} zoom
   * @param {number} tileSize
   * @returns {{x: number, y: number}}
   */
  static effectiveCenterWorld(centerLat, centerLng, zoom, tileSize) {
    if (typeof MercatorMath !== 'undefined') {
      return MercatorMath.latLngToWorldPoint(centerLat, centerLng, zoom, tileSize);
    }
    return MercatorProjection.latLngToWorldPoint(centerLat, centerLng, zoom, tileSize);
  }

  /**
   * Projects (lat, lng) to screen pixel coordinates (x, y) relative to panel top-left.
   * Handles antimeridian wrapping.
   * @param {number} lat
   * @param {number} lng
   * @param {number} centerLat
   * @param {number} centerLng
   * @param {number} zoom
   * @param {number} width
   * @param {number} height
   * @param {number} tileSize
   * @returns {{x: number, y: number}}
   */
  static latLngToScreen(lat, lng, centerLat, centerLng, zoom, width, height, tileSize) {
    const point = (typeof MercatorMath !== 'undefined')
      ? MercatorMath.latLngToWorldPoint(lat, lng, zoom, tileSize)
      : MercatorProjection.latLngToWorldPoint(lat, lng, zoom, tileSize);
    const center = this.effectiveCenterWorld(centerLat, centerLng, zoom, tileSize);
    const size = (typeof MercatorMath !== 'undefined')
      ? MercatorMath.getWorldSize(zoom, tileSize)
      : MercatorProjection.getWorldSize(zoom, tileSize);

    let dx = point.x - center.x;
    if (dx > size / 2) dx -= size;
    if (dx < -size / 2) dx += size;

    return {
      x: dx + width / 2,
      y: point.y - center.y + height / 2
    };
  }

  /**
   * Unprojects screen pixel coordinates (px, py) back to geographic (lat, lng).
   * @param {number} px
   * @param {number} py
   * @param {number} centerLat
   * @param {number} centerLng
   * @param {number} zoom
   * @param {number} width
   * @param {number} height
   * @param {number} tileSize
   * @returns {{lat: number, lng: number}}
   */
  static screenToLatLng(px, py, centerLat, centerLng, zoom, width, height, tileSize) {
    const center = this.effectiveCenterWorld(centerLat, centerLng, zoom, tileSize);
    const size = (typeof MercatorMath !== 'undefined')
      ? MercatorMath.getWorldSize(zoom, tileSize)
      : MercatorProjection.getWorldSize(zoom, tileSize);

    let targetWorldX = center.x + px - width / 2;
    const targetWorldY = center.y + py - height / 2;

    if (targetWorldX < 0) targetWorldX = ((targetWorldX % size) + size) % size;
    if (targetWorldX > size) targetWorldX = targetWorldX % size;

    if (typeof MercatorMath !== 'undefined') {
      return MercatorMath.worldPointToLatLng(targetWorldX, targetWorldY, zoom, tileSize);
    }
    return MercatorProjection.worldPointToLatLng(targetWorldX, targetWorldY, zoom, tileSize);
  }

  /**
   * Calculates the optimal camera center and zoom level to encompass a geographic bounding box.
   * @param {number|string} south
   * @param {number|string} north
   * @param {number|string} west
   * @param {number|string} east
   * @param {number} width
   * @param {number} height
   * @param {number} minZoom
   * @param {number} maxZoom
   * @param {number} tileSize
   * @param {number} [padding=60]
   * @returns {{centerLat: number, centerLng: number, zoom: number}}
   */
  static fitBounds(south, north, west, east, width, height, minZoom, maxZoom, tileSize, padding = 60) {
    const southLat = parseFloat(south);
    const northLat = parseFloat(north);
    let wLng = parseFloat(west);
    let eLng = parseFloat(east);

    let centerLng = (wLng + eLng) / 2;
    if (wLng > eLng) {
      centerLng = (wLng + eLng + 360) / 2;
      if (centerLng > 180) centerLng -= 360;
    }

    let bestZoom = minZoom;
    const targetW = Math.max(10, width - padding);
    const targetH = Math.max(10, height - padding);

    const getWSize = typeof MercatorMath !== 'undefined'
      ? (z, ts) => MercatorMath.getWorldSize(z, ts)
      : (z, ts) => MercatorProjection.getWorldSize(z, ts);

    const toWorld = typeof MercatorMath !== 'undefined'
      ? (lat, lng, z, ts) => MercatorMath.latLngToWorldPoint(lat, lng, z, ts)
      : (lat, lng, z, ts) => MercatorProjection.latLngToWorldPoint(lat, lng, z, ts);

    const toLatLng = typeof MercatorMath !== 'undefined'
      ? (x, y, z, ts) => MercatorMath.worldPointToLatLng(x, y, z, ts)
      : (x, y, z, ts) => MercatorProjection.worldPointToLatLng(x, y, z, ts);

    for (let z = maxZoom; z >= minZoom; z--) {
      let lngDiff = eLng - wLng;
      if (lngDiff < 0) lngDiff += 360;

      const size = getWSize(z, tileSize);
      let w = (lngDiff / 360) * size;

      const sw = toWorld(south, west, z, tileSize);
      const ne = toWorld(north, east, z, tileSize);
      const h = Math.abs(sw.y - ne.y);

      if (w <= targetW && h <= targetH) {
        bestZoom = z;
        break;
      }
    }

    const southWorld = toWorld(southLat, centerLng, 0, tileSize);
    const northWorld = toWorld(northLat, centerLng, 0, tileSize);
    const centerLat = toLatLng(southWorld.x, (southWorld.y + northWorld.y) / 2, 0, tileSize).lat;

    return {
      centerLat,
      centerLng,
      zoom: bestZoom
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ViewportTransform;
}
if (typeof window !== 'undefined') {
  window.ViewportTransform = ViewportTransform;
}
