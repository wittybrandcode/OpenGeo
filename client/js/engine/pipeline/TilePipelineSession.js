/**
 * OpenGeo — TilePipelineSession (Engine Pipeline Delegate)
 *
 * Coordinates a single synchronous or asynchronous tile planning and download session.
 * Separates download execution and coverage evaluation from the Engine Façade.
 */

class TilePipelineSession {
  /**
   * Executes a complete sync pipeline run for an Engine instance.
   * @param {object} engine OpenGeo.Engine instance
   * @param {function} [onProgress] Progress callback
   * @param {number} [qualityOffset=-2] Zoom offset for tile planning
   * @returns {Promise<object>} Sync execution result
   */
  static executeSync(engine, onProgress, qualityOffset) {
    const cam = engine.getCameraState();
    const offset = (qualityOffset !== undefined) ? qualityOffset : -2;
    const downloadZoom = Math.max(0, Math.min(19, Math.floor(cam.zoom + offset)));

    const modifiedCam = {
      lat: cam.lat,
      lon: cam.lon,
      zoom: downloadZoom,
      compZoom: cam.compZoom || cam.zoom,
      compWidth: cam.compWidth,
      compHeight: cam.compHeight,
      viewportWidth: cam.viewportWidth,
      viewportHeight: cam.viewportHeight
    };

    const visible = engine._tileGrid.getVisibleTiles(modifiedCam);
    const plan = PlacementExpander.createDownloadPlan([
      { sampleId: 'viewport', camera: cam, tiles: visible }
    ], {
      providerSignature: engine._providerSignature || 'default',
      tileMatrix: 'webMercator',
      sourceTileSize: engine._sourceTileSize || 256
    });

    return engine._downloader.downloadBatch(plan, function (c, t) {
      if (onProgress) onProgress(c, t);
    }).then(function (results) {
      const errors = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status !== 'complete' || !r.filePath) errors.push(r);
      }
      if (errors.length) {
        console.warn('[OpenGeo.Engine] ' + errors.length + ' tiles failed');
      }

      const expandedTiles = PlacementExpander.expandCompleted(plan, results);
      return {
        plan: plan,
        results: results,
        tiles: expandedTiles,
        coverage: CoverageContract.evaluate(plan, results, expandedTiles),
        errors: errors,
        camera: {
          lat: cam.lat,
          lon: cam.lon,
          zoom: cam.zoom,
          viewportWidth: cam.viewportWidth,
          viewportHeight: cam.viewportHeight
        }
      };
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TilePipelineSession;
}
if (typeof window !== 'undefined') {
  window.TilePipelineSession = TilePipelineSession;
}
