class SyncManager {
  constructor(app) {
    this.app = app;
    this.exportTimer = null;
    this.trajectoryTimer = null;
    this._trajectoryRunId = 0;
    this._trajectoryOperationGeneration = null;
    this._syncDownloadSession = null;
    this._trajectoryDownloadSession = null;
    this._previewStitcher = null;
    this.maxTrajectoryPreviewTiles = 2500;
  }

  queueAutoExport() {
    if (!this.app.activeCompId) return;
    if (this.app.finalizeController && this.app.finalizeController.isFinalizing) return;
    clearTimeout(this.exportTimer);
    this.exportTimer = setTimeout(() => this.exportToAE(false, true), 700);
  }

  queueTrajectoryPreview() {
    if (!this.app.activeCompId) return;
    if (this.app.finalizeController && this.app.finalizeController.isFinalizing) return;
    this._trajectoryRunId += 1;
    const runId = this._trajectoryRunId;
    if (this._trajectoryDownloadSession) this._trajectoryDownloadSession.cancel();
    if (this._trajectoryOperationGeneration !== null) {
      this.app.session.cancelOperation('preview', this._trajectoryOperationGeneration);
      this._trajectoryOperationGeneration = null;
    }
    clearTimeout(this.trajectoryTimer);
    this.trajectoryTimer = setTimeout(() => this._buildTrajectoryPreview(runId), 1100);
  }

  /**
   * Supersedes every background asset operation that captured an older
   * provider definition. The next provider owns a fresh generation and may
   * schedule exactly one viewport export after its Canvas preview is reset.
   */
  invalidateForProviderChange() {
    this.invalidateBackgroundWork();
  }

  invalidateBackgroundWork() {
    if (this.exportTimer) clearTimeout(this.exportTimer);
    if (this.trajectoryTimer) clearTimeout(this.trajectoryTimer);
    this.exportTimer = null;
    this.trajectoryTimer = null;
    this._trajectoryRunId += 1;

    if (this._syncDownloadSession) this._syncDownloadSession.cancel();
    if (this._trajectoryDownloadSession) this._trajectoryDownloadSession.cancel();
    if (this._previewStitcher) this._previewStitcher.destroy();
    this._syncDownloadSession = null;
    this._trajectoryDownloadSession = null;
    this._previewStitcher = null;

    this._supersedeOperation('sync');
    this._supersedeOperation('preview');
    this._trajectoryOperationGeneration = null;
  }

  _supersedeOperation(kind) {
    const session = this.app && this.app.session;
    if (!session || !session.generations || !Object.prototype.hasOwnProperty.call(session.generations, kind)) return;
    const activeGeneration = session.generations[kind];
    if (session.operations && session.operations[kind] === 'running') {
      session.cancelOperation(kind, activeGeneration);
    }
    session.nextGeneration(kind);
  }

  /**
   * Gives an explicit keyframe mutation precedence over background preview
   * work. The next successful Add Key schedules one trajectory preview, so a
   * pending viewport export must not reach AE first and duplicate the build.
   */
  prepareForKeyframeMutation() {
    if (this.exportTimer) clearTimeout(this.exportTimer);
    this.exportTimer = null;

    this._trajectoryRunId += 1;
    if (this.trajectoryTimer) clearTimeout(this.trajectoryTimer);
    this.trajectoryTimer = null;
    if (this._syncDownloadSession) this._syncDownloadSession.cancel();
    if (this._trajectoryDownloadSession) this._trajectoryDownloadSession.cancel();
    if (this._previewStitcher) this._previewStitcher.destroy();
    this._previewStitcher = null;

    if (this._trajectoryOperationGeneration !== null) {
      this.app.session.cancelOperation('preview', this._trajectoryOperationGeneration);
      this._trajectoryOperationGeneration = null;
    }
    if (this._syncDownloadSession || this.app.session.operations.sync === 'running') {
      const generation = this.app.session.nextGeneration('sync');
      this.app.session.cancelOperation('sync', generation);
      globalEventBus.emit('ui:download_modal', { show: false });
    }
  }

