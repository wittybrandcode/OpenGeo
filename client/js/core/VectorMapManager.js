/**
 * Local high-detail country-outline drawing service.
 * Search → Draw is intentionally the only entry point. It never fetches or
 * renders OSM polygons: each AE path comes from the local Natural Earth 10m
 * source's country exterior rings. The result includes the coastline that
 * bounds the country's land, never EEZ or maritime-political boundaries.
 */
class VectorMapManager {
  constructor(app) {
    this.app = app;
    this.fs = require('fs');
    this._unsubscribeDraw = typeof globalEventBus !== 'undefined'
      ? globalEventBus.on('search:drawCountryOutline', data => this.drawCountryOutlineFromSearch(data))
      : null;
  }

  async drawCountryOutlineFromSearch(data) {
    if (!this.app.geoDataRepository) {
      globalEventBus.emit('toast:show', { message: 'Local country-outline data is unavailable.', type: 'error' });
      return;
    }

    const resolved = this.app.geoDataRepository.getCountryOutline(data && data.countryCode);
    if (!resolved || !resolved.country) {
      globalEventBus.emit('toast:show', { message: 'This search result has no supported local country identity.', type: 'error' });
      return;
    }
    if (!resolved.features.length) {
      globalEventBus.emit('toast:show', { message: `${resolved.country.name} has no local land outline.`, type: 'info' });
      return;
    }

    const vectorLimits = this._validateVectorComplexity(resolved.features);
    if (!vectorLimits.ok) {
      globalEventBus.emit('toast:show', { message: vectorLimits.message, type: 'error', duration: 6000 });
      return;
    }

    const countryName = resolved.country.nameAr || resolved.country.name || resolved.country.nameLong || resolved.country.iso3;
    const layerName = String(countryName);
    const featureSignature = this._getFeatureSignature(resolved.country, resolved.features);
    const labelPoint = resolved.country.label || null;
    const labelLatLng = labelPoint ? this._worldPointToLatLng(labelPoint[0], labelPoint[1]) : null;
    const payload = {
      dataset: 'vectors/country-outlines-10m.json',
      selectionRule: 'country exterior rings only (international land borders + coastline; no EEZ)',
      layerName: layerName,
      displayName: layerName,
      featureId: `country-${resolved.country.iso3}`,
      sourceId: resolved.country.iso3,
      featureSignature: featureSignature,
      anchor: labelLatLng ? { lat: labelLatLng.lat, lng: labelLatLng.lng, point: labelPoint } : null,
      strokeWidth: 3,
      strokeColor: [1.0, 0.8, 0.2, 1.0],
      fillOpacity: 0,
      features: resolved.features,
      layers: [{
        id: 'country-outline',
        title: 'COUNTRY OUTLINE',
        isClosed: true,
        features: resolved.features,
        fillOpacity: 0,
        strokeOpacity: 100
      }],
      labels: resolved.country.label ? [{ name: layerName, point: resolved.country.label }] : []
    };

    const activeMapCompId = this.app.compositionController
      ? await this.app.compositionController.resolveActiveMapTarget()
      : this.app.activeCompId;
    if (!activeMapCompId) {
      if (this.app.featureManager) await this.app.featureManager.registerPreview(payload, 'country');
      globalEventBus.emit('toast:show', { message: `${layerName} added as a preview map. Create a composition to draw it in AE.`, type: 'info', duration: 5000 });
      globalEventBus.emit('ui:status', { message: 'Country outline preview only — no active Map composition.', isError: false });
      return { previewOnly: true, featureId: payload.featureId };
    }

    try {
      globalEventBus.emit('ui:status', { message: `Preparing local 10m country outline for ${layerName}...`, isError: false });
      await new Promise(resolve => setTimeout(resolve, 0));
      globalEventBus.emit('ui:status', { message: `Drawing local 10m country outline for ${layerName}...`, isError: false });
      if (!this.app.featureManager) throw new Error('FeatureManager is missing.');
      const result = await this.app.featureManager.drawPayloadInAE(payload, 'country');
      if (result.registryDeferred) {
        globalEventBus.emit('toast:show', { message: `${layerName} was drawn in the original composition. Reopen it to refresh Layers.`, type: 'info', duration: 6000 });
        return result;
      }
      globalEventBus.emit('toast:show', { message: `${layerName}: ${resolved.features.length} local country-outline paths created.`, type: 'success' });
      globalEventBus.emit('ui:status', { message: 'Local country outline complete.', isError: false });
      return result;
    } catch (error) {
      globalEventBus.emit('toast:show', { message: `Failed to draw local country outline: ${error.message}`, type: 'error' });
      throw error;
    }
  }

