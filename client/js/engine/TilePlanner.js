class TilePlanner {
  constructor(app) {
    this.app = app;
  }

  /**
   * Plans which tiles need to be downloaded based on the camera trajectory.
   * Optimizes for spatial coverage and incorporates the "Base Zoom + Peak Zoom" coverage strategy.
   * @param {Array} frames - Array of AE camera keyframe objects { lat, lon, zoom }
   * @param {Object} options - { qualityOffset, sourceTileSize, maxSourceZoom, sourceKey, fetchWidth, fetchHeight, gutterTiles, includeBaseCoverage }
   * @returns {Array} Unique download requests with placements and coverageSamples metadata
   */
  createPlan(frames, options) {
    const {
      qualityOffset, sourceTileSize, maxSourceZoom, sourceKey, providerSignature,
      fetchWidth, fetchHeight, gutterTiles, includeBaseCoverage
    } = options;
    
    let currentQualityOffset = qualityOffset;
    if (sourceTileSize === 512) {
      currentQualityOffset = qualityOffset - 1;
    }

    const blendDuration = options.blendDuration !== undefined ? options.blendDuration : 0;

    let minZoom = 99;
    const frameZooms = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      if (f.zoom < minZoom) minZoom = f.zoom;
      const z = Math.max(0, Math.min(maxSourceZoom, Math.floor(f.zoom + currentQualityOffset)));
      frameZooms.push(z);
    }

    const minDownloadZoom = Math.max(0, Math.min(maxSourceZoom, Math.floor(minZoom + currentQualityOffset)));

    // Detect zoom level boundary transitions across frames
    const zoomTransitions = [];
    if (blendDuration > 0 && frames.length > 1) {
      for (let i = 1; i < frames.length; i++) {
        const prevZ = frameZooms[i - 1];
        const currZ = frameZooms[i];
        if (prevZ !== currZ) {
          const prevTime = frames[i - 1].time !== undefined ? frames[i - 1].time : ((i - 1) / 30);
          const currTime = frames[i].time !== undefined ? frames[i].time : (i / 30);
          const boundaryTime = (prevTime + currTime) / 2;
          const startTime = Math.max(0, boundaryTime - blendDuration / 2);
          const endTime = boundaryTime + blendDuration / 2;

          const existing = zoomTransitions.find(t =>
            t.fromZoom === prevZ && t.toZoom === currZ && Math.abs(t.startTime - startTime) < blendDuration
          );
          if (!existing) {
            zoomTransitions.push({
              fromZoom: prevZ,
              toZoom: currZ,
              boundaryTime: Number(boundaryTime.toFixed(4)),
              startTime: Number(startTime.toFixed(4)),
              endTime: Number(endTime.toFixed(4)),
              duration: blendDuration
            });
          }
        }
      }
    }

    const samples = [];
    
    // Spatial Cache to prevent redundant calculations for identical/near-identical frames
    let lastFrameState = { lat: null, lon: null, zoom: null, extraZooms: [], tiles: [] };

    for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
      const frame = frames[frameIndex];
      const frameDownloadZoom = frameZooms[frameIndex];
      const effectiveZoom = frameDownloadZoom;

      // Identify active transitions for this frame
      const frameTime = frame.time !== undefined ? frame.time : (frameIndex / 30);
      const activeTransitions = zoomTransitions.filter(tr => frameTime >= tr.startTime && frameTime <= tr.endTime);
      const extraZooms = [];
      for (let at = 0; at < activeTransitions.length; at++) {
        const tr = activeTransitions[at];
        const targetExtra = (effectiveZoom === tr.fromZoom) ? tr.toZoom : (effectiveZoom === tr.toZoom ? tr.fromZoom : null);
        if (targetExtra !== null && targetExtra !== effectiveZoom && extraZooms.indexOf(targetExtra) === -1) {
          extraZooms.push(targetExtra);
        }
      }

      // Check Spatial Cache (if camera hasn't moved significantly, reuse tiles)
      const zoomDiff = Math.abs(frameDownloadZoom - lastFrameState.zoom);
      const extraZoomChanged = (lastFrameState.extraZooms || []).join(',') !== extraZooms.join(',');
      const movementPixels = MercatorProjection.cameraPixelDistance(
        frame,
        lastFrameState,
        frameDownloadZoom,
        sourceTileSize
      );
      const hasCachedFrame = lastFrameState.lat !== null && lastFrameState.lon !== null && lastFrameState.zoom !== null;
      
      // A geographic epsilon changes meaning with latitude and zoom. Reuse is
      // safe only when the projected camera movement is below one source pixel and transitions match.
      if (hasCachedFrame && movementPixels < 1 && zoomDiff === 0 && !extraZoomChanged) {
        samples.push({
          sampleId: frame.sampleId !== undefined ? frame.sampleId : `frame-${frameIndex}`,
          camera: frame,
          tiles: lastFrameState.tiles
        });
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

        // Add extra dual-zoom transition tiles when inside blend window
        let transitionTiles = [];
        for (let ez = 0; ez < extraZooms.length; ez++) {
          const tTiles = CoveragePlanner.planComposition(frame, {
            width: fetchWidth,
            height: fetchHeight,
            downloadZoom: extraZooms[ez],
            tileSize: 256,
            gutterTiles,
            alignMegaTiles: false
          });
          transitionTiles = transitionTiles.concat(tTiles);
        }

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

        const allVisibleTiles = tiles.concat(transitionTiles).concat(baseTiles);

        for (const t of allVisibleTiles) {
          if (!t.url) t.url = this.app._buildTileUrl(sourceKey, t.wrappedX, t.y, t.z);
          t.source = sourceKey;
        }

        samples.push({
          sampleId: frame.sampleId !== undefined ? frame.sampleId : `frame-${frameIndex}`,
          camera: frame,
          tiles: allVisibleTiles
        });

        // Update cache
        lastFrameState = {
          lat: frame.lat,
          lon: frame.lon,
          zoom: frameDownloadZoom,
          extraZooms: extraZooms.slice(),
          tiles: allVisibleTiles
        };
      }
    }

    const plan = PlacementExpander.createDownloadPlan(samples, {
      providerSignature: providerSignature || sourceKey,
      tileMatrix: options.tileMatrix || 'webMercator',
      sourceTileSize
    });
    plan.zoomTransitions = zoomTransitions;
    return plan;
  }
}

TilePlanner.DEFAULT_BLEND_DURATION = 0.25;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TilePlanner;
} else if (typeof window !== 'undefined') {
  window.TilePlanner = TilePlanner;
}
