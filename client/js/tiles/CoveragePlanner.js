/** Shared coverage calculations for panel preview, Sync, trajectory and Finalize. */
class CoveragePlanner {
  static planViewport(viewport) {
    const zoom = viewport.zoom;
    const tileZoom = Math.floor(zoom);
    const tileScale = Math.pow(2, zoom - tileZoom);
    const drawSize = viewport.tileSize * tileScale;
    const count = Math.pow(2, tileZoom);
    const center = MercatorProjection.latLngToWorldPoint(viewport.centerLat, viewport.centerLng, tileZoom, viewport.tileSize);
    const pitch = Number(viewport.pitch || (viewport.mapState && viewport.mapState.pitch) || 0);
    const pitchRad = (Math.max(0, Math.min(45, pitch)) * Math.PI) / 180;
    // Frustum and camera motion overscan: anticipate rapid pan/inertia and 3D horizon perspective
    const overscanScale = pitch > 0 ? 1 + 1.5 * Math.sin(pitchRad) : 1;
    const overscanY = pitch > 0 ? Math.max(overscanScale * 1.3, (1 / Math.cos(pitchRad)) * 1.3) : 1;
    const overscanX = pitch > 0 ? overscanScale * 1.25 : 1;
    const halfWidth = (viewport.width / (2 * tileScale)) * overscanX;
    const halfHeight = (viewport.height / (2 * tileScale)) * overscanY;
    
    // Gutter buffers: delegate to FrustumMath with safe fallback
    const overscan = (typeof FrustumMath !== 'undefined' && FrustumMath.calculatePitchOverscan)
      ? FrustumMath.calculatePitchOverscan(pitch)
      : { gutterX: pitch > 0 ? 3 : 1, gutterY: pitch > 0 ? 3 : 1, horizonGutter: pitch > 0 ? 3 : 0 };
    const gutterX = overscan.gutterX;
    const gutterY = overscan.gutterY;
    const horizonGutter = overscan.horizonGutter;
    
    const minX = Math.floor((center.x - halfWidth) / viewport.tileSize) - gutterX;
    const maxX = Math.floor((center.x + halfWidth) / viewport.tileSize) + gutterX;
    const minY = Math.max(0, Math.floor((center.y - halfHeight) / viewport.tileSize) - (gutterY + horizonGutter));
    const maxY = Math.min(count - 1, Math.floor((center.y + halfHeight) / viewport.tileSize) + gutterY);
    const centerScreenX = viewport.width / 2;
    const centerScreenY = viewport.height / 2;
    const tiles = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const screenX = (x * viewport.tileSize - center.x) * tileScale + centerScreenX;
        const screenY = (y * viewport.tileSize - center.y) * tileScale + centerScreenY;
        tiles.push(TileAddress.create(x, y, tileZoom, {
          // Panel transport historically consumes x as canonical X; tileX is
          // retained as the unwrapped render slot.
          x: TileAddress.wrapX(x, tileZoom),
          tileX: x,
          screenX: Math.round(screenX),
          screenY: Math.round(screenY),
          drawSize: Math.ceil(drawSize),
          distance: Math.abs(screenX + drawSize / 2 - centerScreenX) + Math.abs(screenY + drawSize / 2 - centerScreenY)
        }));
      }
    }
    tiles.sort((a, b) => a.distance - b.distance);
    return tiles;
  }

  static planComposition(camera, options = {}) {
    const tileSize = options.tileSize || 256;
    const downloadZoom = options.downloadZoom;
    const count = Math.pow(2, downloadZoom);
    const center = MercatorProjection.latLngToWorldPoint(camera.lat, camera.lon, downloadZoom, tileSize);
    // Convert composition pixels to pixels at the selected source zoom. This
    // ratio must remain fractional when downloading a lower-resolution draft;
    // clamping it to 1 expands a z-2 viewport by 4x on each axis.
    const sourcePixelsPerCompPixel = Math.pow(2, downloadZoom - camera.zoom);
    const pitch = Number(camera.pitch || options.pitch || 0);
    const pitchRad = (Math.max(0, Math.min(45, pitch)) * Math.PI) / 180;
    const overscanY = pitch > 0 ? (1 / Math.cos(pitchRad)) * 1.35 : 1;
    const overscanX = pitch > 0 ? 1 + Math.sin(pitchRad) * 0.8 : 1;
    const halfWidth = (options.width / 2) * sourcePixelsPerCompPixel * overscanX;
    const halfHeight = (options.height / 2) * sourcePixelsPerCompPixel * overscanY;
    const requestedGutter = Number(options.gutterTiles);
    const gutterTiles = Number.isFinite(requestedGutter)
      ? Math.max(0, Math.min(4, Math.floor(requestedGutter)))
      : 1;
    const horizonGutter = (pitch > 0)
      ? ((typeof FrustumMath !== 'undefined' && FrustumMath.calculatePitchOverscan)
          ? FrustumMath.calculatePitchOverscan(pitch).horizonGutter
          : 3)
      : 0;
    let minX = Math.floor((center.x - halfWidth) / tileSize) - gutterTiles;
    let maxX = Math.floor((center.x + halfWidth) / tileSize) + gutterTiles;
    let minY = Math.max(0, Math.floor((center.y - halfHeight) / tileSize) - (gutterTiles + horizonGutter));
    let maxY = Math.min(count - 1, Math.floor((center.y + halfHeight) / tileSize) + gutterTiles);
    // Alignment is an explicit export policy, never a download default. The
    // stitcher can pack sparse groups with transparent cells after download.
    if (downloadZoom >= 2 && options.alignMegaTiles === true) {
      minX = Math.floor(minX / 8) * 8;
      maxX = Math.ceil((maxX + 1) / 8) * 8 - 1;
      minY = Math.floor(minY / 8) * 8;
      maxY = Math.min(count - 1, Math.ceil((maxY + 1) / 8) * 8 - 1);
    }
    const tiles = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        tiles.push(TileAddress.create(x, y, downloadZoom, {
          pixelX: x * tileSize,
          pixelY: y * tileSize
        }));
      }
    }
    return tiles;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = CoveragePlanner;
else if (typeof window !== 'undefined') window.CoveragePlanner = CoveragePlanner;
