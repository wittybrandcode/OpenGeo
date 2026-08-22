class GeoJSONValidator {
  constructor(limits = {}) {
    this.limits = Object.assign({
      maxBytes: 10 * 1024 * 1024,
      maxFeatures: 5000,
      maxPoints: 100000,
      maxDepth: 12,
      maxStringLength: 512
    }, limits);
  }

  parse(input, options = {}) {
    const sourceBytes = Number(options.sourceBytes) || (typeof input === 'string' ? input.length : 0);
    if (sourceBytes > this.limits.maxBytes) return this._failure('GEOJSON_TOO_LARGE', `GeoJSON exceeds the ${this._formatMb(this.limits.maxBytes)} MB limit.`);
    let data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); }
      catch (error) { return this._failure('GEOJSON_PARSE_ERROR', 'GeoJSON contains invalid JSON.'); }
    }
    if (!data || typeof data !== 'object') return this._failure('GEOJSON_INVALID_ROOT', 'GeoJSON root must be an object.');

    const stats = { features: 0, points: 0, maxDepth: 0 };
    try {
      const features = this._normalizeRoot(data, stats);
      return { ok: true, data, features, stats };
    } catch (error) {
      return this._failure(error.code || 'GEOJSON_INVALID', error.message || 'Invalid GeoJSON.');
    }
  }

  _normalizeRoot(data, stats) {
    if (data.type === 'FeatureCollection') {
      if (!Array.isArray(data.features)) this._throw('GEOJSON_FEATURES_REQUIRED', 'FeatureCollection.features must be an array.');
      if (data.features.length > this.limits.maxFeatures) this._throw('GEOJSON_FEATURE_LIMIT', `GeoJSON exceeds ${this.limits.maxFeatures} features.`);
      for (let index = 0; index < data.features.length; index++) this._validateFeature(data.features[index], stats, 1);
      return data.features;
    }
    if (data.type === 'Feature') {
      this._validateFeature(data, stats, 1);
      return [data];
    }
    this._validateGeometry(data, stats, 1);
    stats.features = 1;
    return [{ type: 'Feature', properties: {}, geometry: data }];
  }

  _validateFeature(feature, stats, depth) {
    this._checkDepth(depth, stats);
    if (!feature || feature.type !== 'Feature') this._throw('GEOJSON_FEATURE_INVALID', 'Every collection item must be a GeoJSON Feature.');
    stats.features++;
    if (stats.features > this.limits.maxFeatures) this._throw('GEOJSON_FEATURE_LIMIT', `GeoJSON exceeds ${this.limits.maxFeatures} features.`);
    if (feature.geometry !== null) this._validateGeometry(feature.geometry, stats, depth + 1);
    if (feature.properties !== undefined && feature.properties !== null) this._validateMetadata(feature.properties, depth + 1, stats);
  }

  _validateGeometry(geometry, stats, depth) {
    this._checkDepth(depth, stats);
    if (!geometry || typeof geometry.type !== 'string') this._throw('GEOJSON_GEOMETRY_INVALID', 'Feature geometry is missing or invalid.');
    const type = geometry.type;
    if (type === 'GeometryCollection') {
      if (!Array.isArray(geometry.geometries)) this._throw('GEOJSON_GEOMETRIES_REQUIRED', 'GeometryCollection.geometries must be an array.');
      for (let index = 0; index < geometry.geometries.length; index++) this._validateGeometry(geometry.geometries[index], stats, depth + 1);
      return;
    }
    const coordinateDepth = { Point: 1, MultiPoint: 2, LineString: 2, MultiLineString: 3, Polygon: 3, MultiPolygon: 4 }[type];
    if (!coordinateDepth) this._throw('GEOJSON_GEOMETRY_UNSUPPORTED', `Unsupported GeoJSON geometry type: ${type}.`);
    this._validateCoordinates(geometry.coordinates, coordinateDepth, stats, depth + 1, type);
    this._validateCardinality(type, geometry.coordinates);
  }

  _validateCoordinates(value, coordinateDepth, stats, depth, geometryType) {
    this._checkDepth(depth, stats);
    if (!Array.isArray(value)) this._throw('GEOJSON_COORDINATES_INVALID', `${geometryType} coordinates must be arrays.`);
    if (coordinateDepth === 1) {
      if (value.length < 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) this._throw('GEOJSON_COORDINATE_NOT_FINITE', 'Every coordinate must contain finite longitude and latitude values.');
      if (value[0] < -180 || value[0] > 180 || value[1] < -90 || value[1] > 90) this._throw('GEOJSON_COORDINATE_RANGE', 'GeoJSON longitude/latitude is outside the valid range.');
      stats.points++;
      if (stats.points > this.limits.maxPoints) this._throw('GEOJSON_POINT_LIMIT', `GeoJSON exceeds ${this.limits.maxPoints} coordinate points.`);
      return;
    }
    if (value.length === 0) this._throw('GEOJSON_COORDINATES_EMPTY', `${geometryType} contains an empty coordinate array.`);
    for (let index = 0; index < value.length; index++) this._validateCoordinates(value[index], coordinateDepth - 1, stats, depth + 1, geometryType);
  }

  _validateCardinality(type, coordinates) {
    if (type === 'LineString' && coordinates.length < 2) this._throw('GEOJSON_LINE_TOO_SHORT', 'LineString requires at least two points.');
    if (type === 'MultiLineString') for (const line of coordinates) if (line.length < 2) this._throw('GEOJSON_LINE_TOO_SHORT', 'Every MultiLineString path requires at least two points.');
    const polygons = type === 'Polygon' ? [coordinates] : (type === 'MultiPolygon' ? coordinates : []);
    for (const polygon of polygons) for (const ring of polygon) {
      if (ring.length < 4) this._throw('GEOJSON_RING_TOO_SHORT', 'Polygon rings require at least four points.');
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) this._throw('GEOJSON_RING_OPEN', 'Polygon rings must be closed.');
    }
  }

  _validateMetadata(value, depth, stats) {
    this._checkDepth(depth, stats);
    if (typeof value === 'string') {
      if (value.length > this.limits.maxStringLength) this._throw('GEOJSON_STRING_LIMIT', `GeoJSON text exceeds ${this.limits.maxStringLength} characters.`);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) this._validateMetadata(value[index], depth + 1, stats);
      return;
    }
    for (const key of Object.keys(value)) {
      if (key.length > this.limits.maxStringLength) this._throw('GEOJSON_STRING_LIMIT', 'GeoJSON property name is too long.');
      this._validateMetadata(value[key], depth + 1, stats);
    }
  }

  _checkDepth(depth, stats) {
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    if (depth > this.limits.maxDepth) this._throw('GEOJSON_DEPTH_LIMIT', `GeoJSON nesting exceeds ${this.limits.maxDepth} levels.`);
  }

  _throw(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }

  _failure(code, message) {
    return { ok: false, error: { code, message } };
  }

  _formatMb(bytes) {
    return Math.round(bytes / (1024 * 1024));
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = GeoJSONValidator;
else if (typeof window !== 'undefined') window.GeoJSONValidator = GeoJSONValidator;
