/**
 * Owns one OpenGeo.Engine for exactly one logical operation. Provider URL,
 * cache namespace and cancellation can therefore never bleed into another
 * Sync, trajectory-preview, or Finalize run.
 */
class DownloadSession {
  constructor(snapshot, options = {}) {
    if (!snapshot || !snapshot.resolvedTemplate || !snapshot.providerSignature) {
      throw new Error('DownloadSession requires a complete OperationSnapshot.');
    }
    const EngineClass = options.EngineClass || OpenGeo.Engine;
    const cacheDir = options.cacheDir || EngineClass.getDefaultCacheDir();
    this.snapshot = snapshot;
    this.cancelled = false;
    this.engine = new EngineClass({
      cacheDir,
      compWidth: snapshot.composition.width,
      compHeight: snapshot.composition.height,
      maxConcurrent: options.maxConcurrent || 6
    });
    this.engine.setUrlTemplate(snapshot.resolvedTemplate);
    this.engine.setCacheNamespace(snapshot.providerSignature);
  }

  sync(onProgress, qualityOffset) {
    if (this.cancelled) return Promise.reject(this._cancelledError());
    this.engine.setCamera(
      this.snapshot.camera.lat,
      this.snapshot.camera.lon,
      this.snapshot.camera.zoom
    );
    this.engine.setViewport(
      this.snapshot.composition.width,
      this.snapshot.composition.height
    );
    return this.engine.sync(onProgress, qualityOffset);
  }

  downloadTiles(plan, onProgress) {
    if (this.cancelled) return Promise.reject(this._cancelledError());
    return this.engine.downloadTiles(plan, onProgress);
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.engine && this.engine.cancelDownloads) this.engine.cancelDownloads();
  }

  dispose() {
    this.cancel();
    this.engine = null;
  }

  _cancelledError() {
    const error = new Error('Download session was cancelled.');
    error.code = 'OPEN_GEO_DOWNLOAD_CANCELLED';
    return error;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DownloadSession;
} else if (typeof window !== 'undefined') {
  window.DownloadSession = DownloadSession;
}
