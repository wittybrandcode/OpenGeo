class InputHandler {
  constructor(canvas, viewport) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.dragging = false;
    this.lastPointer = null;
    this.velBuffer = [];
    this.inertia = { vx: 0, vy: 0, active: false, frameId: null, lastTime: null };
    this._panDx = 0;
    this._panDy = 0;
    this._panFrameId = null;
    this._wheelDelta = 0;
    this._wheelPoint = null;
    this._wheelFrameId = null;
    this._wheelTargetZoom = null;
    this._wheelAnimationPoint = null;
    this._wheelAnimationFrameId = null;
    this._boundHandlers = {
      pointerdown: this._onPointerDown.bind(this),
      pointermove: this._onPointerMove.bind(this),
      pointerup: this._onPointerUp.bind(this),
      pointercancel: this._onPointerCancel.bind(this),
      wheel: this._onWheel.bind(this),
      dblclick: this._onDoubleClick.bind(this)
    };
    
    this._setupEvents();
  }

  _setupEvents() {
    this.canvas.addEventListener('pointerdown', this._boundHandlers.pointerdown);
    this.canvas.addEventListener('pointermove', this._boundHandlers.pointermove);
    this.canvas.addEventListener('pointerup', this._boundHandlers.pointerup);
    this.canvas.addEventListener('pointercancel', this._boundHandlers.pointercancel);
    this.canvas.addEventListener('wheel', this._boundHandlers.wheel, { passive: false });
    this.canvas.addEventListener('dblclick', this._boundHandlers.dblclick);
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  _onPointerDown(e) {
    e.preventDefault();
    this.dragging = true;
    this.isTilt = (e.button === 2) || (e.shiftKey && e.button === 0);
    this.lastPointer = { x: e.clientX, y: e.clientY, t: Date.now() };
    this.velBuffer = [];
    this._cancelWheelAnimation();
    
    try { 
      this.canvas.setPointerCapture(e.pointerId); 
    } catch (ex) {}
    
    this.canvas.style.cursor = this.isTilt ? 'ns-resize' : 'grabbing';
    this.inertia.active = false;
    if (this.inertia.frameId !== null) {
      cancelAnimationFrame(this.inertia.frameId);
      this.inertia.frameId = null;
    }
    this.inertia.lastTime = null;
  }

  _onPointerMove(e) {
    if (!this.dragging || !this.lastPointer) return;
    e.preventDefault();
    
    const now = Date.now();
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    const dt = Math.max(1, now - this.lastPointer.t);

    if (this.isTilt) {
      const currentPitch = this.viewport.pitch || 0;
      const newPitch = Math.max(0, Math.min(65, currentPitch - dy * 0.4));
      this.viewport.setPitch(newPitch);
      this.lastPointer = { x: e.clientX, y: e.clientY, t: now };
      return;
    }
    
    this._panDx += dx;
    this._panDy += dy;
    if (this._panFrameId === null) {
      this._panFrameId = requestAnimationFrame(() => this._flushPan());
    }
    
    this.lastPointer = { x: e.clientX, y: e.clientY, t: now };
    this.velBuffer.push({ vx: dx / dt, vy: dy / dt, t: now });
    if (this.velBuffer.length > 5) this.velBuffer.shift();
  }

  _onPointerUp(e) {
    if (!this.dragging) return;
    if (!this.isTilt) {
      this._flushPan();
      this._startInertia();
    }
    this.dragging = false;
    this.isTilt = false;
    this.lastPointer = null;
    this.canvas.style.cursor = 'grab';
  }

  _onPointerCancel(e) {
    if (!this.isTilt) this._flushPan();
    this.dragging = false;
    this.isTilt = false;
    this.lastPointer = null;
    this.canvas.style.cursor = 'grab';
  }

  _onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const modeScale = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? rect.height : 1);
    // Trackpads issue many small deltas while mouse wheels issue larger
    // ones. Coalesce input once per frame rather than turning every event
    // into a fixed 0.5 zoom jump.
    this._wheelDelta += Math.max(-180, Math.min(180, e.deltaY * modeScale));
    this._wheelPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (this._wheelFrameId === null) {
      this._wheelFrameId = requestAnimationFrame(() => this._applyWheelZoom());
    }
  }

  _applyWheelZoom() {
    this._wheelFrameId = null;
    const delta = Math.max(-240, Math.min(240, this._wheelDelta));
    const point = this._wheelPoint;
    this._wheelDelta = 0;
    this._wheelPoint = null;
    if (!point || !delta) return;
    const baseZoom = this._wheelTargetZoom === null ? this.viewport.zoom : this._wheelTargetZoom;
    this._wheelTargetZoom = this.viewport.clampZoom(baseZoom - delta * 0.0018);
    this._wheelAnimationPoint = point;
    if (this._wheelAnimationFrameId === null) this._tickWheelZoom();
  }

  _tickWheelZoom() {
    this._wheelAnimationFrameId = null;
    if (this._wheelTargetZoom === null || !this._wheelAnimationPoint) return;
    const currentZoom = this.viewport.zoom;
    const difference = this._wheelTargetZoom - currentZoom;
    if (Math.abs(difference) <= 0.001) {
      if (difference !== 0) {
        this.viewport.zoomAtPoint(this._wheelTargetZoom, this._wheelAnimationPoint.x, this._wheelAnimationPoint.y);
      }
      this._wheelTargetZoom = null;
      this._wheelAnimationPoint = null;
      return;
    }
    const nextZoom = currentZoom + difference * 0.42;
    this.viewport.zoomAtPoint(nextZoom, this._wheelAnimationPoint.x, this._wheelAnimationPoint.y);
    this._wheelAnimationFrameId = requestAnimationFrame(() => this._tickWheelZoom());
  }

  _cancelWheelAnimation() {
    if (this._wheelFrameId !== null) cancelAnimationFrame(this._wheelFrameId);
    if (this._wheelAnimationFrameId !== null) cancelAnimationFrame(this._wheelAnimationFrameId);
    this._wheelFrameId = null;
    this._wheelAnimationFrameId = null;
    this._wheelDelta = 0;
    this._wheelPoint = null;
    this._wheelTargetZoom = null;
    this._wheelAnimationPoint = null;
  }

  _flushPan() {
    if (this._panFrameId !== null) cancelAnimationFrame(this._panFrameId);
    this._panFrameId = null;
    const dx = this._panDx;
    const dy = this._panDy;
    this._panDx = 0;
    this._panDy = 0;
    if (dx || dy) this.viewport.pan(dx, dy);
  }

  _onDoubleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const point = this.viewport.screenToLatLng(e.clientX - rect.left, e.clientY - rect.top);
    
    if (typeof globalEventBus !== 'undefined') {
      globalEventBus.emit('marker:add', { lat: point.lat, lng: point.lng, label: '' });
      globalEventBus.emit('toast:show', { message: 'Marker added', type: 'success', duration: 1500 });
    }
  }

  _startInertia() {
    if (this.velBuffer.length === 0) return;
    const now = Date.now();
    let totalVx = 0, totalVy = 0, count = 0;
    
    for (let i = 0; i < this.velBuffer.length; i++) {
      const dt = now - this.velBuffer[i].t;
      if (dt > 150) continue;
      totalVx += this.velBuffer[i].vx;
      totalVy += this.velBuffer[i].vy;
      count++;
    }
    
    this.velBuffer = [];
    if (count === 0) return;
    
    const avgVx = totalVx / count;
    const avgVy = totalVy / count;
    const speed = Math.sqrt(avgVx * avgVx + avgVy * avgVy);
    
    if (speed < 0.03) return;
    
    this.inertia.vx = avgVx;
    this.inertia.vy = avgVy;
    this.inertia.active = true;
    this.inertia.lastTime = null;
    this.inertia.frameId = requestAnimationFrame(timestamp => this._tickInertia(timestamp));
  }

  _tickInertia(timestamp) {
    if (!this.inertia.active) return;
    const now = isFinite(Number(timestamp)) ? Number(timestamp) : Date.now();
    if (this.inertia.lastTime === null) {
      this.inertia.lastTime = now;
      this.inertia.frameId = requestAnimationFrame(nextTimestamp => this._tickInertia(nextTimestamp));
      return;
    }
    const dt = Math.max(8, Math.min(32, now - this.inertia.lastTime));
    this.inertia.lastTime = now;
    const speed = Math.sqrt(this.inertia.vx * this.inertia.vx + this.inertia.vy * this.inertia.vy);
    
    if (speed < 0.02) {
      this.inertia.active = false;
      this.inertia.frameId = null;
      this.inertia.lastTime = null;
      return;
    }

    this.viewport.pan(this.inertia.vx * dt, this.inertia.vy * dt);
    const frameDecay = Math.pow(0.9, dt / (1000 / 60));
    this.inertia.vx *= frameDecay;
    this.inertia.vy *= frameDecay;
    this.inertia.frameId = requestAnimationFrame(nextTimestamp => this._tickInertia(nextTimestamp));
  }

  dispose() {
    if (!this.canvas || !this._boundHandlers) return;
    this.inertia.active = false;
    this.inertia.lastTime = null;
    if (this.inertia.frameId !== null) cancelAnimationFrame(this.inertia.frameId);
    if (this._panFrameId !== null) cancelAnimationFrame(this._panFrameId);
    this._panFrameId = null;
    this._panDx = 0;
    this._panDy = 0;
    this._cancelWheelAnimation();
    this.canvas.removeEventListener('pointerdown', this._boundHandlers.pointerdown);
    this.canvas.removeEventListener('pointermove', this._boundHandlers.pointermove);
    this.canvas.removeEventListener('pointerup', this._boundHandlers.pointerup);
    this.canvas.removeEventListener('pointercancel', this._boundHandlers.pointercancel);
    this.canvas.removeEventListener('wheel', this._boundHandlers.wheel);
    this.canvas.removeEventListener('dblclick', this._boundHandlers.dblclick);
    this._boundHandlers = null;
  }
}