  /**
   * Draws an already validated GeoJSON document into the active OpenGeo map
   * composition. Preview ownership stays in GeoJSONLayer; this method owns
   * only the bounded, temporary-file-backed AE transaction.
   */
  async drawGeoJSONInAE(validation, fileInfo = {}) {
    if (!this.app.activeCompId) {
      const error = new Error('Create a Map composition before drawing GeoJSON in After Effects.');
      error.code = 'GEOJSON_COMP_REQUIRED';
      throw error;
    }
    if (!validation || !validation.ok || !Array.isArray(validation.features)) {
      const error = new Error('GeoJSON must pass validation before it can be drawn in After Effects.');
      error.code = 'GEOJSON_VALIDATION_REQUIRED';
      throw error;
    }
    if (!this.app.featureManager) throw new Error('FeatureManager is missing.');

    const payload = this._buildGeoJSONPayload(validation, fileInfo.name || 'GeoJSON');
    await new Promise(resolve => setTimeout(resolve, 0));
    const result = await this.app.featureManager.drawPayloadInAE(payload, 'geojson');
    return Object.assign({ layerName: payload.layerName }, result || {});
  }

  _buildGeoJSONPayload(validation, fileName) {
    const layerName = this._getGeoJSONLayerName(fileName);
    // Content participates in identity: two different uploads with the same
    // filename remain independently manageable, while re-importing the exact
    // same document replaces its own AE feature atomically.
    const identityMaterial = `${layerName.toLowerCase()}|${JSON.stringify(validation.data || validation.features)}`;
    const featureSignature = `geojson-${this._hashText(identityMaterial)}`;
    const groups = { polygons: [], lines: [], points: [] };
    for (let index = 0; index < validation.features.length; index++) {
      const feature = validation.features[index];
      if (feature && feature.geometry) this._collectGeoJSONGeometry(feature.geometry, groups);
    }

    const layers = [];
    if (groups.polygons.length) {
      layers.push({
        id: 'geojson-polygons', title: 'POLYGONS', isClosed: true,
        features: [{ id: 'geojson-polygons', name: 'Polygons', isClosed: true, rings: groups.polygons }],
        fillOpacity: 15, strokeOpacity: 100
      });
    }
    if (groups.lines.length) {
      layers.push({
        id: 'geojson-lines', title: 'LINES', isClosed: false,
        features: [{ id: 'geojson-lines', name: 'Lines', isClosed: false, rings: groups.lines }],
        fillOpacity: 0, strokeOpacity: 100
      });
    }
    if (groups.points.length) {
      layers.push({
        id: 'geojson-points', title: 'POINTS', isClosed: true,
        features: [{ id: 'geojson-points', name: 'Points', isClosed: true, rings: groups.points }],
        fillOpacity: 100, strokeOpacity: 100
      });
    }
    if (!layers.length) {
      const error = new Error('GeoJSON contains no drawable geometry.');
      error.code = 'GEOJSON_GEOMETRY_EMPTY';
      throw error;
    }

    const payload = {
      dataset: 'uploaded-geojson',
      selectionRule: 'validated GeoJSON projected to OpenGeo Web Mercator',
      sourceName: String(fileName || 'GeoJSON').slice(0, 512),
      sourceId: String(fileName || 'GeoJSON').slice(0, 160),
      layerName,
      displayName: layerName,
      featureId: featureSignature,
      featureSignature,
      strokeWidth: 3,
      strokeColor: [0.078, 0.451, 0.902, 1.0],
      fillColor: [0.078, 0.451, 0.902, 1.0],
      layers,
      labels: []
    };
    payload.anchor = this._getPayloadAnchor(payload);
    return payload;
  }

  buildGeoJSONPreviewPayload(validation, fileName) {
    if (!validation || !validation.ok || !Array.isArray(validation.features)) throw new Error('GeoJSON must pass validation before preview registration.');
    return this._buildGeoJSONPayload(validation, fileName || 'GeoJSON');
  }

