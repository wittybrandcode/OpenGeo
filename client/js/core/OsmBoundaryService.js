/**
 * OpenGeo OsmBoundaryService
 *
 * Fetches, projects, caches and normalizes ultra-high-resolution country
 * boundaries from OpenStreetMap (Admin Level 2) on demand.
 *
 * Features:
 *  - On-demand bounded HTTPS queries via NetworkPolicy.
 *  - Web Mercator projection (MAP_SIZE 262144).
 *  - Exterior land perimeter extraction (no internal hole geometry).
 *  - Strict Cartography Policy compliance (MAR/ESH pinned sovereignty profiles).
 *  - Persistent and memory caching.
 *  - Point budget defense (guards After Effects shape engine from overload).
 */

class OsmBoundaryService {
  constructor(geoDataRepository) {
    this.geoDataRepository = geoDataRepository || null;
    this.MAP_SIZE = 262144;
    this.MAX_POINTS = 3500; // Safe ceiling for After Effects Shape Layers to prevent freezing
    this._memoryCache = new Map();
    this._rawGeometryCache = new Map();
  }

  projectPoint(point) {
    if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      return null;
    }
    const lng = point[0];
    const lat = Math.max(-85.05112878, Math.min(85.05112878, point[1]));
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const x = Math.max(0, Math.min(this.MAP_SIZE, ((lng + 180) / 360) * this.MAP_SIZE));
    const y = Math.max(0, Math.min(this.MAP_SIZE, ((1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2) * this.MAP_SIZE));
    return [
      Math.round(x * 100) / 100,
      Math.round(y * 100) / 100
    ];
  }

  projectRing(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const projected = [];
    for (let i = 0; i < ring.length; i++) {
      const pt = this.projectPoint(ring[i]);
      if (pt) {
        if (!projected.length || projected[projected.length - 1][0] !== pt[0] || projected[projected.length - 1][1] !== pt[1]) {
          projected.push(pt);
        }
      }
    }
    if (projected.length < 3) return null;
    // Ensure ring is closed
    const first = projected[0];
    const last = projected[projected.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      projected.push([first[0], first[1]]);
    }
    return projected;
  }

  extractOuterRings(geojsonGeometry) {
    if (!geojsonGeometry || !geojsonGeometry.coordinates) return [];
    const type = geojsonGeometry.type;
    const rings = [];

    if (type === 'Polygon') {
      const outerCoords = geojsonGeometry.coordinates[0];
      const ring = this.projectRing(outerCoords);
      if (ring) rings.push(ring);
    } else if (type === 'MultiPolygon') {
      for (let i = 0; i < geojsonGeometry.coordinates.length; i++) {
        const polyCoords = geojsonGeometry.coordinates[i];
        if (Array.isArray(polyCoords) && polyCoords.length > 0) {
          const outerCoords = polyCoords[0];
          const ring = this.projectRing(outerCoords);
          if (ring) rings.push(ring);
        }
      }
    }
    return this.decimateRings(rings);
  }

  decimateRings(outerRings, maxLimit) {
    const limit = maxLimit || this.MAX_POINTS;
    let pointCount = 0;
    for (let r = 0; r < outerRings.length; r++) {
      pointCount += outerRings[r].length;
    }
    if (pointCount <= limit) return outerRings;

    const step = Math.ceil(pointCount / limit);
    const result = [];
    for (let r = 0; r < outerRings.length; r++) {
      const ring = outerRings[r];
      if (ring.length > 10) {
        const decimated = [];
        for (let p = 0; p < ring.length - 1; p += step) {
          decimated.push(ring[p]);
        }
        decimated.push(ring[ring.length - 1]); // keep closed
        result.push(decimated);
      } else {
        result.push(ring);
      }
    }
    return result;
  }

