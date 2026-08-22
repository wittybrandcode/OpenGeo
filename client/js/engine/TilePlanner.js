class TilePlanner {
  constructor(app) {
    this.app = app;
  }

  /**
   * Plans which tiles need to be downloaded based on the camera trajectory.
   * Optimizes for spatial coverage and incorporates the "Base Zoom + Peak Zoom" coverage strategy.
   * @param {Array} frames - Array of AE camera keyframe objects { lat, lon, zoom }
   * @param {Object} options - { qualityOffset, sourceTileSize, maxSourceZoom, sourceKey, fetchWidth, fetchHeight, gutterTiles, includeBaseCoverage }
   * @returns {Array} Array of unique tile objects to download
   */
  createPlan(frames, options) {
    const {
      qualityOffset, sourceTileSize, maxSourceZoom, sourceKey,
      fetchWidth, fetchHeight, gutterTiles, includeBaseCoverage
    } = options;
    
    let currentQualityOffset = qualityOffset;
    if (sourceTileSize === 512) {
      currentQualityOffset = qualityOffset - 1;
    }

    let minZoom = 99;
    let maxZoom = -99;
    for (const f of frames) {
      if (f.zoom < minZoom) minZoom = f.zoom;
      if (f.zoom > maxZoom) maxZoom = f.zoom;
    }

    const minDownloadZoom = Math.max(0, Math.min(maxSourceZoom, Math.floor(minZoom + currentQualityOffset)));
    const maxDownloadZoom = Math.max(0, Math.min(maxSourceZoom, Math.floor(maxZoom + currentQualityOffset)));

    const uniqueTiles = {};
    
    // Spatial Cache to prevent redundant calculations for identical/near-identical frames
    let lastFrameState = { lat: null, lon: null, zoom: null, tiles: [] };

    for (const frame of frames) {
      const frameDownloadZoom = Math.max(0, Math.min(maxSourceZoom, Math.floor(frame.zoom + currentQualityOffset)));
      
      // Resolution Coverage Strategy: We don't snap to arbitrary target zooms anymore.
      // Instead, we allow a max difference of 1 zoom level from the requested frame zoom.
      // This ensures smooth visual quality across the entire trajectory.
      const effectiveZoom = frameDownloadZoom;

      // Check Spatial Cache (if camera hasn't moved significantly, reuse tiles)
      const zoomDiff = Math.abs(frameDownloadZoom - lastFrameState.zoom);
      const movementPixels = MercatorProjection.cameraPixelDistance(
        frame,
        lastFrameState,
        frameDownloadZoom,
        sourceTileSize
      );
      const hasCachedFrame = lastFrameState.lat !== null && lastFrameState.lon !== null && lastFrameState.zoom !== null;
      
      // A geographic epsilon changes meaning with latitude and zoom. Reuse is
      // safe only when the projected camera movement is below one source pixel.
      if (hasCachedFrame && movementPixels < 1 && zoomDiff === 0) {
        // Use cached tiles
        for (const t of lastFrameState.tiles) {
          if (!t.url) t.url = this.app._buildTileUrl(sourceKey, t.wrappedX, t.y, t.z);
          t.source = sourceKey;
          uniqueTiles[t.key] = t;
        }
      } else {
        // Calculate new tiles
        const tiles = CoveragePlanner.planComposition(frame, {
          width: fetchWidth,
          height: fetchHeight,
          downloadZoom: effectiveZoom,
          tileSize: 256,
          gutterTiles,
          alignMegaTiles: false
        });

        // A second low-resolution layer is opt-in only. Every sampled frame
        // already contributes complete viewport coverage, while failed final
        // downloads are retried and rejected before AE mutation.
        let baseTiles = [];
        if (includeBaseCoverage === true && effectiveZoom !== minDownloadZoom) {
            baseTiles = CoveragePlanner.planComposition(frame, {
              width: fetchWidth,
              height: fetchHeight,
              downloadZoom: minDownloadZoom,
              tileSize: 256,
              gutterTiles,
              alignMegaTiles: false
            });
        }

        const allVisibleTiles = tiles.concat(baseTiles);

        for (const t of allVisibleTiles) {
          if (!t.url) t.url = this.app._buildTileUrl(sourceKey, t.wrappedX, t.y, t.z);
          t.source = sourceKey;
          uniqueTiles[t.key] = t;
        }

        // Update cache
        lastFrameState = {
          lat: frame.lat,
          lon: frame.lon,
          zoom: frameDownloadZoom,
          tiles: allVisibleTiles
        };
      }
    }

    return Object.values(uniqueTiles);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TilePlanner;
} else if (typeof window !== 'undefined') {
  window.TilePlanner = TilePlanner;
}
