/**
 * OpenGeo — GeometryMemoryCache (Repository Cache Delegate)
 *
 * Manages in-memory storage, metadata access tracking,
 * and deduplication of pending asynchronous dataset loads.
 */

class GeometryMemoryCache {
  constructor() {
    this.cache = new Map();
    this.cacheMeta = new Map();
    this.pendingLoads = new Map();
  }

  has(key) {
    return this.cache.has(key);
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, data, bytes) {
    this.cache.set(key, data);
    this.cacheMeta.set(key, {
      bytes: Number(bytes) || 0,
      loadedAt: Date.now(),
      lastAccess: Date.now()
    });
  }

  touch(key) {
    const meta = this.cacheMeta.get(key);
    if (meta) {
      meta.lastAccess = Date.now();
    }
  }

  delete(key) {
    this.cacheMeta.delete(key);
    return this.cache.delete(key);
  }

  hasPending(key) {
    return this.pendingLoads.has(key);
  }

  getPending(key) {
    return this.pendingLoads.get(key);
  }

  setPending(key, promise) {
    this.pendingLoads.set(key, promise);
  }

  deletePending(key) {
    this.pendingLoads.delete(key);
  }

  getStats() {
    let bytes = 0;
    for (const metadata of this.cacheMeta.values()) {
      bytes += Number(metadata.bytes) || 0;
    }
    return {
      entries: this.cache.size,
      pending: this.pendingLoads.size,
      sourceBytes: bytes
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeometryMemoryCache;
}
if (typeof window !== 'undefined') {
  window.GeometryMemoryCache = GeometryMemoryCache;
}
