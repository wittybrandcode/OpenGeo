/** Compatibility facade. Coverage ownership lives in CoveragePlanner. */
class TileGrid {
  static latLngToTile(lat, lng, zoom, tileSize = 256) {
    const world = MercatorProjection.latLngToWorldPoint(lat, lng, zoom, tileSize);
    return { x: Math.floor(world.x / tileSize), y: Math.floor(world.y / tileSize), z: zoom };
  }

  static tileToLatLng(x, y, zoom, tileSize = 256) {
    return MercatorProjection.worldPointToLatLng(x * tileSize, y * tileSize, zoom, tileSize);
  }

  static getVisibleTiles(viewport) { return CoveragePlanner.planViewport(viewport); }

  static getCompVisibleTiles(lat, lon, compZoom, compWidth, compHeight, downloadZoom) {
    return CoveragePlanner.planComposition(
      { lat, lon, zoom: compZoom },
      { width: compWidth, height: compHeight, downloadZoom, tileSize: 256 }
    );
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = TileGrid;
else if (typeof window !== 'undefined') window.TileGrid = TileGrid;
