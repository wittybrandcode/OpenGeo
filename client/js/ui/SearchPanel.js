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
    
    this._setupEvents();
  }

  _setupEvents() {
    if (!this.input || !this.results) return;
    
    // Bind Close Button if it exists
    const closeBtn = document.getElementById('search-close-btn');
    if (closeBtn) {
      this._listen(closeBtn, 'click', () => {
        this.results.classList.remove('visible');
      });
    }
    
    this.resultsList = document.getElementById('search-results-list');
    
    this._listen(this.input, 'input', () => {
      clearTimeout(this.timer);
      const query = this.input.value.trim();
      
      if (query.length < 3) {
        this.results.classList.remove('visible');
        if (this.resultsList) this.resultsList.textContent = '';
        return;
      }
      
      this.timer = setTimeout(() => this._geocode(query), 450);
    });
    
    this._listen(this.input, 'keydown', (event) => {
      if (event.key === 'Escape') {
        this.results.classList.remove('visible');
      }
    });
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

  _geocode(query) {
    if (this._activeRequest) this._activeRequest.abort();
    const generation = ++this._requestGeneration;
    // Check for raw coordinates
    const match = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (match) {
      this.viewport.setCenter(parseFloat(match[1]), parseFloat(match[2]));
      this.viewport.setZoom(12);
      this.results.classList.remove('visible');
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
        try { request.abort(); } catch (_ignoreAbort) {}
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
      } catch (e) {}
      if (!Array.isArray(items)) items = [];
      items = items.slice(0, 5).filter(item => item && typeof item === 'object');
      
      if (this.resultsList) this.resultsList.textContent = '';
      
      if (!items.length) {
        this.results.classList.remove('visible');
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
          btn.style.borderRadius = '3px';
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
      
      this.results.classList.add('visible');
      
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
    if (this.results) this.results.classList.remove('visible');
  }
}
