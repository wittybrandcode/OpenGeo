/** Renders registered AE vector features over both raster and vector previews. */
class FeatureOverlayLayer {
  constructor(viewport, registry) {
    this.viewport = viewport;
    this.registry = registry;
  }

  render(ctx) {
    if (!ctx || !this.viewport || !this.registry) return;
    const items = this.registry.list();
    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      if (!item.visible || !item.previewPayload) continue;
      this._renderPayload(ctx, item.previewPayload);
    }
  }

  _renderPayload(ctx, payload) {
    const layers = payload.layers || [];
    const stroke = this._cssColor(payload.strokeColor, '#1473e6', 1);
    const fill = this._cssColor(payload.fillColor || payload.strokeColor, '#1473e6', 1);
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const definition = layers[layerIndex] || {};
      const closed = definition.isClosed !== false;
      const features = definition.features || [];
      for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
        const rings = features[featureIndex].rings || [];
        for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
          const points = this._toScreenPath(rings[ringIndex]);
          if (points.length < (closed ? 3 : 2)) continue;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let pointIndex = 1; pointIndex < points.length; pointIndex++) ctx.lineTo(points[pointIndex].x, points[pointIndex].y);
          if (closed) ctx.closePath();
          if (closed && Number(definition.fillOpacity) > 0) {
            ctx.globalAlpha = Math.max(0, Math.min(1, Number(definition.fillOpacity) / 100));
            ctx.fillStyle = fill;
            ctx.fill();
          }
          if (definition.strokeOpacity !== 0) {
            ctx.globalAlpha = Math.max(0, Math.min(1, Number(definition.strokeOpacity === undefined ? 100 : definition.strokeOpacity) / 100));
            ctx.strokeStyle = stroke;
            ctx.lineWidth = Math.max(1.25, Math.min(4, Number(payload.strokeWidth) || 2));
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
  }

  _toScreenPath(ring) {
    if (!Array.isArray(ring)) return [];
    const baseWorld = 262144;
    const displayWorld = MercatorProjection.getWorldSize(this.viewport.zoom, this.viewport.tileSize);
    const scale = displayWorld / baseWorld;
    const center = MercatorProjection.latLngToWorldPoint(this.viewport.centerLat, this.viewport.centerLng, 10, 256);
    const points = [];
    for (let index = 0; index < ring.length; index++) {
      const point = ring[index];
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      let dx = point[0] - center.x;
      while (dx > baseWorld / 2) dx -= baseWorld;
      while (dx < -baseWorld / 2) dx += baseWorld;
      points.push({
        x: this.viewport.width / 2 + dx * scale,
        y: this.viewport.height / 2 + (point[1] - center.y) * scale
      });
    }
    return points;
  }

  _cssColor(value, fallback, alpha) {
    if (!Array.isArray(value) || value.length < 3) return fallback;
    return `rgba(${Math.round(value[0] * 255)},${Math.round(value[1] * 255)},${Math.round(value[2] * 255)},${alpha})`;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = FeatureOverlayLayer;
else if (typeof window !== 'undefined') window.FeatureOverlayLayer = FeatureOverlayLayer;
