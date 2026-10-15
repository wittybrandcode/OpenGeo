/**
 * OpenGeo — CountryHighlightLayer
 *
 * Renders transient, interactive live vector boundary highlights and glassmorphic
 * country identification badges over both raster and vector map previews.
 * Activated in real-time as users enter country names into the Search input.
 */

class CountryHighlightLayer {
  constructor(viewport, repository) {
    this.viewport = viewport || null;
    this.repository = repository || null;
    this.activeHighlight = null;
    this.visible = true;
  }

  setHighlight(countryCode, autoFit = false) {
    const code = String(countryCode || '').trim().toUpperCase();
    if (!code || !this.repository) {
      this.clearHighlight();
      return;
    }

    if (this.activeHighlight && this.activeHighlight.iso3 === code) {
      return;
    }

    const resolved = this.repository.getCountryOutline(code);
    if (!resolved || !Array.isArray(resolved.features) || !resolved.features.length) {
      this.clearHighlight();
      return;
    }

    const bounds = this._computeBounds(resolved.features);
    this.activeHighlight = {
      iso3: code,
      country: resolved.country || {},
      features: resolved.features,
      bounds: bounds
    };

    if (autoFit && bounds && this.viewport && typeof this.viewport.fitBounds === 'function') {
      this.viewport.fitBounds(bounds.south, bounds.north, bounds.west, bounds.east, 48);
    }
  }

  clearHighlight() {
    this.activeHighlight = null;
  }

  getHighlight() {
    return this.activeHighlight;
  }

  _computeBounds(features) {
    if (!Array.isArray(features)) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let f = 0; f < features.length; f++) {
      const rings = features[f] && features[f].rings;
      if (!Array.isArray(rings)) continue;
      for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        if (!Array.isArray(ring)) continue;
        for (let p = 0; p < ring.length; p++) {
          const pt = ring[p];
          if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
          if (pt[0] < minX) minX = pt[0];
          if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] < minY) minY = pt[1];
          if (pt[1] > maxY) maxY = pt[1];
        }
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return null;
    }

    if (typeof MercatorProjection === 'undefined' || typeof MercatorProjection.worldPointToLatLng !== 'function') {
      return null;
    }

    const sw = MercatorProjection.worldPointToLatLng(minX, maxY, 10, 256);
    const ne = MercatorProjection.worldPointToLatLng(maxX, minY, 10, 256);
    return {
      minX, maxX, minY, maxY,
      south: sw.lat,
      north: ne.lat,
      west: sw.lng,
      east: ne.lng
    };
  }

  _toScreenPath(ring, scale, center, baseWorld) {
    if (!Array.isArray(ring)) return [];
    const points = [];
    const halfWidth = this.viewport.width / 2;
    const halfHeight = this.viewport.height / 2;

    for (let i = 0; i < ring.length; i++) {
      const pt = ring[i];
      if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
      let dx = pt[0] - center.x;
      while (dx > baseWorld / 2) dx -= baseWorld;
      while (dx < -baseWorld / 2) dx += baseWorld;
      points.push({
        x: halfWidth + dx * scale,
        y: halfHeight + (pt[1] - center.y) * scale
      });
    }
    return points;
  }

  _pointToScreen(point, scale, center, baseWorld) {
    let dx = point[0] - center.x;
    while (dx > baseWorld / 2) dx -= baseWorld;
    while (dx < -baseWorld / 2) dx += baseWorld;
    return {
      x: this.viewport.width / 2 + dx * scale,
      y: this.viewport.height / 2 + (point[1] - center.y) * scale
    };
  }

  render(ctx) {
    if (!this.visible || !this.activeHighlight || !ctx || !this.viewport) return;
    if (typeof MercatorProjection === 'undefined') return;

    const { features, country } = this.activeHighlight;
    if (!Array.isArray(features) || !features.length) return;

    const baseWorld = 262144;
    const displayWorld = MercatorProjection.getWorldSize(this.viewport.zoom, this.viewport.tileSize);
    const scale = displayWorld / baseWorld;
    const center = MercatorProjection.latLngToWorldPoint(this.viewport.centerLat, this.viewport.centerLng, 10, 256);

    ctx.save();

    // 1. Draw glowing translucent boundary polygon
    for (let f = 0; f < features.length; f++) {
      const rings = features[f] && features[f].rings;
      if (!Array.isArray(rings)) continue;

      for (let r = 0; r < rings.length; r++) {
        const points = this._toScreenPath(rings[r], scale, center, baseWorld);
        if (points.length < 3) continue;

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();

        // Subtle modern glass fill
        ctx.fillStyle = 'rgba(0, 229, 255, 0.14)';
        ctx.fill();

        // High-definition neon glow stroke
        ctx.save();
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2.2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
      }
    }

    // 2. Render floating glassmorphic country identification badge at country.label
    if (country && Array.isArray(country.label) && country.label.length >= 2) {
      const labelScreen = this._pointToScreen(country.label, scale, center, baseWorld);
      const isVisible = (
        labelScreen.x >= -60 && labelScreen.x <= this.viewport.width + 60 &&
        labelScreen.y >= -30 && labelScreen.y <= this.viewport.height + 30
      );

      if (isVisible) {
        const nameAr = country.nameAr || '';
        const nameEn = country.name || country.iso3 || '';
        const labelText = nameAr && nameEn && nameAr !== nameEn ? `${nameAr} • ${nameEn}` : (nameAr || nameEn);

        ctx.font = '600 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const textMetrics = ctx.measureText(labelText);
        const paddingX = 10;
        const paddingY = 6;
        const dotRadius = 3.5;
        const dotSpacing = 8;
        const badgeWidth = textMetrics.width + (paddingX * 2) + (dotRadius * 2) + dotSpacing;
        const badgeHeight = 24;
        const badgeX = labelScreen.x - (badgeWidth / 2);
        const badgeY = labelScreen.y - (badgeHeight / 2);
        const radius = 12;

        // Draw pill background
        ctx.beginPath();
        ctx.moveTo(badgeX + radius, badgeY);
        ctx.lineTo(badgeX + badgeWidth - radius, badgeY);
        ctx.quadraticCurveTo(badgeX + badgeWidth, badgeY, badgeX + badgeWidth, badgeY + radius);
        ctx.lineTo(badgeX + badgeWidth, badgeY + badgeHeight - radius);
        ctx.quadraticCurveTo(badgeX + badgeWidth, badgeY + badgeHeight, badgeX + badgeWidth - radius, badgeY + badgeHeight);
        ctx.lineTo(badgeX + radius, badgeY + badgeHeight);
        ctx.quadraticCurveTo(badgeX, badgeY + badgeHeight, badgeX, badgeY + badgeHeight - radius);
        ctx.lineTo(badgeX, badgeY + radius);
        ctx.quadraticCurveTo(badgeX, badgeY, badgeX + radius, badgeY);
        ctx.closePath();

        ctx.fillStyle = 'rgba(10, 16, 26, 0.88)';
        ctx.fill();

        ctx.strokeStyle = 'rgba(0, 229, 255, 0.65)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Draw glowing cyan dot indicator
        const dotX = badgeX + paddingX + dotRadius;
        const dotY = badgeY + (badgeHeight / 2);
        ctx.save();
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#00e5ff';
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Draw label text
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(labelText, dotX + dotRadius + dotSpacing, badgeY + (badgeHeight / 2));
      }
    }

    ctx.restore();
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = CountryHighlightLayer;
else if (typeof window !== 'undefined') window.CountryHighlightLayer = CountryHighlightLayer;
