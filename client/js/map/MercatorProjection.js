/**
 * OpenGeo — MercatorProjection (Façade)
 *
 * Provides backward-compatible cartographic projection interface.
 * Delegates pure mathematical formulas to Functional Core (MercatorMath)
 * with inline deterministic fallbacks.
 */

class MercatorProjection {
  static clampLat(lat) {
    if (typeof MercatorMath !== 'undefined' && MercatorMath.clampLat) {
      return MercatorMath.clampLat(lat);
    }
    return Math.max(-85.05112878, Math.min(85.05112878, Number(lat) || 0));
  }

  static normalizeLng(lng) {
    if (typeof MercatorMath !== 'undefined' && MercatorMath.normalizeLng) {
      return MercatorMath.normalizeLng(lng);
    }
    return ((((Number(lng) || 0) + 180) % 360) + 360) % 360 - 180;
  }

  static getWorldSize(zoom, tileSize = 256) {
    if (typeof MercatorMath !== 'undefined' && MercatorMath.getWorldSize) {
      return MercatorMath.getWorldSize(zoom, tileSize);
    }
    return Math.pow(2, zoom) * tileSize;
  }

  static latLngToWorldPoint(lat, lng, zoom, tileSize = 256) {
    if (typeof MercatorMath !== 'undefined' && MercatorMath.latLngToWorldPoint) {
      return MercatorMath.latLngToWorldPoint(lat, lng, zoom, tileSize);
    }
    const size = this.getWorldSize(zoom, tileSize);
    const safeLat = this.clampLat(lat) * Math.PI / 180;
    const sinLat = Math.sin(safeLat);
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * size;
    return {
      x: ((this.normalizeLng(lng) + 180) / 360) * size,
      y: Math.max(0, Math.min(size, y))
    };
  }

  static worldPointToLatLng(px, py, zoom, tileSize = 256) {
    if (typeof MercatorMath !== 'undefined' && MercatorMath.worldPointToLatLng) {
      return MercatorMath.worldPointToLatLng(px, py, zoom, tileSize);
    }
    const size = this.getWorldSize(zoom, tileSize);
    const lng = this.normalizeLng((px / size) * 360 - 180);
    const safeY = Math.max(0, Math.min(size, py));
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * safeY / size))) * 180 / Math.PI;
    return { lat: this.clampLat(lat), lng: lng };
  }

  static getMetersPerPixel(lat, zoom) {
    if (typeof MercatorMath !== 'undefined' && MercatorMath.getMetersPerPixel) {
      return MercatorMath.getMetersPerPixel(lat, zoom);
    }
    const latRad = this.clampLat(lat) * Math.PI / 180;
    return 156543.03392 * Math.cos(latRad) / Math.pow(2, zoom);
  }

  static cameraPixelDistance(first, second, zoom, tileSize = 256) {
    if (typeof MercatorMath !== 'undefined' && MercatorMath.cameraPixelDistance) {
      return MercatorMath.cameraPixelDistance(first, second, zoom, tileSize);
    }
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

  static camerasEquivalent(first, second, options = {}) {
    if (typeof MercatorMath !== 'undefined' && MercatorMath.camerasEquivalent) {
      return MercatorMath.camerasEquivalent(first, second, options);
    }
    if (!first || !second) return false;
    const zoomTolerance = options.zoomTolerance === undefined ? 0.001 : options.zoomTolerance;
    if (Math.abs((Number(first.zoom) || 0) - (Number(second.zoom) || 0)) > zoomTolerance) return false;
    const pixelTolerance = options.pixelTolerance === undefined ? 0.5 : options.pixelTolerance;
    const zoom = Math.max(Number(first.zoom) || 0, Number(second.zoom) || 0);
    return this.cameraPixelDistance(first, second, zoom, options.tileSize || 256) <= pixelTolerance;
  }

  /**
   * Calculates camera anchor coordinates that guarantee linear, non-slingshot
   * screen-space velocity when interpolating between two zoom levels.
   */
  static screenSpaceTrajectoryPoint(start, end, progress, options = {}) {
    const mapSize = options.mapSize || 268435456;
    const startLng = start.lng !== undefined ? start.lng : (start.lon || 0);
    const endLng = end.lng !== undefined ? end.lng : (end.lon || 0);
    const z1 = Number(start.zoom) || 0;
    const z2 = Number(end.zoom) || 0;

    const w1 = this.latLngToWorldPoint(start.lat, startLng, 0, mapSize);
    const w2 = this.latLngToWorldPoint(end.lat, endLng, 0, mapSize);

    const u = Math.max(0, Math.min(1, progress));
    const currentZoom = options.currentZoom !== undefined ? options.currentZoom : (z1 + u * (z2 - z1));
    const curScale = Math.pow(2, currentZoom);

    // Shortest-path longitudinal wrap (avoids 350-degree round-the-world flights)
    let dx = w2.x - w1.x;
    if (dx > mapSize / 2) dx -= mapSize;
    else if (dx < -mapSize / 2) dx += mapSize;
    const dy = w2.y - w1.y;

    const dz = z2 - z1;
    const uZoom = Math.abs(dz) > 0.001
      ? Math.max(0, Math.min(1, (currentZoom - z1) / dz))
      : Math.max(0, Math.min(1, progress));

    let x, y;
    if (z2 > z1 + 0.2) {
      const s1 = Math.pow(2, z1);
      const factor = (s1 / curScale) * (1 - uZoom);
      x = w2.x - dx * factor;
      y = w2.y - dy * factor;
    } else if (z2 < z1 - 0.2) {
      const s2 = Math.pow(2, z2);
      const factor = (s2 / curScale) * uZoom;
      x = w1.x + dx * factor;
      y = w1.y + dy * factor;
    } else {
      x = w1.x + dx * uZoom;
      y = w1.y + dy * uZoom;
    }

    x = ((x % mapSize) + mapSize) % mapSize;

    const latLng = this.worldPointToLatLng(x, y, 0, mapSize);
    return {
      lat: latLng.lat,
      lng: latLng.lng,
      x,
      y,
      zoom: currentZoom
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MercatorProjection;
}
if (typeof window !== 'undefined') {
  window.MercatorProjection = MercatorProjection;
}