  computeCentroid(rings) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      for (let j = 0; j < ring.length; j++) {
        sumX += ring[j][0];
        sumY += ring[j][1];
        count++;
      }
    }
    return count > 0 ? [Math.round((sumX / count) * 100) / 100, Math.round((sumY / count) * 100) / 100] : null;
  }

  async resolveCountryBoundaryAsync(countryCode, countryName, searchItem, options = {}) {
    const iso3 = String(countryCode || '').trim().toUpperCase();
    if (!iso3) {
      return { ok: false, message: 'Country code is required.', fallbackRequired: false };
    }

    const targetZoom = (options && Number.isFinite(options.compZoom))
      ? options.compZoom
      : ((options && Number.isFinite(options.zoom)) ? options.zoom : 6);
    const zoomBucket = Math.round(targetZoom);
    const cacheKey = `${iso3}_z${zoomBucket}`;

    // Cartography Policy enforcement:
    // Morocco and Western Sahara have pinned locked profiles in CARTOGRAPHY_POLICY.json.
    if ((iso3 === 'MAR' || iso3 === 'ESH') && this.geoDataRepository) {
      const policyResolved = await this.geoDataRepository.resolveStudioCountryOutlineAsync(iso3);
      if (policyResolved && policyResolved.country) {
        return {
          ok: true,
          tier: 'ultra-osm',
          country: policyResolved.country,
          features: policyResolved.features,
          provenance: policyResolved.provenance,
          policyEnforced: true
        };
      }
    }

    // Check in-memory LOD cache for this zoom
    if (this._memoryCache.has(cacheKey)) {
      return this._memoryCache.get(cacheKey);
    }

    // Check if raw full geometry is already in memory
    if (this._rawGeometryCache.has(iso3)) {
      const cachedRaw = this._rawGeometryCache.get(iso3);
      const res = this._buildResultFromRaw(iso3, countryName, cachedRaw.meta, cachedRaw.allRings, targetZoom);
      this._memoryCache.set(cacheKey, res);
      return res;
    }

    // Check persistent storage cache if localStorage is available
    try {
      if (typeof localStorage !== 'undefined') {
        const cachedRaw = localStorage.getItem(`opengeo_osm_country_${cacheKey}`);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          if (parsed && parsed.ok && Array.isArray(parsed.features)) {
            this._memoryCache.set(cacheKey, parsed);
            return parsed;
          }
        }
      }
    } catch (_storageErr) {}

    // Query GeoBoundaries gbOpen High-Resolution OSM-Derived Boundaries
    const apiUrl = `https://www.geoboundaries.org/api/current/gbOpen/${encodeURIComponent(iso3)}/ADM0/`;
    
    const apiValidation = typeof NetworkPolicy !== 'undefined'
      ? NetworkPolicy.validateHttpsUrl(apiUrl)
      : { ok: /^https:\/\//i.test(apiUrl), url: apiUrl };

    if (!apiValidation.ok) {
      return { ok: false, message: 'GeoBoundaries API URL rejected by network policy.', fallbackRequired: true };
    }

    try {
      const meta = await this._fetchJson(apiValidation.url);
      if (!meta || !meta.boundaryISO) {
        return { ok: false, message: `No Ultra-HD boundary metadata found for ${iso3}.`, fallbackRequired: true };
      }

      const downloadUrl = meta.gjDownloadURL || meta.simplifiedGeometryGeoJSON;
      if (!downloadUrl) {
        return { ok: false, message: `No boundary download URL found for ${iso3}.`, fallbackRequired: true };
      }

      const downloadValidation = typeof NetworkPolicy !== 'undefined'
        ? NetworkPolicy.validateHttpsUrl(downloadUrl)
        : { ok: /^https:\/\//i.test(downloadUrl), url: downloadUrl };

      if (!downloadValidation.ok) {
        return { ok: false, message: 'Boundary download URL rejected by network policy.', fallbackRequired: true };
      }

      const geojsonData = await this._fetchJson(downloadValidation.url);
      if (!geojsonData) {
        return { ok: false, message: `Failed to load boundary geometry for ${iso3}.`, fallbackRequired: true };
      }

      // Extract geometry from FeatureCollection or Feature or Geometry
      const allRings = [];
      if (geojsonData.type === 'FeatureCollection' && Array.isArray(geojsonData.features)) {
        for (let fi = 0; fi < geojsonData.features.length; fi++) {
          const feat = geojsonData.features[fi];
          if (feat && feat.geometry) {
            const rings = this.extractOuterRings(feat.geometry);
            for (let ri = 0; ri < rings.length; ri++) allRings.push(rings[ri]);
          }
        }
      } else if (geojsonData.type === 'Feature' && geojsonData.geometry) {
        const rings = this.extractOuterRings(geojsonData.geometry);
        for (let ri = 0; ri < rings.length; ri++) allRings.push(rings[ri]);
      } else if (geojsonData.type === 'Polygon' || geojsonData.type === 'MultiPolygon') {
        const rings = this.extractOuterRings(geojsonData);
        for (let ri = 0; ri < rings.length; ri++) allRings.push(rings[ri]);
      }

      if (!allRings.length) {
        return { ok: false, message: `Could not parse polygon rings for ${iso3}.`, fallbackRequired: true };
      }

      // Cache raw rings in memory so subsequent zooms never hit network
      this._rawGeometryCache.set(iso3, { meta, allRings });

      const result = this._buildResultFromRaw(iso3, countryName, meta, allRings, targetZoom);

      // Store in memory cache
      this._memoryCache.set(cacheKey, result);

      // Store in persistent cache (capped size)
      try {
        if (typeof localStorage !== 'undefined' && JSON.stringify(result).length < 2 * 1024 * 1024) {
          localStorage.setItem(`opengeo_osm_country_${cacheKey}`, JSON.stringify(result));
        }
      } catch (_saveErr) {}

      return result;

    } catch (fetchErr) {
      return {
        ok: false,
        message: `Ultra OSM boundary fetch failed: ${fetchErr.message}`,
        fallbackRequired: true
      };
    }
  }

  _buildResultFromRaw(iso3, countryName, meta, allRings, targetZoom) {
    let PolylineMathClass = typeof PolylineMath !== 'undefined' ? PolylineMath : null;
    if (!PolylineMathClass && typeof window !== 'undefined' && window.PolylineMath) {
      PolylineMathClass = window.PolylineMath;
    }

    const outerRings = PolylineMathClass
      ? PolylineMathClass.simplifyRingsForZoom(allRings, targetZoom, this.MAX_POINTS)
      : this.decimateRings(allRings, this.MAX_POINTS);

    let pointCount = 0;
    for (let r = 0; r < outerRings.length; r++) {
      pointCount += outerRings[r].length;
    }

    const centroid = this.computeCentroid(outerRings);
    const displayName = (meta && meta.boundaryName) || countryName || iso3;
    const roundedZ = Math.round(targetZoom * 10) / 10;

    return {
      ok: true,
      tier: 'ultra-osm',
      country: {
        iso3: iso3,
        name: displayName,
        nameAr: countryName || displayName,
        label: centroid
      },
      features: [
        {
          id: `ultra-${iso3.toLowerCase()}-exterior`,
          rings: outerRings,
          properties: {
            source: (meta && meta.boundarySource) || 'GeoBoundaries / OpenStreetMap',
            boundaryID: meta && meta.boundaryID,
            vertices: pointCount,
            lodZoom: roundedZ
          }
        }
      ],
      pointCount: pointCount,
      provenance: `GeoBoundaries gbOpen High-Resolution (OSM, Altitude LOD Z${roundedZ})`
    };
  }

  async _fetchJson(url) {
    let transport = typeof TileTransport !== 'undefined' ? TileTransport : null;
    if (!transport && typeof globalThis !== 'undefined' && globalThis.TileTransport) {
      transport = globalThis.TileTransport;
    }
    if (!transport) {
      throw new Error('TileTransport is required for network operations.');
    }
    const res = transport.request(url, {
      timeoutMs: 20000,
      maxBytes: 16 * 1024 * 1024
    });
    const buffer = res && res.promise ? await res.promise : await res;
    const text = typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer)
      ? buffer.toString('utf8')
      : new TextDecoder('utf-8').decode(new Uint8Array(buffer));
    return JSON.parse(text);
  }

  clearCache() {
    this._memoryCache.clear();
    this._rawGeometryCache.clear();
    try {
      if (typeof localStorage !== 'undefined') {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('opengeo_osm_country_')) keysToRemove.push(k);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      }
    } catch (_e) {}
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = OsmBoundaryService;
else if (typeof window !== 'undefined') window.OsmBoundaryService = OsmBoundaryService;
