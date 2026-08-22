class GeoJSONLayer {
  constructor(viewport, validator) {
    this.viewport = viewport;
    this.validator = validator || (typeof GeoJSONValidator !== 'undefined' ? new GeoJSONValidator() : null);
    this.features = [];
    
    if (typeof globalEventBus !== 'undefined') {
      this._unsubscribeLoad = globalEventBus.on('geojson:load', (data) => this.loadGeoJSON(data));
      this._unsubscribeClear = globalEventBus.on('geojson:clear', () => this.clearGeoJSON());
    }
  }

  loadGeoJSON(json) {
    const validation = this.validator
      ? this.validator.parse(json)
      : { ok: false, error: { code: 'GEOJSON_VALIDATOR_UNAVAILABLE', message: 'GeoJSON validation is unavailable.' } };
    if (!validation.ok) return validation;

    // Transactional replacement: invalid input must never clear the last
    // successfully rendered layer or install a partially parsed collection.
    this.features = validation.features.filter(feature => feature && feature.geometry);
    
    if (typeof globalEventBus !== 'undefined') {
      globalEventBus.emit('overlay:changed');
    }
    return { ok: true, stats: validation.stats, featureCount: this.features.length };
  }

  clearGeoJSON() {
    this.features = [];
    if (typeof globalEventBus !== 'undefined') {
      globalEventBus.emit('overlay:changed');
    }
  }

  dispose() {
    if (this._unsubscribeLoad) this._unsubscribeLoad();
    if (this._unsubscribeClear) this._unsubscribeClear();
    this._unsubscribeLoad = null;
    this._unsubscribeClear = null;
  }

  render(ctx) {
    if (!this.viewport) return;
    
    for (let fi = 0; fi < this.features.length; fi++) {
      const f = this.features[fi];
      const geom = f.geometry;
      try {
        this._drawGeoJSONGeometry(ctx, geom);
      } catch (e) {
        console.error('[GeoJSONLayer] Render failed:', e);
      }
    }
  }

  _drawGeoJSONGeometry(ctx, geom) {
    if (geom.type === 'GeometryCollection') {
      for (let i = 0; i < geom.geometries.length; i++) this._drawGeoJSONGeometry(ctx, geom.geometries[i]);
    } else if (geom.type === 'Point') {
      this._drawGeoJSONPoint(ctx, geom.coordinates);
    } else if (geom.type === 'MultiPoint') {
      for (let i = 0; i < geom.coordinates.length; i++) {
        this._drawGeoJSONPoint(ctx, geom.coordinates[i]);
      }
    } else if (geom.type === 'LineString') {
      this._drawGeoJSONLine(ctx, geom.coordinates);
    } else if (geom.type === 'MultiLineString') {
      for (let i = 0; i < geom.coordinates.length; i++) {
        this._drawGeoJSONLine(ctx, geom.coordinates[i]);
      }
    } else if (geom.type === 'Polygon') {
      this._drawGeoJSONPolygon(ctx, geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      for (let i = 0; i < geom.coordinates.length; i++) {
        this._drawGeoJSONPolygon(ctx, geom.coordinates[i]);
      }
    }
  }

  _drawGeoJSONPoint(ctx, coords) {
    const px = this.viewport.latLngToScreen(coords[1], coords[0]);
    if (px.x < -10 || px.x > this.viewport.width + 10 || px.y < -10 || px.y > this.viewport.height + 10) return;
    ctx.beginPath();
    ctx.arc(px.x, px.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#1473e6';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _drawGeoJSONLine(ctx, coords) {
    const pts = [];
    for (let i = 0; i < coords.length; i++) {
      const px = this.viewport.latLngToScreen(coords[i][1], coords[i][0]);
      pts.push(px.x); pts.push(px.y);
    }
    if (pts.length < 4) return;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.strokeStyle = '#1473e6';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _drawGeoJSONPolygon(ctx, rings) {
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      const pts = [];
      for (let i = 0; i < ring.length; i++) {
        const px = this.viewport.latLngToScreen(ring[i][1], ring[i][0]);
        pts.push(px.x); pts.push(px.y);
      }
      if (pts.length < 6) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(20,115,230,0.15)';
      ctx.fill();
      ctx.strokeStyle = '#1473e6';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = GeoJSONLayer;
else if (typeof window !== 'undefined') window.GeoJSONLayer = GeoJSONLayer;
