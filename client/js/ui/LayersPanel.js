/** Safe DOM-only feature layer panel. */
class LayersPanel {
  constructor(app) {
    this.app = app;
    this.panel = document.getElementById('feature-layers-panel');
    this.listElement = document.getElementById('feature-layers-list');
    this.toggleButton = document.getElementById('feature-layers-btn');
    this.closeButton = document.getElementById('feature-layers-close');
    this._onToggle = () => this.toggle();
    this._onClose = () => this.close();
    if (this.toggleButton) this.toggleButton.addEventListener('click', this._onToggle);
    if (this.closeButton) this.closeButton.addEventListener('click', this._onClose);
    this._unsubscribe = app.featureRegistry.onChange(items => this.render(items));
    this.render(app.featureRegistry.list());
  }

  toggle() { if (this.panel && this.panel.classList.contains('visible')) this.close(); else this.open(); }
  open() {
    if (this.panel) { this.panel.classList.add('visible'); this.panel.setAttribute('aria-hidden', 'false'); }
    if (this.app.featureManager) this._run(() => this.app.featureManager.refresh());
  }
  close() { if (this.panel) { this.panel.classList.remove('visible'); this.panel.setAttribute('aria-hidden', 'true'); } }

  render(items) {
    if (!this.listElement) return;
    while (this.listElement.firstChild) this.listElement.removeChild(this.listElement.firstChild);
    if (!items.length) {
      const empty = document.createElement('div'); empty.className = 'feature-layers-empty';
      empty.textContent = this.app.activeCompId
        ? 'No vector maps are registered in this composition.'
        : 'No preview maps yet. Import GeoJSON or use the drawing action in Search.';
      this.listElement.appendChild(empty); return;
    }
    items.forEach(item => this.listElement.appendChild(this._createRow(item)));
  }

  _createRow(item) {
    const row = document.createElement('div'); row.className = 'feature-layer-row'; row.dataset.featureId = item.id;
    const visibility = this._button(item.visible ? 'eye' : 'eye-off', item.visible ? 'Hide' : 'Show');
    visibility.classList.toggle('muted', !item.visible);
    visibility.addEventListener('click', async () => this._run(() => this.app.featureManager.setVisibility(item.id, !item.visible)));
    const body = document.createElement('div'); body.className = 'feature-layer-body';
    const name = document.createElement('div'); name.className = 'feature-layer-name'; name.textContent = item.name;
    const status = document.createElement('div'); status.className = 'feature-layer-status';
    status.textContent = item.hostPresent
      ? (item.previewAvailable ? `${item.type} · Synced with AE` : `${item.type} · AE only`)
      : `${item.type} · Preview only`;
    body.appendChild(name); body.appendChild(status);
    const focus = this._button('crosshair', 'Focus in preview'); focus.addEventListener('click', () => this.app.featureManager.focusFeature(item.id));
    let send = null;
    if (!item.hostPresent && this.app.activeCompId) {
      send = this._button('upload-cloud', 'Draw this preview map in After Effects');
      send.classList.add('feature-layer-send');
      send.addEventListener('click', async () => this._run(() => this.app.featureManager.importPreviewToAE(item.id)));
    }
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
    row.appendChild(visibility); row.appendChild(body); row.appendChild(focus); if (send) row.appendChild(send); row.appendChild(remove);
    if (typeof lucide !== 'undefined') setTimeout(() => lucide.createIcons(), 0);
    return row;
  }

  _button(icon, title) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'feature-layer-action'; button.title = title;
    const element = document.createElement('i'); element.setAttribute('data-lucide', icon); button.appendChild(element); return button;
  }

  async _run(callback) {
    try { await callback(); }
    catch (error) { globalEventBus.emit('toast:show', { message: error.message, type: 'error', duration: 6000 }); }
  }

  dispose() {
    if (this.toggleButton) this.toggleButton.removeEventListener('click', this._onToggle);
    if (this.closeButton) this.closeButton.removeEventListener('click', this._onClose);
    if (this._unsubscribe) this._unsubscribe();
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = LayersPanel;
else if (typeof window !== 'undefined') window.LayersPanel = LayersPanel;