  _getPayloadAnchor(payload) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (payload.layers || []).forEach(layer => (layer.features || []).forEach(feature => (feature.rings || []).forEach(ring => ring.forEach(point => {
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
      minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]); minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
    }))));
    if (!Number.isFinite(minX)) return null;
    const point = [(minX + maxX) / 2, (minY + maxY) / 2];
    const latLng = this._worldPointToLatLng(point[0], point[1]);
    return { lat: latLng.lat, lng: latLng.lng, point };
  }

  _worldPointToLatLng(x, y) {
    if (typeof MercatorProjection !== 'undefined') return MercatorProjection.worldPointToLatLng(x, y, 10, 256);
    const worldSize = 262144;
    const lng = x / worldSize * 360 - 180;
    const n = Math.PI - 2 * Math.PI * y / worldSize;
    return { lat: 180 / Math.PI * Math.atan(Math.sinh(n)), lng };
  }

  _collectGeoJSONGeometry(geometry, groups) {
    if (!geometry) return;
    const type = geometry.type;
    const coordinates = geometry.coordinates;
    if (type === 'GeometryCollection') {
      const geometries = geometry.geometries || [];
      for (let index = 0; index < geometries.length; index++) this._collectGeoJSONGeometry(geometries[index], groups);
    } else if (type === 'Point') {
      this._addGeoJSONPointMarker(coordinates, groups.points);
    } else if (type === 'MultiPoint') {
      for (let index = 0; index < coordinates.length; index++) this._addGeoJSONPointMarker(coordinates[index], groups.points);
    } else if (type === 'LineString') {
      this._addGeoJSONPath(coordinates, groups.lines, false);
    } else if (type === 'MultiLineString') {
      for (let index = 0; index < coordinates.length; index++) this._addGeoJSONPath(coordinates[index], groups.lines, false);
    } else if (type === 'Polygon') {
      for (let index = 0; index < coordinates.length; index++) this._addGeoJSONPath(coordinates[index], groups.polygons, true);
    } else if (type === 'MultiPolygon') {
      for (let polygonIndex = 0; polygonIndex < coordinates.length; polygonIndex++) {
        for (let ringIndex = 0; ringIndex < coordinates[polygonIndex].length; ringIndex++) {
          this._addGeoJSONPath(coordinates[polygonIndex][ringIndex], groups.polygons, true);
        }
      }
    }
  }

  _addGeoJSONPath(coordinates, target, closed) {
    if (!Array.isArray(coordinates)) return;
    const projected = [];
    const worldSize = 262144;
    for (let index = 0; index < coordinates.length; index++) {
      const point = this._projectGeoJSONPoint(coordinates[index]);
      if (!point) continue;
      if (projected.length) {
        const previousX = projected[projected.length - 1][0];
        while (point[0] - previousX > worldSize / 2) point[0] -= worldSize;
        while (point[0] - previousX < -worldSize / 2) point[0] += worldSize;
      }
      const previous = projected[projected.length - 1];
      if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) projected.push(point);
    }
    if (closed && projected.length > 1) {
      const first = projected[0];
      const last = projected[projected.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) projected.pop();
    }
    if (projected.length >= (closed ? 3 : 2)) target.push(this._alignGeoJSONPathToCamera(projected, worldSize));
  }

  _addGeoJSONPointMarker(coordinate, target) {
    const point = this._projectGeoJSONPoint(coordinate);
    if (!point) return;
    const radius = 48;
    target.push(this._alignGeoJSONPathToCamera([
      [point[0], point[1] - radius], [point[0] + radius, point[1]],
      [point[0], point[1] + radius], [point[0] - radius, point[1]]
    ], 262144));
  }

  _projectGeoJSONPoint(coordinate) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
    const lng = Number(coordinate[0]);
    const lat = Number(coordinate[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    if (typeof MercatorProjection !== 'undefined') {
      const point = MercatorProjection.latLngToWorldPoint(lat, lng, 10, 256);
      return [point.x, point.y];
    }
    const safeLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const sinLat = Math.sin(safeLat * Math.PI / 180);
    return [
      ((lng + 180) / 360) * 262144,
      ((1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2) * 262144
    ];
  }

  _alignGeoJSONPathToCamera(path, worldSize) {
    if (!path.length || !this.app || !this.app.mapState) return path;
    const longitude = Number(this.app.mapState.longitude);
    if (!Number.isFinite(longitude)) return path;
    const centerX = ((longitude + 180) / 360) * worldSize;
    let averageX = 0;
    for (let index = 0; index < path.length; index++) averageX += path[index][0];
    averageX /= path.length;
    const shift = Math.round((centerX - averageX) / worldSize) * worldSize;
    if (!shift) return path;
    return path.map(point => [point[0] + shift, point[1]]);
  }

  _getGeoJSONLayerName(fileName) {
    const base = String(fileName || 'GeoJSON')
      .replace(/\.(geojson|json)$/i, '')
      .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return (`GeoJSON — ${base || 'Imported Map'}`).slice(0, 160);
  }

  _hashText(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(36);
  }

  _getFeatureSignature(country, features) {
    const material = `${country.iso3}|${features.map(feature => feature.id).sort().join('|')}|country-outlines-10m-v1`;
    let hash = 2166136261;
    for (let index = 0; index < material.length; index++) {
      hash ^= material.charCodeAt(index);
      hash = (hash * 16777619) >>> 0;
    }
    return `outline-${hash.toString(36)}`;
  }

  _validateVectorComplexity(features) {
    const maxFeatures = 100;
    const maxPoints = 100000;
    if (!Array.isArray(features) || !features.length) return { ok: false, message: 'No local country-outline paths were found.' };
    if (features.length > maxFeatures) return { ok: false, message: 'Too many local country-outline features. Narrow the search result.' };
    let points = 0;
    for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
      const rings = features[featureIndex].rings || [];
      for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) points += rings[ringIndex].length;
    }
    return points <= maxPoints
      ? { ok: true, points: points }
      : { ok: false, message: `Country-outline import exceeds ${maxPoints.toLocaleString()} points.` };
  }

  dispose() {
    if (this._unsubscribeDraw) this._unsubscribeDraw();
    this._unsubscribeDraw = null;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = VectorMapManager;
else if (typeof window !== 'undefined') window.VectorMapManager = VectorMapManager;
