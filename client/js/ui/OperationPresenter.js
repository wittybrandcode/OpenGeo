/** Renders operation/status events. It contains no map or AE workflow logic. */
class OperationPresenter {
  constructor(eventBus, lifecycle) {
    this.eventBus = eventBus;
    this.lifecycle = lifecycle;
  }

  start() {
    this.lifecycle.subscribe('ui:status', data => {
      const element = document.getElementById('status-text');
      if (!element) return;
      element.textContent = data.message;
      element.style.color = data.isError ? '#e34850' : '';
    });
    this.lifecycle.subscribe('ui:download_modal', data => this._renderDownloadModal(data));
    this.lifecycle.subscribe('stitch:progress', data => {
      const element = document.getElementById('status-text');
      if (!element) return;
      const label = data.phase === 'downloading' ? 'Downloading tiles' : data.phase === 'stitching' ? 'Assembling map' : data.phase === 'scaling' ? 'Scaling output' : 'Export';
      element.textContent = `${label}... ${data.percent}% (${data.completedTiles}/${data.totalTiles} tiles)`;
      element.style.color = '#4fc3f7';
    });
    this.lifecycle.subscribe('stitch:complete', data => {
      this.eventBus.emit('toast:show', { message: `Map stitched: ${data.width}x${data.height} (${data.tilesUsed} tiles)`, type: 'success', duration: 3000 });
    });
  }

  _renderDownloadModal(data) {
    const modal = document.getElementById('download-modal');
    const cancelButton = document.getElementById('dl-cancel');
    if (!modal) return;
    if (!data.show) {
      modal.style.display = 'none';
      if (cancelButton) cancelButton.style.display = 'none';
      return;
    }
    modal.style.display = 'flex';
    if (cancelButton) cancelButton.style.display = data.cancelable === true ? 'block' : 'none';
    const info = document.getElementById('dl-info');
    if (data.info && info) info.textContent = data.info;
    if (data.pct !== undefined) {
      const percent = document.getElementById('dl-percent');
      const progress = document.getElementById('dl-progress-bar');
      if (percent) percent.textContent = data.pct + '%';
      if (progress) progress.style.width = data.pct + '%';
    }
    if (data.done !== undefined && data.total !== undefined) {
      const done = document.getElementById('dl-done');
      const total = document.getElementById('dl-total');
      if (done) done.textContent = data.done;
      if (total) total.textContent = data.total;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = OperationPresenter;
else if (typeof window !== 'undefined') window.OperationPresenter = OperationPresenter;
