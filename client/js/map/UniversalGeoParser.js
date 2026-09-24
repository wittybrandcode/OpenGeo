/**
 * OpenGeo Universal Geo Parser.
 * High-performance, robust parser for map service URLs and global coordinate notations.
 * Supports: Google Maps (all permutations), Apple Maps, OpenStreetMap, Google Earth,
 * Bing Maps, Yandex Maps, Geo URI, Decimal Degrees (DD), Degrees Minutes Seconds (DMS),
 * and Degrees Decimal Minutes (DDM).
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UniversalGeoParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  class UniversalGeoParser {
    /**
     * Parses any map URL or coordinate string synchronously.
     * Returns a structured result object or null if unrecognized.
     * @param {string} input - Raw input string (URL, query, or coordinates)
     * @returns {Object|null}
     */
    static parse(input) {
      if (!input || typeof input !== 'string') return null;
      const str = input.trim();
      if (!str) return null;

      // 1. Google Maps Shortlinks (requires async resolution, flag for caller)
      if (/^(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[A-Za-z0-9_-]+/i.test(str)) {
        return {
          valid: true,
          isShortlink: true,
          source: 'Google Maps Shortlink',
          url: str,
          lat: null,
          lng: null,
          zoom: 15
        };
      }

      // 2. Google Maps Desktop / Web URLs
      const gmapsResult = this._parseGoogleMaps(str);
      if (gmapsResult) return gmapsResult;

      // 3. Apple Maps URLs
      const appleResult = this._parseAppleMaps(str);
      if (appleResult) return appleResult;

      // 4. OpenStreetMap URLs
      const osmResult = this._parseOpenStreetMap(str);
      if (osmResult) return osmResult;

      // 5. Google Earth Web URLs
      const earthResult = this._parseGoogleEarth(str);
      if (earthResult) return earthResult;

      // 6. Bing Maps URLs
      const bingResult = this._parseBingMaps(str);
      if (bingResult) return bingResult;

      // 7. Yandex Maps URLs
      const yandexResult = this._parseYandexMaps(str);
      if (yandexResult) return yandexResult;

      // 8. Geo URI (RFC 5870): geo:lat,lng?z=zoom
      const geoUriResult = this._parseGeoUri(str);
      if (geoUriResult) return geoUriResult;

      // 9. DDM (Degrees Decimal Minutes): 36° 45.173' N, 3° 02.523' E
      const ddmResult = this._parseDDM(str);
      if (ddmResult) return ddmResult;

      // 10. DMS (Degrees Minutes Seconds): 36°45'10.4"N 3°02'31.4"E
      const dmsResult = this._parseDMS(str);
      if (dmsResult) return dmsResult;

      // 11. Decimal Coordinates (DD): 36.752887, 3.042048 or 36.752887 N 3.042048 E
      const decResult = this._parseDecimalCoords(str);
      if (decResult) return decResult;

      return null;
    }

    /**
     * Parses Google Maps URLs across all known formats.
     */
    static _parseGoogleMaps(str) {
      if (!/google\.[a-z.]+\/maps|maps\.google\.[a-z.]+/i.test(str)) return null;

      // Format A: Embedded Protobuf/Data coordinates (!3d<lat>!4d<lng>)
      // e.g. https://www.google.com/maps/place/.../data=!3m1!1e3!4m6!3m5!1s0x...!8m2!3d36.752887!4d3.042048
      const dataMatch = str.match(/!3d(-?\d+(?:\.\d+)?)(?:.*?)!4d(-?\d+(?:\.\d+)?)/i);
      if (dataMatch) {
        const lat = parseFloat(dataMatch[1]);
        const lng = parseFloat(dataMatch[2]);
        if (this._isValidCoords(lat, lng)) {
          const zoomMatch = str.match(/@(?:-?\d+(?:\.\d+)?),(?:-?\d+(?:\.\d+)?),([0-9.]+)(?:m|z)/i);
          const zoom = zoomMatch ? this._clampZoom(parseFloat(zoomMatch[1])) : 15;
          return {
            valid: true,
            source: 'Google Maps',
            lat,
            lng,
            zoom,
            placeName: this._extractPlaceNameFromUrl(str)
          };
        }
      }

      // Format B: Standard @lat,lng,zoom or @lat,lng,meters
      // e.g. https://www.google.com/maps/@36.752887,3.042048,15z or @36.752887,3.042048,2500m
      const atMatch = str.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,([0-9.]+)(m|z))?/i);
      if (atMatch) {
        const lat = parseFloat(atMatch[1]);
        const lng = parseFloat(atMatch[2]);
        if (this._isValidCoords(lat, lng)) {
          let zoom = 14;
          if (atMatch[3]) {
            const rawVal = parseFloat(atMatch[3]);
            const unit = atMatch[4] ? atMatch[4].toLowerCase() : 'z';
            zoom = unit === 'm' ? this._metersToZoom(rawVal) : this._clampZoom(rawVal);
          }
          return {
            valid: true,
            source: 'Google Maps',
            lat,
            lng,
            zoom,
            placeName: this._extractPlaceNameFromUrl(str)
          };
        }
      }

      // Format C: Query parameters (?q=lat,lng or ?ll=lat,lng or ?query=lat,lng or ?destination=lat,lng)
      const queryParamMatch = str.match(/[?&](?:q|query|destination|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
      if (queryParamMatch) {
        const lat = parseFloat(queryParamMatch[1]);
        const lng = parseFloat(queryParamMatch[2]);
        if (this._isValidCoords(lat, lng)) {
          const zMatch = str.match(/[?&]z=(\d+(?:\.\d+)?)/i);
          return {
            valid: true,
            source: 'Google Maps',
            lat,
            lng,
            zoom: zMatch ? this._clampZoom(parseFloat(zMatch[1])) : 14,
            placeName: this._extractPlaceNameFromUrl(str)
          };
        }
      }

      // Format D: Search path with coordinates /maps/search/lat,lng or /maps/search/lat,+lng
      const searchMatch = str.match(/\/maps\/search\/(-?\d+(?:\.\d+)?)[,\s+]+(-?\d+(?:\.\d+)?)/i);
      if (searchMatch) {
        const lat = parseFloat(searchMatch[1]);
        const lng = parseFloat(searchMatch[2]);
        if (this._isValidCoords(lat, lng)) {
          return {
            valid: true,
            source: 'Google Maps',
            lat,
            lng,
            zoom: 14,
            placeName: null
          };
        }
      }

      return null;
    }

    /**
     * Parses Apple Maps URLs.
     */
    static _parseAppleMaps(str) {
      if (!/maps\.apple\.com/i.test(str)) return null;

      // ?ll=lat,lng or ?q=lat,lng
      const match = str.match(/[?&](?:ll|q)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (this._isValidCoords(lat, lng)) {
          const zMatch = str.match(/[?&]z=(\d+)/i);
          return {
            valid: true,
            source: 'Apple Maps',
            lat,
            lng,
            zoom: zMatch ? this._clampZoom(parseInt(zMatch[1], 10)) : 14,
            placeName: null
          };
        }
      }
      return null;
    }

    /**
     * Parses OpenStreetMap URLs.
     */
    static _parseOpenStreetMap(str) {
      if (!/(?:openstreetmap\.org|osm\.org)/i.test(str)) return null;

      // #map=zoom/lat/lng
      const hashMatch = str.match(/#map=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/i);
      if (hashMatch) {
        const zoom = this._clampZoom(parseFloat(hashMatch[1]));
        const lat = parseFloat(hashMatch[2]);
        const lng = parseFloat(hashMatch[3]);
        if (this._isValidCoords(lat, lng)) {
          return {
            valid: true,
            source: 'OpenStreetMap',
            lat,
            lng,
            zoom,
            placeName: null
          };
        }
      }

      // ?mlat=lat&mlon=lng
      const mMatch = str.match(/[?&]mlat=(-?\d+(?:\.\d+)?).*?[?&]mlon=(-?\d+(?:\.\d+)?)/i);
      if (mMatch) {
        const lat = parseFloat(mMatch[1]);
        const lng = parseFloat(mMatch[2]);
        if (this._isValidCoords(lat, lng)) {
          const zMatch = str.match(/[?&]zoom=(\d+)/i);
          return {
            valid: true,
            source: 'OpenStreetMap',
            lat,
            lng,
            zoom: zMatch ? this._clampZoom(parseInt(zMatch[1], 10)) : 15,
            placeName: null
          };
        }
      }

      return null;
    }

    /**
     * Parses Google Earth Web URLs.
     */
    static _parseGoogleEarth(str) {
      if (!/earth\.google\.com\/web/i.test(str)) return null;

      // @lat,lng,elev...
      const match = str.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (this._isValidCoords(lat, lng)) {
          return {
            valid: true,
            source: 'Google Earth',
            lat,
            lng,
            zoom: 15,
            placeName: null
          };
        }
      }
      return null;
    }

    /**
     * Parses Bing Maps URLs.
     */
    static _parseBingMaps(str) {
      if (!/bing\.com\/maps/i.test(str)) return null;

      // ?cp=lat~lng&lvl=zoom
      const match = str.match(/[?&]cp=(-?\d+(?:\.\d+)?)~(-?\d+(?:\.\d+)?)/i);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (this._isValidCoords(lat, lng)) {
          const lvlMatch = str.match(/[?&]lvl=(\d+)/i);
          return {
            valid: true,
            source: 'Bing Maps',
            lat,
            lng,
            zoom: lvlMatch ? this._clampZoom(parseInt(lvlMatch[1], 10)) : 14,
            placeName: null
          };
        }
      }
      return null;
    }

    /**
     * Parses Yandex Maps URLs.
     */
    static _parseYandexMaps(str) {
      if (!/yandex\.[a-z.]+\/maps/i.test(str)) return null;

      // ?ll=lng%2Clat or ?ll=lng,lat (Yandex uses lng,lat convention)
      const match = str.match(/[?&]ll=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/i);
      if (match) {
        const lng = parseFloat(match[1]);
        const lat = parseFloat(match[2]);
        if (this._isValidCoords(lat, lng)) {
          const zMatch = str.match(/[?&]z=(\d+)/i);
          return {
            valid: true,
            source: 'Yandex Maps',
            lat,
            lng,
            zoom: zMatch ? this._clampZoom(parseInt(zMatch[1], 10)) : 14,
            placeName: null
          };
        }
      }
      return null;
    }

    /**
     * Parses standard Geo URI (RFC 5870): geo:lat,lng?z=zoom
     */
    static _parseGeoUri(str) {
      const match = str.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:;[a-z0-9=.]+)*(?:\?(?:.*&)?z=(\d+))?/i);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (this._isValidCoords(lat, lng)) {
          return {
            valid: true,
            source: 'Geo URI',
            lat,
            lng,
            zoom: match[3] ? this._clampZoom(parseInt(match[3], 10)) : 14,
            placeName: null
          };
        }
      }
      return null;
    }

    /**
     * Parses Degrees Minutes Seconds (DMS).
     * Examples: 36°45'10.4"N 3°02'31.4"E, 36 45 10.4 N, 3 2 31.4 E, 36°45'N 3°02'E
     */
    static _parseDMS(str) {
      const dmsRegex = /([0-9.]+)[°\s]+([0-9.]+)?['\s]*(?:([0-9.]+)["\s]*)?([NSEWnsew])\s*[,/ ]\s*([0-9.]+)[°\s]+([0-9.]+)?['\s]*(?:([0-9.]+)["\s]*)?([NSEWnsew])/i;
      const match = str.match(dmsRegex);
      if (match) {
        let latDeg = parseFloat(match[1]);
        let latMin = match[2] ? parseFloat(match[2]) : 0;
        let latSec = match[3] ? parseFloat(match[3]) : 0;
        let latDir = match[4].toUpperCase();

        let lngDeg = parseFloat(match[5]);
        let lngMin = match[6] ? parseFloat(match[6]) : 0;
        let lngSec = match[7] ? parseFloat(match[7]) : 0;
        let lngDir = match[8].toUpperCase();

        let lat = latDeg + latMin / 60 + latSec / 3600;
        if (latDir === 'S') lat = -lat;

        let lng = lngDeg + lngMin / 60 + lngSec / 3600;
        if (lngDir === 'W') lng = -lng;

        if (this._isValidCoords(lat, lng)) {
          return {
            valid: true,
            source: 'GPS Coordinates (DMS)',
            lat: parseFloat(lat.toFixed(6)),
            lng: parseFloat(lng.toFixed(6)),
            zoom: 14,
            placeName: null
          };
        }
      }
      return null;
    }

    /**
     * Parses Degrees Decimal Minutes (DDM).
     * Example: 36° 45.173' N, 3° 02.523' E
     */
    static _parseDDM(str) {
      const ddmRegex = /([0-9.]+)[°\s]+([0-9.]+)'\s*([NSEWnsew])\s*[,/ ]\s*([0-9.]+)[°\s]+([0-9.]+)'\s*([NSEWnsew])/i;
      const match = str.match(ddmRegex);
      if (match) {
        let lat = parseFloat(match[1]) + parseFloat(match[2]) / 60;
        if (match[3].toUpperCase() === 'S') lat = -lat;
        let lng = parseFloat(match[4]) + parseFloat(match[5]) / 60;
        if (match[6].toUpperCase() === 'W') lng = -lng;

        if (this._isValidCoords(lat, lng)) {
          return {
            valid: true,
            source: 'GPS Coordinates (DDM)',
            lat: parseFloat(lat.toFixed(6)),
            lng: parseFloat(lng.toFixed(6)),
            zoom: 14,
            placeName: null
          };
        }
      }
      return null;
    }

    /**
     * Parses Decimal Coordinates (DD) with or without labels and cardinals.
     * Examples:
     * - 36.752887, 3.042048
     * - 36.752887 N, 3.042048 E
     * - Lat: 36.752887, Lng: 3.042048
     * - [36.752887, 3.042048]
     * - 36.752887, 3.042048, 15z
     */
    static _parseDecimalCoords(str) {
      // Clean brackets if present
      const cleaned = str.replace(/[\[\]()]/g, '').trim();

      // Check cardinal-suffixed coordinates (e.g. 36.7528 N, 3.0420 E or 36.7528N 3.0420E)
      const cardinalMatch = cleaned.match(/^([0-9.]+)\s*°?\s*([NSns])\s*[, ]\s*([0-9.]+)\s*°?\s*([EWew])(?:\s*[, ]\s*([0-9.]+)\s*z?)?$/i);
      if (cardinalMatch) {
        let lat = parseFloat(cardinalMatch[1]);
        if (cardinalMatch[2].toUpperCase() === 'S') lat = -lat;
        let lng = parseFloat(cardinalMatch[3]);
        if (cardinalMatch[4].toUpperCase() === 'W') lng = -lng;
        if (this._isValidCoords(lat, lng)) {
          return {
            valid: true,
            source: 'Coordinates (DD)',
            lat: parseFloat(lat.toFixed(6)),
            lng: parseFloat(lng.toFixed(6)),
            zoom: cardinalMatch[5] ? this._clampZoom(parseFloat(cardinalMatch[5])) : 13,
            placeName: null
          };
        }
      }

      // Standard decimal pair: 36.752887, 3.042048
      const decMatch = cleaned.match(/^(?:lat:\s*)?(-?\d+(?:\.\d+)?)\s*°?\s*[, ]\s*(?:lng:\s*|lon:\s*)?(-?\d+(?:\.\d+)?)\s*°?(?:\s*[, ]\s*([0-9.]+)\s*z?)?$/i);
      if (decMatch) {
        const lat = parseFloat(decMatch[1]);
        const lng = parseFloat(decMatch[2]);
        if (this._isValidCoords(lat, lng)) {
          return {
            valid: true,
            source: 'Coordinates (DD)',
            lat,
            lng,
            zoom: decMatch[3] ? this._clampZoom(parseFloat(decMatch[3])) : 13,
            placeName: null
          };
        }
      }

      return null;
    }

    /**
     * Resolves Google Maps mobile shortlinks (maps.app.goo.gl or goo.gl/maps)
     * by following HTTP redirects to the expanded canonical URL.
     * Works in Node.js, CEP runtime, or browser fetch environments.
     * @param {string} shortUrl
     * @returns {Promise<Object|null>}
     */
    static async resolveShortlink(shortUrl) {
      if (!shortUrl) return null;
      try {
        let targetUrl = null;

        // Standard Fetch environment with automatic redirect following
        if (typeof fetch !== 'undefined') {
          const response = await fetch(shortUrl, {
            method: 'HEAD',
            redirect: 'follow'
          });
          targetUrl = response.url;
        }

        if (targetUrl) {
          const parsed = this.parse(targetUrl);
          if (parsed && parsed.valid) {
            parsed.source = 'Google Maps (Shared Link)';
            return parsed;
          }
        }
      } catch (err) {
        console.warn('[UniversalGeoParser] Shortlink resolution error:', err);
      }
      return null;
    }

    /**
     * Extracts a legible place name from URL paths if present.
     * e.g. /maps/place/Eiffel+Tower/@... -> "Eiffel Tower"
     */
    static _extractPlaceNameFromUrl(url) {
      try {
        const placeMatch = url.match(/\/maps\/place\/([^/@?]+)/i);
        if (placeMatch) {
          return decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
        }
      } catch (e) {
        /* decodeURIComponent failure fallback */
      }
      return null;
    }

    static _isValidCoords(lat, lng) {
      return (
        typeof lat === 'number' &&
        typeof lng === 'number' &&
        !isNaN(lat) &&
        !isNaN(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
      );
    }

    static _clampZoom(z) {
      if (isNaN(z)) return 14;
      return Math.min(19, Math.max(2, Math.round(z * 10) / 10));
    }

    static _metersToZoom(meters) {
      if (meters <= 100) return 18;
      if (meters <= 300) return 17;
      if (meters <= 700) return 16;
      if (meters <= 1500) return 15;
      if (meters <= 3500) return 14;
      if (meters <= 8000) return 13;
      if (meters <= 20000) return 12;
      if (meters <= 50000) return 10;
      return 8;
    }
  }

  return UniversalGeoParser;
});
