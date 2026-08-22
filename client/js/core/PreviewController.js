/** Owns raster/vector preview mode and frame-coalesced rendering. */
class PreviewController {
  constructor(app, initialMode) {
    this.app = app;
    this.mode = initialMode === 'vector' ? 'vector' : 'raster';
    this._renderFrameId = null;
    this._pendingRenderTiles = null;
  }

  triggerTileUpdate() {
    if (this.mode === 'vector') {
      this.scheduleRender();
      return;
    }
    this.app.tileManager.update(this.app.viewport, this.app._getTileUrls.bind(this.app));
  }

  render(tiles) {
    if (this.mode === 'vector') {
      const overlays = [this.app.vectorPreviewLayer, this.app.geoJSONLayer, this.app.featureOverlayLayer, this.app.markerLayer].filter(Boolean);
      this.app.mapRenderer.renderVector(overlays);
      return;
    }
    this.app.mapRenderer.render(tiles || this.app.tileManager.getTilesForRender(), [this.app.geoJSONLayer, this.app.featureOverlayLayer, this.app.markerLayer]);
  }

  scheduleRender(tiles) {
    if (tiles) this._pendingRenderTiles = tiles;
    if (this._renderFrameId !== null) return;
    const flush = () => {
      this._renderFrameId = null;
      const pendingTiles = this._pendingRenderTiles;
      this._pendingRenderTiles = null;
      this.render(pendingTiles);
    };
    this._renderFrameId = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(flush)
      : setTimeout(flush, 16);
  }

  setMode(mode, options = {}) {
    const nextMode = mode === 'vector' ? 'vector' : 'raster';
    if (nextMode === 'vector' && (!this.app.vectorPreviewLayer || !this.app.vectorPreviewLayer.load())) {
      if (!options.silent) globalEventBus.emit('toast:show', { message: 'Offline vector boundaries are unavailable.', type: 'error' });
      return false;
    }
    this.mode = nextMode;
    this.app.previewMode = nextMode;
    localStorage.setItem('opengeo_preview_mode', nextMode);
    const button = document.getElementById('preview-mode-btn');
    if (button) {
      const vector = nextMode === 'vector';
      button.classList.toggle('active', vector);
      button.setAttribute('aria-pressed', vector ? 'true' : 'false');
      button.title = vector ? 'Switch to satellite tile preview' : 'Switch to offline vector preview';
    }
    if (nextMode === 'vector' && this.app.tileManager && this.app.tileManager.downloader) {
      this.app.tileManager.downloader.cancelAll();
    } else if (nextMode === 'raster' && this.app.tileManager) {
      this.app.tileManager.setSource(this.app.tileManager.source, this.app.tileManager.sourceSignature);
    }
    this.triggerTileUpdate();
    if (!options.silent) globalEventBus.emit('ui:status', {
      message: nextMode === 'vector' ? 'Offline Vector Preview — no tile downloads.' : 'Satellite Preview enabled.',
      isError: false
    });
    return true;
  }

  dispose() {
    if (this._renderFrameId !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._renderFrameId);
      else clearTimeout(this._renderFrameId);
    }
    this._renderFrameId = null;
    this._pendingRenderTiles = null;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = PreviewController;
else if (typeof window !== 'undefined') window.PreviewController = PreviewController;
