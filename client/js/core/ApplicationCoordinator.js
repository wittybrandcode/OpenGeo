/** Coordinates cross-module events without owning DOM or implementation details. */
class ApplicationCoordinator {
  constructor(app) {
    this.app = app;
    this.lifecycle = app.lifecycle;
    this._prefsSaveTimer = null;
    this._started = false;
  }

  start() {
    if (this._started) return;
    this._started = true;
    const app = this.app;
    app.operationPresenter.start();
    this.lifecycle.subscribe('viewport:changed', () => {
      if (app._suppressViewportEffects) return;
      app._triggerTileUpdate();
      this.updateUIInfo();
      this.schedulePrefsSave();
      app._scheduleMetadataSave();
      if (app.previewMode === 'raster') {
        app.syncManager.queueAutoExport();
        if (app.isKeyframeRecording) app.syncManager.queueTrajectoryPreview();
      }
    });
    this.lifecycle.subscribe('tiles:renderReady', tiles => {
      app._schedulePreviewRender(tiles);
      this.updateUIInfo();
    });
    this.lifecycle.subscribe('overlay:changed', () => app._schedulePreviewRender());
    this.lifecycle.subscribe('providers:updated', () => this._onProvidersUpdated());
    this.lifecycle.subscribe('settings:sourceChanged', source => this._onSourceChanged(source));
    this.lifecycle.subscribe('settings:tileSizeChanged', size => this._onTileSizeChanged(size));
    this.lifecycle.subscribe('sync:compChanged', data => this._onCompositionChanged(data));
    this.lifecycle.subscribe('sync:aeCamera', camera => this._onAeCamera(camera));
  }

  _onProvidersUpdated() {
    const app = this.app;
    const select = document.getElementById('tile-source');
    const sourceKey = select ? select.value : 'esri';
    this._onSourceChanged(sourceKey);
    globalEventBus.emit('toast:show', { message: 'Provider settings updated', type: 'success' });
  }

  _onSourceChanged(source) {
    const app = this.app;
    const provider = app.providerManager.getProvider(source);
    if (!provider) return;
    const validation = app.providerManager.validateProvider(source);
    if (!validation.ok) {
      const select = document.getElementById('tile-source');
      if (select) select.value = app.tileManager.source;
      globalEventBus.emit('toast:show', { message: validation.message, type: 'error', duration: 4000 });
      return;
    }
    // Cancel and invalidate requests captured from either another provider id
    // or an older definition of this same id before changing shared state.
    if (app.syncManager) app.syncManager.invalidateForProviderChange();
    app.session.setProvider(source);
    app.viewport.minZoom = provider.minZoom || 2;
    app.viewport.maxZoom = provider.maxZoom || 19;
    app.viewport.setZoom(app.viewport.zoom);
    app.tileManager.setSource(source, app.providerManager.getSignature(source));
    app.settingsPanel.updateAttribution(source);
    globalEventBus.emit('ui:status', { message: 'Loading ' + provider.name, isError: false });
    app._triggerTileUpdate();
    if (app.previewMode === 'raster' && app.activeCompId && app.syncManager) {
      app.syncManager.queueAutoExport();
    }
    this.savePrefs();
    app._scheduleMetadataSave();
  }

  _onTileSizeChanged(size) {
    if (size !== 256 && size !== 512) return;
    const app = this.app;
    if (app.syncManager) app.syncManager.invalidateBackgroundWork();
    app.session.setTileSize(size);
    app.tileManager.clearCache();
    app.tileManager.setSource(app.tileManager.source, app.providerManager.getSignature(app.tileManager.source));
    globalEventBus.emit('ui:status', { message: 'Tile size: ' + size + 'px', isError: false });
    app._triggerTileUpdate();
    if (app.previewMode === 'raster' && app.activeCompId && app.syncManager) {
      app.syncManager.queueAutoExport();
    }
    this.savePrefs();
    app._scheduleMetadataSave();
  }

  _onAeCamera(camera) {
    const app = this.app;
    if (camera) {
      app._suppressViewportEffects = true;
      app.syncEngine.isApplyingAeState = true;
      try {
        const pitch = Math.max(0, Math.min(45, camera.pitch || 0));
        app.session.setCamera({
          lat: camera.lat,
          lng: camera.lng,
          compZoom: camera.zoom,
          pitch: pitch
        }, { origin: 'ae' });
        if (app.locationHudController) {
          app.locationHudController.updatePitch(pitch);
        }
      } finally {
        app.syncEngine.isApplyingAeState = false;
        app._suppressViewportEffects = false;
      }
    }
    app._triggerTileUpdate();
    this.updateUIInfo();
    this.schedulePrefsSave();
    app._scheduleMetadataSave();
  }

  _onCompositionChanged(data) {
    const app = this.app;
    const compId = data && data.newId ? data.newId : null;
    if (app.toolbarController) app.toolbarController.syncKeyframeRecordingState(compId);
    return app._loadCompositionState(compId);
  }

  updateUIInfo() {
    const app = this.app;
    const lat = document.getElementById('coord-lat');
    const lng = document.getElementById('coord-lng');
    const zoom = document.getElementById('coord-zoom');
    if (lat) lat.textContent = app.viewport.centerLat.toFixed(4) + '°';
    if (lng) lng.textContent = app.viewport.centerLng.toFixed(4) + '°';
    if (zoom) zoom.textContent = 'Z: ' + app.mapState.compZoom.toFixed(1);
    const stats = document.querySelector('#cache-stats p');
    if (stats) {
      const info = app.tileManager.getStats();
      stats.textContent = `Tiles: ${info.loadedTiles}/${info.visibleTiles} | Cache: ${info.cache.size}/${info.cache.max} | Errors: ${info.download.errors}`;
    }
    if (app.locationHudController) {
      app.locationHudController.update();
    }
  }

  savePrefs() { this.app.preferencesStore.saveSession(this.app.session); }

  schedulePrefsSave() {
    if (this._prefsSaveTimer) clearTimeout(this._prefsSaveTimer);
    this._prefsSaveTimer = setTimeout(() => {
      this._prefsSaveTimer = null;
      this.savePrefs();
    }, 180);
  }

  dispose() {
    if (this._prefsSaveTimer) clearTimeout(this._prefsSaveTimer);
    this._prefsSaveTimer = null;
    this._started = false;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = ApplicationCoordinator;
else if (typeof window !== 'undefined') window.ApplicationCoordinator = ApplicationCoordinator;
