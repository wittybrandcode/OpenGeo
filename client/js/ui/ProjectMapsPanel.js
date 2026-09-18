/** Project-wide OpenGeo map browser. Host owns discovery; client owns thumbnails and UI. */
class ProjectMapsPanel {
  constructor(app) {
    this.app = app;
    this.modal = document.getElementById('project-maps-modal');
    this.listElement = document.getElementById('project-maps-list');
    this.openButton = document.getElementById('project-maps-btn');
    this.closeButton = document.getElementById('project-maps-close');
    this.refreshButton = document.getElementById('project-maps-refresh');
    this.thumbnailProcessor = typeof ThumbnailProcessor !== 'undefined' ? new ThumbnailProcessor() : null;
    this._revision = 0;
    this._previousFocus = null;
    this._onOpen = () => this.open();
    this._onClose = () => this.close();
    this._onRefresh = () => this.refresh();
    this._onKeyDown = event => {
      if (!this.modal || !this.modal.classList.contains('visible')) return;
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      else if (event.key === 'Tab') {
        const controls = Array.prototype.slice.call(this.modal.querySelectorAll('button:not([disabled])'));
        if (!controls.length) return;
        const currentIndex = controls.indexOf(document.activeElement);
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
          : (currentIndex < 0 || currentIndex === controls.length - 1 ? 0 : currentIndex + 1);
        event.preventDefault(); controls[nextIndex].focus();
      }
    };
    if (this.openButton) this.openButton.addEventListener('click', this._onOpen);
    if (this.closeButton) this.closeButton.addEventListener('click', this._onClose);
    if (this.refreshButton) this.refreshButton.addEventListener('click', this._onRefresh);
    document.addEventListener('keydown', this._onKeyDown);
    this._onThumbnailUpdated = () => {
      if (this.modal && this.modal.classList.contains('visible')) {
        this.refresh();
      }
    };
    if (typeof globalEventBus !== 'undefined') {
      globalEventBus.on('project-maps:thumbnail-updated', this._onThumbnailUpdated);
    }
  }

  open() {
    if (!this.modal) return;
    this._previousFocus = document.activeElement;
    this.modal.classList.add('visible');
    this.modal.setAttribute('aria-hidden', 'false');
    if (this.closeButton) this.closeButton.focus();
    this.refresh();
  }

  close() {
    if (!this.modal) return;
    this._revision++;
    this.modal.classList.remove('visible');
    this.modal.setAttribute('aria-hidden', 'true');
    if (this._previousFocus && typeof this._previousFocus.focus === 'function') this._previousFocus.focus();
    this._previousFocus = null;
  }

  async refresh() {
    const revision = ++this._revision;
    this._renderMessage('Scanning the current AE project…', 'loader-circle');
    try {
      const result = await this.app.aeBridge.invoke('project.listOpenGeoMaps', {}, { timeoutMs: 15000 });
      if (revision !== this._revision || !this.modal.classList.contains('visible')) return;
      const maps = result && Array.isArray(result.maps) ? result.maps : [];
      this._renderMaps(maps, result || {});
    } catch (error) {
      if (revision !== this._revision) return;
      this._renderMessage('Could not read OpenGeo maps from the AE project.', 'triangle-alert');
      globalEventBus.emit('toast:show', { message: 'Project Maps failed: ' + error.message, type: 'error', duration: 5000 });
    }
  }

  _renderMaps(maps, result) {
    this._clearList();
    if (!maps.length) {
      this._renderMessage('No OpenGeo maps in this project. Use + to create the first map.', 'map');
      return;
    }
    maps.forEach(map => this.listElement.appendChild(this._createCard(map, true)));
    if (result.truncated) {
      const note = document.createElement('div');
      note.className = 'project-maps-note';
      note.textContent = 'Only the first 200 OpenGeo maps are shown.';
      this.listElement.appendChild(note);
    }
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
  }

