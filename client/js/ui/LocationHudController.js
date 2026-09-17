/**
 * OpenGeo Location & Production HUD Controller.
 * Provides real-time spatial orientation, geodesic scale bar,
 * offline/online place identity recognition, AE composition framing badge,
 * and pre-flight finalize tile budget estimation.
 */
class LocationHudController {
  constructor(app) {
    this.app = app;
    this.lifecycle = app.lifecycle;
    this._cache = new Map();
    this._reverseTimer = null;
    this._activeAbortController = null;
    this._lastLat = null;
    this._lastLng = null;
    this._lastZoom = null;
    this._bound = false;

    // Elements
    this.locationHudEl = null;
    this.locationNameEl = null;
    this.locationCoordsEl = null;
    this.scaleBarEl = null;
    this.scaleLineEl = null;
    this.scaleTextEl = null;
    this.framingBadgeEl = null;
    this.compassEl = null;
    this.estimateBadgeEl = null;
    this.pitchControlEl = null;
    this.pitchValueEl = null;
  }

  bind() {
    if (this._bound) return;
    this._bound = true;

    this.locationHudEl = document.getElementById('geo-location-hud');
    this.locationNameEl = document.getElementById('location-hud-name');
    this.locationCoordsEl = document.getElementById('location-hud-coords');
    this.scaleBarEl = document.getElementById('map-scale-bar');
    this.scaleLineEl = document.getElementById('scale-bar-line');
    this.scaleTextEl = document.getElementById('scale-bar-text');
    this.framingBadgeEl = document.getElementById('framing-badge');
    this.compassEl = document.getElementById('map-compass');
    this.estimateBadgeEl = document.getElementById('finalize-estimate-badge');
    this.pitchControlEl = document.getElementById('map-pitch-control');
    this.pitchValueEl = document.getElementById('pitch-value-display');

    // 3D Pitch / Tilt Scrubber interaction
    if (this.pitchControlEl) {
      let isScrubbing = false;
      let startY = 0;
      let startPitch = 0;

      const onPointerMove = (e) => {
        if (!isScrubbing || !this.app.viewport) return;
        const dy = startY - e.clientY;
        const newPitch = Math.max(0, Math.min(45, startPitch + dy * 0.5));
        this.app.viewport.setPitch(newPitch);
        this.updatePitch(newPitch);
      };

      const onPointerUp = () => {
        if (!isScrubbing) return;
        isScrubbing = false;
        if (this.pitchControlEl) this.pitchControlEl.classList.remove('active');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      this.pitchControlEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        isScrubbing = true;
        startY = e.clientY;
        startPitch = this.app.viewport ? this.app.viewport.pitch : 0;
        this.pitchControlEl.classList.add('active');
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });

      this.pitchControlEl.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (this.app.viewport) {
          this.app.viewport.setPitch(0);
          this.updatePitch(0);
        }
      });
    }

    // Compass click resets to standard center/north
    if (this.compassEl) {
      this.compassEl.addEventListener('click', () => {
        if (this.app.viewport) {
          this.app.viewport.setCenter(this.app.viewport.centerLat, this.app.viewport.centerLng);
          this.update();
        }
      });
    }

    // Hook finalize-quality changes to update pre-flight tile estimate
    const qualitySelect = document.getElementById('finalize-quality');
    if (qualitySelect) {
      qualitySelect.addEventListener('change', () => {
        const matchingRadio = document.querySelector(`input[name="finalize-quality-radio"][value="${qualitySelect.value}"]`);
        if (matchingRadio && !matchingRadio.checked) {
          matchingRadio.checked = true;
        }
        this.updateEstimate();
      });
    }

    const qualityRadios = document.querySelectorAll('input[name="finalize-quality-radio"]');
    if (qualityRadios.length) {
      qualityRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
          if (e.target.checked) {
            if (qualitySelect) {
              qualitySelect.value = e.target.value;
              qualitySelect.dispatchEvent(new Event('change'));
            } else {
              this.updateEstimate();
            }
          }
        });
      });
    }

    const finalizeSplit = document.getElementById('finalize-split-group');
    if (finalizeSplit) {
      finalizeSplit.addEventListener('mouseenter', () => this.updateEstimate());
    }

    // Initial update
    this.update();
  }

  update() {
    if (!this.app.viewport) return;
    const lat = this.app.viewport.centerLat;
    const lng = this.app.viewport.centerLng;
    const zoom = this.app.viewport.zoom;
    const pitch = this.app.viewport.pitch || 0;

    this.updateScaleBar(lat, zoom);
    this.updateLocationIdentity(lat, lng, zoom);
    this.updateFramingBadge();
    this.updateEstimate();
    this.updatePitch(pitch);
  }

  /**
   * Updates 3D pitch numeric readout, applies Frustum-compensated edge-to-edge
   * perspective tilt centered on the canvas, eliminating top clipping and side cutoffs.
   */
  updatePitch(pitch) {
    if (this.pitchValueEl) {
      const rounded = Math.round(pitch || 0);
      this.pitchValueEl.textContent = `${rounded}°`;
    }
    const canvas = document.getElementById('map-canvas');
    const p = Math.max(0, Math.min(45, pitch || 0));
    if (canvas) {
      if (p > 0) {
        // Frustum compensation: calculate overscan scale centered on map canvas
        // so that the tilted plane expands outward to eliminate side trapezoid cutoffs
        // and eliminates top clipping completely up to the 45 degree limit.
        const pRad = (p * Math.PI) / 180;
        const overscanScale = 1 + 1.25 * Math.sin(pRad);
        const translateY = -Math.round(25 * Math.sin(pRad));
        canvas.style.transformOrigin = 'center center';
        canvas.style.transform = `scale(${overscanScale.toFixed(4)}) rotateX(${p}deg) translateY(${translateY}px)`;
        const vignette = document.getElementById('map-horizon-vignette');
        if (vignette) {
          vignette.style.opacity = '0';
          vignette.style.display = 'none';
        }
      } else {
        canvas.style.transformOrigin = 'center center';
        canvas.style.transform = '';
        const vignette = document.getElementById('map-horizon-vignette');
        if (vignette) {
          vignette.style.opacity = '0';
          vignette.style.display = 'none';
        }
      }
    }
  }

  /**
   * Calculates geodesic distance scale bar and renders clean metric increments.
   */
  updateScaleBar(lat, zoom) {
    if (!this.scaleLineEl || !this.scaleTextEl) return;
    if (typeof MercatorProjection === 'undefined' || !MercatorProjection.getMetersPerPixel) return;

    const metersPerPixel = MercatorProjection.getMetersPerPixel(lat, zoom);
    if (!metersPerPixel || metersPerPixel <= 0 || !isFinite(metersPerPixel)) return;

    // Target scale bar width between 60px and 120px (ideal ~90px)
    const targetMeters = metersPerPixel * 90;

    // Standard human-friendly metric intervals
    const intervals = [
      1, 2, 5, 10, 20, 50, 100, 200, 500,
      1000, 2000, 5000, 10000, 20000, 50000,
      100000, 200000, 500000, 1000000, 2000000, 5000000
    ];

    let chosenDistance = intervals[0];
    for (let i = 0; i < intervals.length; i++) {
      if (intervals[i] <= targetMeters) {
        chosenDistance = intervals[i];
      } else {
        break;
      }
    }

    const barWidthPx = Math.max(30, Math.min(140, Math.round(chosenDistance / metersPerPixel)));
    const text = chosenDistance >= 1000
      ? (chosenDistance / 1000) + ' km'
      : chosenDistance + ' m';

    this.scaleLineEl.style.width = barWidthPx + 'px';
    this.scaleTextEl.textContent = text;
  }

  /**
   * Resolves place identity: fast offline lookup + debounced reverse geocoding.
   */
  updateLocationIdentity(lat, lng, zoom) {
    if (!this.locationNameEl || !this.locationCoordsEl) return;

    const latStr = lat.toFixed(4) + '°';
    const lngStr = lng.toFixed(4) + '°';
    const zoomStr = 'Z: ' + zoom.toFixed(1);
    this.locationCoordsEl.textContent = `${latStr}, ${lngStr} • ${zoomStr}`;

    // Fast Cache Check
    const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${Math.round(zoom)}`;
    if (this._cache.has(cacheKey)) {
      this.locationNameEl.textContent = this._cache.get(cacheKey);
      return;
    }

    // Immediate offline country/region estimation
    const offlineName = this._resolveOfflineCountry(lat, lng);
    if (offlineName) {
      this.locationNameEl.textContent = offlineName;
    }

    // Debounce online reverse geocoding (500ms)
    if (this._reverseTimer) clearTimeout(this._reverseTimer);
    this._reverseTimer = setTimeout(() => {
      this._fetchReverseGeocode(lat, lng, zoom, cacheKey);
    }, 500);
  }

  _resolveOfflineCountry(lat, lng) {
    const resolver = this.app.geographyIdentityResolver;
    if (!resolver || !resolver.countries) return null;

    // Fast search across country labels if available in Mercator pixel coordinates
    if (typeof MercatorProjection !== 'undefined') {
      const point = MercatorProjection.latLngToWorldPoint(lat, lng, 18, 256);
      let closestIso3 = null;
      let minDistanceSq = Infinity;
      for (const iso3 in resolver.countries) {
        const country = resolver.countries[iso3];
        if (country && country.label && country.label.length >= 2) {
          const dx = point.x - country.label[0];
          const dy = point.y - country.label[1];
          const distSq = dx * dx + dy * dy;
          if (distSq < minDistanceSq) {
            minDistanceSq = distSq;
            closestIso3 = iso3;
          }
        }
      }
      // Proximity threshold
      if (closestIso3 && minDistanceSq < 1500000000) {
        const c = resolver.countries[closestIso3];
        return c.nameLong || c.name || null;
      }
    }
    return null;
  }

  async _fetchReverseGeocode(lat, lng, zoom, cacheKey) {
    if (this._activeAbortController) {
      this._activeAbortController.abort();
    }
    this._activeAbortController = new AbortController();
    const signal = this._activeAbortController.signal;

    try {
      const queryZoom = Math.min(18, Math.max(3, Math.round(zoom)));
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&zoom=${queryZoom}&addressdetails=1`;
      const res = await fetch(url, { signal, headers: { 'Accept': 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      if (!data) return;

      const addr = data.address || {};
      const place = addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state || '';
      const country = addr.country || '';
      let display = '';

      if (place && country && place.toLowerCase() !== country.toLowerCase()) {
        display = `${place}, ${country}`;
      } else if (country) {
        display = country;
      } else if (data.name) {
        display = data.name;
      } else if (data.display_name) {
        display = data.display_name.split(',')[0];
      }

      if (display) {
        // Cache (LRU up to 200 entries)
        if (this._cache.size > 200) {
          const firstKey = this._cache.keys().next().value;
          this._cache.delete(firstKey);
        }
        this._cache.set(cacheKey, display);
        if (this.locationNameEl) {
          this.locationNameEl.textContent = display;
        }
      }
    } catch (e) {
      // Graceful ignore aborts or network limits
    } finally {
      this._activeAbortController = null;
    }
  }

  /**
   * Updates AE composition framing badge with resolution and aspect ratio.
   */
  updateFramingBadge() {
    if (!this.framingBadgeEl) return;
    const session = this.app.session;
    const width = (session && session.compSettings && session.compSettings.width) || 1920;
    const height = (session && session.compSettings && session.compSettings.height) || 1080;

    let ratioName = 'Custom';
    const aspect = width / height;
    if (Math.abs(aspect - 16 / 9) < 0.02) {
      ratioName = '16:9';
    } else if (Math.abs(aspect - 9 / 16) < 0.02) {
      ratioName = '9:16';
    } else if (Math.abs(aspect - 1) < 0.02) {
      ratioName = '1:1';
    } else if (Math.abs(aspect - 21 / 9) < 0.05 || (width === 3440 && height === 1440) || (width === 2560 && height === 1080)) {
      ratioName = '21:9';
    } else if (Math.abs(aspect - 4 / 3) < 0.02) {
      ratioName = '4:3';
    } else if (width === 2048 && height === 1080) {
      ratioName = '2K';
    }

    const is4K = width >= 3840 || height >= 2160;
    this.framingBadgeEl.textContent = `${ratioName} • ${width}×${height}${is4K ? ' (4K UHD)' : ''}`;
  }

  /**
   * Pre-flight estimation of tiles & download size before Finalize execution.
   */
  updateEstimate() {
    if (!this.estimateBadgeEl) return;
    const qualitySelect = document.getElementById('finalize-quality');
    const quality = qualitySelect ? qualitySelect.value : 'normal';
    const offset = { normal: 0, high: 1, ultra: 2 }[quality] || 0;

    const session = this.app.session;
    const width = (session && session.compSettings && session.compSettings.width) || 1920;
    const height = (session && session.compSettings && session.compSettings.height) || 1080;
    const tileSize = (this.app.viewport && this.app.viewport.tileSize) || 256;

    // Approximate viewport tile coverage for current frame + 1 gutter tile margin
    const cols = Math.ceil(width / tileSize * Math.pow(2, offset)) + 2;
    const rows = Math.ceil(height / tileSize * Math.pow(2, offset)) + 2;
    const estTiles = cols * rows;
    const estMB = (estTiles * 0.024).toFixed(1); // ~24KB per compressed tile

    while (this.estimateBadgeEl.firstChild) {
      this.estimateBadgeEl.removeChild(this.estimateBadgeEl.firstChild);
    }
    const spanAction = document.createElement('span');
    spanAction.className = 'est-action';
    spanAction.textContent = 'Finalize:';

    const spanTiles = document.createElement('span');
    spanTiles.className = 'est-tiles';
    spanTiles.textContent = `~${estTiles} tiles`;

    const spanDot = document.createElement('span');
    spanDot.className = 'est-dot';
    spanDot.textContent = '•';

    const spanSize = document.createElement('span');
    spanSize.className = 'est-size';
    spanSize.textContent = `~${estMB} MB`;

    const spanQuality = document.createElement('span');
    spanQuality.className = 'est-quality';
    spanQuality.textContent = `(${quality.toUpperCase()})`;

    this.estimateBadgeEl.appendChild(spanAction);
    this.estimateBadgeEl.appendChild(spanTiles);
    this.estimateBadgeEl.appendChild(spanDot);
    this.estimateBadgeEl.appendChild(spanSize);
    this.estimateBadgeEl.appendChild(spanQuality);
  }

  dispose() {
    if (this._reverseTimer) clearTimeout(this._reverseTimer);
    if (this._activeAbortController) this._activeAbortController.abort();
    this._cache.clear();
    this._bound = false;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = LocationHudController;
else if (typeof window !== 'undefined') window.LocationHudController = LocationHudController;
