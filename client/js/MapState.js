class MapState {
  constructor() {
    this.latitude = 0;
    this.longitude = 0;
    
    // AE Composition Zoom (The true targeted zoom level)
    this.compZoom = 13;
    
    // Composition Settings
    this.compWidth = 1920;
    this.compHeight = 1080;
    
    // UI Panel Dimensions
    this.panelWidth = 800;
    this.panelHeight = 600;
    
    // Frame Box Dimensions (Determined by panel aspect vs comp aspect)
    this.frameWidth = 800;
    this.frameHeight = 450;
    
    this.tileSize = 256;
    
    // Quality offset for tile downloads
    // Draft = -2 (auto-sync)
    // Normal = 0, High = +1, Ultra = +2 (finalize)
    this.qualityOffset = -2; // Default: Draft during work
    
    // 3D Pitch / Tilt angle (degrees, 0 = flat top-down)
    this.pitch = 0;
  }

  getDownloadZoom() {
    return Math.max(0, Math.min(19,
      Math.floor(this.compZoom + this.qualityOffset)
    ));
  }

  updatePanelSize(width, height) {
    this.panelWidth = width;
    this.panelHeight = height;
    this._recalculateFrame();
  }

  setCompSize(width, height) {
    this.compWidth = width;
    this.compHeight = height;
    this._recalculateFrame();
  }

  setCenter(lat, lng) {
    this.latitude = MercatorProjection.clampLat(lat);
    this.longitude = MercatorProjection.normalizeLng(lng);
  }

  // Set the zoom based on what the UI wants
  setUIZoom(uiZoom) {
    // The UI zoom is the zoom visible in the panel's framing box.
    // compZoom is the actual zoom level that After Effects will render at.
    // scaleRatio = how much the comp is scaled down to fit in the panel.
    // We use Math.min to pick the constraining dimension (width OR height).
    if (this.frameWidth > 0 && this.compWidth > 0 && this.frameHeight > 0 && this.compHeight > 0) {
      const scaleRatio = Math.min(this.frameWidth / this.compWidth, this.frameHeight / this.compHeight);
      this.compZoom = uiZoom - Math.log2(scaleRatio);
    } else {
      this.compZoom = uiZoom;
    }
    // Limit compZoom
    this.compZoom = Math.max(1, Math.min(22, this.compZoom));
  }

  // Get the zoom that the UI should render at
  getUIZoom() {
    if (this.frameWidth > 0 && this.compWidth > 0 && this.frameHeight > 0 && this.compHeight > 0) {
      const scaleRatio = Math.min(this.frameWidth / this.compWidth, this.frameHeight / this.compHeight);
      return this.compZoom + Math.log2(scaleRatio);
    }
    return this.compZoom;
  }

  // Get the integer base zoom level for downloading tiles
  getBaseTileZoom() {
    return Math.max(0, Math.min(19, Math.floor(this.compZoom)));
  }

  _recalculateFrame() {
    const compAspect = this.compWidth / this.compHeight;
    const panelAspect = this.panelWidth / this.panelHeight;
    
    // The framing box is bound by max-width: calc(100% - 40px), max-height: calc(100% - 40px)
    // See style.css .framing-box-inner
    const availWidth = Math.max(0, this.panelWidth - 40);
    const availHeight = Math.max(0, this.panelHeight - 40);
    if (availHeight === 0) return;
    const availAspect = availWidth / availHeight;

    if (compAspect > availAspect) {
      // Width constrained
      this.frameWidth = availWidth;
      this.frameHeight = availWidth / compAspect;
    } else {
      // Height constrained
      this.frameHeight = availHeight;
      this.frameWidth = availHeight * compAspect;
    }
  }

  getPitch() {
    return this.pitch;
  }

  setPitch(val) {
    const num = Number(val);
    const clamped = Math.max(0, Math.min(45, Number.isFinite(num) ? num : 0));
    this.pitch = Math.round(clamped * 10) / 10;
    return this.pitch;
  }
}