  _createCard(map, loadThumbnail) {
    const card = document.createElement('div');
    card.className = 'project-map-card';
    if (map.active) card.classList.add('active');

    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'project-map-open';
    openButton.title = 'Open ' + String(map.displayName || map.compName || 'OpenGeo Map');
    openButton.setAttribute('aria-label', openButton.title);

    const thumbnail = document.createElement('div');
    thumbnail.className = 'project-map-thumbnail';
    const fallback = document.createElement('div');
    fallback.className = 'project-map-thumbnail-fallback';
    const fallbackIcon = document.createElement('i');
    fallbackIcon.setAttribute('data-lucide', 'camera');
    const fallbackText = document.createElement('span');
    fallbackText.textContent = 'Capture the current map preview';
    fallback.appendChild(fallbackIcon); fallback.appendChild(fallbackText);
    thumbnail.appendChild(fallback);
    const url = loadThumbnail ? this._getThumbnailUrl(map) : '';
    if (url) {
      const backdrop = document.createElement('img');
      backdrop.className = 'project-map-thumbnail-backdrop';
      backdrop.alt = '';
      backdrop.loading = 'lazy';
      backdrop.referrerPolicy = 'no-referrer';
      backdrop.addEventListener('error', () => backdrop.remove());
      backdrop.src = url;
      const image = document.createElement('img');
      image.className = 'project-map-thumbnail-image';
      image.alt = String(map.displayName || 'OpenGeo Map') + ' composition frame';
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('load', () => thumbnail.classList.add('loaded'));
      image.addEventListener('error', () => image.remove());
      image.src = url;
      thumbnail.appendChild(backdrop);
      thumbnail.appendChild(image);

      const sequenceUrls = loadThumbnail ? this._getSequenceUrls(map) : [];
      const stripUrl = loadThumbnail ? this._getThumbnailStripUrl(map) : '';
      const hasMotion = sequenceUrls.length > 1 || !!stripUrl;
      if (hasMotion) {
        const isSequence = sequenceUrls.length > 1;
        const frameCount = isSequence ? sequenceUrls.length : 12;

        const stripContainer = document.createElement('div');
        stripContainer.className = 'project-map-filmstrip-container';

        const stripImg = document.createElement('img');
        stripImg.className = 'project-map-filmstrip-image';
        stripImg.src = stripUrl || (sequenceUrls.length > 0 ? sequenceUrls[0] : '');
        stripImg.alt = '';
        stripImg.referrerPolicy = 'no-referrer';

        const scrubBar = document.createElement('div');
        scrubBar.className = 'project-map-scrub-bar';
        scrubBar.title = 'Scrub map timeline preview';

        const scrubFill = document.createElement('div');
        scrubFill.className = 'project-map-scrub-fill';

        const scrubHandle = document.createElement('div');
        scrubHandle.className = 'project-map-scrub-handle';

        const timecodeBadge = document.createElement('div');
        timecodeBadge.className = 'project-map-scrub-timecode';
        timecodeBadge.textContent = '00:00';

        scrubBar.appendChild(scrubFill);
        scrubBar.appendChild(scrubHandle);
        scrubBar.appendChild(timecodeBadge);

        stripContainer.appendChild(stripImg);
        thumbnail.appendChild(stripContainer);
        thumbnail.appendChild(scrubBar);

        const videoBadge = document.createElement('span');
        videoBadge.className = 'project-map-video-badge';
        const playSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        playSvg.setAttribute('viewBox', '0 0 24 24');
        playSvg.setAttribute('width', '8');
        playSvg.setAttribute('height', '8');
        playSvg.setAttribute('fill', 'currentColor');
        const playPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        playPoly.setAttribute('points', '5 3 19 12 5 21 5 3');
        playSvg.appendChild(playPoly);
        videoBadge.appendChild(playSvg);
        videoBadge.appendChild(document.createTextNode(' Preview'));
        thumbnail.appendChild(videoBadge);

        if (!isSequence) {
          stripImg.style.width = `${frameCount * 100}%`;
          stripImg.style.objectFit = 'cover';
          stripImg.style.padding = '0';
        } else {
          stripImg.style.width = '100%';
          stripImg.style.objectFit = 'contain';
          stripImg.style.padding = '4px';
          // Preload sequence frames in browser cache for instant 60fps frame swapping
          for (let sIdx = 0; sIdx < sequenceUrls.length; sIdx++) {
            const pre = new Image();
            pre.src = sequenceUrls[sIdx];
          }
        }

        let autoPlayTimer = null;
        let currentFrame = 0;
        const totalDuration = Math.max(1, Number(map.duration) || 10);

        const setFrame = (idx) => {
          const clamped = Math.max(0, Math.min(frameCount - 1, idx));
          if (isSequence && sequenceUrls[clamped]) {
            image.src = sequenceUrls[clamped];
            if (stripImg) stripImg.src = sequenceUrls[clamped];
          } else if (stripImg) {
            const offsetPct = (clamped / frameCount) * 100;
            stripImg.style.transform = `translateX(-${offsetPct}%)`;
          }
          const pct = (clamped / Math.max(1, frameCount - 1)) * 100;
          scrubHandle.style.left = `${pct}%`;
          scrubFill.style.width = `${pct}%`;

          const currentSec = (clamped / Math.max(1, frameCount - 1)) * totalDuration;
          const mins = Math.floor(currentSec / 60);
          const secs = (currentSec % 60).toFixed(1);
          timecodeBadge.textContent = `${mins > 0 ? mins + ':' : ''}${secs.padStart(4, '0')}s • Frame ${clamped + 1}/${frameCount}`;
          timecodeBadge.style.left = `${pct}%`;
        };

        const startAutoPlay = () => {
          if (autoPlayTimer) clearInterval(autoPlayTimer);
          autoPlayTimer = setInterval(() => {
            currentFrame = (currentFrame + 1) % frameCount;
            setFrame(currentFrame);
          }, 110);
        };

        const stopAutoPlay = () => {
          if (autoPlayTimer) {
            clearInterval(autoPlayTimer);
            autoPlayTimer = null;
          }
        };

        card.addEventListener('mouseenter', () => {
          scrubBar.classList.add('active');
          if (!isSequence) stripContainer.classList.add('active');
          currentFrame = 0;
          setFrame(0);
          startAutoPlay();
        });

        const handleScrubMove = (e) => {
          stopAutoPlay();
          const rect = thumbnail.getBoundingClientRect();
          if (rect.width > 0) {
            const relX = Math.max(0, Math.min(rect.width - 1, e.clientX - rect.left));
            const progress = relX / rect.width;
            const targetFrame = Math.floor(progress * frameCount);
            setFrame(targetFrame);
          }
        };

        card.addEventListener('mousemove', handleScrubMove);
        scrubBar.addEventListener('mousemove', (e) => {
          e.stopPropagation();
          stopAutoPlay();
          const sRect = scrubBar.getBoundingClientRect();
          if (sRect.width > 0) {
            const relX = Math.max(0, Math.min(sRect.width - 1, e.clientX - sRect.left));
            const progress = relX / sRect.width;
            const targetFrame = Math.floor(progress * frameCount);
            setFrame(targetFrame);
          }
        });

        card.addEventListener('mouseleave', () => {
          stopAutoPlay();
          scrubBar.classList.remove('active');
          if (!isSequence) stripContainer.classList.remove('active');
          image.src = url;
          setFrame(0);
        });
      }
    }

    const cardActions = document.createElement('div');
    cardActions.className = 'project-map-card-actions';

    const duplicateButton = document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.className = 'project-map-duplicate';
    duplicateButton.title = 'Duplicate this map as an independent composition with isolated layers';
    duplicateButton.setAttribute('aria-label', duplicateButton.title);
    const duplicateIcon = document.createElement('i');
    duplicateIcon.setAttribute('data-lucide', 'copy');
    duplicateButton.appendChild(duplicateIcon);
    duplicateButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this._duplicateMap(map, duplicateButton, card);
    });

    const captureButton = document.createElement('button');
    captureButton.type = 'button';
    captureButton.className = 'project-map-capture';
    captureButton.title = map.active
      ? (map.thumbnailPath ? 'Replace thumbnail with the current OpenGeo preview' : 'Use the current OpenGeo preview as thumbnail')
      : 'Open this map before capturing its thumbnail';
    captureButton.setAttribute('aria-label', captureButton.title);
    const captureIcon = document.createElement('i');
    captureIcon.setAttribute('data-lucide', 'camera');
    captureButton.appendChild(captureIcon);
    captureButton.disabled = map.thumbnailCaptureApiVersion !== 5 || map.thumbnailCaptureSupported !== true || !map.active;

    cardActions.appendChild(duplicateButton);
    cardActions.appendChild(captureButton);

    const body = document.createElement('div'); body.className = 'project-map-card-body';
    const name = document.createElement('strong'); name.textContent = map.displayName || map.compName || 'OpenGeo Map';
    const details = document.createElement('span');
    details.textContent = `${Number(map.width) || 0}×${Number(map.height) || 0} · ${map.providerId || 'local'} · ${Number(map.featureCount) || 0} layers`;
    body.appendChild(name); body.appendChild(details);

    const captureStatus = document.createElement('div');
    captureStatus.className = 'project-map-capture-status';
    if (map.thumbnailCaptureApiVersion !== 5) {
      captureStatus.classList.add('warning');
      captureStatus.textContent = 'Restart After Effects to load direct preview capture.';
    } else if (map.thumbnailCaptureSupported !== true) {
      captureStatus.classList.add('warning');
      captureStatus.textContent = 'Save the AE project before choosing a thumbnail.';
    } else if (!map.active) {
      captureStatus.textContent = 'Open this map to capture its preview.';
    } else {
      captureStatus.textContent = map.thumbnailPath ? 'Preview cover selected' : 'No preview cover selected';
    }
    body.appendChild(captureStatus);
    captureButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this._captureThumbnail(map, captureButton, captureStatus);
    });

    const badges = document.createElement('div'); badges.className = 'project-map-badges';
    if (map.active) badges.appendChild(this._badge('Active'));
    if (map.isFinalized) badges.appendChild(this._badge('Final'));
    if (map.needsRepair) badges.appendChild(this._badge('Needs repair', true));
    body.appendChild(badges);
    openButton.appendChild(thumbnail); openButton.appendChild(body);
    openButton.addEventListener('click', () => this._openMap(map, openButton));
    card.appendChild(openButton);
    card.appendChild(cardActions);
    return card;
  }

  _badge(text, warning) {
    const badge = document.createElement('span');
    badge.className = 'project-map-badge' + (warning ? ' warning' : '');
    badge.textContent = text;
    return badge;
  }

  _getThumbnailUrl(map) {
    if (!map || !map.thumbnailPath) return '';
    const normalized = String(map.thumbnailPath).replace(/\\/g, '/');
    const fileUrl = (/^[a-zA-Z]:\//.test(normalized) ? 'file:///' : 'file://') + normalized;
    const encoded = encodeURI(fileUrl).replace(/#/g, '%23').replace(/\?/g, '%3F');
    return encoded + '?v=' + encodeURIComponent(String(map.thumbnailRevision || map.thumbnailBytes || 0));
  }

  _getThumbnailStripUrl(map) {
    if (!map || !map.stripPath) return '';
    const normalized = String(map.stripPath).replace(/\\/g, '/');
    const fileUrl = (/^[a-zA-Z]:\//.test(normalized) ? 'file:///' : 'file://') + normalized;
    const encoded = encodeURI(fileUrl).replace(/#/g, '%23').replace(/\?/g, '%3F');
    return encoded + '?v=' + encodeURIComponent(String(map.stripRevision || map.thumbnailRevision || map.thumbnailBytes || 0));
  }

  _getSequenceUrls(map) {
    if (!map || !map.hasSequence || !Array.isArray(map.sequenceFrames) || map.sequenceFrames.length <= 1) return [];
    return map.sequenceFrames.map(p => {
      const normalized = String(p).replace(/\\/g, '/');
      const fileUrl = (/^[a-zA-Z]:\//.test(normalized) ? 'file:///' : 'file://') + normalized;
      const encoded = encodeURI(fileUrl).replace(/#/g, '%23').replace(/\?/g, '%3F');
      return encoded + '?v=' + encodeURIComponent(String(map.sequenceRevision || map.thumbnailRevision || 0));
    });
  }

  async _captureThumbnail(map, button, statusElement) {
    if (!map || !map.compId || !map.documentId || button.disabled) return;
    if (map.thumbnailCaptureSupported === false) {
      globalEventBus.emit('toast:show', { message: 'Save your After Effects project (Ctrl+S) before capturing thumbnails.', type: 'info', duration: 3500 });
      return;
    }
    if (!map.active || String(this.app.activeCompId || '') !== String(map.compId)) {
      globalEventBus.emit('toast:show', { message: 'Open this map before capturing its preview.', type: 'info', duration: 3200 });
      return;
    }
    button.disabled = true;
    button.classList.add('busy');
    if (statusElement) {
      statusElement.classList.remove('warning', 'error');
      statusElement.textContent = 'Saving the current OpenGeo preview...';
    }
    if (this.app.operationLogger) this.app.operationLogger.record('project-map:thumbnail', {
      operationId: 'thumbnail:' + String(map.documentId), phase: 'started', compId: map.compId
    });
    try {
      const result = await this.app.aeBridge.invoke('project.prepareOpenGeoMapThumbnail', {
        compId: map.compId,
        documentId: map.documentId
      }, { timeoutMs: 15000 });
      if (!result || !result.thumbnailTargetPath) {
        const missingPath = new Error('After Effects did not return a managed thumbnail path.');
        missingPath.code = 'THUMBNAIL_PATH_MISSING';
        throw missingPath;
      }
      if (!this.thumbnailProcessor) {
        const missingProcessor = new Error('The display-ready thumbnail processor is unavailable.');
        missingProcessor.code = 'THUMBNAIL_PROCESSOR_MISSING';
        throw missingProcessor;
      }
      const sourceCanvas = this.app.mapRenderer && this.app.mapRenderer.canvas;
      if (!sourceCanvas) {
        const missingPreview = new Error('The OpenGeo map preview is unavailable.');
        missingPreview.code = 'THUMBNAIL_PREVIEW_UNAVAILABLE';
        throw missingPreview;
      }
      if (map.width && map.height && this.app.mapState &&
          (this.app.mapState.compWidth !== map.width || this.app.mapState.compHeight !== map.height)) {
        this.app.mapState.setCompSize(map.width, map.height);
      }
      const captureOptions = {
        viewportWidth: this.app.viewport && this.app.viewport.width,
        viewportHeight: this.app.viewport && this.app.viewport.height,
        frameWidth: this.app.mapState && this.app.mapState.frameWidth,
        frameHeight: this.app.mapState && this.app.mapState.frameHeight
      };
      const optimized = await this.thumbnailProcessor.captureCanvas(sourceCanvas, result.thumbnailTargetPath, captureOptions);

      // Generate multi-frame sequence and filmstrip for rich hover scrubbing!
      try {
        const frameCanvases = typeof this.thumbnailProcessor.generateCinematicFrames === 'function'
          ? this.thumbnailProcessor.generateCinematicFrames(sourceCanvas, 10, captureOptions)
          : [];
        if (frameCanvases && frameCanvases.length > 0) {
          const seqPattern = result.thumbnailTargetPath.replace(/\.png$/i, '_%d.png');
          if (typeof this.thumbnailProcessor.savePngSequence === 'function') {
            await this.thumbnailProcessor.savePngSequence(frameCanvases, seqPattern);
          }
          if (result.thumbnailStripTargetPath && typeof this.thumbnailProcessor.createFilmstrip === 'function') {
            const aspect = (map.width && map.height) ? (map.width / map.height) : (16 / 9);
            const frameW = 480;
            const frameH = Math.max(45, Math.round(frameW / (aspect > 0 ? aspect : (16 / 9))));
            await this.thumbnailProcessor.createFilmstrip(frameCanvases, result.thumbnailStripTargetPath, {
              frameWidth: frameW,
              frameHeight: frameH
            });
          }
        }
      } catch (motionErr) {
        console.warn('[ProjectMapsPanel] Motion preview sequence generation skipped:', motionErr);
      }

      globalEventBus.emit('toast:show', {
        message: 'Preview thumbnail and motion sequence saved.',
        type: 'success', duration: 2600
      });
      if (this.app.operationLogger) this.app.operationLogger.record('project-map:thumbnail', {
        operationId: 'thumbnail:' + String(map.documentId), phase: 'completed', compId: map.compId,
        thumbnailBytes: optimized.bytes,
        colorStrategy: optimized.colorStrategy,
        source: optimized.source,
        width: optimized.width,
        height: optimized.height
      });
      await this.refresh();
    } catch (error) {
      console.error('[ProjectMapsPanel] Thumbnail capture failed:', error);
      button.disabled = false;
      button.classList.remove('busy');
      const code = error && error.code ? String(error.code) : 'THUMBNAIL_FAILED';
      const message = error && error.message ? String(error.message) : 'Unknown thumbnail error';
      if (statusElement) {
        statusElement.classList.add('error');
        statusElement.textContent = code + ': ' + message;
        statusElement.title = statusElement.textContent;
      }
      if (this.app.operationLogger) this.app.operationLogger.record('project-map:thumbnail', {
        operationId: 'thumbnail:' + String(map.documentId), phase: 'failed', compId: map.compId,
        errorCode: code, error: message
      });
      globalEventBus.emit('toast:show', { message: 'Thumbnail capture failed: ' + error.message, type: 'error', duration: 6000 });
    }
  }

  async _duplicateMap(map, duplicateButton, card) {
    if (!map || !map.compId || duplicateButton.disabled) return;
    duplicateButton.disabled = true;
    duplicateButton.classList.add('busy');
    if (this.app.operationLogger) {
      this.app.operationLogger.record('project-map:duplicate', {
        phase: 'started', compId: map.compId, documentId: map.documentId
      });
    }
    try {
      const duplicated = await this.app.aeBridge.invoke('project.duplicateMap', {
        compId: map.compId,
        documentId: map.documentId
      }, { timeoutMs: 30000 });

      const newName = duplicated && duplicated.displayName ? duplicated.displayName : 'Duplicated Map';
      globalEventBus.emit('toast:show', {
        message: `Map duplicated: ${newName}`,
        type: 'success',
        duration: 3500
      });

      if (this.app.operationLogger) {
        this.app.operationLogger.record('project-map:duplicate', {
          phase: 'completed',
          sourceCompId: map.compId,
          newCompId: duplicated && duplicated.compId,
          newDocumentId: duplicated && duplicated.documentId
        });
      }

      await this.refresh();
    } catch (error) {
      console.error('[ProjectMapsPanel] Duplication failed:', error);
      duplicateButton.disabled = false;
      duplicateButton.classList.remove('busy');
      if (this.app.operationLogger) {
        this.app.operationLogger.record('project-map:duplicate', {
          phase: 'failed',
          compId: map.compId,
          error: error.message
        });
      }
      globalEventBus.emit('toast:show', {
        message: 'Could not duplicate map: ' + error.message,
        type: 'error',
        duration: 6000
      });
    }
  }

  async _openMap(map, card) {
    if (card.disabled) return;
    card.disabled = true;
    try {
      const opened = await this.app.aeBridge.invoke('project.openOpenGeoMap', {
        compId: map.compId, documentId: map.documentId
      }, { timeoutMs: 15000 });
      const compId = opened && opened.compId ? opened.compId : map.compId;
      if (this.app.syncEngine) this.app.syncEngine.setActiveComp(compId);
      else this.app.activeCompId = compId;
      if (this.app.toolbarController) this.app.toolbarController.syncKeyframeRecordingState(compId);
      await this.app.compositionController.load(compId);
      this.close();
      globalEventBus.emit('toast:show', { message: `${map.displayName || 'OpenGeo Map'} opened.`, type: 'success', duration: 2200 });
    } catch (error) {
      card.disabled = false;
      globalEventBus.emit('toast:show', { message: 'Could not open map: ' + error.message, type: 'error', duration: 5000 });
      this.refresh();
    }
  }

  _renderMessage(message, icon) {
    this._clearList();
    if (!this.listElement) return;
    const empty = document.createElement('div'); empty.className = 'project-maps-empty';
    const element = document.createElement('i'); element.setAttribute('data-lucide', icon || 'map');
    const text = document.createElement('span'); text.textContent = message;
    empty.appendChild(element); empty.appendChild(text); this.listElement.appendChild(empty);
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
  }

  _clearList() {
    if (!this.listElement) return;
    while (this.listElement.firstChild) this.listElement.removeChild(this.listElement.firstChild);
  }

  dispose() {
    this._revision++;
    if (this.openButton) this.openButton.removeEventListener('click', this._onOpen);
    if (this.closeButton) this.closeButton.removeEventListener('click', this._onClose);
    if (this.refreshButton) this.refreshButton.removeEventListener('click', this._onRefresh);
    document.removeEventListener('keydown', this._onKeyDown);
    if (typeof globalEventBus !== 'undefined' && this._onThumbnailUpdated) {
      globalEventBus.off('project-maps:thumbnail-updated', this._onThumbnailUpdated);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = ProjectMapsPanel;
else if (typeof window !== 'undefined') window.ProjectMapsPanel = ProjectMapsPanel;
