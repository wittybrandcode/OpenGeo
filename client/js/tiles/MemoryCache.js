class MemoryCache {
  constructor(options = {}) {
    this.maxMemory = options.memoryLimit || 200;
    this.memory = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  static computeKey(x, y, z, source) {
    return CachePolicy.memoryKey(source, x, y, z);
  }

  get(key) {
    if (this.memory.has(key)) {
      const data = this.memory.get(key);
      this.memory.delete(key);
      this.memory.set(key, data);
      this.hits++;
      return data;
    }
    this.misses++;
    return null;
  }

  set(key, data) {
    if (this.memory.has(key)) {
      this.memory.delete(key);
    } else if (this.memory.size >= this.maxMemory) {
      const oldestKey = this.memory.keys().next().value;
      if (oldestKey) this.memory.delete(oldestKey);
    }
    this.memory.set(key, data);
  }

  has(key) {
    return this.memory.has(key);
  }

  delete(key) {
    this.memory.delete(key);
  }

  clear() {
    this.memory.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    return {
      size: this.memory.size,
      max: this.maxMemory,
      hits: this.hits,
      misses: this.misses,
      ratio: this.hits / (this.hits + this.misses || 1)
    };
  }
}
