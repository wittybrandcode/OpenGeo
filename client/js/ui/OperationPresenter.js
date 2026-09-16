/** Renders operation/status events. It contains no map or AE workflow logic. */
class OperationPresenter {
  constructor(eventBus, lifecycle) {
    this.eventBus = eventBus;
    this.lifecycle = lifecycle;
    this._pendingModalData = null;
    this._pendingModalRaf = null;
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
    if (!data || !data.show) {
      if (this._pendingModalRaf && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this._pendingModalRaf);
        this._pendingModalRaf = null;
      }
      this._applyDownloadModal(data);
      return;
    }
    this._pendingModalData = data;
    if (typeof requestAnimationFrame === 'function') {
      if (!this._pendingModalRaf) {
        this._pendingModalRaf = requestAnimationFrame(() => {
          this._pendingModalRaf = null;
          this._applyDownloadModal(this._pendingModalData);
        });
      }
    } else {
      this._applyDownloadModal(data);
    }
  }

  _applyDownloadModal(data) {
    const modal = document.getElementById('download-modal');
    const cancelButton = document.getElementById('dl-cancel');
    if (!modal) return;
    if (!data || !data.show) {
      modal.style.display = 'none';
      if (cancelButton) cancelButton.style.display = 'none';
      const speed = document.getElementById('dl-speed');
      if (speed) speed.textContent = '--';
      return;
    }
    modal.style.display = 'flex';
    if (cancelButton) cancelButton.style.display = data.cancelable === true ? 'block' : 'none';

    // Header & Phase
    const title = document.getElementById('dl-title');
    if (title) {
      title.textContent = data.title || (data.phase === 'stitching' ? 'Assembling MegaTiles' : 'Downloading Tiles');
    }
    const subtitle = document.getElementById('dl-subtitle');
    if (subtitle) {
      subtitle.textContent = data.subtitle || (data.phase === 'stitching' ? 'Lossless Canvas Compilation' : 'High-Resolution Map Finalize');
    }
    const phaseBadge = document.getElementById('dl-phase-badge');
    if (phaseBadge) {
      phaseBadge.textContent = data.phaseBadge || (data.phase === 'stitching' ? 'Stage 2 of 2' : 'Stage 1 of 2');
    }

    // Info Subline
    const info = document.getElementById('dl-info');
    if (data.info && info) info.textContent = data.info;

    // Progress
    if (data.pct !== undefined) {
      const percent = document.getElementById('dl-percent');
      const progress = document.getElementById('dl-progress-bar');
      if (percent) percent.textContent = data.pct + '%';
      if (progress) progress.style.width = data.pct + '%';
    }

    // Tiles Count & Remaining
    if (data.done !== undefined && data.total !== undefined) {
      const done = document.getElementById('dl-done');
      const total = document.getElementById('dl-total');
      if (done) done.textContent = data.done;
      if (total) total.textContent = data.total;

      const remainingTilesEl = document.getElementById('dl-remaining-tiles');
      if (remainingTilesEl) {
        const left = data.remainingTiles !== undefined ? data.remainingTiles : Math.max(0, data.total - data.done);
        remainingTilesEl.textContent = `${left} left`;
      }
    }

    // Live Decreasing Remaining Data Size (Counts down to 0 MB!)
    const remainingSizeEl = document.getElementById('dl-remaining-size');
    if (remainingSizeEl) {
      if (typeof data.remainingMB === 'number') {
        remainingSizeEl.textContent = data.remainingMB >= 1
          ? `${data.remainingMB.toFixed(1)} MB`
          : `${Math.max(0, Math.round(data.remainingMB * 1024))} KB`;
      } else if (data.phase === 'stitching') {
        remainingSizeEl.textContent = '0.0 MB';
      }
    }

    const totalSizeEl = document.getElementById('dl-total-size');
    if (totalSizeEl) {
      if (data.phase === 'stitching') {
        totalSizeEl.textContent = 'Downloaded 100%';
      } else if (typeof data.totalMB === 'number') {
        totalSizeEl.textContent = `Total: ~${data.totalMB.toFixed(1)} MB`;
      }
    }

    // Speed & ETA
    if (data.speed !== undefined) {
      const speed = document.getElementById('dl-speed');
      if (speed) speed.textContent = data.speed;
    }
    const etaEl = document.getElementById('dl-eta');
    if (etaEl) {
      etaEl.textContent = data.eta ? `ETA: ${data.eta}` : (data.phase === 'stitching' ? 'Assembling' : 'ETA: --');
    }

    // Specs Strip: Resolution & Transferred Bytes
    const resText = document.getElementById('dl-resolution-text');
    if (resText && data.resolution) {
      resText.textContent = data.resolution;
    }
    const transferredText = document.getElementById('dl-transferred-text');
    if (transferredText) {
      if (typeof data.downloadedMB === 'number') {
        transferredText.textContent = `${data.downloadedMB.toFixed(1)} MB downloaded`;
      } else if (data.phase === 'stitching' && typeof data.totalMB === 'number') {
        transferredText.textContent = `${data.totalMB.toFixed(1)} MB completed`;
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = OperationPresenter;
else if (typeof window !== 'undefined') window.OperationPresenter = OperationPresenter;
