class MapRenderer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.width = 300;
    this.height = 500;
    this._frameTime = 0;
  }

  attachCanvas(canvas) {
    this.canvas = canvas;
    try {
      this.ctx = canvas.getContext('2d');
    } catch (e) {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width || 300, canvas.height || 200);
        ctx.fillStyle = '#e34850';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Render error: ' + e.message, (canvas.width || 300) / 2, (canvas.height || 200) / 2);
      }
    }
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    if (this.canvas && this.ctx) {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  render(tiles = [], overlays = []) {
    if (!this.ctx || !this.canvas) return;

    this._frameTime++;

    try {
      this.ctx.clearRect(0, 0, this.width, this.height);

      if (tiles.length === 0) {
        this._drawPlaceholder(this.ctx, this.width, this.height);
        return;
      }

      // Draw tiles (with 0.5px subpixel dilation to eliminate canvas antialiasing hairline seams)
      for (const tile of tiles) {
        const renderSize = tile.drawSize + 0.5;
        if (tile.bitmap) {
          // Full-resolution tile available
          this.ctx.drawImage(tile.bitmap, tile.screenX, tile.screenY, renderSize, renderSize);
        } else if (tile.parentBitmap && tile.parentCropSize > 0) {
          // Parent-tile scaled fallback: crop the sub-quadrant and draw scaled
          try {
            this.ctx.drawImage(
              tile.parentBitmap,
              tile.parentCropX, tile.parentCropY,
              tile.parentCropSize, tile.parentCropSize,
              tile.screenX, tile.screenY,
              renderSize, renderSize
            );
          } catch (e) {
            // Fallback to shimmer if parent draw fails
            this._drawShimmer(this.ctx, tile.screenX, tile.screenY, tile.drawSize, tile.drawSize);
          }
        } else if (tile.error) {
          // If tile request failed (like ESRI 404 ocean tiles), draw a subtle deep blue/dark base
          this.ctx.fillStyle = '#061324';
          this.ctx.fillRect(tile.screenX, tile.screenY, renderSize, renderSize);
        } else {
          // No tile and no parent — show loading shimmer
          this._drawShimmer(this.ctx, tile.screenX, tile.screenY, tile.drawSize, tile.drawSize);
        }
      }

      // Draw overlays (GeoJSON, Markers)
      for (const overlay of overlays) {
        overlay.render(this.ctx);
      }

    } catch (e) {
      this._renderError(e);
    }
  }

  renderVector(overlays = []) {
    if (!this.ctx || !this.canvas) return;
    this._frameTime++;
    try {
      this.ctx.clearRect(0, 0, this.width, this.height);
      for (const overlay of overlays) overlay.render(this.ctx);
    } catch (e) {
      this._renderError(e);
    }
  }

  _drawShimmer(ctx, x, y, w, h) {
    const phase = ((this._frameTime || 0) * 0.03) % 1;
    const gx1 = x - 60 + phase * (w + 120);
    const gx2 = gx1 + 80;
    
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    
    ctx.fillStyle = '#282828';
    ctx.fillRect(x, y, w, h);
    
    const grad = ctx.createLinearGradient(gx1, y, gx2, y);
    grad.addColorStop(0, 'rgba(60,60,60,0)');
    grad.addColorStop(0.5, 'rgba(80,80,80,0.5)');
    grad.addColorStop(1, 'rgba(60,60,60,0)');
    
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  _drawPlaceholder(ctx, w, h) {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    const step = 40;
    for (let x = 0; x < w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#555';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('OpenGeo', w / 2, h / 2 - 6);
    ctx.fillStyle = '#444';
    ctx.font = '10px sans-serif';
    ctx.fillText('اسحب الخريطة لبدء التحميل', w / 2, h / 2 + 14);
  }

  _renderError(e) {
    if (!this.ctx) return;
    try {
      this.ctx.fillStyle = '#e34850';
      this.ctx.font = '10px sans-serif';
      this.ctx.textAlign = 'left';
      this.ctx.fillText('Err: ' + e.message.substring(0, 40), 4, 20);
    } catch (ex) {
      /* canvas text draw fallback */
    }
  }
}
