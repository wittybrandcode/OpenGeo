class SettingsPanel {
  constructor(config, providerManager) {
    this.config = config;
    this.providerManager = providerManager || null;
    this.overlay = document.getElementById('settings-overlay');
    this.panel = document.getElementById('settings-panel');
    this.sourceSelect = document.getElementById('tile-source');
    this.themeSelect = document.getElementById('theme-select');
    this.sizeSelect = document.getElementById('tile-size-select');
    this.sizeRadios = document.querySelectorAll('input[name="tile-size"]');
    this._handlers = {};

    this._populateSources();
    this._setupEvents();
  }

  _populateSources() {
    if (!this.sourceSelect || !this.providerManager) return;
    const selected = this.sourceSelect.value;
    while (this.sourceSelect.firstChild) this.sourceSelect.removeChild(this.sourceSelect.firstChild);
    for (const provider of this.providerManager.getProviderSchema()) {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = provider.name;
      this.sourceSelect.appendChild(option);
    }
    if (this.providerManager.getProvider(selected)) this.sourceSelect.value = selected;
  }

  _setupEvents() {
    if (this.sourceSelect) {
      this._handlers.sourceChange = () => {
        if (typeof globalEventBus !== 'undefined') {
          globalEventBus.emit('settings:sourceChanged', this.sourceSelect.value);
        }
      };
      this.sourceSelect.addEventListener('change', this._handlers.sourceChange);
    }
    
    if (this.sizeSelect) {
      this._handlers.sizeChange = () => {
        if (typeof globalEventBus !== 'undefined') {
          globalEventBus.emit('settings:tileSizeChanged', parseInt(this.sizeSelect.value, 10));
        }
      };
      this.sizeSelect.addEventListener('change', this._handlers.sizeChange);
    }
    
    for (let i = 0; i < this.sizeRadios.length; i++) {
      const handler = (e) => {
        if (e.target.checked && typeof globalEventBus !== 'undefined') {
          globalEventBus.emit('settings:tileSizeChanged', parseInt(e.target.value, 10));
        }
      };
      this._handlers['radio' + i] = handler;
      this.sizeRadios[i].addEventListener('change', handler);
    }
    
    if (this.themeSelect) {
      this._handlers.themeChange = () => {
        const theme = this.themeSelect.value;
        document.documentElement.classList.toggle('theme-light', theme === 'light');
        if (typeof globalEventBus !== 'undefined') {
          globalEventBus.emit('settings:themeChanged', theme);
        }
      };
      this.themeSelect.addEventListener('change', this._handlers.themeChange);
    }
  }

  show() {
    if (this.overlay) this.overlay.classList.add('visible');
    if (this.panel) this.panel.classList.add('visible');
  }

  hide() {
    if (this.overlay) this.overlay.classList.remove('visible');
    if (this.panel) this.panel.classList.remove('visible');
  }

  updateState(source, tileSize, theme) {
    if (this.sourceSelect) this.sourceSelect.value = source;
    
    if (this.sizeSelect) this.sizeSelect.value = String(tileSize);
    for (let i = 0; i < this.sizeRadios.length; i++) {
      this.sizeRadios[i].checked = parseInt(this.sizeRadios[i].value, 10) === tileSize;
    }
    
    if (this.themeSelect) {
      this.themeSelect.value = theme;
      document.documentElement.classList.toggle('theme-light', theme === 'light');
    }
    
    this.updateAttribution(source);
  }

  updateAttribution(sourceKey) {
    const element = document.getElementById('map-attribution');
    const sourceInfo = this.providerManager ? this.providerManager.getProvider(sourceKey) : this.config.tileSources[sourceKey];
    if (!element || !sourceInfo) return;
    
    element.textContent = '';
    const safeUrl = typeof SecurityPolicy !== 'undefined'
      ? SecurityPolicy.normalizeHttpsUrl(sourceInfo.attributionUrl)
      : (/^https:\/\/[^\s]+$/i.test(String(sourceInfo.attributionUrl || '')) ? String(sourceInfo.attributionUrl) : '');
    if (!safeUrl) {
      const label = document.createElement('span');
      label.textContent = sourceInfo.attribution || sourceInfo.name;
      element.appendChild(label);
      return;
    }
    const link = document.createElement('a');
    link.href = safeUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = sourceInfo.attribution || sourceInfo.name;
    element.appendChild(link);
  }

  dispose() {
    if (this.sourceSelect && this._handlers.sourceChange) this.sourceSelect.removeEventListener('change', this._handlers.sourceChange);
    if (this.sizeSelect && this._handlers.sizeChange) this.sizeSelect.removeEventListener('change', this._handlers.sizeChange);
    for (let i = 0; i < this.sizeRadios.length; i++) {
      const handler = this._handlers['radio' + i];
      if (handler) this.sizeRadios[i].removeEventListener('change', handler);
    }
    if (this.themeSelect && this._handlers.themeChange) this.themeSelect.removeEventListener('change', this._handlers.themeChange);
    this._handlers = {};
  }
}
