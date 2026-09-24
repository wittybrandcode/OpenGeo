/**
 * Owns toolbar/modals/file-input wiring. Business operations remain delegated
 * to their dedicated controllers; this class only translates DOM intent.
 */
class ToolbarController {
  constructor(appOrDeps) {
    const isDeps = appOrDeps && (appOrDeps.lifecycle || appOrDeps.session);
    this.app = isDeps && appOrDeps.app ? appOrDeps.app : (appOrDeps || {});
    this.lifecycle = (isDeps && appOrDeps.lifecycle) || (this.app && this.app.lifecycle) || null;
    this.session = (isDeps && appOrDeps.session) || (this.app && this.app.session) || null;
    this.viewport = (isDeps && appOrDeps.viewport) || (this.app && this.app.viewport) || null;
    this._geoJsonReader = null;
    this._geoJsonLoadRevision = 0;
    this._geoJsonProgressAt = 0;
    this._recordTogglePending = false;
    this._clearPending = false;
    this._keyframeMutationTails = new Map();
    this._bound = false;
  }

  bind() {
    if (this._bound) return;
    this._bound = true;
    this._selectedPinColor = '#1473e6';
    this._bindMapControls();
    this._bindProviderSettings();
    this._bindCompositionSettings();
    this._bindSpatialPinModal();
    this._bindActions();
    this._bindGeoJSONImport();
  }

  _listen(target, eventName, callback, options) {
    return this.lifecycle.listen(target, eventName, callback, options);
  }

  _bindMapControls() {
    const app = this.app;
    this._listen(document.getElementById('zoom-in'), 'click', () => app.viewport.setZoom(app.viewport.zoom + 0.5));
    this._listen(document.getElementById('zoom-out'), 'click', () => app.viewport.setZoom(app.viewport.zoom - 0.5));
    this._listen(document.getElementById('center-btn'), 'click', () => {
      app.viewport.setCenter(app.config.defaults.centerLat, app.config.defaults.centerLng);
      app.viewport.setZoom(app.config.defaults.zoom);
    });
    this._listen(document.getElementById('preview-mode-btn'), 'click', () => {
      app._setPreviewMode(app.previewMode === 'raster' ? 'vector' : 'raster');
    });
  }

  _renderProviderKeyFields(container) {
    if (!container || !this.app.providerManager) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    const schema = this.app.providerManager.getProviderSchema();
    for (const provider of schema) {
      if (!provider.requiresKey) continue;
      const group = document.createElement('div');
      group.className = 'settings-group provider-key-group';
      group.style.cssText = 'margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border-color);';
      const label = document.createElement('label');
      label.className = 'settings-label';
      label.style.marginBottom = '4px';
      label.textContent = provider.name + ' (API Key)';
      const input = document.createElement('input');
      input.type = 'password';
      input.className = 'search-input';
      input.id = 'provider-key-' + provider.id;
      input.autocomplete = 'off';
      input.placeholder = 'Enter ' + provider.name + ' key...';
      input.style.cssText = 'width:100%;padding:4px 8px;';
      group.appendChild(label);
      group.appendChild(input);
      container.appendChild(group);
    }
  }

  _readProviderKeys() {
    const keys = {};
    if (!this.app.providerManager) return keys;
    for (const id of this.app.providerManager.getKeyProviderIds()) {
      const input = document.getElementById('provider-key-' + id);
      keys[id] = input ? input.value : '';
    }
    return keys;
  }

  _fillProviderKeys(settings) {
    if (!this.app.providerManager) return;
    for (const id of this.app.providerManager.getKeyProviderIds()) {
      const input = document.getElementById('provider-key-' + id);
      if (input) input.value = settings.keys && settings.keys[id] || '';
    }
  }

