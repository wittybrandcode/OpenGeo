/** Safe DOM-only feature layer panel. */
class LayersPanel {
  constructor(app = {}) {
    const isDeps = app && (app.featureRegistry || app.featureManager);
    this.app = isDeps && app.app ? app.app : app;
    this.featureRegistry = (isDeps && app.featureRegistry) || (this.app && this.app.featureRegistry) || null;
    this.featureManager = (isDeps && app.featureManager) || (this.app && this.app.featureManager) || null;
    this.panel = typeof document !== 'undefined' ? document.getElementById('feature-layers-panel') : null;
    this.listElement = typeof document !== 'undefined' ? document.getElementById('feature-layers-list') : null;
    this.toggleButton = typeof document !== 'undefined' ? document.getElementById('feature-layers-btn') : null;
    this.headerToggleButton = typeof document !== 'undefined' ? document.getElementById('toolbar-vector-layers-btn') : null;
    this.countBadge = typeof document !== 'undefined' ? document.getElementById('vector-layers-count-badge') : null;
    this.countLabel = typeof document !== 'undefined' ? document.getElementById('feature-layers-count-label') : null;
    this.closeButton = typeof document !== 'undefined' ? document.getElementById('feature-layers-close') : null;

    // Merge toolbar elements
    this.selectAllCheckbox = typeof document !== 'undefined' ? document.getElementById('feature-layers-select-all') : null;
    this.selectedCountElement = typeof document !== 'undefined' ? document.getElementById('feature-layers-selected-count') : null;
    this.mergeButton = typeof document !== 'undefined' ? document.getElementById('feature-layers-merge-btn') : null;

    // Merge modal elements
    this.mergeModal = typeof document !== 'undefined' ? document.getElementById('merge-vector-modal') : null;
    this.mergeModalClose = typeof document !== 'undefined' ? document.getElementById('merge-modal-close-btn') : null;
    this.mergeCancelBtn = typeof document !== 'undefined' ? document.getElementById('merge-cancel-btn') : null;
    this.mergeConfirmBtn = typeof document !== 'undefined' ? document.getElementById('merge-confirm-btn') : null;
    this.mergeConfirmBtnText = typeof document !== 'undefined' ? document.getElementById('merge-confirm-btn-text') : null;
    this.mergeNameInput = typeof document !== 'undefined' ? document.getElementById('merge-bloc-name-input') : null;
    this.mergeChipsContainer = typeof document !== 'undefined' ? document.getElementById('merge-selected-chips') : null;
    this.mergeCountBadge = typeof document !== 'undefined' ? document.getElementById('merge-selected-count-badge') : null;
    this.mergeColorPalette = typeof document !== 'undefined' ? document.getElementById('merge-color-palette') : null;
    this.mergeLabelsCheck = typeof document !== 'undefined' ? document.getElementById('merge-create-labels-check') : null;
    this.mergeSimplifyCheck = typeof document !== 'undefined' ? document.getElementById('merge-auto-simplify-check') : null;
    this.mergeSingleShapeCheck = typeof document !== 'undefined' ? document.getElementById('merge-single-shape-check') : null;

    this._selectedIds = new Set();
    this._selectedMergeColor = '#10b981';
    this._paletteColors = ['#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16'];

    this._onToggle = () => this.toggle();
    this._onClose = () => this.close();
    this._onSelectAll = (e) => this._handleSelectAll(e && e.target && e.target.checked);
    this._onOpenMerge = () => this._openMergeModal();
    this._onCloseMerge = () => this._closeMergeModal();
    this._onConfirmMerge = () => this._executeMerge();

    if (this.toggleButton) this.toggleButton.addEventListener('click', this._onToggle);
    if (this.headerToggleButton) this.headerToggleButton.addEventListener('click', this._onToggle);
    if (this.closeButton) this.closeButton.addEventListener('click', this._onClose);
    if (this.selectAllCheckbox) this.selectAllCheckbox.addEventListener('change', this._onSelectAll);
    if (this.mergeButton) this.mergeButton.addEventListener('click', this._onOpenMerge);
    if (this.mergeModalClose) this.mergeModalClose.addEventListener('click', this._onCloseMerge);
    if (this.mergeCancelBtn) this.mergeCancelBtn.addEventListener('click', this._onCloseMerge);
    if (this.mergeConfirmBtn) this.mergeConfirmBtn.addEventListener('click', this._onConfirmMerge);

    this._unsubscribe = (app && app.featureRegistry)
      ? app.featureRegistry.onChange(items => this.render(items))
      : (this.featureRegistry && typeof this.featureRegistry.onChange === 'function'
          ? this.featureRegistry.onChange(items => this.render(items))
          : null);
    if (this.featureRegistry && typeof this.featureRegistry.list === 'function') {
      this.render(this.featureRegistry.list());
    }
  }

