class Viewport {
  constructor(stateOwner, options = {}) {
    this.session = stateOwner && stateOwner.mapState && typeof stateOwner.setCamera === 'function' ? stateOwner : null;
    this.mapState = this.session ? this.session.mapState : stateOwner;
    this.minZoom = options.minZoom === undefined ? 2 : options.minZoom;
    this.maxZoom = options.maxZoom === undefined ? 19 : options.maxZoom;
    if (options.tileSize && options.tileSize !== this.mapState.tileSize) this.tileSize = options.tileSize;
    
    // Initial values
    if (options.centerLat !== undefined || options.centerLng !== undefined) {
      this._commitCamera({
        lat:
        options.centerLat === undefined ? 25.2048 : options.centerLat,
        lng: options.centerLng === undefined ? 55.2708 : options.centerLng
      }, 'bootstrap');
    }
    if (options.zoom !== undefined) {
      this._commitCamera({ uiZoom: this.clampZoom(options.zoom) }, 'bootstrap');
    }
  }

  // Getters that act as proxies to mapState
  get width() { return this.mapState.panelWidth; }
  get height() { return this.mapState.panelHeight; }
  get centerLat() { return this.mapState.latitude; }
  get centerLng() { return this.mapState.longitude; }
  get zoom() { return this.mapState.getUIZoom(); }
  get pitch() { return this.mapState.getPitch(); }
  setPitch(deg, origin = 'ui') {
    this.mapState.setPitch(deg);
    this._commitCamera({ pitch: this.mapState.getPitch() }, origin);
    this._emitChanged();
  }
  set tileSize(val) {
    if (this.session) this.session.setTileSize(val, { origin: 'viewport' });
    else this.mapState.tileSize = val;
  }
  get tileSize() { return this.mapState.tileSize; }

  clampZoom(z) { 
    return Math.max(this._getSafeMinZoom(), Math.min(this.maxZoom, Number(z) || this.minZoom)); 
  }

  _getSafeMinZoom() {
    // Keep a full tile guard band beyond each side of the visible panel. This
    // prevents the first render from exposing an empty edge while priority
    // requests are still resolving, without imposing a fixed resolution.
    const panelWidth = Math.max(1, this.width || 0);
    const guardBandPixels = this.tileSize * 2;
    const coverageZoom = Math.log2((panelWidth + guardBandPixels) / this.tileSize);
    return Math.max(this.minZoom, Math.min(this.maxZoom, coverageZoom));
  }

  setSize(w, h) {
    const numW = Math.max(0, Math.round(Number(w) || 0));
    const numH = Math.max(0, Math.round(Number(h) || 0));
    if (numW === this.width && numH === this.height) return;
    const prevCompZoom = this.mapState.compZoom;
    this.mapState.updatePanelSize(numW, numH);
    // Only lift an undersized initial viewport. We never zoom a user out on
    // resize, so their chosen composition framing remains stable.
    if (this.zoom < this._getSafeMinZoom()) this._commitCamera({ uiZoom: this._getSafeMinZoom() });
    if (Math.abs(this.mapState.compZoom - prevCompZoom) > 1e-6) {
      this._emitChanged();
    }
  }

  setZoom(z) {
    const targetZoom = this.clampZoom(z);
    if (targetZoom === this.zoom) return;
    this._commitCamera({ uiZoom: targetZoom });
    this._emitChanged();
  }

  setCenter(lat, lng) {
    const numLat = Number(lat);
    const numLng = Number(lng);
    if (numLat === this.centerLat && numLng === this.centerLng) return;
    this._commitCamera({ lat: numLat, lng: numLng });
    this._emitChanged();
  }

  zoomAtGeoPoint(newZoom, geoLat, geoLng, px, py) {
    const targetZoom = this.clampZoom(newZoom);
    if (targetZoom === this.zoom) return;

    const focusWorld = MercatorProjection.latLngToWorldPoint(geoLat, geoLng, targetZoom, this.tileSize);
    const centerWorldX = focusWorld.x - (px - this.width / 2);
    const centerWorldY = focusWorld.y - (py - this.height / 2);

    const newCenter = MercatorProjection.worldPointToLatLng(centerWorldX, centerWorldY, targetZoom, this.tileSize);
    this._commitCamera({ lat: newCenter.lat, lng: newCenter.lng, uiZoom: targetZoom });
    this._emitChanged();
  }

  zoomAtPoint(newZoom, px, py) {
    const focus = this.screenToLatLng(px, py);
    this.zoomAtGeoPoint(newZoom, focus.lat, focus.lng, px, py);
  }

