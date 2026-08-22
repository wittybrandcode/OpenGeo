class MarkerLayer {
  constructor(viewport) {
    this.viewport = viewport;
    this.markers = [];
    
    if (typeof globalEventBus !== 'undefined') {
      this._unsubscribeAdd = globalEventBus.on('marker:add', (data) => this.addMarker(data.lat, data.lng, data.label));
      this._unsubscribeClear = globalEventBus.on('marker:clear', () => this.clearMarkers());
    }
  }

  addMarker(lat, lng, label = '') {
    this.markers.push({ lat, lng, label });
    if (typeof globalEventBus !== 'undefined') {
      globalEventBus.emit('overlay:changed');
    }
  }

  removeMarker(index) {
    if (index >= 0 && index < this.markers.length) {
      this.markers.splice(index, 1);
      if (typeof globalEventBus !== 'undefined') {
        globalEventBus.emit('overlay:changed');
      }
    }
  }

  clearMarkers() {
    this.markers = [];
    if (typeof globalEventBus !== 'undefined') {
      globalEventBus.emit('overlay:changed');
    }
  }

  getMarkers() {
    return this.markers.slice();
  }

  dispose() {
    if (this._unsubscribeAdd) this._unsubscribeAdd();
    if (this._unsubscribeClear) this._unsubscribeClear();
    this._unsubscribeAdd = null;
    this._unsubscribeClear = null;
  }

  render(ctx) {
    if (!this.viewport) return;
    
    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      const px = this.viewport.latLngToScreen(m.lat, m.lng);
      
      // Basic culling
      if (px.x < -20 || px.x > this.viewport.width + 20 ||
          px.y < -20 || px.y > this.viewport.height + 20) continue;
          
      ctx.beginPath();
      ctx.arc(px.x, px.y - 6, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#e34850';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      if (m.label) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(px.x - 30, px.y + 4, 60, 14);
        ctx.fillStyle = '#fff';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(m.label.substring(0, 12), px.x, px.y + 15);
      }
    }
  }
}
