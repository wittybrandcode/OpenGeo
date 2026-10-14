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
    this.MAX_POINTS = 85000;
    this._memoryCache = new Map();
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

  async resolveCountryBoundaryAsync(countryCode, countryName, searchItem) {
    const iso3 = String(countryCode || '').trim().toUpperCase();
    if (!iso3) {
      return { ok: false, message: 'Country code is required.', fallbackRequired: false };
    }

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

    // Check in-memory cache
    if (this._memoryCache.has(iso3)) {
      return this._memoryCache.get(iso3);
    }

    // Check persistent storage cache if localStorage is available
    try {
      if (typeof localStorage !== 'undefined') {
        const cachedRaw = localStorage.getItem(`opengeo_osm_country_${iso3}`);
        if (cachedRaw) {
          const parsed = JSON.parse(cachedRaw);
          if (parsed && parsed.ok && Array.isArray(parsed.features)) {
            this._memoryCache.set(iso3, parsed);
            return parsed;
          }
        }
      }
    } catch (_storageErr) {}

    // Build Nominatim query
    const queryName = countryName || searchItem?.name || iso3;
    const requestUrl = `https://nominatim.openstreetmap.org/search?country=${encodeURIComponent(queryName)}&polygon_geojson=1&format=json&limit=1`;
    
    const validation = typeof NetworkPolicy !== 'undefined'
      ? NetworkPolicy.validateHttpsUrl(requestUrl)
      : { ok: /^https:\/\//i.test(requestUrl), url: requestUrl };

    if (!validation.ok) {
      return { ok: false, message: 'OSM query URL rejected by network policy.', fallbackRequired: true };
    }

    try {
      const geojsonResult = await this._fetchJson(validation.url);
      if (!Array.isArray(geojsonResult) || !geojsonResult.length) {
        return { ok: false, message: `No OSM boundary found for ${queryName}.`, fallbackRequired: true };
      }

      // Find relation or best polygon entry
      const entry = geojsonResult.find(item => item.osm_type === 'relation' && item.geojson) ||
                    geojsonResult.find(item => item.geojson && (item.geojson.type === 'Polygon' || item.geojson.type === 'MultiPolygon')) ||
                    geojsonResult[0];

      if (!entry || !entry.geojson) {
        return { ok: false, message: `No vector polygon returned by OSM for ${queryName}.`, fallbackRequired: true };
      }

      const outerRings = this.extractOuterRings(entry.geojson);
      if (!outerRings.length) {
        return { ok: false, message: `Could not parse polygon rings for ${queryName}.`, fallbackRequired: true };
      }

      let pointCount = 0;
      for (let r = 0; r < outerRings.length; r++) {
        pointCount += outerRings[r].length;
      }

      // If point count exceeds MAX_POINTS (85,000), decimate safely every nth point on dense rings
      if (pointCount > this.MAX_POINTS) {
        const step = Math.ceil(pointCount / this.MAX_POINTS);
        for (let r = 0; r < outerRings.length; r++) {
          const ring = outerRings[r];
          if (ring.length > 100) {
            const decimated = [];
            for (let p = 0; p < ring.length - 1; p += step) {
              decimated.push(ring[p]);
            }
            decimated.push(ring[ring.length - 1]); // keep closed
            outerRings[r] = decimated;
          }
        }
      }

      const centroid = this.computeCentroid(outerRings);
      const displayName = entry.display_name ? entry.display_name.split(',')[0] : queryName;

      const result = {
        ok: true,
        tier: 'ultra-osm',
        country: {
          iso3: iso3,
          name: displayName,
          nameAr: displayName,
          label: centroid
        },
        features: [
          {
            id: `osm-${iso3.toLowerCase()}-exterior`,
            rings: outerRings,
            properties: {
              source: 'OpenStreetMap',
              osm_id: entry.osm_id,
              osm_type: entry.osm_type
            }
          }
        ],
        pointCount: pointCount,
        provenance: 'OpenStreetMap Nominatim Admin Level 2 Boundary'
      };

      // Store in memory cache
      this._memoryCache.set(iso3, result);

      // Store in persistent cache (capped size)
      try {
        if (typeof localStorage !== 'undefined' && JSON.stringify(result).length < 2 * 1024 * 1024) {
          localStorage.setItem(`opengeo_osm_country_${iso3}`, JSON.stringify(result));
        }
      } catch (_saveErr) {}

      return result;

    } catch (fetchErr) {
      return {
        ok: false,
        message: `OSM boundary fetch failed: ${fetchErr.message}`,
        fallbackRequired: true
      };
    }
  }

  async _fetchJson(url) {
    let transport = typeof TileTransport !== 'undefined' ? TileTransport : null;
    if (!transport && typeof globalThis !== 'undefined' && globalThis.TileTransport) {
      transport = globalThis.TileTransport;
    }
    if (!transport) {
      throw new Error('TileTransport is required for network operations.');
    }
    const buffer = await transport.request(url, {
      timeoutMs: 15000,
      maxBytes: 10 * 1024 * 1024
    });
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer));
    return JSON.parse(text);
  }

  clearCache() {
    this._memoryCache.clear();
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