  destroy() {
    this.dispose();
  }

  dispose() {
    if (this.toggleButton) this.toggleButton.removeEventListener('click', this._onToggle);
    if (this.headerToggleButton) this.headerToggleButton.removeEventListener('click', this._onToggle);
    if (this.closeButton) this.closeButton.removeEventListener('click', this._onClose);
    if (this.selectAllCheckbox) this.selectAllCheckbox.removeEventListener('change', this._onSelectAll);
    if (this.mergeButton) this.mergeButton.removeEventListener('click', this._onOpenMerge);
    if (this.mergeModalClose) this.mergeModalClose.removeEventListener('click', this._onCloseMerge);
    if (this.mergeCancelBtn) this.mergeCancelBtn.removeEventListener('click', this._onCloseMerge);
    if (this.mergeConfirmBtn) this.mergeConfirmBtn.removeEventListener('click', this._onConfirmMerge);
    if (typeof this._unsubscribe === 'function') {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  toggle() { if (this.panel && this.panel.classList.contains('visible')) this.close(); else this.open(); }
  open() {
    if (this.panel) { this.panel.classList.add('visible'); this.panel.setAttribute('aria-hidden', 'false'); }
    if (this.app.featureManager) this._run(() => this.app.featureManager.refresh());
  }
  close() { if (this.panel) { this.panel.classList.remove('visible'); this.panel.setAttribute('aria-hidden', 'true'); } }

  render(items = []) {
    const safeItems = Array.isArray(items) ? items : [];
    const totalCount = safeItems.length;

    // Update count badge on header toolbar
    if (this.countBadge) {
      this.countBadge.textContent = String(totalCount);
      this.countBadge.style.display = totalCount > 0 ? 'flex' : 'none';
    }
    if (this.countLabel) {
      this.countLabel.textContent = totalCount > 0
        ? `${totalCount} map${totalCount === 1 ? '' : 's'} in composition`
        : 'Preview and AE composition';
    }

    // Clean up selected IDs that no longer exist in the registry
    const validIds = new Set(safeItems.map(it => it.id));
    for (const id of this._selectedIds) {
      if (!validIds.has(id)) this._selectedIds.delete(id);
    }
    this._updateSelectionState(safeItems);

    if (!this.listElement) return;
    while (this.listElement.firstChild) this.listElement.removeChild(this.listElement.firstChild);

    if (!safeItems.length) {
      const empty = document.createElement('div'); empty.className = 'feature-layers-empty';
      empty.textContent = this.app.activeCompId
        ? 'No vector maps are registered in this composition.'
        : 'No preview maps yet. Import GeoJSON or use the drawing action in Search.';
      this.listElement.appendChild(empty);
      return;
    }

    safeItems.forEach(item => this.listElement.appendChild(this._createRow(item)));
  }

  _updateSelectionState(items = []) {
    const selectedCount = this._selectedIds.size;
    if (this.selectedCountElement) {
      this.selectedCountElement.textContent = `${selectedCount} selected`;
    }
    if (this.mergeButton) {
      this.mergeButton.disabled = selectedCount < 2;
    }
    if (this.selectAllCheckbox) {
      const total = items.length;
      this.selectAllCheckbox.checked = total > 0 && selectedCount === total;
      this.selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < total;
    }
  }

  _handleSelectAll(checked) {
    const items = this.featureRegistry ? this.featureRegistry.list() : [];
    if (checked) {
      items.forEach(it => this._selectedIds.add(it.id));
    } else {
      this._selectedIds.clear();
    }
    this.render(items);
  }

  _createRow(item) {
    const row = document.createElement('div'); row.className = 'feature-layer-row'; row.dataset.featureId = item.id;

    // Checkbox for selection & merge
    const checkWrap = document.createElement('label'); checkWrap.className = 'feature-layer-check-wrap';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'feature-layer-checkbox';
    checkbox.title = `Select ${item.name} for merge`;
    checkbox.setAttribute('aria-label', `Select ${item.name} for merge`);
    checkbox.checked = this._selectedIds.has(item.id);
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) this._selectedIds.add(item.id);
      else this._selectedIds.delete(item.id);
      this._updateSelectionState(this.featureRegistry ? this.featureRegistry.list() : []);
    });
    checkWrap.appendChild(checkbox);

