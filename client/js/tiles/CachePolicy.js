/** Canonical cache/render identity shared by preview and Finalize adapters. */
class CachePolicy {
  static memoryKey(sourceSignature, x, y, z) {
    const wrappedX = TileAddress.wrapX(x, z);
    return `${CachePolicy.sanitizeNamespace(sourceSignature)}/${z}/${wrappedX}/${y}`;
  }

  static renderKey(sourceSignature, tile) {
    const worldX = Number.isFinite(tile.tileX) ? tile.tileX : tile.x;
    const worldY = Number.isFinite(tile.tileY) ? tile.tileY : tile.y;
    return `${CachePolicy.sanitizeNamespace(sourceSignature)}/${tile.z}/${worldX}/${worldY}`;
  }

  static diskFilename(sourceSignature, tile, extension) {
    const ext = /^\.[a-z0-9]+$/i.test(extension || '') ? extension : '.png';
    const wrappedX = tile.wrappedX !== undefined ? tile.wrappedX : TileAddress.wrapX(tile.x, tile.z);
    return `tile_${CachePolicy.sanitizeNamespace(sourceSignature)}_${tile.z}_${wrappedX}_${tile.y}${ext}`;
  }

  static sanitizeNamespace(value) {
    return String(value || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = CachePolicy;
else if (typeof window !== 'undefined') window.CachePolicy = CachePolicy;
