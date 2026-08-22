class GeoDataRepository {
  constructor() {
    try {
      this.fs = typeof require !== 'undefined' ? require('fs') : null;
      this.path = typeof require !== 'undefined' ? require('path') : null;
    } catch (e) {
      this.fs = null;
      this.path = null;
    }
    this.cache = new Map();
    this.cacheMeta = new Map();
    this.pendingLoads = new Map();
    this.dataDir = this._getDataDir();
  }

  _getDataDir() {
    if (!this.path) return null;
    try {
      const cs = typeof CSInterface !== 'undefined' ? new CSInterface() : new window.CSInterface();
      const extUri = cs.getSystemPath(window.SystemPath.EXTENSION);
      let extPath = extUri.replace(/^file:\/{2,3}/, '');
      extPath = decodeURIComponent(extPath);
      return this.path.join(extPath, 'client', 'assets', 'data').replace(/\\/g, '/');
    } catch(e) {
      return this.path.resolve(__dirname, '../../assets/data').replace(/\\/g, '/');
    }
  }

  _resolveDataFile(filename) {
    if (!filename || !this.path || !this.dataDir) return null;
    const root = this.path.resolve(this.dataDir);
    const candidate = this.path.resolve(root, filename);
    const normalizedRoot = (root + this.path.sep).toLowerCase();
    const normalizedCandidate = candidate.toLowerCase();
    return normalizedCandidate.indexOf(normalizedRoot) === 0 ? candidate : null;
  }

  /**
   * Loads a GeoJSON dataset into memory (cached).
   */
  loadDataset(filename) {
    if (!filename || !this.fs || !this.path || !this.dataDir) return null;
    if (this.cache.has(filename)) {
      return this.cache.get(filename);
    }

    const fullPath = this._resolveDataFile(filename);
    if (!fullPath) {
      console.error(`[GeoDataRepository] Rejected unsafe dataset path: ${filename}`);
      return null;
    }
    if (!this.fs.existsSync(fullPath)) {
      console.error(`[GeoDataRepository] Dataset not found: ${fullPath}`);
      return null;
    }

    try {
      const dataStr = this.fs.readFileSync(fullPath, 'utf8');
      const data = JSON.parse(dataStr);
      this.cache.set(filename, data);
      this.cacheMeta.set(filename, { bytes: dataStr.length, loadedAt: Date.now(), lastAccess: Date.now() });
      return data;
    } catch (e) {
      console.error(`[GeoDataRepository] Failed to parse ${filename}:`, e);
      return null;
    }
  }

  /**
   * Non-blocking filesystem read for preview datasets. Parsing is kept below
   * the frame budget by feeding this method indexed chunks instead of the
   * former monolithic 10m document.
   */
  loadDatasetAsync(filename, options = {}) {
    if (!filename || !this.fs || !this.path || !this.dataDir) return Promise.resolve(null);
    if (this.cache.has(filename)) {
      const metadata = this.cacheMeta.get(filename);
      if (metadata) metadata.lastAccess = Date.now();
      return Promise.resolve(this.cache.get(filename));
    }
    if (this.pendingLoads.has(filename)) return this.pendingLoads.get(filename);

    const fullPath = this._resolveDataFile(filename);
    if (!fullPath) return Promise.resolve(null);
    const maxBytes = Number(options.maxBytes) || 4 * 1024 * 1024;
    const promise = new Promise(resolve => {
      this.fs.stat(fullPath, (statError, stats) => {
        if (statError || !stats || !stats.isFile() || stats.size > maxBytes) {
          if (stats && stats.size > maxBytes) console.warn(`[GeoDataRepository] Dataset chunk exceeds ${maxBytes} bytes: ${filename}`);
          resolve(null);
          return;
        }
        this.fs.readFile(fullPath, 'utf8', (readError, dataStr) => {
          if (readError) {
            console.error(`[GeoDataRepository] Failed to read ${filename}:`, readError);
            resolve(null);
            return;
          }
          try {
            const data = JSON.parse(dataStr);
            this.cache.set(filename, data);
            this.cacheMeta.set(filename, { bytes: stats.size, loadedAt: Date.now(), lastAccess: Date.now() });
            resolve(data);
          } catch (parseError) {
            console.error(`[GeoDataRepository] Failed to parse ${filename}:`, parseError);
            resolve(null);
          }
        });
      });
    });
    const trackedPromise = promise.then(value => {
      this.pendingLoads.delete(filename);
      return value;
    }, error => {
      this.pendingLoads.delete(filename);
      throw error;
    });
    this.pendingLoads.set(filename, trackedPromise);
    return trackedPromise;
  }

  unloadDataset(filename) {
    if (!filename) return false;
    this.cacheMeta.delete(filename);
    return this.cache.delete(filename);
  }

  getCacheStats() {
    let bytes = 0;
    for (const metadata of this.cacheMeta.values()) bytes += Number(metadata.bytes) || 0;
    return { entries: this.cache.size, pending: this.pendingLoads.size, sourceBytes: bytes };
  }

  /**
   * Returns one semantic layer from a v2 vector package. Older datasets keep
   * their single `features` collection so existing callers remain compatible.
   */
  getDatasetLayer(dataset, layerName) {
    if (!dataset) return [];
    if (dataset.layers) {
      if (layerName && dataset.layers[layerName] && Array.isArray(dataset.layers[layerName].features)) return dataset.layers[layerName].features;
      return [];
    }
    if (layerName && layerName !== 'land') return [];
    return Array.isArray(dataset.features) ? dataset.features : [];
  }

  /**
   * Resolves the exact local 10m land perimeter of one country. This is the
   * exterior of its land polygon: international borders plus its coastline.
   * It deliberately excludes holes, EEZ, and every maritime-political line.
   */
  getCountryOutline(countryCode) {
    const code = String(countryCode || '').trim().toUpperCase();
    if (!code) return null;
    const index = this.loadDataset('vectors/country-index-10m.json');
    const outlines = this.loadDataset('vectors/country-outlines-10m.json');
    if (!index || !index.countries || !outlines || !Array.isArray(outlines.features)) return null;
    const iso3 = index.countries[code] ? code : (index.iso2ToIso3 && index.iso2ToIso3[code]);
    const country = iso3 && index.countries[iso3];
    if (!country) return null;
    const byId = {};
    for (let featureIndex = 0; featureIndex < outlines.features.length; featureIndex++) {
      const feature = outlines.features[featureIndex];
      if (feature && feature.id) byId[feature.id] = feature;
    }
    const features = [];
    const ids = Array.isArray(country.outlineIds) ? country.outlineIds : [];
    for (let idIndex = 0; idIndex < ids.length; idIndex++) {
      const feature = byId[ids[idIndex]];
      if (feature && feature.type === 'CountryLandOutline' && feature.isClosed === true) features.push(feature);
    }
    return { country: country, features: features };
  }

  /**
   * Normalizes Arabic text by removing Tashkeel and Tatweel for better search matching.
   */
  normalizeArabic(text) {
    if (!text) return '';
    return text
      .replace(/[\u064B-\u065F\u0670]/g, '') // Remove Tashkeel (harakat)
      .replace(/ـ/g, '') // Remove Tatweel (kashida)
      .replace(/[أإآا]/g, 'ا') // Normalize Alifs
      .replace(/ة/g, 'ه') // Normalize Ta Marbuta
      .replace(/ى/g, 'ي') // Normalize Alef Maksura
      .toLowerCase()
      .trim();
  }

  /**
   * Adapter for the internal Mercator feature dataset. It returns a new view
   * and never mutates the cached source feature.
   */
  fromInternalMercatorFeature(feature) {
    if (!feature || !Array.isArray(feature.rings)) return null;
    return { rings: feature.rings, feature: feature };
  }

  /** Adapter for standard GeoJSON Features without changing their geometry. */
  fromGeoJsonFeature(feature) {
    if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) return null;
    return { coordinates: feature.geometry.coordinates, feature: feature };
  }

  computeMercatorRingsBBox(rings) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
      const ring = rings[ringIndex];
      for (let pointIndex = 0; ring && pointIndex < ring.length; pointIndex++) {
        const point = ring[pointIndex];
        if (!point || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
        if (point[0] < minX) minX = point[0];
        if (point[0] > maxX) maxX = point[0];
        if (point[1] < minY) minY = point[1];
        if (point[1] > maxY) maxY = point[1];
      }
    }
    return { minX, minY, maxX, maxY };
  }

  _computeCoordinatesBBox(coordinates) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const visit = (value) => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) return;
        minX = Math.min(minX, value[0]);
        minY = Math.min(minY, value[1]);
        maxX = Math.max(maxX, value[0]);
        maxY = Math.max(maxY, value[1]);
        return;
      }
      for (let i = 0; i < value.length; i++) visit(value[i]);
    };
    visit(coordinates);
    return { minX, minY, maxX, maxY };
  }

  /** Calculates a bbox for either internal Mercator or any GeoJSON geometry. */
  _calculateFeatureBBox(feature) {
    const mercator = this.fromInternalMercatorFeature(feature);
    if (mercator) return this.computeMercatorRingsBBox(mercator.rings);
    const geoJson = this.fromGeoJsonFeature(feature);
    return geoJson ? this._computeCoordinatesBBox(geoJson.coordinates) : { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  }

  /**
   * Checks if two bounding boxes intersect.
   */
  _intersects(bbox1, bbox2) {
    if (!bbox1 || !bbox2) return false;
    return !(bbox2.minX > bbox1.maxX || 
             bbox2.maxX < bbox1.minX || 
             bbox2.minY > bbox1.maxY || 
             bbox2.maxY < bbox1.minY);
  }

  /**
   * Queries the dataset with spatial filtering and advanced search.
   * @param {Object} options 
   * @param {string} options.dataset - Runtime data path (e.g., 'vectors/country-outlines-10m.json')
   * @param {string} [options.searchTerm] - Optional text to search for (country name, ISO code)
   * @param {string} [options.layer] - Optional semantic layer in a v2 vector package
   * @param {Object} [options.bbox] - Optional bounding box { minX, minY, maxX, maxY } to filter features spatially
   * @returns {Array} Array of matched GeoJSON features
   */
  query(options) {
    const { dataset, layer, searchTerm, bbox } = options || {};
    const geoData = this.loadDataset(dataset);
    if (!geoData) return [];

    let results = this.getDatasetLayer(geoData, layer);

    // 1. Spatial Filtering (Bounding Box Intersection)
    if (bbox) {
      results = results.filter(f => {
        const featureBBox = this._calculateFeatureBBox(f);
        return Number.isFinite(featureBBox.minX) && this._intersects(featureBBox, bbox);
      });
    }

    // 2. Text Search Filtering
    if (searchTerm) {
      const termNormalized = this.normalizeArabic(searchTerm);
      const exactMatches = [];
      const partialMatches = [];

      for (const f of results) {
        const iso2 = (f.iso2 || '').toLowerCase();
        const iso3 = (f.iso3 || '').toLowerCase();
        const name = this.normalizeArabic(f.name || '');
        const nameLong = this.normalizeArabic(f.nameLong || '');
        const nameAr = this.normalizeArabic(f.nameAr || '');

        // Exact match scoring (100)
        if (
          iso2 === termNormalized || 
          iso3 === termNormalized || 
          name === termNormalized ||
          nameLong === termNormalized ||
          (nameAr && nameAr === termNormalized)
        ) {
          exactMatches.push(f);
          continue;
        }

        // Partial match scoring (50)
        if (
          name.includes(termNormalized) || 
          nameLong.includes(termNormalized) ||
          (nameAr && nameAr.includes(termNormalized))
        ) {
          partialMatches.push(f);
        }
      }

      // Return exact matches first, then partial matches
      results = [...exactMatches, ...partialMatches];
    }

    return results;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeoDataRepository;
} else if (typeof window !== 'undefined') {
  window.GeoDataRepository = GeoDataRepository;
}
