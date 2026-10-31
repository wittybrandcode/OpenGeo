/**
 * OpenGeo GeoJSON Import Manager Modal Controller (v1.1.0)
 * Provides interactive layer inspection, feature selection, color customization,
 * deletion, unified bloc merging, and camera framing before sending to After Effects.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.GeoJSONImportModal = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class GeoJSONImportModal {
    constructor(app) {
      this.app = app;
      this.engine = (typeof window !== 'undefined' && window.GeoJSONEngine) ||
        (typeof global !== 'undefined' && global.GeoJSONEngine) ||
        (typeof GeoJSONEngine !== 'undefined' ? GeoJSONEngine : null);

      this.isOpen = false;
      this.validation = null;
      this.fileInfo = null;
      this.features = [];
      this.activeMode = 'separate'; // 'separate' | 'bloc'
      this._onConfirmPromise = null;
      this._resolveConfirm = null;
      this._rejectConfirm = null;

      this._elements = {};
      this._bound = false;
    }

    _cacheDom() {
      if (this._bound) return;
      this._elements.overlay = document.getElementById('geojson-import-modal');
      if (!this._elements.overlay) return;

      this._elements.title = document.getElementById('geojson-modal-title');
      this._elements.subtitle = document.getElementById('geojson-modal-file-subtitle');
      this._elements.closeBtn = document.getElementById('geojson-modal-close');
      this._elements.cancelBtn = document.getElementById('geojson-btn-cancel');
      this._elements.importBtn = document.getElementById('geojson-btn-import');
      this._elements.importBtnLabel = document.getElementById('geojson-import-btn-label');
      this._elements.statFeatures = document.getElementById('geojson-stat-features');
      this._elements.statPoints = document.getElementById('geojson-stat-points');
      this._elements.statSelected = document.getElementById('geojson-stat-selected');
      this._elements.lodContainer = document.getElementById('geojson-lod-badge-container');
      this._elements.filterInput = document.getElementById('geojson-filter-input');
      this._elements.selectAllBtn = document.getElementById('geojson-select-all');
      this._elements.deselectAllBtn = document.getElementById('geojson-deselect-all');
      this._elements.tbody = document.getElementById('geojson-features-tbody');
      this._elements.modeSeparate = document.getElementById('geojson-mode-opt-separate');
      this._elements.modeBloc = document.getElementById('geojson-mode-opt-bloc');
      this._elements.blocSettings = document.getElementById('geojson-bloc-settings');
      this._elements.blocName = document.getElementById('geojson-bloc-name');
      this._elements.blocColor = document.getElementById('geojson-bloc-color');
      this._elements.optLabels = document.getElementById('geojson-opt-labels');
      this._elements.optFitCamera = document.getElementById('geojson-opt-fit-camera');
      this._elements.optSimplify = document.getElementById('geojson-opt-simplify');
      this._elements.footerStatus = document.getElementById('geojson-footer-status');

      this._bindEvents();
      this._bound = true;
    }

    _bindEvents() {
      const el = this._elements;
      if (el.closeBtn) el.closeBtn.addEventListener('click', () => this.cancel());
      if (el.cancelBtn) el.cancelBtn.addEventListener('click', () => this.cancel());
      if (el.importBtn) el.importBtn.addEventListener('click', () => this._handleImport());

      if (el.overlay) {
        el.overlay.addEventListener('click', (e) => {
          if (e.target === el.overlay) this.cancel();
        });
      }

      if (el.modeSeparate) {
        el.modeSeparate.addEventListener('click', () => this.setMode('separate'));
      }
      if (el.modeBloc) {
        el.modeBloc.addEventListener('click', () => this.setMode('bloc'));
      }

      if (el.selectAllBtn) {
        el.selectAllBtn.addEventListener('click', () => this.selectAll(true));
      }
      if (el.deselectAllBtn) {
        el.deselectAllBtn.addEventListener('click', () => this.selectAll(false));
      }

      if (el.filterInput) {
        el.filterInput.addEventListener('input', (e) => this._filterFeatures(e.target.value));
      }
    }

    setMode(mode) {
      this.activeMode = mode;
      const el = this._elements;
      if (el.modeSeparate && el.modeBloc) {
        if (mode === 'bloc') {
          el.modeBloc.classList.add('active');
          el.modeSeparate.classList.remove('active');
          const radioBloc = el.modeBloc.querySelector('input[type="radio"]');
          if (radioBloc) radioBloc.checked = true;
          if (el.blocSettings) el.blocSettings.classList.add('visible');
        } else {
          el.modeSeparate.classList.add('active');
          el.modeBloc.classList.remove('active');
          const radioSep = el.modeSeparate.querySelector('input[type="radio"]');
          if (radioSep) radioSep.checked = true;
          if (el.blocSettings) el.blocSettings.classList.remove('visible');
        }
      }
      this._updateStats();
    }

    open(validation, fileInfo) {
      this._cacheDom();
      if (!this._elements.overlay) {
        console.warn('[GeoJSONImportModal] Modal overlay not present in DOM');
        return Promise.reject(new Error('GeoJSON modal DOM not found'));
      }

      this.validation = validation;
      this.fileInfo = fileInfo || { name: 'Uploaded GeoJSON', size: 0 };
      this.activeMode = 'separate';

      // Parse feature metadata
      const rawFeatures = (validation && validation.features) || [];
      this.features = rawFeatures.map((f, i) => {
        const meta = this.engine && this.engine.resolveFeatureMetadata
          ? this.engine.resolveFeatureMetadata(f, i)
          : {
              id: f.id || `feat_${i}`,
              index: i,
              name: (f.properties && (f.properties.name || f.properties.NAME)) || `Feature ${i + 1}`,
              geometryType: f.geometry ? f.geometry.type : 'Unknown',
              vertexCount: 0,
              selected: true,
              fillColor: '#10b981',
              strokeColor: '#ffffff',
              fillOpacity: 65,
              strokeWidth: 2.5
            };
        return Object.assign({}, meta, { rawFeature: f });
      });

      // Default bloc name from filename
      const baseName = String(this.fileInfo.name || 'Unified Bloc')
        .replace(/\.(geojson|json)$/i, '')
        .replace(/[-_]+/g, ' ')
        .trim();
      if (this._elements.blocName) {
        this._elements.blocName.value = `Bloc — ${baseName}`;
      }

      if (this._elements.subtitle) {
        this._elements.subtitle.textContent = `${this.fileInfo.name} (${this._formatBytes(this.fileInfo.size)})`;
      }
      if (this._elements.filterInput) {
        this._elements.filterInput.value = '';
      }

      this.setMode('separate');
      this._renderRows();
      this._updateStats();

      this._elements.overlay.classList.add('visible');
      this.isOpen = true;

      if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
      }

      return new Promise((resolve, reject) => {
        this._resolveConfirm = resolve;
        this._rejectConfirm = reject;
      });
    }

    close() {
      if (this._elements.overlay) {
        this._elements.overlay.classList.remove('visible');
      }
      this.isOpen = false;
      this._clearMapHover();
    }

    cancel() {
      this.close();
      if (this._rejectConfirm) {
        this._rejectConfirm(new Error('GEOJSON_IMPORT_CANCELLED'));
        this._rejectConfirm = null;
        this._resolveConfirm = null;
      }
    }

    selectAll(selected) {
      for (let i = 0; i < this.features.length; i++) {
        this.features[i].selected = Boolean(selected);
      }
      const checkboxes = this._elements.tbody.querySelectorAll('.geojson-feat-check');
      checkboxes.forEach(cb => { cb.checked = Boolean(selected); });
      const rows = this._elements.tbody.querySelectorAll('tr');
      rows.forEach(r => {
        if (selected) r.classList.remove('excluded');
        else r.classList.add('excluded');
      });
      this._updateStats();
    }

    _filterFeatures(query) {
      const q = String(query || '').toLowerCase().trim();
      const rows = this._elements.tbody.querySelectorAll('tr');
      rows.forEach(r => {
        const text = r.getAttribute('data-search') || '';
        if (!q || text.includes(q)) {
          r.style.display = '';
        } else {
          r.style.display = 'none';
        }
      });
    }

    _renderRows() {
      const tbody = this._elements.tbody;
      if (!tbody) return;
      while (tbody.firstChild) tbody.removeChild(tbody.firstChild);

      for (let i = 0; i < this.features.length; i++) {
        const item = this.features[i];
        const tr = document.createElement('tr');
        tr.setAttribute('data-index', i.toString());
        tr.setAttribute('data-search', `${item.name.toLowerCase()} ${item.isoCode.toLowerCase()} ${item.geometryType.toLowerCase()}`);
        if (!item.selected) tr.classList.add('excluded');

        // Checkbox
        const tdCheck = document.createElement('td');
        tdCheck.className = 'geojson-cell-check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'geojson-feat-check';
        cb.checked = item.selected;
        cb.addEventListener('change', (e) => {
          item.selected = e.target.checked;
          if (item.selected) tr.classList.remove('excluded');
          else tr.classList.add('excluded');
          this._updateStats();
        });
        tdCheck.appendChild(cb);

        // Color Picker
        const tdColor = document.createElement('td');
        tdColor.className = 'geojson-cell-color';
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = item.fillColor;
        colorInput.title = 'Change feature fill color';
        colorInput.addEventListener('input', (e) => {
          item.fillColor = e.target.value;
        });
        tdColor.appendChild(colorInput);

        // Name
        const tdName = document.createElement('td');
        tdName.className = 'geojson-cell-name';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = item.name;
        tdName.appendChild(nameSpan);
        if (item.isoCode) {
          const isoSmall = document.createElement('small');
          isoSmall.textContent = `ISO: ${item.isoCode}`;
          tdName.appendChild(isoSmall);
        }

        // Type & Points
        const tdPts = document.createElement('td');
        tdPts.className = 'geojson-cell-pts';
        tdPts.textContent = `${item.geometryType} • ${item.vertexCount.toLocaleString()} pts`;

        // Delete action
        const tdActions = document.createElement('td');
        tdActions.className = 'geojson-cell-actions';
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'geojson-del-btn';
        delBtn.title = 'Remove this feature from import';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._deleteFeature(i);
        });
        tdActions.appendChild(delBtn);

        // Hover for map preview
        tr.addEventListener('mouseenter', () => this._highlightFeatureOnMap(i));
        tr.addEventListener('mouseleave', () => this._clearMapHover());

        tr.appendChild(tdCheck);
        tr.appendChild(tdColor);
        tr.appendChild(tdName);
        tr.appendChild(tdPts);
        tr.appendChild(tdActions);
        tbody.appendChild(tr);
      }
    }

    _deleteFeature(index) {
      if (index >= 0 && index < this.features.length) {
        this.features.splice(index, 1);
        this._renderRows();
        this._updateStats();
      }
    }

    _updateStats() {
      const totalFeats = this.features.length;
      const selected = this.features.filter(f => f.selected);
      let totalPts = 0;
      let selectedPts = 0;
      for (let i = 0; i < totalFeats; i++) {
        totalPts += this.features[i].vertexCount;
        if (this.features[i].selected) selectedPts += this.features[i].vertexCount;
      }

      if (this._elements.statFeatures) this._elements.statFeatures.textContent = totalFeats.toString();
      if (this._elements.statPoints) this._elements.statPoints.textContent = totalPts.toLocaleString();
      if (this._elements.statSelected) this._elements.statSelected.textContent = `${selected.length} (${selectedPts.toLocaleString()} pts)`;

      if (this._elements.importBtnLabel) {
        if (this.activeMode === 'bloc') {
          this._elements.importBtnLabel.textContent = `Merge & Import as Unified Bloc (${selected.length})`;
        } else {
          this._elements.importBtnLabel.textContent = `Import Selected Features (${selected.length})`;
        }
      }

      if (this._elements.importBtn) {
        this._elements.importBtn.disabled = selected.length === 0;
      }

      // LOD Warning Badge
      if (this._elements.lodContainer) {
        while (this._elements.lodContainer.firstChild) {
          this._elements.lodContainer.removeChild(this._elements.lodContainer.firstChild);
        }
        const badge = document.createElement('span');
        if (selectedPts > 4000) {
          badge.className = 'geojson-lod-badge warning';
          badge.title = 'Over 4,000 points. Auto-simplification is recommended to prevent AE slowdown.';
          badge.textContent = `⚠️ High Point Count: ${selectedPts.toLocaleString()} (Auto-LOD Enabled)`;
          if (this._elements.optSimplify) this._elements.optSimplify.checked = true;
        } else {
          badge.className = 'geojson-lod-badge safe';
          badge.textContent = `✓ Safe Complexity: ${selectedPts.toLocaleString()} pts`;
        }
        this._elements.lodContainer.appendChild(badge);
      }
    }

    _highlightFeatureOnMap(index) {
      if (!this.app || !this.app.geoJSONLayer) return;
      const item = this.features[index];
      if (!item || !item.rawFeature) return;
      // If geoJSONLayer supports highlightFeature
      if (typeof this.app.geoJSONLayer.highlightFeature === 'function') {
        this.app.geoJSONLayer.highlightFeature(item.rawFeature);
      }
    }

    _clearMapHover() {
      if (!this.app || !this.app.geoJSONLayer) return;
      if (typeof this.app.geoJSONLayer.clearHighlight === 'function') {
        this.app.geoJSONLayer.clearHighlight();
      }
    }

    _formatBytes(bytes) {
      if (!bytes || bytes <= 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
    }

    _escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    async _handleImport() {
      const selected = this.features.filter(f => f.selected);
      if (selected.length === 0) return;

      const createLabels = this._elements.optLabels ? this._elements.optLabels.checked : true;
      const fitCamera = this._elements.optFitCamera ? this._elements.optFitCamera.checked : true;
      const autoSimplify = this._elements.optSimplify ? this._elements.optSimplify.checked : true;

      const importPayload = {
        mode: this.activeMode,
        fileInfo: this.fileInfo,
        selectedFeatures: selected.map(s => s.rawFeature),
        featureMetas: selected,
        createLabels,
        fitCamera,
        autoSimplify,
        blocName: this._elements.blocName ? this._elements.blocName.value.trim() : 'Unified Bloc',
        blocColor: this._elements.blocColor ? this._elements.blocColor.value : '#10b981'
      };

      this.close();
      if (this._resolveConfirm) {
        this._resolveConfirm(importPayload);
        this._resolveConfirm = null;
        this._rejectConfirm = null;
      }
    }
  }

  return GeoJSONImportModal;
});