  _bindProviderSettings() {
    const app = this.app;
    const manager = app.providerManager;
    const modal = document.getElementById('provider-settings-modal');
    const fields = document.getElementById('provider-key-fields');
    const customUrl = document.getElementById('provider-custom-url');
    this._renderProviderKeyFields(fields);
    if (!modal || !manager) return;

    const close = () => { modal.style.display = 'none'; };
    this._listen(document.getElementById('provider-settings-btn'), 'click', () => {
      const settings = manager.getSettings();
      this._fillProviderKeys(settings);
      if (customUrl) customUrl.value = settings.customUrl || '';
      modal.style.display = 'flex';
    });
    this._listen(document.getElementById('provider-settings-close'), 'click', close);
    this._listen(document.getElementById('provider-settings-cancel'), 'click', close);
    this._listen(document.getElementById('provider-settings-save'), 'click', () => {
      const result = manager.saveSettings({
        keys: this._readProviderKeys(),
        customUrl: customUrl ? customUrl.value : ''
      });
      if (!result.ok) {
        globalEventBus.emit('toast:show', { message: result.message, type: 'error' });
        return;
      }
      close();
    });
  }

  _bindCompositionSettings() {
    const app = this.app;
    const modal = document.getElementById('comp-settings-modal');
    const preset = document.getElementById('comp-preset');
    const name = document.getElementById('comp-name');
    const nameModeButton = document.getElementById('comp-name-mode');
    const nameModeLabel = document.getElementById('comp-name-mode-label');
    const width = document.getElementById('comp-width');
    const height = document.getElementById('comp-height');
    const fps = document.getElementById('comp-fps');
    const duration = document.getElementById('comp-duration');
    if (!modal || !preset || !width || !height || !fps || !duration || !name) return;

    try {
      const saved = JSON.parse(localStorage.getItem('opengeo_comp_settings') || '{}');
      if (saved.preset) preset.value = saved.preset;
      if (saved.width) width.value = saved.width;
      if (saved.height) height.value = saved.height;
      if (saved.fps) fps.value = saved.fps;
      if (saved.duration) duration.value = saved.duration;
    } catch (error) {
      /* localStorage comp settings parse fallback */
    }

    this._listen(preset, 'change', () => {
      const dimensions = {
        hd: [1920, 1080], '4k': [3840, 2160], vertical: [1080, 1920], square: [1080, 1080]
      }[preset.value];
      if (dimensions) { width.value = dimensions[0]; height.value = dimensions[1]; }
    });
    let namingContext = { mode: localStorage.getItem('opengeo_map_naming_mode') === 'project' ? 'project' : 'default', projectName: '', ordinal: '' };
    const applySuggestedName = () => {
      name.value = this._composeSuggestedMapName(namingContext.mode, namingContext.projectName, namingContext.ordinal);
      if (nameModeButton) {
        nameModeButton.setAttribute('aria-pressed', namingContext.mode === 'project' ? 'true' : 'false');
        nameModeButton.title = namingContext.mode === 'project' ? 'Use default OpenGeo name' : 'Use After Effects project name';
        nameModeButton.classList.toggle('active', namingContext.mode === 'project');
        while (nameModeButton.firstChild) nameModeButton.removeChild(nameModeButton.firstChild);
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', namingContext.mode === 'project' ? 'folder' : 'map');
        nameModeButton.appendChild(icon);
      }
      if (nameModeLabel) nameModeLabel.textContent = namingContext.mode === 'project' ? 'AE project name' : 'Default name';
      if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
    };
    if (nameModeButton) this._listen(nameModeButton, 'click', () => {
      namingContext.mode = namingContext.mode === 'project' ? 'default' : 'project';
      localStorage.setItem('opengeo_map_naming_mode', namingContext.mode);
      applySuggestedName();
      name.focus();
      name.select();
    });
    this._listen(document.getElementById('create-comp-btn'), 'click', async () => {
      let state = null;
      try {
        state = await app.aeBridge.invoke('project.getState');
        if (state && !state.isSaved) {
          globalEventBus.emit('toast:show', { message: 'Please save your AE project first to create local assets.', type: 'error' });
          return;
        }
      } catch (error) {
        console.error('[ToolbarController] Failed to check project state', error);
      }
      let existingNames = [];
      try {
        const index = await app.aeBridge.invoke('project.listOpenGeoMaps', {}, { timeoutMs: 15000 });
        existingNames = index && Array.isArray(index.maps) ? index.maps.map(item => item && item.displayName) : [];
      } catch (error) {
        console.warn('[ToolbarController] Could not reserve a project map number:', error.message);
      }
      namingContext = {
        mode: localStorage.getItem('opengeo_map_naming_mode') === 'project' ? 'project' : 'default',
        projectName: this._normalizeProjectName(state && state.projectName),
        ordinal: this._createMapOrdinal(existingNames)
      };
      applySuggestedName();
      modal.style.display = 'flex';
      if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons({ root: modal });
      }
      setTimeout(() => { name.focus(); name.select(); }, 0);
    });
    const close = () => { modal.style.display = 'none'; };
    this._listen(document.getElementById('comp-settings-close'), 'click', close);
    this._listen(document.getElementById('comp-settings-cancel'), 'click', close);
    this._listen(document.getElementById('comp-settings-create'), 'click', () => {
      const settings = {
        displayName: this._normalizeMapName(name.value),
        preset: preset.value,
        width: parseInt(width.value, 10) || 1920,
        height: parseInt(height.value, 10) || 1080,
        fps: parseFloat(fps.value) || 30,
        duration: parseFloat(duration.value) || 30
      };
      localStorage.setItem('opengeo_comp_settings', JSON.stringify(settings));
      close();
      app.compositionController.create(settings);
    });
  }

  _bindSpatialPinModal() {
    const modal = document.getElementById('spatial-pin-modal');
    if (!modal) return;
    const closeBtn = document.getElementById('pin-modal-close');
    const cancelBtn = document.getElementById('pin-modal-cancel');
    const createBtn = document.getElementById('pin-modal-create');
    const palette = document.getElementById('pin-color-palette');

    const hide = () => {
      modal.style.display = 'none';
      modal.classList.remove('visible');
    };

    if (closeBtn) this._listen(closeBtn, 'click', hide);
    if (cancelBtn) this._listen(cancelBtn, 'click', hide);

    if (palette) {
      this._listen(palette, 'click', (e) => {
        const pill = e.target.closest('.pin-color-pill');
        if (!pill) return;
        palette.querySelectorAll('.pin-color-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this._selectedPinColor = pill.getAttribute('data-color') || '#1473e6';
      });
    }

    if (createBtn) {
      this._listen(createBtn, 'click', async () => {
        const app = this.app;
        if (!app.activeCompId) {
          globalEventBus.emit('toast:show', { message: 'No active comp! Create one first.', type: 'error' });
          hide();
          return;
        }
        const nameInput = document.getElementById('pin-name-input');
        const name = (nameInput && nameInput.value.trim()) || 'Spatial Pin';
        const optGraphic = document.getElementById('pin-opt-graphic');
        const optLabel = document.getElementById('pin-opt-label');
        const optSelected = document.getElementById('pin-opt-selected');
        const optOrient = document.getElementById('pin-opt-orient');
        const scaleRadio = document.querySelector('input[name="pin-scale-mode"]:checked');

        const options = {
          attachGraphic: optGraphic ? optGraphic.checked : true,
          attachLabel: optLabel ? optLabel.checked : true,
          attachSelected: optSelected ? optSelected.checked : false,
          autoOrient: optOrient ? optOrient.checked : false,
          maintainScreenSize: scaleRadio ? scaleRadio.value === 'maintain' : true,
          color: this._selectedPinColor || '#1473e6'
        };

        hide();
        try {
          await app.spatialPin.addPin(app.activeCompId, app.mapState.latitude, app.mapState.longitude, name, options);
          globalEventBus.emit('toast:show', { message: `Spatial Pin "${name}" created in AE!`, type: 'success' });
        } catch (error) {
          globalEventBus.emit('toast:show', { message: 'Failed to add Spatial Pin: ' + error.message, type: 'error' });
        }
      });
    }
  }

  _normalizeMapName(value) {
    const normalized = String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    return (normalized || 'OpenGeo Map').slice(0, 80);
  }

  _normalizeProjectName(value) {
    const withoutExtension = String(value || '').replace(/\.(aep|aepx|aet)$/i, '');
    return this._normalizeMapName(withoutExtension || 'OpenGeo Map');
  }

  _createMapOrdinal(existingNames) {
    const used = {};
    (Array.isArray(existingNames) ? existingNames : []).forEach(value => {
      const match = String(value || '').match(/(?:\u2022|#)\s*(\d{4})\s*$/);
      if (match) used[match[1]] = true;
    });
    for (let attempt = 0; attempt < 10000; attempt++) {
      const seed = (Date.now() + Math.floor(Math.random() * 9000) + attempt * 7919) % 10000;
      const candidate = ('0000' + String(seed)).slice(-4);
      if (!used[candidate]) return candidate;
    }
    return ('0000' + String(Date.now() % 10000)).slice(-4);
  }

  _composeSuggestedMapName(mode, projectName, ordinal) {
    const base = mode === 'project' && projectName ? projectName : 'OpenGeo Map';
    const suffix = ' \u2022 ' + String(ordinal || '0000');
    const safeBase = this._normalizeMapName(base).slice(0, Math.max(1, 80 - suffix.length)).trim();
    return safeBase + suffix;
  }

  _bindActions() {
    const app = this.app;
    this._listen(document.getElementById('finalize-btn'), 'click', () => {
      if (!app.activeCompId) {
        globalEventBus.emit('toast:show', { message: 'Create or open an OpenGeo composition first.', type: 'error' });
        return;
      }
      if (app.finalizeController) app.finalizeController.finalize();
    });
    this._listen(document.getElementById('dl-cancel'), 'click', () => {
      if (app.finalizeController) app.finalizeController.cancel();
    });
    this._listen(document.getElementById('keyframe-add-btn'), 'click', () => this._addKeyframe());
    this._listen(document.getElementById('keyframe-record-btn'), 'click', () => this._setKeyframeRecording(!app.isKeyframeRecording));
    this._listen(document.getElementById('pin-btn'), 'click', () => this._addSpatialPin());
    this._listen(document.getElementById('clear-markers-btn'), 'click', () => this._clearMapAnimation());
  }

  _bindGeoJSONImport() {
    const app = this.app;
    const input = document.getElementById('geojson-file-input');
    this._listen(document.getElementById('load-geojson-btn'), 'click', () => { if (input) input.click(); });
    this._listen(input, 'change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const maxBytes = app.geoJSONValidator ? app.geoJSONValidator.limits.maxBytes : 10 * 1024 * 1024;
      if (file.size > maxBytes) {
        globalEventBus.emit('toast:show', { message: 'GeoJSON is larger than the 10 MB safety limit.', type: 'error', duration: 6000 });
        input.value = '';
        return;
      }
      const revision = ++this._geoJsonLoadRevision;
      if (this._geoJsonReader && this._geoJsonReader.readyState === FileReader.LOADING) this._geoJsonReader.abort();
      const reader = new FileReader();
      this._geoJsonReader = reader;
      reader.onerror = () => this._finishGeoJSONError(revision, 'Could not read GeoJSON: ' + file.name);
      reader.onabort = () => { if (revision === this._geoJsonLoadRevision) this._geoJsonReader = null; };
      reader.onprogress = event => {
        if (revision !== this._geoJsonLoadRevision || !event.lengthComputable) return;
        const now = Date.now();
        if (now - this._geoJsonProgressAt < 150 && event.loaded < event.total) return;
        this._geoJsonProgressAt = now;
        globalEventBus.emit('ui:status', { message: 'Reading GeoJSON… ' + Math.round(event.loaded / event.total * 100) + '%', isError: false });
      };
      reader.onload = () => { this._finishGeoJSONLoad(revision, file, reader.result); };
      reader.readAsText(file);
      input.value = '';
    });
  }

  async _setKeyframeRecording(enabled, options = {}) {
    const app = this.app;
    const compId = options.compId === undefined ? app.activeCompId : options.compId;
    if (enabled && !compId) {
      this.syncKeyframeRecordingState(null);
      if (!options.silent) globalEventBus.emit('toast:show', { message: 'Create or open an OpenGeo composition before recording.', type: 'error' });
      return false;
    }
    if (this._recordTogglePending) return false;
    this._recordTogglePending = true;
    try {
      if (app.syncEngine) app.syncEngine.setKeyframeRecording(!!enabled, compId);
      if (app.activeCompId === compId) this.syncKeyframeRecordingState(compId);

      if (enabled) {
        const added = await this._addKeyframe({ silent: true, compId });
        if (!added) {
          if (app.syncEngine) app.syncEngine.setKeyframeRecording(false, compId);
          if (app.activeCompId === compId) this.syncKeyframeRecordingState(compId);
          return false;
        }
      }

      if (!options.silent && app.activeCompId === compId) {
        globalEventBus.emit('toast:show', {
          message: enabled ? 'Recording started; the initial keyframe was added at the current AE time.' : 'Keyframe recording stopped for this map.',
          type: enabled ? 'info' : 'success', duration: 2400
        });
      }
      return true;
    } finally {
      this._recordTogglePending = false;
    }
  }

  syncKeyframeRecordingState(compId) {
    const app = this.app;
    const enabled = !!(app.syncEngine && app.syncEngine.isKeyframeRecordingEnabled(compId));
    app.isKeyframeRecording = enabled;
    const button = document.getElementById('keyframe-record-btn');
    if (button) {
      button.classList.toggle('active', enabled);
      button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      button.title = enabled
        ? 'Recording map moves as keyframes. Click to stop recording.'
        : 'Record map moves as keyframes at the current AE time';
      const label = document.getElementById('keyframe-record-label');
      if (label) label.textContent = enabled ? 'Recording' : 'Record';
    }
    return enabled;
  }

  async _addSpatialPin() {
    const app = this.app;
    if (!app.activeCompId) {
      globalEventBus.emit('toast:show', { message: 'No active comp! Create one first.', type: 'error' });
      return;
    }

    const modal = document.getElementById('spatial-pin-modal');
    if (modal) {
      const nameInput = document.getElementById('pin-name-input');
      if (nameInput) nameInput.value = 'Spatial Pin';
      const coordsBadge = document.getElementById('pin-coords-badge');
      if (coordsBadge && app.mapState) {
        const lat = typeof app.mapState.latitude === 'number' ? app.mapState.latitude.toFixed(4) : '0.0000';
        const lng = typeof app.mapState.longitude === 'number' ? app.mapState.longitude.toFixed(4) : '0.0000';
        coordsBadge.textContent = `${lat}°, ${lng}°`;
      }
      modal.style.display = 'block';
      modal.classList.add('visible');
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons({ root: modal });
      }
      if (nameInput && typeof nameInput.focus === 'function') {
        setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
      }
      return;
    }

    const requestedName = await app.dialog.prompt({
      title: 'Create spatial pin',
      message: 'Name the Null/label that will be created at the current map position.',
      defaultValue: 'Spatial Pin', confirmLabel: 'Create Pin', cancelLabel: 'Cancel'
    });
    if (requestedName === null) return;
    const name = String(requestedName).trim() || 'Spatial Pin';
    try {
      await app.spatialPin.addPin(app.activeCompId, app.mapState.latitude, app.mapState.longitude, name);
      globalEventBus.emit('toast:show', { message: `Spatial Pin "${name}" created in AE!`, type: 'success' });
    } catch (error) {
      globalEventBus.emit('toast:show', { message: 'Failed to add Spatial Pin: ' + error.message, type: 'error' });
    }
  }

  async _addKeyframe(options = {}) {
    const app = this.app;
    const compId = options.compId === undefined ? app.activeCompId : options.compId;
    if (!compId) {
      if (!options.silent) globalEventBus.emit('toast:show', { message: 'No active comp! Create one first.', type: 'error' });
      return false;
    }
    if (app.finalizeController && app.finalizeController.isFinalizing) {
      if (!options.silent) globalEventBus.emit('toast:show', {
        message: 'Finalize is already reading the camera path. Wait for it to finish before adding another key.',
        type: 'warning', duration: 5000
      });
      return false;
    }
    const camera = {
      lat: app.mapState.latitude,
      lng: app.mapState.longitude,
      zoom: app.mapState.compZoom,
      pitch: app.mapState.pitch || 0
    };
    const mutationKey = String(compId);
    const previous = this._keyframeMutationTails.get(mutationKey) || Promise.resolve(true);
    const operation = previous.then(async () => {
      try {
        // Add Key is an explicit user command. Supersede debounced Live Sync
        // work before entering the host so it cannot sit behind a stale tile
        // build or trigger a second, redundant viewport preview afterwards.
        app.syncManager.prepareForKeyframeMutation();
        await app.aeBridge.invoke('keyframe.add', {
          compId, lat: camera.lat, lng: camera.lng, zoom: camera.zoom, pitch: camera.pitch
        });
        if (!options.silent) globalEventBus.emit('toast:show', { message: 'Keyframe added!', type: 'success' });
        if (app.activeCompId === compId) app.syncManager.queueTrajectoryPreview();
        return true;
      } catch (error) {
        globalEventBus.emit('toast:show', { message: 'Error adding keyframe: ' + error.message, type: 'error' });
        return false;
      }
    });
    this._keyframeMutationTails.set(mutationKey, operation);
    operation.then(() => {
      if (this._keyframeMutationTails.get(mutationKey) === operation) {
        this._keyframeMutationTails.delete(mutationKey);
      }
    });
    return operation;
  }

  hasPendingKeyframeMutation(compId) {
    return !!compId && this._keyframeMutationTails.has(String(compId));
  }

  async waitForKeyframeMutations(compId) {
    if (!compId) return true;
    const pending = this._keyframeMutationTails.get(String(compId));
    if (!pending) return true;
    return pending;
  }

  async _clearMapAnimation() {
    if (this._clearPending) return false;
    const app = this.app;
    const compId = app.activeCompId;
    if (!compId) {
      globalEventBus.emit('marker:clear');
      globalEventBus.emit('geojson:clear');
      globalEventBus.emit('toast:show', { message: 'Preview markers cleared.', type: 'info' });
      return true;
    }
    const confirmed = await app.dialog.confirm({
      title: 'Clear map animation',
      message: 'Remove all Latitude, Longitude, and Zoom keyframes from this map? The current camera view will be preserved. Vector layers and finalized tiles will not be deleted.',
      confirmLabel: 'Clear Keyframes', cancelLabel: 'Cancel', danger: true
    });
    if (!confirmed) return false;
    if (app.activeCompId !== compId) {
      globalEventBus.emit('toast:show', { message: 'Clear cancelled because the active map changed.', type: 'warning' });
      return false;
    }
    this._clearPending = true;
    try {
      app.syncManager.prepareForKeyframeMutation();
      const result = await app.aeBridge.invoke('keyframe.clear', { compId });
      if (app.syncEngine) app.syncEngine.setKeyframeRecording(false, compId);
      if (app.activeCompId === compId) {
        this.syncKeyframeRecordingState(compId);
        globalEventBus.emit('marker:clear');
        globalEventBus.emit('geojson:clear');
      }
      const removed = result && Number.isFinite(Number(result.keysRemoved)) ? Number(result.keysRemoved) : 0;
      globalEventBus.emit('toast:show', { message: `Map animation cleared (${removed} keyframes removed).`, type: 'success', duration: 3000 });
      return true;
    } catch (error) {
      globalEventBus.emit('toast:show', { message: 'Could not clear map animation: ' + error.message, type: 'error', duration: 5000 });
      return false;
    } finally {
      this._clearPending = false;
    }
  }

  _finishGeoJSONError(revision, message) {
    if (revision !== this._geoJsonLoadRevision) return;
    this._geoJsonReader = null;
    globalEventBus.emit('toast:show', { message, type: 'error' });
  }

  async _finishGeoJSONLoad(revision, file, source) {
    if (revision !== this._geoJsonLoadRevision) return;
    this._geoJsonReader = null;
    const app = this.app;
    const validation = app.geoJSONValidator
      ? app.geoJSONValidator.parse(source, { sourceBytes: file.size })
      : { ok: false, error: { message: 'GeoJSON validation is unavailable.' } };
    if (!validation.ok) {
      globalEventBus.emit('toast:show', { message: validation.error.message, type: 'error', duration: 6000 });
      globalEventBus.emit('ui:status', { message: validation.error.message, isError: true });
      return;
    }
    const result = app.geoJSONLayer.loadGeoJSON(validation.data);
    if (!result || !result.ok) {
      const message = result && result.error ? result.error.message : 'GeoJSON could not be rendered.';
      globalEventBus.emit('toast:show', { message, type: 'error', duration: 6000 });
      return;
    }
    const previewPayload = app.vectorMapManager.buildGeoJSONPreviewPayload(validation, file.name);
    const registerPreviewOnly = async () => {
      await app.featureManager.registerPreview(previewPayload, 'geojson');
      app.geoJSONLayer.clearGeoJSON();
    };
    const activeMapCompId = app.compositionController
      ? await app.compositionController.resolveActiveMapTarget()
      : app.activeCompId;
    if (revision !== this._geoJsonLoadRevision) return;
    if (!activeMapCompId) {
      try {
        await registerPreviewOnly();
        const message = `GeoJSON preview loaded: ${file.name}. It is available in Layers and can be sent to AE after creating a composition.`;
        globalEventBus.emit('toast:show', { message, type: 'info', duration: 7000 });
        globalEventBus.emit('ui:status', { message: 'GeoJSON preview only — no active Map composition.', isError: false });
      } catch (error) {
        globalEventBus.emit('toast:show', { message: `GeoJSON is visible, but could not be added to Layers: ${error.message}`, type: 'error', duration: 7000 });
      }
      return;
    }
    if (!app.vectorMapManager || typeof app.vectorMapManager.drawGeoJSONInAE !== 'function') {
      globalEventBus.emit('toast:show', { message: 'GeoJSON preview loaded, but the After Effects drawing service is unavailable.', type: 'error', duration: 6000 });
      return;
    }
    globalEventBus.emit('ui:status', { message: `Drawing GeoJSON in After Effects… ${file.name}`, isError: false });
    try {
      const aeResult = await app.vectorMapManager.drawGeoJSONInAE(validation, { name: file.name, size: file.size });
      if (revision !== this._geoJsonLoadRevision) return;
      // The persisted FeatureOverlay becomes the sole preview owner after the
      // AE transaction succeeds, preventing duplicate strokes.
      app.geoJSONLayer.clearGeoJSON();
      const paths = aeResult && Number.isFinite(Number(aeResult.paths)) ? Number(aeResult.paths) : 0;
      globalEventBus.emit('toast:show', {
        message: `GeoJSON drawn in AE: ${file.name} (${result.featureCount} features, ${paths} paths)`,
        type: 'success', duration: 5000
      });
      globalEventBus.emit('ui:status', { message: 'GeoJSON preview and AE drawing complete.', isError: false });
    } catch (error) {
      if (revision !== this._geoJsonLoadRevision) return;
      try { await registerPreviewOnly(); }
      catch (previewError) {
        const message = `GeoJSON drawing failed and its preview could not be registered: ${previewError.message}`;
        globalEventBus.emit('toast:show', { message, type: 'error', duration: 7000 });
        globalEventBus.emit('ui:status', { message, isError: true });
        return;
      }
      const message = `AE drawing was unavailable; ${file.name} was kept in Layers as Preview only. Open an OpenGeo map and use the draw button.`;
      globalEventBus.emit('toast:show', { message, type: 'warning', duration: 7000 });
      globalEventBus.emit('ui:status', { message, isError: false });
    }
  }

  dispose() {
    if (this._geoJsonReader && this._geoJsonReader.readyState === FileReader.LOADING) this._geoJsonReader.abort();
    this._geoJsonLoadRevision++;
    this._geoJsonReader = null;
    this._keyframeMutationTails.clear();
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = ToolbarController;
else if (typeof window !== 'undefined') window.ToolbarController = ToolbarController;
