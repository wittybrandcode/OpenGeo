/** Owns composition creation, active-document hydration and guarded metadata writes. */
class CompositionController {
  constructor(app) {
    this.app = app;
    this.loadRevision = 0;
    this.saveTimer = null;
  }

  create(settings) {
    this.app.session.createDocument();
    this.app.syncEngine.beginNewDocument();
    if (this.app.toolbarController) this.app.toolbarController.syncKeyframeRecordingState(null);
    this.app.session.setComposition({ width: settings.width, height: settings.height, displayName: settings.displayName || 'OpenGeo Map' });
    this.app._updateUIInfo();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
    return this.app.syncManager.exportToAE(true, false, false, settings);
  }

  hydrate(state, compId) {
    this.app._suppressViewportEffects = true;
    this.app.syncEngine.isApplyingAeState = true;
    try {
      const result = this.app.stateHydrator.hydrate(state, compId);
      if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
      const restored = result.snapshot;
      this.refreshFrame();
      this.app.settingsPanel.updateState(restored.providerId, restored.camera.tileSize, localStorage.getItem('opengeo_theme') || 'dark');
      const provider = this.app.providerManager.getProvider(restored.providerId);
      if (provider) {
        this.app.viewport.minZoom = provider.minZoom || 2;
        this.app.viewport.maxZoom = provider.maxZoom || 19;
        this.app.tileManager.setSource(restored.providerId, this.app.providerManager.getSignature(restored.providerId));
        this.app.settingsPanel.updateAttribution(restored.providerId);
      }
      if (restored && restored.camera && this.app.viewport && typeof this.app.viewport.setCenter === 'function') {
        this.app.viewport.setCenter(restored.camera.lat, restored.camera.lng);
        if (typeof this.app.viewport.setZoom === 'function' && typeof this.app.viewport.clampZoom === 'function') {
          this.app.viewport.setZoom(this.app.viewport.clampZoom(this.app.mapState.getUIZoom()));
        }
      }
      return result;
    } finally {
      this.app.syncEngine.isApplyingAeState = false;
      this.app._suppressViewportEffects = false;
    }
  }

  async load(compId) {
    const revision = ++this.loadRevision;
    const previewDrafts = this.app.featureManager
      ? this.app.featureManager.registry.list().filter(item => item.hostPresent === false && item.previewPayload)
      : [];
    this.app.activeCompId = compId;
    this.cancelPendingSave();
    if (!compId) {
      if (this.app.featureManager) await this.app.featureManager.hydrate(previewDrafts);
      if (revision !== this.loadRevision || this.app.activeCompId) return false;
      this.app._schedulePreviewRender();
      globalEventBus.emit('ui:status', { message: 'No active OpenGeo composition.', isError: false });
      return false;
    }
    const state = await this.app.metadataManager.loadFromComp(compId);
    if (revision !== this.loadRevision || this.app.activeCompId !== compId) return false;
    if (!state) {
      if (this.app.featureManager) await this.app.featureManager.hydrate([]);
      if (revision !== this.loadRevision || this.app.activeCompId !== compId) return false;
      return false;
    }
    this.hydrate(state, compId);
    if (this.app.featureManager) {
      const features = Array.isArray(state.features) ? state.features.slice() : [];
      const known = {};
      features.forEach(item => { if (item && item.id) known[String(item.id)] = true; });
      previewDrafts.forEach(item => { if (!known[String(item.id)]) features.push(item); });
      await this.app.featureManager.hydrate(features);
    }
    if (revision !== this.loadRevision || this.app.activeCompId !== compId) return false;
    this.app._triggerTileUpdate();
    this.app._updateUIInfo();
    globalEventBus.emit('ui:status', { message: 'Loaded comp state', isError: false });
    return true;
  }

  async resolveActiveMapTarget() {
    let state = null;
    try {
      state = await this.app.aeBridge.invoke('camera.getActive', {}, { timeoutMs: 10000 });
    } catch (error) {
      console.warn('[CompositionController] Could not validate the active OpenGeo map:', error.message);
      // A transient CEP/Host failure is not evidence that the current map was
      // closed. Refuse the pending draw, but preserve the last confirmed UI
      // identity until a successful host response explicitly reports no map.
      return null;
    }
    const nextCompId = state && state.compId && state.controllerId ? state.compId : null;
    const currentCompId = this.app.activeCompId;
    const changed = String(currentCompId || '') !== String(nextCompId || '');
    if (changed) {
      if (this.app.syncEngine) this.app.syncEngine.setActiveComp(nextCompId);
      else this.app.activeCompId = nextCompId;
      if (this.app.toolbarController) this.app.toolbarController.syncKeyframeRecordingState(nextCompId);
      await this.load(nextCompId);
    }
    return nextCompId;
  }

  refreshFrame() {
    const box = typeof document.querySelector === 'function' ? document.querySelector('.framing-box-inner') : null;
    if (!box || !this.app.mapState) return;
    box.style.width = this.app.mapState.frameWidth + 'px';
    box.style.height = this.app.mapState.frameHeight + 'px';
  }

  scheduleSave() {
    this.cancelPendingSave();
    const compId = this.app.activeCompId;
    const documentId = this.app.session ? this.app.session.documentId : null;
    const loadRevision = this.loadRevision;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      if (!compId || this.app._suppressViewportEffects || this.app.activeCompId !== compId ||
          this.loadRevision !== loadRevision || !this.app.session || this.app.session.documentId !== documentId) return;
      await this.app.metadataManager.saveToComp(compId, this.app.viewport, this.app.tileManager, this.app.session);
    }, 500);
  }

  cancelPendingSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  dispose() {
    this.loadRevision += 1;
    this.cancelPendingSave();
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = CompositionController;
else if (typeof window !== 'undefined') window.CompositionController = CompositionController;