  async _packPreviewTiles(tiles, snapshot, compId, scope, isCurrent) {
    if (!tiles || tiles.length < 2) return tiles || [];
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const root = path.resolve(OpenGeo.Engine.getDefaultCacheDir(), 'PreviewMegaTiles');
    const safeDocument = String(snapshot.documentId || 'legacy').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeScope = String(scope || 'viewport').replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputDir = path.resolve(root, safeDocument, safeScope);
    if (outputDir !== root && outputDir.indexOf(root + path.sep) !== 0) {
      throw new Error('Unsafe preview MegaTile directory.');
    }
    await new Promise((resolve, reject) => {
      fs.mkdir(outputDir, { recursive: true }, error => error ? reject(error) : resolve());
    });
    if (!isCurrent()) throw new Error('Preview packing was superseded.');

    // A sparse trajectory can revisit the same 8x8 group with a different
    // subset of children. Include the complete child manifest in the cache
    // signature so an older partial MegaTile can never be reused as this run.
    const manifestSignature = crypto.createHash('sha256').update(
      [snapshot.providerSignature, scope].concat(tiles.map(tile =>
        [tile.z, tile.x, tile.y, tile.placementKey || '', tile.downloadKey || '', tile.filePath || ''].join(':')
      ).sort()).join('|')
    ).digest('hex').slice(0, 20);

    const stitcher = new MegaTileStitcher(
      outputDir.replace(/\\/g, '/'),
      String(compId || 'global').replace(/[^a-zA-Z0-9_-]/g, '_'),
      'preview_' + manifestSignature
    );
    if (this._previewStitcher) this._previewStitcher.destroy();
    this._previewStitcher = stitcher;
    try {
      const packed = await stitcher.stitchHierarchical(tiles, (done, total) => {
        if (!isCurrent()) throw new Error('Preview packing was superseded.');
        if (total > 0) {
          globalEventBus.emit('ui:status', {
            message: `Packing ${scope} preview… ${Math.round(done / total * 100)}%`,
            isError: false
          });
        }
      }, snapshot.sourceTileSize);
      const coverage = stitcher.getCoverageReport();
      if (!isCurrent()) throw new Error('Preview packing was superseded.');
      if (!packed.length || coverage.some(report => report.decodedCount !== report.expectedCount)) {
        throw new Error('Preview MegaTile coverage validation failed.');
      }
      return packed;
    } finally {
      stitcher.destroy();
      if (this._previewStitcher === stitcher) this._previewStitcher = null;
    }
  }

  async _cleanupPreviewMegaTiles(tiles, snapshot, scope) {
    const fs = require('fs');
    const path = require('path');
    const root = path.resolve(OpenGeo.Engine.getDefaultCacheDir(), 'PreviewMegaTiles');
    const safeDocument = String(snapshot.documentId || 'legacy').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeScope = String(scope || 'viewport').replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputDir = path.resolve(root, safeDocument, safeScope);
    if (outputDir === root || outputDir.indexOf(root + path.sep) !== 0) return;
    const keep = new Set((tiles || []).map(tile => path.resolve(tile.filePath || '')));
    let names;
    try {
      names = await new Promise((resolve, reject) => {
        fs.readdir(outputDir, (error, entries) => error ? reject(error) : resolve(entries));
      });
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      console.warn('[SyncManager] Preview MegaTile cleanup skipped:', error.message);
      return;
    }
    await Promise.all(names.filter(name => /^mega\d+_/.test(name)).map(name => {
      const candidate = path.resolve(outputDir, name);
      if (candidate.indexOf(outputDir + path.sep) !== 0 || keep.has(candidate)) return Promise.resolve();
      return new Promise(resolve => fs.unlink(candidate, () => resolve()));
    }));
  }

