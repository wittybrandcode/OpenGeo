/** Canonical tile identity separates wrapped network/cache X from world-placement X. */
class TileAddress {
  static wrapX(x, z) {
    const count = Math.pow(2, z);
    return ((x % count) + count) % count;
  }

  static create(x, y, z, extra = {}) {
    const wrappedX = TileAddress.wrapX(x, z);
    return Object.assign({
      x,
      unwrappedX: x,
      wrappedX,
      y,
      z,
      tileX: x,
      tileY: y
    }, extra);
  }

  static downloadKey(providerSignature, tileMatrix, sourceTileSize, z, wrappedX, y) {
    return [
      TileAddress._identityPart(providerSignature || 'default'),
      TileAddress._identityPart(tileMatrix || 'webMercator'),
      TileAddress._positiveInteger(sourceTileSize, 256),
      TileAddress._integer(z),
      TileAddress.wrapX(TileAddress._integer(wrappedX), TileAddress._integer(z)),
      TileAddress._integer(y)
    ].join('/');
  }

  static placementKey(tileMatrix, sourceTileSize, z, unwrappedX, y) {
    return [
      TileAddress._identityPart(tileMatrix || 'webMercator'),
      TileAddress._positiveInteger(sourceTileSize, 256),
      TileAddress._integer(z),
      TileAddress._integer(unwrappedX),
      TileAddress._integer(y)
    ].join('/');
  }

  static withIdentity(tile, options = {}) {
    if (!tile || typeof tile !== 'object') throw new Error('Tile identity requires a tile object.');
    const z = TileAddress._integer(tile.z);
    const y = TileAddress._integer(tile.y);
    const unwrappedX = Number.isFinite(tile.unwrappedX)
      ? TileAddress._integer(tile.unwrappedX)
      : (Number.isFinite(tile.tileX) ? TileAddress._integer(tile.tileX) : TileAddress._integer(tile.x));
    const wrappedX = Number.isFinite(tile.wrappedX)
      ? TileAddress.wrapX(TileAddress._integer(tile.wrappedX), z)
      : TileAddress.wrapX(unwrappedX, z);
    const tileMatrix = options.tileMatrix || tile.tileMatrix || 'webMercator';
    const sourceTileSize = TileAddress._positiveInteger(
      options.sourceTileSize || tile.sourceTileSize,
      256
    );
    const providerSignature = options.providerSignature || tile.providerSignature || 'default';
    return Object.assign({}, tile, {
      x: unwrappedX,
      unwrappedX,
      wrappedX,
      y,
      z,
      tileX: unwrappedX,
      tileY: y,
      tileMatrix,
      sourceTileSize,
      downloadKey: TileAddress.downloadKey(providerSignature, tileMatrix, sourceTileSize, z, wrappedX, y),
      placementKey: TileAddress.placementKey(tileMatrix, sourceTileSize, z, unwrappedX, y)
    });
  }

  static _identityPart(value) {
    return encodeURIComponent(String(value || 'default'));
  }

  static _integer(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error('Tile identity contains a non-finite coordinate.');
    return Math.trunc(parsed);
  }

  static _positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = TileAddress;
else if (typeof window !== 'undefined') window.TileAddress = TileAddress;
