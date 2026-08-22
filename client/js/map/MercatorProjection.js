class MercatorProjection {
  static clampLat(lat) {
    return Math.max(-85.05112878, Math.min(85.05112878, Number(lat) || 0));
  }

  static normalizeLng(lng) {
    return ((((Number(lng) || 0) + 180) % 360) + 360) % 360 - 180;
  }

  static getWorldSize(zoom, tileSize = 256) {
    return Math.pow(2, zoom) * tileSize;
  }

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

  static worldPointToLatLng(px, py, zoom, tileSize = 256) {
    const size = this.getWorldSize(zoom, tileSize);
    const lng = this.normalizeLng((px / size) * 360 - 180);
    const safeY = Math.max(0, Math.min(size, py));
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * safeY / size))) * 180 / Math.PI;
    return { lat: this.clampLat(lat), lng: lng };
  }

  static getMetersPerPixel(lat, zoom) {
    const latRad = this.clampLat(lat) * Math.PI / 180;
    return 156543.03392 * Math.cos(latRad) / Math.pow(2, zoom);
  }

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

  static camerasEquivalent(first, second, options = {}) {
    if (!first || !second) return false;
    const zoomTolerance = options.zoomTolerance === undefined ? 0.001 : options.zoomTolerance;
    if (Math.abs((Number(first.zoom) || 0) - (Number(second.zoom) || 0)) > zoomTolerance) return false;
    const pixelTolerance = options.pixelTolerance === undefined ? 0.5 : options.pixelTolerance;
    const zoom = Math.max(Number(first.zoom) || 0, Number(second.zoom) || 0);
    return this.cameraPixelDistance(first, second, zoom, options.tileSize || 256) <= pixelTolerance;
  }
}
