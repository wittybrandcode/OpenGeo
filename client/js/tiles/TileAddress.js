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
      wrappedX,
      y,
      z,
      tileX: x,
      tileY: y,
      key: `${z}/${wrappedX}/${y}`
    }, extra);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = TileAddress;
else if (typeof window !== 'undefined') window.TileAddress = TileAddress;