  async _buildTrajectoryPreview(runId) {
    let snapshot = null;
    let downloadSession = null;
    const isCurrent = () => runId === this._trajectoryRunId &&
      (!snapshot || snapshot.isCurrent(this.app)) &&
      !(this.app.finalizeController && this.app.finalizeController.isFinalizing);
    const compId = this.app.activeCompId;
    if (!compId || !isCurrent()) return;

    try {
      const trajectory = await this.app.aeBridge.invoke(
        'trajectory.scan', { compId, sampleStep: 6 }, { timeoutMs: 30000 }
      );
      if (!isCurrent()) return;

      const previewGeneration = this.app.session.beginOperation('preview');
      this._trajectoryOperationGeneration = previewGeneration;
      snapshot = OperationSnapshot.capture(this.app, {
        kind: 'preview', generation: previewGeneration, compId
      });
      const frames = (trajectory && trajectory.frames ? trajectory.frames : [])
        .filter(frame => Number.isFinite(frame.lat) && Number.isFinite(frame.lon) && Number.isFinite(frame.zoom));
      frames.push({
        lat: snapshot.camera.lat,
        lon: snapshot.camera.lon,
        zoom: snapshot.camera.zoom
      });
      if (frames.length < 2) {
        this.app.session.failOperation('preview', previewGeneration, 'PREVIEW_INSUFFICIENT_FRAMES');
        this._trajectoryOperationGeneration = null;
        return;
      }

      const planner = new TilePlanner(this.app);
      const plan = planner.createPlan(frames, {
        qualityOffset: -2,
        sourceTileSize: snapshot.sourceTileSize,
        maxSourceZoom: snapshot.maxSourceZoom,
        sourceKey: snapshot.sourceKey,
        providerSignature: snapshot.providerSignature,
        fetchWidth: snapshot.composition.width,
        fetchHeight: snapshot.composition.height,
        gutterTiles: 1,
        includeBaseCoverage: false
      });
      if (!isCurrent()) return;
      if (plan.length > this.maxTrajectoryPreviewTiles) {
        this.app.session.failOperation('preview', previewGeneration, 'PREVIEW_TILE_LIMIT');
        this._trajectoryOperationGeneration = null;
        globalEventBus.emit('toast:show', {
          message: `Path preview needs ${plan.length} tiles (limit ${this.maxTrajectoryPreviewTiles}). Current-location preview remains available.`,
          type: 'warning', duration: 6000
        });
        return;
      }

      downloadSession = new DownloadSession(snapshot, { maxConcurrent: 4 });
      this._trajectoryDownloadSession = downloadSession;
      globalEventBus.emit('ui:status', { message: `Preparing path preview (${plan.length} tiles)…`, isError: false });
      const download = await downloadSession.downloadPlan(plan);
      if (!isCurrent()) return;
      const downloadedTiles = download.tiles;
      if (!downloadedTiles.length) throw new Error('Path preview downloaded no usable tiles.');
      const tiles = await this._packPreviewTiles(
        downloadedTiles, snapshot, compId, 'path', isCurrent
      );
      if (!isCurrent()) return;

      const result = await this.app.aeBridge.invokeWithPayloadFile('composition.build', {
        operationId: snapshot.operationId,
        tiles,
        camera: Object.assign({}, snapshot.camera),
        isPreview: true,
        previewGeneration: `trajectory_${runId}`,
        previewScope: 'trajectory',
        replaceFinal: false,
        source: snapshot.sourceKey,
        documentId: snapshot.documentId,
        displayName: snapshot.composition.displayName
      }, this.app.jobManager, { timeoutMs: 60000 });
      if (!isCurrent()) return;
      await this._cleanupPreviewMegaTiles(tiles, snapshot, 'path');
      if (result && result.compId) this.app.activeCompId = result.compId;
      this.app.session.completeOperation('preview', previewGeneration);
      this._trajectoryOperationGeneration = null;
      globalEventBus.emit('ui:status', { message: 'Path preview ready.', isError: false });
    } catch (error) {
      if (isCurrent()) {
        if (snapshot) this.app.session.failOperation('preview', snapshot.generation, error && error.code ? error.code : 'PREVIEW_FAILED');
        this._trajectoryOperationGeneration = null;
        console.warn('[SyncManager] Path preview skipped:', error.message);
      }
    } finally {
      if (downloadSession && this._trajectoryDownloadSession === downloadSession) {
        this._trajectoryDownloadSession = null;
      }
      if (snapshot && this._trajectoryOperationGeneration === snapshot.generation &&
          this.app.session.operations.preview === 'running') {
        this.app.session.cancelOperation('preview', snapshot.generation);
        this._trajectoryOperationGeneration = null;
      }
    }
  }

  queueAutoExportFromAE() {
    if (!this.app.activeCompId) return;
    // We do NOT auto-export tiles to AE when the timeline cursor moves.
    // This function was disabled previously to fix the "timeline scrub preview tile bug".
    // We keep it empty to satisfy any event emitters.
  }

