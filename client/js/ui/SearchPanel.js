class SearchPanel {
  constructor(inputId, resultsId, viewport, identityResolver) {
    this.input = document.getElementById(inputId);
    this.results = document.getElementById(resultsId);
    this.viewport = viewport;
    this.identityResolver = identityResolver || null;
    this.timer = null;
    this._activeRequest = null;
    this._requestGeneration = 0;
    this._domUnsubscribers = [];
    this._detectedTarget = null;

    this.clearBtn = document.getElementById('search-clear-btn');
    this.pasteBtn = document.getElementById('search-paste-btn');
    this.detectedBadge = document.getElementById('search-detected-badge');
    this.detectedServiceName = document.getElementById('detected-service-name');
    this.detectedCoordsText = document.getElementById('detected-coords-text');
    this.detectedJumpBtn = document.getElementById('detected-jump-btn');
    this.detectedPinBtn = document.getElementById('detected-pin-btn');
    
    this._setupEvents();
  }

  showResults() {
    if (!this.results) return;
    if (this.results.classList && typeof this.results.classList.add === 'function') {
      this.results.classList.add('visible');
    }
    const searchBar = this.input && typeof this.input.closest === 'function' ? this.input.closest('.search-bar') : null;
    if (searchBar && searchBar.classList && typeof searchBar.classList.add === 'function') {
      searchBar.classList.add('search-active');
    }
  }

  hideResults() {
    if (!this.results) return;
    if (this.results.classList && typeof this.results.classList.remove === 'function') {
      this.results.classList.remove('visible');
    }
    const searchBar = this.input && typeof this.input.closest === 'function' ? this.input.closest('.search-bar') : null;
    if (searchBar && searchBar.classList && typeof searchBar.classList.remove === 'function') {
      searchBar.classList.remove('search-active');
    }
  }

  showDetectedBadge(target) {
    if (!this.detectedBadge) return;
    this._detectedTarget = target;
    if (this.detectedServiceName) {
      this.detectedServiceName.textContent = target.source || 'Map Target';
    }
    if (this.detectedCoordsText) {
      if (typeof target.lat === 'number' && typeof target.lng === 'number') {
        const zStr = target.zoom ? ` • Z:${target.zoom}` : '';
        this.detectedCoordsText.textContent = `${target.lat.toFixed(4)}°, ${target.lng.toFixed(4)}${zStr}`;
      } else {
        this.detectedCoordsText.textContent = 'Resolving location...';
      }
    }
    this.detectedBadge.style.display = 'flex';
    this.hideResults();
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons({ root: this.detectedBadge });
    }
  }

  hideDetectedBadge() {
    this._detectedTarget = null;
    if (this.detectedBadge) {
      this.detectedBadge.style.display = 'none';
    }
  }

  jumpToDetectedTarget() {
    if (!this._detectedTarget || !this.viewport) return;
    const { lat, lng, zoom, source } = this._detectedTarget;
    if (typeof lat === 'number' && typeof lng === 'number') {
      this.viewport.setCenter(lat, lng);
      if (typeof zoom === 'number') {
        this.viewport.setZoom(zoom);
      }
      this.hideDetectedBadge();
      this.hideResults();
      if (typeof globalEventBus !== 'undefined') {
        globalEventBus.emit('ui:status', {
          message: `Jumped to ${source || 'Location'} (${lat.toFixed(4)}°, ${lng.toFixed(4)}°)`,
          isError: false
        });
      }
    }
  }

  _setupEvents() {
    if (!this.input || !this.results) return;
    
    // Bind Close Button if it exists
    const closeBtn = document.getElementById('search-close-btn');
    if (closeBtn) {
      this._listen(closeBtn, 'click', () => {
        this.hideResults();
      });
    }
    
    this.resultsList = document.getElementById('search-results-list');

    // Paste from Clipboard Action
    if (this.pasteBtn) {
      this._listen(this.pasteBtn, 'click', async () => {
        try {
          let text = '';
          if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
            text = await navigator.clipboard.readText();
          }
          if (text && text.trim()) {
            this.input.value = text.trim();
            this._processInput(text.trim(), true);
          } else {
            if (typeof globalEventBus !== 'undefined') {
              globalEventBus.emit('ui:status', { message: 'Clipboard is empty or contains non-text content', isError: false });
            }
          }
        } catch (err) {
          console.warn('[SearchPanel] Clipboard read error:', err);
          this.input.focus();
        }
      });
    }

    // Clear Input Action
    if (this.clearBtn) {
      this._listen(this.clearBtn, 'click', () => {
        this.input.value = '';
        this.clearBtn.style.display = 'none';
        this.hideDetectedBadge();
        this.hideResults();
        this.input.focus();
      });
    }

    // Detected Badge Jump Action
    if (this.detectedJumpBtn) {
      this._listen(this.detectedJumpBtn, 'click', () => {
        this.jumpToDetectedTarget();
      });
    }

    // Detected Badge Create Spatial Pin Action
    if (this.detectedPinBtn) {
      this._listen(this.detectedPinBtn, 'click', () => {
        if (!this._detectedTarget) return;
        const target = this._detectedTarget;
        this.jumpToDetectedTarget();
        const pinModal = document.getElementById('spatial-pin-modal');
        if (pinModal) {
          const nameInput = document.getElementById('pin-name-input');
          if (nameInput) nameInput.value = target.placeName || `${target.source || 'Pin'}`;
          const coordsBadge = document.getElementById('pin-coords-badge');
          if (coordsBadge) coordsBadge.textContent = `${target.lat.toFixed(4)}°, ${target.lng.toFixed(4)}°`;
          pinModal.style.display = 'block';
          pinModal.classList.add('visible');
          if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons({ root: pinModal });
          }
          if (nameInput && typeof nameInput.focus === 'function') {
            setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
          }
        }
      });
    }
    
    // Live Input Event
    this._listen(this.input, 'input', () => {
      const query = this.input.value.trim();
      this._processInput(query, false);
    });

    this._listen(this.input, 'focus', () => {
      if (this.resultsList && this.resultsList.children && this.resultsList.children.length > 0 && this.input.value && this.input.value.trim().length >= 3) {
        this.showResults();
      }
    });
    
    this._listen(this.input, 'keydown', (event) => {
      if (event.key === 'Escape') {
        this.hideResults();
        this.hideDetectedBadge();
      } else if (event.key === 'Enter') {
        if (this._detectedTarget) {
          this.jumpToDetectedTarget();
        } else if (this.input.value && this.input.value.trim().length >= 2) {
          this._geocode(this.input.value.trim());
        }
      }
    });

    // Auto-dismiss search results on outside pointer interactions
    this._listen(document, 'pointerdown', (event) => {
      const searchBar = this.input && typeof this.input.closest === 'function' ? this.input.closest('.search-bar') : null;
      if (searchBar && typeof searchBar.contains === 'function' && searchBar.contains(event.target)) return;
      if (this.results && this.results.classList && typeof this.results.classList.contains === 'function' && this.results.classList.contains('visible')) {
        this.hideResults();
      }
      if (this.detectedBadge && this.detectedBadge.style.display !== 'none') {
        this.hideDetectedBadge();
      }
    });
  }

  _processInput(query, autoJump = false) {
    if (this.clearBtn) {
      this.clearBtn.style.display = query && query.length > 0 ? 'flex' : 'none';
    }

    if (!query) {
      this.hideDetectedBadge();
      this.hideResults();
      return;
    }

    const directLoc = this._parseUniversalLocation(query);
    if (directLoc) {
      if (directLoc.isShortlink) {
        this.showDetectedBadge({
          source: 'Resolving Link...',
          lat: null,
          lng: null,
          zoom: 15
        });
        if (typeof UniversalGeoParser !== 'undefined' && UniversalGeoParser.resolveShortlink) {
          UniversalGeoParser.resolveShortlink(directLoc.url).then(resolved => {
            if (resolved && resolved.valid) {
              this.showDetectedBadge(resolved);
              if (autoJump) this.jumpToDetectedTarget();
            } else {
              this.hideDetectedBadge();
            }
          }).catch(() => {
            this.hideDetectedBadge();
          });
        }
        return;
      }

      this.showDetectedBadge(directLoc);
      if (autoJump) {
        this.jumpToDetectedTarget();
      }
      return;
    }

    this.hideDetectedBadge();
    if (query.length < 3) {
      this.hideResults();
      if (this.resultsList) this.resultsList.textContent = '';
      return;
    }

    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._geocode(query), 450);
  }

  _listen(target, eventName, callback, options) {
    if (!target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(eventName, callback, options);
    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      target.removeEventListener(eventName, callback, options);
    };
    this._domUnsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  _parseUniversalLocation(query) {
    if (!query || typeof query !== 'string') return null;
    const str = query.trim();

    if (typeof UniversalGeoParser !== 'undefined' && typeof UniversalGeoParser.parse === 'function') {
      const parsed = UniversalGeoParser.parse(str);
      if (parsed) return parsed;
    }

    // 1. Google Maps @lat,lng,zoom or @lat,lng,meters
    const gmapsMatch = str.match(/google\.[a-z.]+\/maps\/.*@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,([0-9.]+)(?:m|z))?/i);
    if (gmapsMatch) {
      return {
        lat: parseFloat(gmapsMatch[1]),
        lng: parseFloat(gmapsMatch[2]),
        zoom: gmapsMatch[3] ? Math.min(19, Math.max(2, Math.round(parseFloat(gmapsMatch[3])))) : 14,
        source: 'Google Maps'
      };
    }

    // 2. Google Maps query or destination param (?q=lat,lng or ?query=lat,lng)
    const gmapsQueryMatch = str.match(/google\.[a-z.]+\/maps\/.*[?&](?:q|query|destination|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
    if (gmapsQueryMatch) {
      return {
        lat: parseFloat(gmapsQueryMatch[1]),
        lng: parseFloat(gmapsQueryMatch[2]),
        zoom: 14,
        source: 'Google Maps'
      };
    }

    // 3. Apple Maps ?ll=lat,lng&z=zoom
    const appleMatch = str.match(/maps\.apple\.com\/.*[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:.*[?&]z=(\d+))?/i);
    if (appleMatch) {
      return {
        lat: parseFloat(appleMatch[1]),
        lng: parseFloat(appleMatch[2]),
        zoom: appleMatch[3] ? Math.min(19, Math.max(2, parseInt(appleMatch[3], 10))) : 14,
        source: 'Apple Maps'
      };
    }

    // 4. OpenStreetMap #map=zoom/lat/lng
    const osmMatch = str.match(/openstreetmap\.org\/.*#map=(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/i);
    if (osmMatch) {
      return {
        lat: parseFloat(osmMatch[2]),
        lng: parseFloat(osmMatch[3]),
        zoom: Math.min(19, Math.max(2, Math.round(parseFloat(osmMatch[1])))),
        source: 'OpenStreetMap'
      };
    }

    // 5. DMS (Degrees Minutes Seconds): 36°45'10.4"N 3°02'31.4"E or 36 45 10 N, 3 2 31 E
    const dmsRegex = /([0-9.]+)[°\s]+([0-9.]+)['\s]+(?:([0-9.]+)["\s]*)?([NSEWnsew])\s*[, ]\s*([0-9.]+)[°\s]+([0-9.]+)['\s]+(?:([0-9.]+)["\s]*)?([NSEWnsew])/i;
    const dmsMatch = str.match(dmsRegex);
    if (dmsMatch) {
      let lat = parseFloat(dmsMatch[1]) + (parseFloat(dmsMatch[2]) || 0) / 60 + (parseFloat(dmsMatch[3]) || 0) / 3600;
      if (dmsMatch[4].toUpperCase() === 'S') lat = -lat;
      let lng = parseFloat(dmsMatch[5]) + (parseFloat(dmsMatch[6]) || 0) / 60 + (parseFloat(dmsMatch[7]) || 0) / 3600;
      if (dmsMatch[8].toUpperCase() === 'W') lng = -lng;
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return {
          lat: parseFloat(lat.toFixed(6)),
          lng: parseFloat(lng.toFixed(6)),
          zoom: 14,
          source: 'GPS (DMS)'
        };
      }
    }

    // 6. Decimal Coordinates: 36.752887, 3.042048 or 36.752887, 3.042048, 15z
    const decMatch = str.match(/^\s*(?:lat:\s*)?(-?\d+(?:\.\d+)?)\s*[, ]\s*(?:lng:\s*|lon:\s*)?(-?\d+(?:\.\d+)?)(?:\s*[, ]\s*([0-9.]+)\s*z?)?\s*$/i);
    if (decMatch) {
      const lat = parseFloat(decMatch[1]);
      const lng = parseFloat(decMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return {
          lat,
          lng,
          zoom: decMatch[3] ? Math.min(19, Math.max(2, Math.round(parseFloat(decMatch[3])))) : 12,
          source: 'Coordinates'
        };
      }
    }

    return null;
  }

  _geocode(query) {
    if (this._activeRequest) this._activeRequest.abort();
    const generation = ++this._requestGeneration;

    // Universal Coordinate & Map URL Detection
    const directLoc = this._parseUniversalLocation(query);
    if (directLoc) {
      this.viewport.setCenter(directLoc.lat, directLoc.lng);
      if (typeof directLoc.zoom === 'number') {
        this.viewport.setZoom(directLoc.zoom);
      }
      this.hideResults();
      if (typeof globalEventBus !== 'undefined') {
        globalEventBus.emit('ui:status', {
          message: `Jumped to ${directLoc.source} (${directLoc.lat.toFixed(4)}°, ${directLoc.lng.toFixed(4)}°)`,
          isError: false
        });
      }
      return;
    }
    
    // Fetch from Nominatim with bounded HTTPS transport. CEP's XHR follows
    // redirects internally, so the final response URL is verified as well.
    const request = new XMLHttpRequest();
    this._activeRequest = request;
    const requestUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=${encodeURIComponent(query)}`;
    const maxResponseBytes = 1024 * 1024;
    const timeoutMs = typeof NetworkPolicy !== 'undefined' ? NetworkPolicy.timeoutMs(10000, 10000) : 10000;
    const initialValidation = typeof NetworkPolicy !== 'undefined'
      ? NetworkPolicy.validateHttpsUrl(requestUrl)
      : { ok: /^https:\/\//i.test(requestUrl), url: requestUrl };
    if (!initialValidation.ok) {
      if (typeof globalEventBus !== 'undefined') globalEventBus.emit('ui:status', { message: 'Search URL rejected by network policy', isError: true });
      return;
    }
    let networkFailureReported = false;
    const reportNetworkFailure = message => {
      if (networkFailureReported || generation !== this._requestGeneration) return;
      networkFailureReported = true;
      if (typeof globalEventBus !== 'undefined') globalEventBus.emit('ui:status', { message, isError: true });
    };
    request.open('GET', initialValidation.url, true);
    request.timeout = timeoutMs;
    request.onprogress = event => {
      if (event && event.loaded > maxResponseBytes) {
        reportNetworkFailure('Search response exceeded the safety limit');
        try { request.abort(); } catch (_ignoreAbort) { /* request abort fallback */ }
      }
    };
    
    request.onload = () => {
      if (generation !== this._requestGeneration) return;
      const finalValidation = typeof NetworkPolicy !== 'undefined'
        ? NetworkPolicy.validateFinalUrl(initialValidation.url, request.responseURL)
        : { ok: true };
      if (!finalValidation.ok) {
        reportNetworkFailure('Search redirect rejected by network policy');
        return;
      }
      const responseBytes = typeof NetworkPolicy !== 'undefined'
        ? NetworkPolicy.utf8Bytes(request.responseText)
        : String(request.responseText || '').length;
      if (responseBytes > maxResponseBytes) {
        reportNetworkFailure('Search response exceeded the safety limit');
        return;
      }
      let items = [];
      try {
        items = request.status === 200 ? JSON.parse(request.responseText) : [];
      } catch (e) {
        /* JSON parse error fallback */
      }
      if (!Array.isArray(items)) items = [];
      items = items.slice(0, 5).filter(item => item && typeof item === 'object');
      
      if (this.resultsList) this.resultsList.textContent = '';
      
      if (!items.length) {
        this.hideResults();
        if (typeof globalEventBus !== 'undefined') {
          globalEventBus.emit('ui:status', { message: 'No search result — try coordinates', isError: true });
        }
        return;
      }
      
      items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'search-result-item';
        row.style.display = 'flex';
        row.style.justifyContent = 'flex-start'; // Align left, next to name
        row.style.alignItems = 'center';
        
        const identity = this.identityResolver
          ? this.identityResolver.resolve(item, query)
          : { drawingIso3: 'UNKNOWN', displayLabel: String(item.display_name || item.name || ''), confidence: 0, ruleId: 'identity.resolver-unavailable' };
        const displayName = identity.displayLabel;
        const name = displayName.split(',')[0] || item.name || 'Location';
        
        // Left side: Name
        const nameDiv = document.createElement('div');
        nameDiv.style.textOverflow = 'ellipsis';
        nameDiv.style.overflow = 'hidden';
        nameDiv.style.whiteSpace = 'nowrap';
        nameDiv.style.flex = '0 1 auto'; // Shrink if too long, but natural width otherwise
        nameDiv.style.minWidth = '0';
        nameDiv.style.marginRight = '12px'; // Gap between name and icons
        nameDiv.title = displayName;
        nameDiv.textContent = displayName || name;
        
        // Right side: Action icons
        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.alignItems = 'center';
        actionsDiv.style.gap = '8px'; // Increased gap
        actionsDiv.style.flexShrink = '0';
        
        const createBtn = (iconName, title, colorClass, btnWidth, onClick) => {
          const btn = document.createElement('button');
          btn.className = 'toolbar-btn';
          btn.style.width = btnWidth;
          btn.style.height = '24px';
          btn.style.padding = btnWidth === 'auto' ? '0 6px' : '0';
          btn.style.display = 'flex';
          btn.style.alignItems = 'center';
          btn.style.justifyContent = 'center';
          
          const defaultColor = colorClass || 'var(--text-secondary)';
          const hoverBg = colorClass || 'var(--accent-color)';
          
          btn.style.color = defaultColor;
          btn.style.transition = 'all 0.15s ease';
          btn.style.borderRadius = '0px';
          btn.title = title;
          const icon = typeof SecurityPolicy !== 'undefined'
            ? SecurityPolicy.createLucideIcon(document, iconName, 14)
            : document.createElement('i');
          if (!icon.getAttribute('data-lucide')) icon.setAttribute('data-lucide', iconName);
          icon.style.width = '14px';
          icon.style.height = '14px';
          btn.appendChild(icon);
          
          btn.addEventListener('mouseenter', () => {
             btn.style.backgroundColor = hoverBg;
             btn.style.color = '#ffffff';
          });
          btn.addEventListener('mouseleave', () => {
             btn.style.backgroundColor = 'transparent';
             btn.style.color = defaultColor;
          });
          
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick(btn);
          });
          return btn;
        };
        
        const jumpToLocation = () => {
          const bbox = item.boundingbox;
          if (bbox && bbox.length === 4) {
            // Nominatim bbox is [south, north, west, east]
            this.viewport.fitBounds(bbox[0], bbox[1], bbox[2], bbox[3], 60);
          } else {
            this.viewport.setCenter(parseFloat(item.lat), parseFloat(item.lon));
            this.viewport.setZoom(12);
          }
          this.hideResults();
        };
        
        // 1. Jump Button
        actionsDiv.appendChild(createBtn('crosshair', 'Jump to location', '', '24px', () => {
          jumpToLocation();
        }));
        
        // 2. Pin Button
        actionsDiv.appendChild(createBtn('map-pin', 'Drop Spatial Pin', '', '24px', () => {
          jumpToLocation();
          if (typeof globalEventBus !== 'undefined') {
            globalEventBus.emit('marker:add', { lat: parseFloat(item.lat), lng: parseFloat(item.lon), label: name });
            globalEventBus.emit('toast:show', { message: 'Pin added at ' + name, type: 'success' });
          }
        }));
        
        // 3. The pen draws the exact local 10m land perimeter: international
        // borders plus the coastline that bounds the country's land. It is
        // also valid for a city result: the enclosing country is used.
        if (identity.drawingIso3 !== 'UNKNOWN') {
          const drawBtn = createBtn('pen-tool', 'Draw local 10m country outline (land borders + coastline)', 'var(--accent-color)', '24px', () => {
            this.hideResults();
            if (typeof globalEventBus !== 'undefined') {
              globalEventBus.emit('search:drawCountryOutline', {
                countryCode: identity.drawingIso3,
                searchName: name,
                item: item,
                identity: identity
              });
            }
          });
          actionsDiv.appendChild(drawBtn);
        }
        
        row.appendChild(nameDiv);
        row.appendChild(actionsDiv);
        
        // Default click on row = Jump
        row.addEventListener('click', () => {
          jumpToLocation();
        });
        
        if (this.resultsList) this.resultsList.appendChild(row);
      });
      
      this.showResults();
      
      if (typeof lucide !== 'undefined' && this.resultsList) {
        lucide.createIcons({ root: this.resultsList });
      }
    };
    
    request.onerror = () => {
      reportNetworkFailure('Search network unavailable — enter lat,lng');
    };
    request.ontimeout = () => reportNetworkFailure('Search timed out — enter lat,lng or retry');
    request.onabort = () => {};
    
    request.send();
  }

  dispose() {
    clearTimeout(this.timer);
    this._requestGeneration += 1;
    if (this._activeRequest) this._activeRequest.abort();
    this._activeRequest = null;
    this._domUnsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
    if (this.resultsList) this.resultsList.textContent = '';
    this.hideResults();
  }
}
