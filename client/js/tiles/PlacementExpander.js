/**
 * Builds the canonical in-memory tile plan.
 *
 * Network and cache work is unique by downloadKey. Rendering and stitching
 * remain unique by placementKey, so a single local image may feed several
 * unwrapped world positions without another request.
 */
class PlacementExpander {
  static createDownloadPlan(samples, options = {}) {
    const downloadByKey = new Map();
    const placementByKey = new Map();
    const coverageSamples = [];
    const normalizedSamples = Array.isArray(samples) ? samples : [];

    for (let sampleIndex = 0; sampleIndex < normalizedSamples.length; sampleIndex++) {
      const input = normalizedSamples[sampleIndex] || {};
      const sampleId = String(input.sampleId !== undefined ? input.sampleId : `sample-${sampleIndex}`);
      const requiredPlacementKeys = [];
      const seenInSample = new Set();
      const tiles = Array.isArray(input.tiles) ? input.tiles : [];

      for (const rawTile of tiles) {
        const placement = PlacementExpander._normalizeTile(rawTile, options);
        if (!seenInSample.has(placement.placementKey)) {
          seenInSample.add(placement.placementKey);
          requiredPlacementKeys.push(placement.placementKey);
        }
        if (!placementByKey.has(placement.placementKey)) {
          placementByKey.set(placement.placementKey, placement);
        }

        let download = downloadByKey.get(placement.downloadKey);
        if (!download) {
          download = {
            downloadKey: placement.downloadKey,
            providerSignature: placement.providerSignature,
            tileMatrix: placement.tileMatrix,
            sourceTileSize: placement.sourceTileSize,
            z: placement.z,
            x: placement.wrappedX,
            wrappedX: placement.wrappedX,
            y: placement.y,
            url: placement.url,
            source: placement.source,
            placementKeys: []
          };
          downloadByKey.set(download.downloadKey, download);
        }
        if (download.placementKeys.indexOf(placement.placementKey) === -1) {
          download.placementKeys.push(placement.placementKey);
        }
      }

      coverageSamples.push({
        sampleId,
        camera: input.camera ? Object.assign({}, input.camera) : null,
        requiredPlacementKeys
      });
    }

    const downloads = Array.from(downloadByKey.values());
    downloads.contractVersion = 'tile-plan/1.0';
    downloads.placementCount = placementByKey.size;
    downloads.placements = Array.from(placementByKey.values());
    downloads.coverageSamples = coverageSamples;
    return downloads;
  }

  static expandCompleted(plan, results) {
    const normalizedPlan = PlacementExpander.normalizeLegacyPlan(plan);
    const completedByDownloadKey = new Map();
    for (const result of (Array.isArray(results) ? results : [])) {
      if (!result || result.status !== 'complete' || !result.filePath || !result.tile) continue;
      const tile = PlacementExpander._normalizeTile(result.tile, {
        providerSignature: result.tile.providerSignature,
        tileMatrix: result.tile.tileMatrix,
        sourceTileSize: result.tile.sourceTileSize
      });
      completedByDownloadKey.set(tile.downloadKey, result.filePath);
    }

    const expanded = [];
    for (const placement of normalizedPlan.placements) {
      const filePath = completedByDownloadKey.get(placement.downloadKey);
      if (!filePath) continue;
      expanded.push(Object.assign({}, placement, { filePath }));
    }
    return expanded;
  }

  static normalizeLegacyPlan(plan, options = {}) {
    if (!Array.isArray(plan)) return PlacementExpander.createDownloadPlan([], options);
    if (plan.contractVersion === 'tile-plan/1.0' && Array.isArray(plan.placements)) return plan;
    PlacementExpander._warnLegacyKey();
    return PlacementExpander.createDownloadPlan([
      { sampleId: 'legacy', tiles: plan }
    ], options);
  }

  static missingDownloadKeys(plan, results) {
    const normalizedPlan = PlacementExpander.normalizeLegacyPlan(plan);
    const complete = new Set();
    for (const result of (Array.isArray(results) ? results : [])) {
      if (!result || result.status !== 'complete' || !result.filePath || !result.tile) continue;
      const tile = PlacementExpander._normalizeTile(result.tile, {
        providerSignature: result.tile.providerSignature,
        tileMatrix: result.tile.tileMatrix,
        sourceTileSize: result.tile.sourceTileSize
      });
      complete.add(tile.downloadKey);
    }
    return normalizedPlan.filter(download => !complete.has(download.downloadKey)).map(download => download.downloadKey);
  }

  static _normalizeTile(tile, options) {
    if (tile && tile.key && !tile.downloadKey && !tile.placementKey) PlacementExpander._warnLegacyKey();
    const normalized = TileAddress.withIdentity(tile, options);
    return Object.assign(normalized, {
      providerSignature: options.providerSignature || normalized.providerSignature || 'default'
    });
  }

  static _warnLegacyKey() {
    if (PlacementExpander._legacyWarningIssued) return;
    PlacementExpander._legacyWarningIssued = true;
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[OpenGeo][DEPRECATED_TILE_KEY] Legacy tile.key was adapted; use downloadKey and placementKey explicitly.');
    }
  }
}

PlacementExpander._legacyWarningIssued = false;

if (typeof module !== 'undefined' && module.exports) module.exports = PlacementExpander;
else if (typeof window !== 'undefined') window.PlacementExpander = PlacementExpander;