  async exportToAE(createIfNeeded, quiet = false, useAeState = false, compSettings = null) {
    const currentGeneration = this.app.session.beginOperation('sync');
    if (this._syncDownloadSession) this._syncDownloadSession.cancel();
    let snapshot = null;
    let downloadSession = null;

    if (!quiet) globalEventBus.emit('ui:status', { message: 'Preparing tile export…', isError: false });
    
    try {
      snapshot = OperationSnapshot.capture(this.app, {
        kind: 'sync',
        generation: currentGeneration,
        compId: this.app.activeCompId || null,
        compSettings
      });
      downloadSession = new DownloadSession(snapshot, { maxConcurrent: 6 });
      this._syncDownloadSession = downloadSession;
      
      if (!quiet) globalEventBus.emit('ui:status', { message: 'Downloading map tiles…', isError: false });

      const qualityOffset = snapshot.sourceTileSize === 512 ? -3 : -2;
      globalEventBus.emit('ui:download_modal', { show: true, info: 'Syncing with After Effects...', pct: 0, done: 0, total: 0 });
      
      const syncResult = await downloadSession.sync((done, total) => {
        if (!snapshot.isCurrent(this.app)) return;
        const pct = Math.round((done / total) * 100);
        globalEventBus.emit('ui:status', { message: `Downloading tiles… ${pct}% (${done}/${total})`, isError: false });
        globalEventBus.emit('ui:download_modal', { show: true, info: 'Downloading low-res draft tiles...', pct, done, total });
      }, qualityOffset);

      if (!snapshot.isCurrent(this.app)) {
        return;
      }

      globalEventBus.emit('ui:download_modal', { show: false });

      // The composition manifest is the immutable result of this sync request,
      // never a history of tiles from previous navigation or providers.
      const accumulatedTiles = syncResult.tiles || [];

      if (accumulatedTiles.length === 0) {
        this.app.session.failOperation('sync', currentGeneration, 'SYNC_NO_TILES');
        globalEventBus.emit('toast:show', { message: 'No tiles downloaded — check connection', type: 'error' });
        return;
      }

      const previewTiles = await this._packPreviewTiles(
        accumulatedTiles,
        snapshot,
        snapshot.compId || this.app.activeCompId || 'new',
        'viewport',
        () => snapshot.isCurrent(this.app)
      );
      if (!snapshot.isCurrent(this.app)) return;

      if (!quiet) globalEventBus.emit('ui:status', { message: 'Building AE composition…', isError: false });

      const aeData = {
        operationId: snapshot.operationId,
        tiles: previewTiles,
        camera: syncResult.camera,
        compSettings: snapshot.compSettings,
        isPreview: true,
        previewGeneration: currentGeneration,
        // Every navigation preview is an overlay. An explicit Finalize is the
        // only operation that replaces a completed final render.
        replaceFinal: !snapshot.isFinalized,
        source: snapshot.sourceKey,
        documentId: snapshot.documentId
      };

      // 4. Removed redundant index.jsx loading, relying on AEBridge central lifecycle
      if (this.app.aeBridge && !this.app.aeBridge.isHostInitialized) {
        await this.app.aeBridge.initializeHost();
      }
      if (!snapshot.isCurrent(this.app)) return;

      const result = await this.app.aeBridge.invokeWithPayloadFile(
        'composition.build', aeData, this.app.jobManager, { timeoutMs: 60000 }
      );

      if (!snapshot.isCurrent(this.app)) return;
      await this._cleanupPreviewMegaTiles(previewTiles, snapshot, 'viewport');

      if (!quiet) globalEventBus.emit('ui:status', { message: `Success: ${result.tilesImported}/${result.tilesTotal} tiles imported`, isError: false });
      if (!quiet) globalEventBus.emit('toast:show', { message: 'AE Composition built successfully', type: 'success' });
      const builtCompId = result.compId || result.compName;
      if (this.app.syncEngine) this.app.syncEngine.setActiveComp(builtCompId);
      else this.app.activeCompId = builtCompId;
      if (this.app.toolbarController) this.app.toolbarController.syncKeyframeRecordingState(builtCompId);
      if (this.app.featureManager) await this.app.featureManager.refresh();
      if (!snapshot.isCurrent(this.app) || this.app.activeCompId !== builtCompId) return;
      await this.app.metadataManager.saveToComp(builtCompId, this.app.viewport, this.app.tileManager, this.app.session);
      this.app.session.completeOperation('sync', currentGeneration);

    } catch (error) {
      if (currentGeneration !== this.app.session.generations.sync) return;
      if (createIfNeeded && this.app.syncEngine) this.app.syncEngine.cancelNewDocument();
      this.app.session.failOperation('sync', currentGeneration, error && error.code ? error.code : 'SYNC_FAILED');
      console.error('[SyncManager] Auto-export error:', error);
      if (!quiet) globalEventBus.emit('ui:status', { message: 'Export failed: ' + error.message, isError: true });
    } finally {
      if (currentGeneration === this.app.session.generations.sync) {
        globalEventBus.emit('ui:download_modal', { show: false });
      }
      if (downloadSession && this._syncDownloadSession === downloadSession) {
        this._syncDownloadSession = null;
      }
    }
  }

  dispose() {
    if (this.exportTimer) clearTimeout(this.exportTimer);
    if (this.trajectoryTimer) clearTimeout(this.trajectoryTimer);
    this.exportTimer = null;
    this.trajectoryTimer = null;
    this._trajectoryRunId += 1;
    this.invalidateBackgroundWork();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyncManager;
} else if (typeof window !== 'undefined') {
  window.SyncManager = SyncManager;
}
