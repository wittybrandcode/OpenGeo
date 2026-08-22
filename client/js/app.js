class App {
  constructor() {
    this.config = OpenGeoConfig;
    this.aeBridge = new AEBridge();
    this.lifecycle = new ApplicationLifecycle(globalEventBus);
    this.operationLogger = typeof OperationLogger !== 'undefined' ? new OperationLogger(globalEventBus) : null;
    this._suppressViewportEffects = false;
    this.isKeyframeRecording = false;
    this.previewMode = localStorage.getItem('opengeo_preview_mode') === 'vector' ? 'vector' : 'raster';
    
    // Initialize New Core Foundation Services
    this.geoDataRepository = typeof GeoDataRepository !== 'undefined' ? new GeoDataRepository() : null;
    this.cartographyPolicy = typeof CartographyPolicy !== 'undefined'
      ? new CartographyPolicy(this.geoDataRepository) : null;
    this.geographyIdentityResolver = typeof GeographyIdentityResolver !== 'undefined'
      ? new GeographyIdentityResolver(this.geoDataRepository) : null;
    this.jobManager = typeof JobManager !== 'undefined' ? new JobManager() : null;
    this.providerManager = typeof ProviderManager !== 'undefined' ? new ProviderManager() : null;
    
    this.preferencesStore = new PreferencesStore(localStorage, 'opengeo_prefs', this.config, OpenGeoStateContracts);
    this.prefs = this.preferencesStore.load();
    
    // Validate sourceKey
    let sourceKey = this.prefs.source || this.config.defaults.tileSource;
    if (!this.providerManager || !this.providerManager.getProvider(sourceKey)) sourceKey = this.config.defaults.tileSource;
    
    const tileSize = this.prefs.tileSize === 512 ? 512 : 256;
    
    // MapSession is the client-side source of truth. MapState remains its
    // projection/layout implementation while legacy modules are migrated.
    this.session = new MapSession(this.config, this.prefs);
    this.featureRegistry = new FeatureRegistry();
    this.session.attachFeatureRegistry(this.featureRegistry);
    this.mapState = this.session.mapState;
    
    this.viewport = new Viewport(this.session, {
      tileSize: tileSize
    });
    this.stateHydrator = new StateHydrator(this.session, this.providerManager);
    
    this.tileManager = new TileManager({
      source: sourceKey,
      sourceSignature: this.providerManager.getSignature(sourceKey),
      cacheMemoryLimit: this.config.defaults.cacheMemoryLimit,
      downloadConcurrency: this.config.defaults.downloadConcurrency,
      downloadRetries: this.config.defaults.downloadRetries,
      downloadTimeout: this.config.defaults.downloadTimeout
    });
    
    this.mapRenderer = new MapRenderer();
    this.vectorPreviewLayer = typeof VectorPreviewLayer !== 'undefined'
      ? new VectorPreviewLayer(this.viewport, this.geoDataRepository) : null;
    this.metadataManager = new MetadataManager(this.aeBridge, this.cartographyPolicy);
    this.syncEngine = new AESyncEngine(this.aeBridge, this.session);
    this.spatialPin = new SpatialPin(this.aeBridge);
    
    // Core Managers
    this.syncManager = new SyncManager(this);
    this.finalizeController = typeof FinalizeController !== 'undefined' ? new FinalizeController(this) : null;
    this.vectorMapManager = new VectorMapManager(this);
    this.featureManager = new FeatureManager(this, this.featureRegistry);
    this.compositionController = new CompositionController(this);
    
    // Initialize Overlays
    this.markerLayer = new MarkerLayer(this.viewport);
    this.geoJSONValidator = typeof GeoJSONValidator !== 'undefined' ? new GeoJSONValidator() : null;
    this.geoJSONLayer = new GeoJSONLayer(this.viewport, this.geoJSONValidator);
    this.featureOverlayLayer = new FeatureOverlayLayer(this.viewport, this.featureRegistry);
    this.previewController = new PreviewController(this, this.previewMode);
    this.operationPresenter = new OperationPresenter(globalEventBus, this.lifecycle);
    this.toolbarController = new ToolbarController(this);
    this.coordinator = new ApplicationCoordinator(this);
    
    this._setupUI();
    this._setupEventHandlers();
  }

  init() {
    const canvas = document.getElementById('map-canvas');
    const container = document.querySelector('.map-container');
    
    if (!canvas || !container) {
      globalEventBus.emit('ui:status', { message: 'Map canvas is unavailable', isError: true });
      return;
    }
    
    this.mapRenderer.attachCanvas(canvas);
    this._setPreviewMode(this.previewMode, { silent: true });
    
    // UI modules
    this.inputHandler = new InputHandler(canvas, this.viewport);
    this.searchPanel = new SearchPanel('search-input', 'search-results', this.viewport, this.geographyIdentityResolver);
    this.settingsPanel = new SettingsPanel(this.config, this.providerManager);
    this.toast = new Toast();
    this.dialog = new DialogManager();
    this.layersPanel = new LayersPanel(this);
    this.projectMapsPanel = new ProjectMapsPanel(this);
    
    this.settingsPanel.updateState(this.tileManager.source, this.viewport.tileSize, localStorage.getItem('opengeo_theme') || 'dark');
    
    this._setupResize(container);
    
    // Initial Render
    if (this.prefs.isNewVersion && this.config.defaults.defaultBounds) {
      const b = this.config.defaults.defaultBounds;
      this.viewport.fitBounds(b[0], b[1], b[2], b[3], 60);
      this._savePrefs(); // Save the precise calculated zoom
    }
    
    this._triggerTileUpdate();
    this._updateUIInfo();
    // Live Sync is a core interaction, not an optional mode. Starting it here
    // also restores synchronization for an already-open OpenGeo composition.
    this.syncEngine.start();
    
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    
    // --- Splash Screen Logic ---
    const splash = document.getElementById('splash-screen');
    const splashLogo = document.getElementById('splash-logo');
    if (splash) {
      const hideSplash = () => {
        if (!splash.classList.contains('splash-hidden')) {
          splash.classList.add('splash-hidden');
        }
      };
      if (splashLogo) {
        this._listen(splashLogo, 'click', hideSplash);
      }
    }
    
    globalEventBus.emit('ui:status', { message: 'Real Earth satellite map ready', isError: false });
  }

  _setupUI() {
    this.toolbarController.bind();
  }

  _setupEventHandlers() {
    this.coordinator.start();
  }

  _setupResize(container) {
    const resize = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        this.viewport.setSize(container.clientWidth, container.clientHeight);
        this.mapRenderer.resize(container.clientWidth, container.clientHeight);
        
        this._refreshCompositionFrame();
        
        this._triggerTileUpdate();
      }
    };
    
    if (window.ResizeObserver) {
      this._resizeObserver = new ResizeObserver(resize);
      this._resizeObserver.observe(container);
    }
    this._resizeHandler = resize;
    this._listen(window, 'resize', this._resizeHandler);
    setTimeout(resize, 0);
  }

  dispose() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this.inputHandler) this.inputHandler.dispose();
    if (this.searchPanel) this.searchPanel.dispose();
    if (this.settingsPanel) this.settingsPanel.dispose();
    if (this.toast) this.toast.dispose();
    if (this.tileManager) this.tileManager.dispose();
    if (this.syncEngine) this.syncEngine.dispose();
    if (this.syncManager) this.syncManager.dispose();
    if (this.finalizeController) this.finalizeController.dispose();
    if (this.vectorMapManager) this.vectorMapManager.dispose();
    if (this.featureManager) this.featureManager.dispose();
    if (this.layersPanel) this.layersPanel.dispose();
    if (this.projectMapsPanel) this.projectMapsPanel.dispose();
    if (this.dialog) this.dialog.dispose();
    if (this.markerLayer) this.markerLayer.dispose();
    if (this.geoJSONLayer) this.geoJSONLayer.dispose();
    if (this.vectorPreviewLayer) this.vectorPreviewLayer.dispose();
    if (this.previewController) this.previewController.dispose();
    if (this.compositionController) this.compositionController.dispose();
    if (this.toolbarController) this.toolbarController.dispose();
    if (this.coordinator) this.coordinator.dispose();
    if (this.operationLogger) this.operationLogger.dispose();
    if (this.lifecycle) this.lifecycle.dispose();
  }

  _listen(target, eventName, callback, options) {
    return this.lifecycle.listen(target, eventName, callback, options);
  }

  async _loadCompositionState(compId) {
    return this.compositionController.load(compId);
  }

  _refreshCompositionFrame() {
    this.compositionController.refreshFrame();
  }

  _scheduleMetadataSave() {
    this.compositionController.scheduleSave();
  }

  _triggerTileUpdate() {
    this.previewController.triggerTileUpdate();
  }

  _schedulePreviewRender(tiles) {
    this.previewController.scheduleRender(tiles);
  }

  _setPreviewMode(mode, options = {}) {
    return this.previewController.setMode(mode, options);
  }

  _getTileUrls(source, x, y, z) {
    const urls = [];
    const mainUrl = this._buildTileUrl(source, x, y, z);
    if (mainUrl) urls.push({ source: source, url: mainUrl });
    // No cross-provider fallback — source isolation enforced.
    // Missing tiles are handled by parent-tile scaling in TileManager.
    return urls;
  }

  _buildTileUrl(source, x, y, z) {
    return this.providerManager.buildTileUrl(source, x, y, z) || null;
  }

  _updateUIInfo() {
    this.coordinator.updateUIInfo();
  }

  _savePrefs() {
    this.coordinator.savePrefs();
  }

  get activeCompId() {
    return this.session && this.session.composition ? this.session.composition.compId : null;
  }

  set activeCompId(compId) {
    if (!this.session) return;
    this.session.setComposition(Object.assign({}, this.session.composition || {}, { compId: compId || null }));
  }
}

// Bootstrap
window.addEventListener('error', (e) => {
  const msg = `${e.message} at ${e.filename}:${e.lineno}`;
  const el = document.getElementById('status-text');
  if (el) { el.textContent = msg; el.style.color = '#e34850'; }
  if (typeof globalEventBus !== 'undefined') globalEventBus.emit('error:report', {
    code: 'WINDOW_RUNTIME_ERROR', message: e.message || 'Unknown runtime error', source: e.filename || null,
    line: e.lineno || null, column: e.colno || null, stack: e.error && e.error.stack
  });
});
window.addEventListener('unhandledrejection', event => {
  const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Unhandled rejection'));
  if (typeof globalEventBus !== 'undefined') globalEventBus.emit('error:report', {
    code: reason.code || 'UNHANDLED_REJECTION', message: reason.message, stack: reason.stack
  });
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    try { window.app = new App(); window.app.init(); } catch (e) { window.dispatchEvent(new ErrorEvent('error', { message: e.toString() })); }
  });
} else {
  try { window.app = new App(); window.app.init(); } catch (e) { window.dispatchEvent(new ErrorEvent('error', { message: e.toString() })); }
}