    // Visibility toggle
    const visibility = this._button(item.visible ? 'eye' : 'eye-off', item.visible ? 'Hide' : 'Show');
    visibility.classList.toggle('muted', !item.visible);
    visibility.addEventListener('click', async () => this._run(() => this.app.featureManager.setVisibility(item.id, !item.visible)));

    // Color Swatch
    const swatch = document.createElement('span'); swatch.className = 'feature-layer-swatch';
    const preview = item.previewPayload;
    let colorHex = '#10b981';
    if (preview && preview.fillColor && Array.isArray(preview.fillColor)) {
      const r = Math.round(preview.fillColor[0] * 255);
      const g = Math.round(preview.fillColor[1] * 255);
      const b = Math.round(preview.fillColor[2] * 255);
      colorHex = `rgb(${r},${g},${b})`;
    }
    swatch.style.backgroundColor = colorHex;

    // Body
    const body = document.createElement('div'); body.className = 'feature-layer-body';
    const name = document.createElement('div'); name.className = 'feature-layer-name'; name.textContent = item.name;
    const status = document.createElement('div'); status.className = 'feature-layer-status';
    status.textContent = item.hostPresent
      ? (item.previewAvailable ? `${item.type} · Synced with AE` : `${item.type} · AE only`)
      : `${item.type} · Preview only`;
    body.appendChild(name); body.appendChild(status);

    // Focus
    const focus = this._button('crosshair', 'Focus in preview');
    focus.addEventListener('click', () => this.app.featureManager.focusFeature(item.id));

    // Send to AE if preview-only
    let send = null;
    if (!item.hostPresent && this.app.activeCompId) {
      send = this._button('upload-cloud', 'Draw this preview map in After Effects');
      send.classList.add('feature-layer-send');
      send.addEventListener('click', async () => this._run(() => this.app.featureManager.importPreviewToAE(item.id)));
    }

    // Delete
    const remove = this._button('trash-2', 'Delete from AE and OpenGeo');
    remove.addEventListener('click', async () => {
      const confirmed = await this.app.dialog.confirm({
        title: 'Delete vector map',
        message: item.hostPresent
          ? `Delete “${item.name}” from the OpenGeo preview and After Effects composition?`
          : `Remove “${item.name}” from the OpenGeo preview?`,
        confirmLabel: 'Delete', cancelLabel: 'Keep map', danger: true
      });
      if (confirmed) await this._run(() => this.app.featureManager.deleteFeature(item.id));
    });