  pan(dx, dy) {
    if (!dx && !dy) return;
    const newCenter = this.screenToLatLng(this.width / 2 - dx, this.height / 2 - dy);
    this._commitCamera({ lat: newCenter.lat, lng: newCenter.lng });
    this._emitChanged();
  }

  _effectiveCenterWorld() {
    return MercatorProjection.latLngToWorldPoint(this.centerLat, this.centerLng, this.zoom, this.tileSize);
  }

  fitBounds(south, north, west, east, padding = 60) {
    const southLat = parseFloat(south);
    const northLat = parseFloat(north);
    let wLng = parseFloat(west);
    let eLng = parseFloat(east);
    
    let centerLng = (wLng + eLng) / 2;
    if (wLng > eLng) {
      centerLng = (wLng + eLng + 360) / 2;
      if (centerLng > 180) centerLng -= 360;
    }
    
    let bestZoom = this.minZoom;
    const targetW = Math.max(10, this.width - padding);
    const targetH = Math.max(10, this.height - padding);
    
    for (let z = this.maxZoom; z >= this.minZoom; z--) {
      let lngDiff = eLng - wLng;
      if (lngDiff < 0) lngDiff += 360;
      
      const size = MercatorProjection.getWorldSize(z, this.tileSize);
      let w = (lngDiff / 360) * size;
      
      const sw = MercatorProjection.latLngToWorldPoint(south, west, z, this.tileSize);
      const ne = MercatorProjection.latLngToWorldPoint(north, east, z, this.tileSize);
      const h = Math.abs(sw.y - ne.y);
      
      if (w <= targetW && h <= targetH) {
        bestZoom = z;
        break;
      }
    }
    
    // Web Mercator is non-linear in latitude. Centering in projected space
    // gives north/south bounds equal visual margins, including high latitudes.
    const southWorld = MercatorProjection.latLngToWorldPoint(southLat, centerLng, 0, this.tileSize);
    const northWorld = MercatorProjection.latLngToWorldPoint(northLat, centerLng, 0, this.tileSize);
    const centerLat = MercatorProjection.worldPointToLatLng(southWorld.x, (southWorld.y + northWorld.y) / 2, 0, this.tileSize).lat;
    this._commitCamera({ lat: centerLat, lng: centerLng, uiZoom: bestZoom });
    this._emitChanged();
  }

  latLngToScreen(lat, lng) {
    const point = MercatorProjection.latLngToWorldPoint(lat, lng, this.zoom, this.tileSize);
    const center = this._effectiveCenterWorld();
    const size = MercatorProjection.getWorldSize(this.zoom, this.tileSize);
    let dx = point.x - center.x;
    if (dx > size / 2) dx -= size;
    if (dx < -size / 2) dx += size;
    return { 
      x: dx + this.width / 2, 
      y: point.y - center.y + this.height / 2 
    };
  }

  screenToLatLng(px, py) {
    const center = this._effectiveCenterWorld();
    const size = MercatorProjection.getWorldSize(this.zoom, this.tileSize);
    let targetWorldX = center.x + px - this.width / 2;
    const targetWorldY = center.y + py - this.height / 2;
    if (targetWorldX < 0) targetWorldX = ((targetWorldX % size) + size) % size;
    if (targetWorldX > size) targetWorldX = targetWorldX % size;
    return MercatorProjection.worldPointToLatLng(targetWorldX, targetWorldY, this.zoom, this.tileSize);
  }

  getCenterCoords() {
    return { lat: this.centerLat, lng: this.centerLng, zoom: this.zoom, pitch: this.pitch };
  }

  _commitCamera(camera, origin) {
    if (this.session) {
      this.session.setCamera(camera, { origin: origin || 'viewport' });
      return;
    }
    if (Number.isFinite(camera.lat) && Number.isFinite(camera.lng)) this.mapState.setCenter(camera.lat, camera.lng);
    if (Number.isFinite(camera.compZoom)) this.mapState.compZoom = camera.compZoom;
    else if (Number.isFinite(camera.uiZoom)) this.mapState.setUIZoom(camera.uiZoom);
    if (Number.isFinite(camera.pitch)) this.mapState.setPitch(camera.pitch);
  }
  
  _emitChanged() {
    if (typeof globalEventBus !== 'undefined') {
      const eventName = typeof OpenGeoEvents !== 'undefined' ? OpenGeoEvents.VIEWPORT_CHANGED : 'viewport:changed';
      globalEventBus.emit(eventName, this.getCenterCoords());
    }
  }
}
