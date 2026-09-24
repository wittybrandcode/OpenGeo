/**
 * OpenGeo — FinalizeTimelineScanner
 *
 * Scans the After Effects timeline trajectory across work area frames
 * and constructs an optimized tile coverage plan.
 * Pure service with zero DOM coupling.
 */

class FinalizeTimelineScanner {
  constructor(aeBridge, tilePlanner) {
    this.aeBridge = aeBridge;
    this.tilePlanner = tilePlanner;
  }

  /**
   * Scans the active composition timeline and generates a tile coverage plan.
   * @param {number|string} activeCompId
   * @param {object} snapshot
   * @returns {Promise<{ trajectory: Array, plan: Array }>}
   */
  async scanTimeline(activeCompId, snapshot) {
    if (typeof globalEventBus !== 'undefined' && globalEventBus.emit) {
      globalEventBus.emit('ui:status', { message: 'Finalize: Scanning timeline...', isError: false });
    }

    const TIMELINE_SAMPLE_STEP = 1;
    const trajectory = await this.aeBridge.invoke(
      'trajectory.scan',
      { compId: activeCompId, sampleStep: TIMELINE_SAMPLE_STEP },
      { timeoutMs: 30000 }
    );
    const frames = trajectory && trajectory.frames ? trajectory.frames : [];

    if (frames.length === 0) {
      throw new Error('No animation data found in Work Area');
    }

    const fetchWidth = snapshot.composition.width;
    const fetchHeight = snapshot.composition.height;
    const qualityOffset = { normal: 0, high: 1, ultra: 2 }[snapshot.quality] || 0;

    const options = {
      qualityOffset,
      sourceTileSize: snapshot.sourceTileSize,
      maxSourceZoom: snapshot.maxSourceZoom,
      sourceKey: snapshot.sourceKey,
      providerSignature: snapshot.providerSignature,
      fetchWidth,
      fetchHeight,
      gutterTiles: 1,
      includeBaseCoverage: false,
      blendDuration: (typeof TilePlanner !== 'undefined' && TilePlanner.DEFAULT_BLEND_DURATION) || 0.25
    };

    const planner = this.tilePlanner || (typeof TilePlanner !== 'undefined' ? new TilePlanner() : null);
    if (!planner) throw new Error('TilePlanner is unavailable for timeline scanning');
    const plan = planner.createPlan(frames, options);

    return { trajectory: frames, plan };
  }

  async scan(activeCompId, snapshot) {
    return this.scanTimeline(activeCompId, snapshot);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FinalizeTimelineScanner;
}
if (typeof window !== 'undefined') {
  window.FinalizeTimelineScanner = FinalizeTimelineScanner;
}