    row.appendChild(checkWrap);
    row.appendChild(visibility);
    row.appendChild(swatch);
    row.appendChild(body);
    row.appendChild(focus);
    if (send) row.appendChild(send);
    row.appendChild(remove);

    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
    return row;
  }

  _openMergeModal() {
    if (this._selectedIds.size < 2) {
      if (typeof globalEventBus !== 'undefined') {
        globalEventBus.emit('toast:show', { message: 'Select at least 2 vector maps to merge.', type: 'info' });
      }
      return;
    }
    if (!this.mergeModal) return;
    const items = this.featureRegistry ? this.featureRegistry.list() : [];
    const selectedItems = items.filter(it => this._selectedIds.has(it.id));

    if (this.mergeCountBadge) {
      this.mergeCountBadge.textContent = String(selectedItems.length);
    }

    // Populate chips
    if (this.mergeChipsContainer) {
      while (this.mergeChipsContainer.firstChild) {
        this.mergeChipsContainer.removeChild(this.mergeChipsContainer.firstChild);
      }
      selectedItems.forEach(item => {
        const chip = document.createElement('div');
        chip.className = 'merge-selected-chip';
        const dot = document.createElement('span');
        dot.className = 'chip-dot';
        const text = document.createElement('span');
        text.textContent = item.name;
        chip.appendChild(dot);
        chip.appendChild(text);
        this.mergeChipsContainer.appendChild(chip);
      });
    }

    // Default name
    if (this.mergeNameInput) {
      const names = selectedItems.map(it => it.name);
      this.mergeNameInput.value = `Merged: ${names.slice(0, 2).join(' + ')}${names.length > 2 ? ` (+${names.length - 2})` : ''}`;
    }

    // Color swatches
    if (this.mergeColorPalette) {
      while (this.mergeColorPalette.firstChild) {
        this.mergeColorPalette.removeChild(this.mergeColorPalette.firstChild);
      }
      this._paletteColors.forEach(hex => {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'geojson-palette-swatch' + (hex === this._selectedMergeColor ? ' active' : '');
        swatch.style.backgroundColor = hex;
        swatch.title = `Color ${hex}`;
        swatch.setAttribute('aria-label', `Color ${hex}`);
        swatch.addEventListener('click', () => {
          this._selectedMergeColor = hex;
          const allSwatches = this.mergeColorPalette.querySelectorAll('.geojson-palette-swatch');
          allSwatches.forEach(s => s.classList.remove('active'));
          swatch.classList.add('active');
        });
        this.mergeColorPalette.appendChild(swatch);
      });
    }

    this.mergeModal.style.display = 'flex';
    this.mergeModal.classList.add('visible');
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
  }

  _closeMergeModal() {
    if (this.mergeModal) {
      this.mergeModal.style.display = 'none';
      this.mergeModal.classList.remove('visible');
    }
  }

  async _executeMerge() {
    const selectedIds = Array.from(this._selectedIds);
    if (selectedIds.length < 2) return;
    const blocName = this.mergeNameInput && this.mergeNameInput.value.trim()
      ? this.mergeNameInput.value.trim()
      : 'Unified Bloc';
    const singleShape = this.mergeSingleShapeCheck ? this.mergeSingleShapeCheck.checked : true;
    const createLabels = this.mergeLabelsCheck ? this.mergeLabelsCheck.checked : true;
    const autoSimplify = this.mergeSimplifyCheck ? this.mergeSimplifyCheck.checked : true;
    const color = this._selectedMergeColor || '#10b981';

    if (this.mergeConfirmBtn) this.mergeConfirmBtn.disabled = true;
    if (this.mergeConfirmBtnText) this.mergeConfirmBtnText.textContent = 'Merging...';

    try {
      await this.app.featureManager.mergeFeaturesIntoBloc(selectedIds, {
        name: blocName,
        color,
        createLabels,
        autoSimplify,
        singleShape
      });
      this._closeMergeModal();
      this._selectedIds.clear();
      if (typeof globalEventBus !== 'undefined') {
        globalEventBus.emit('toast:show', {
          message: `Merged ${selectedIds.length} maps into "${blocName}" in AE (Original maps preserved).`,
          type: 'success'
        });
      }
    } catch (err) {
      if (typeof globalEventBus !== 'undefined') {
        globalEventBus.emit('toast:show', {
          message: `Merge failed: ${err.message}`,
          type: 'error'
        });
      }
    } finally {
      if (this.mergeConfirmBtn) this.mergeConfirmBtn.disabled = false;
      if (this.mergeConfirmBtnText) this.mergeConfirmBtnText.textContent = 'Merge & Draw in AE';
      if (this.featureRegistry) this.render(this.featureRegistry.list());
    }
  }

  _button(icon, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'feature-layer-action';
    button.title = title;
    button.setAttribute('aria-label', title);
    const element = document.createElement('i');
    element.setAttribute('data-lucide', icon);
    button.appendChild(element);
    return button;
  }

  async _run(callback) {
    try { await callback(); }
    catch (error) { globalEventBus.emit('toast:show', { message: error.message, type: 'error', duration: 6000 }); }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = LayersPanel;
else if (typeof window !== 'undefined') window.LayersPanel = LayersPanel;
