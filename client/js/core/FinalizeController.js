class FinalizeController {
  constructor(app) {
    this.app = app;
    this.tilePlanner = typeof TilePlanner !== 'undefined' ? new TilePlanner(app) : null;
    this.isFinalizing = false;
    this._runId = 0;
    this._operationGeneration = null;
    this._downloadSession = null;
    this._commitState = 'idle';
    this._activeTransaction = null;
    this._cancelledRunId = null;
    this.fsm = typeof FinalizeStateMachine !== 'undefined'
      ? new FinalizeStateMachine({
          onStateChange: (newState, oldState, record) => {
            if (typeof globalEventBus !== 'undefined' && globalEventBus && typeof globalEventBus.emit === 'function') {
              globalEventBus.emit('finalize:stateChange', { newState, oldState, record });
            }
          }
        })
      : null;
  }

  /**
   * Main Orchestrator for the Finalize process.
   * Transforms timeline data into high-resolution local assets.
   */
  async finalize(options = {}) {
    if (this.isFinalizing || (this.fsm && this.fsm.isBusy)) {
      globalEventBus.emit('toast:show', { message: 'Finalize is already running.', type: 'warning' });
      return false;
    }

    this.isFinalizing = true;
    if (this.fsm && this.fsm.canTransition('VALIDATING')) this.fsm.transition('VALIDATING');
    const runId = ++this._runId;
    const operationGeneration = this.app.session.beginOperation('finalize');
    this._operationGeneration = operationGeneration;
    this._commitState = 'not-started';
    const documentId = this.app.session.documentId;
    let transaction = null;
    try {
      // 1. Validation Phase
      const { projectPath, activeCompId } = await this.validate();
      this._assertCurrentRun(runId, activeCompId, documentId);
      await this.awaitPendingCameraMutations(activeCompId);
      this._assertCurrentRun(runId, activeCompId, documentId);
      if (this.app.featureManager && typeof this.app.featureManager.waitForIdle === 'function') {
        await this.app.featureManager.waitForIdle();
      }
      this._assertCurrentRun(runId, activeCompId, documentId);

      const qualitySelect = document.getElementById('finalize-quality');
      const quality = qualitySelect ? qualitySelect.value : 'normal';
      const snapshot = OperationSnapshot.capture(this.app, {
        kind: 'finalize', generation: operationGeneration, compId: activeCompId, quality
      });
      transaction = {
        runId,
        snapshot,
        revisionId: this._safeIdentity(snapshot.operationId),
        compId: activeCompId,
        revisionDir: null,
        state: 'not-started',
        hostPrepareStarted: false,
        rollbackPromise: null,
        rollbackCompleted: false
      };
      this._activeTransaction = transaction;

      // 2. Planning Phase
      if (this.fsm && this.fsm.canTransition('PLANNING')) this.fsm.transition('PLANNING');
      const { trajectory, plan } = await this.scanTimeline(activeCompId, snapshot);
      this._assertCurrentRun(runId, activeCompId, documentId, snapshot);

      if (plan.length === 0) {
        throw new Error('No tiles calculated for download. Timeline might be empty.');
      }
      const is4KUltra = snapshot && snapshot.quality === 'ultra' && snapshot.composition &&
        (snapshot.composition.width >= 3840 || snapshot.composition.height >= 2160);
      const safetyLimit = is4KUltra ? 25000 : 20000;
      if (plan.length > 20000 && plan.length > safetyLimit) {
        throw new Error(`Finalize requires ${plan.length} tiles, exceeding the ${safetyLimit.toLocaleString()} tile safety limit. Reduce the Work Area, quality, or camera travel.`);
      }

      await this.evaluateFinalizeBudget(plan, snapshot, options);
      this._assertCurrentRun(runId, activeCompId, documentId, snapshot);

      // 3. Execution Phase (Download & Stitch)
      if (this.fsm && this.fsm.canTransition('DOWNLOADING_TILES')) this.fsm.transition('DOWNLOADING_TILES');
      const assets = await this.downloadTiles(plan, snapshot);
      this._assertCurrentRun(runId, activeCompId, documentId, snapshot);
      if (this.fsm && this.fsm.canTransition('STITCHING_MEGATILES')) this.fsm.transition('STITCHING_MEGATILES');
      const stitched = await this.stitchTiles(assets, projectPath, activeCompId, snapshot, transaction);
      this._validateStitchedAssetIds(stitched.tiles, stitched.coverage);
      this._assertCurrentRun(runId, activeCompId, documentId, snapshot);

      // 4. Atomic Host Transaction: hidden prepare, validated commit, cleanup.
      const expectedAssetIds = stitched.tiles.map(t => String(t.placementKey || t.downloadKey || t.filePath || '')).filter(Boolean);
      transaction.state = 'preparing';
      transaction.hostPrepareStarted = true;
      this._commitState = 'preparing';
      if (this.fsm && this.fsm.canTransition('HOST_PREPARING')) this.fsm.transition('HOST_PREPARING');
      const prepareResult = await this.prepareComposition(
        stitched.tiles, activeCompId, snapshot, transaction.revisionId
      );
      this._assertTypedImportResult(prepareResult, stitched.tiles.length, transaction.revisionId, 'prepare', expectedAssetIds);
      transaction.state = 'prepared';
      this._commitState = 'prepared';
      this._assertCurrentRun(runId, activeCompId, documentId, snapshot);

      transaction.state = 'commit-in-progress';
      this._commitState = 'commit-in-progress';
      if (this.fsm && this.fsm.canTransition('HOST_COMMITTING')) this.fsm.transition('HOST_COMMITTING');
      const commitResult = await this.commitComposition(
        stitched.tiles.length, activeCompId, snapshot, transaction.revisionId
      );
      this._assertTypedImportResult(commitResult, stitched.tiles.length, transaction.revisionId, 'commit', expectedAssetIds);
      if (commitResult.commitState !== 'committed') {
        const commitError = new Error('After Effects did not confirm the finalized revision commit.');
        commitError.code = 'FINALIZE_COMMIT_UNCONFIRMED';
        throw commitError;
      }
      transaction.state = 'committed';
      this.app.session.setFinalized(true, {
        camera: {
          lat: snapshot.camera.lat,
          lng: snapshot.camera.lng,
          zoom: snapshot.camera.compZoom
        }
      });
      const metadataSaved = commitResult.metadataApplied === true ||
        await this.app.metadataManager.saveSnapshotToComp(
          activeCompId, snapshot, true, transaction.revisionId
        );
      if (!metadataSaved) {
        globalEventBus.emit('toast:show', {
          message: 'Finalize committed, but metadata persistence needs attention.',
          type: 'warning', duration: 6000
        });
      }
      this.app.session.completeOperation('finalize', operationGeneration);
      // T5: Only cleanup previous revision after commit is confirmed
      if (this._commitState === 'committed') {
        this._cleanupPreviousRevision(projectPath, snapshot.documentId, commitResult.previousRevision, transaction.revisionId);
      }
      transaction.revisionDir = null;
      if (this.fsm && this.fsm.canTransition('FINALIZED')) this.fsm.transition('FINALIZED');
      this.closeProgressUI();
      globalEventBus.emit('toast:show', { message: 'Finalize completed successfully!', type: 'success' });

      // Automatic high-res thumbnail & PNG sequence capture upon finalize completion
      this._lastFinalizeAssets = assets;
      this._autoCaptureThumbnail(activeCompId, snapshot, trajectory).catch(err => {
        console.warn('[FinalizeController] Auto-thumbnail capture skipped:', err && err.message);
      });
      if (this.app && this.app.dialog && typeof this.app.dialog.alert === 'function') {
        const totalTiles = plan ? plan.length : (stitched && stitched.tiles ? stitched.tiles.length : 0);
        const megaTilesCount = stitched && stitched.tiles ? stitched.tiles.length : 0;
        const tileInfo = totalTiles > 0 ? `${totalTiles.toLocaleString()} tiles` : 'All map tiles';
        const megaInfo = megaTilesCount > 0
          ? `stitched into ${megaTilesCount} high-resolution MegaTile${megaTilesCount > 1 ? 's' : ''}`
          : 'stitched and rendered';

        this.app.dialog.alert({
          title: 'Finalize Complete',
          message: `Download and assembly completed successfully!\n\n${tileInfo} were ${megaInfo} and placed into your After Effects composition.`,
          confirmLabel: 'OK',
          symbol: 'check-circle',
          success: true
        }).catch(() => {});
      }
      return true;

    } catch (error) {
      if (transaction && transaction.state === 'commit-in-progress') {
        const reconciliation = await this._reconcileCommit(transaction);
        if (reconciliation && reconciliation.commitState === 'committed' &&
            reconciliation.activeRevision === transaction.revisionId) {
          transaction.state = 'committed';
          this._commitState = 'committed';
          this.app.session.setFinalized(true, {
            camera: {
              lat: transaction.snapshot.camera.lat,
              lng: transaction.snapshot.camera.lng,
              zoom: transaction.snapshot.camera.compZoom
            }
          });
          if (reconciliation.metadataApplied !== true) {
            await this.app.metadataManager.saveSnapshotToComp(
              transaction.compId, transaction.snapshot, true, transaction.revisionId
            );
          }
          this.app.session.completeOperation('finalize', operationGeneration);
          transaction.revisionDir = null;
          this.closeProgressUI();
          if (this.app && this.app.dialog && typeof this.app.dialog.alert === 'function') {
            this.app.dialog.alert({
              title: 'Finalize Complete',
              message: 'Download and assembly completed successfully!\n\nYour high-resolution map composition is ready in After Effects.',
              confirmLabel: 'OK',
              symbol: 'check-circle',
              success: true
            }).catch(() => {});
          }
          globalEventBus.emit('toast:show', {
            message: 'Finalize commit was confirmed after a delayed AE response.',
            type: 'success', duration: 6000
          });
          return true;
        }
        if (reconciliation && reconciliation.ok === true) {
          transaction.state = 'not-started';
          await this._rollbackTransaction(transaction);
        } else {
          transaction.state = 'reconciliation-required';
          const uncertainError = new Error(
            'Finalize commit status could not be confirmed. Assets were preserved; reopen the composition before retrying.'
          );
          uncertainError.code = 'FINALIZE_RECONCILIATION_REQUIRED';
          error = uncertainError;
        }
      } else if (transaction && transaction.state !== 'committed' &&
          transaction.state !== 'reconciliation-required') {
        if (this.fsm && this.fsm.canTransition('ROLLING_BACK')) this.fsm.transition('ROLLING_BACK');
        await this._rollbackTransaction(transaction);
        if (this.fsm && this.fsm.canTransition('ROLLED_BACK')) this.fsm.transition('ROLLED_BACK');
      }
      if (error && error.code === 'OPEN_GEO_FINALIZE_CANCELLED') return false;
      if (runId !== this._runId) return false;
      if (runId === this._runId) this.app.session.failOperation('finalize', operationGeneration, error && error.code ? error.code : 'FINALIZE_FAILED');
      this.handleFinalizeError(error);
      return false;
    } finally {
      if (this.fsm) this.fsm.reset();
      const ownsCancellationCleanup = runId === this._cancelledRunId;
      if (runId === this._runId || ownsCancellationCleanup) this.isFinalizing = false;
      if (runId === this._runId) this._operationGeneration = null;
      if (runId === this._runId) this._downloadSession = null;
      if (this._activeTransaction === transaction) this._activeTransaction = null;
      if (runId === this._runId || ownsCancellationCleanup) this._commitState = 'idle';
      if (ownsCancellationCleanup) this._cancelledRunId = null;
      if (runId === this._runId || ownsCancellationCleanup) this.closeProgressUI();
    }
  }

  cancel() {
    if (!this.isFinalizing) return false;
    if (this._commitState === 'commit-in-progress' || (this.fsm && !this.fsm.canCancel)) {
      globalEventBus.emit('ui:status', { message: 'Finalize commit is already in progress.', isError: false });
      globalEventBus.emit('toast:show', {
        message: 'After Effects is committing the new revision. This final step cannot be cancelled safely.',
        type: 'warning', duration: 6000
      });
      return false;
    }
    const transaction = this._activeTransaction;
    this._cancelledRunId = this._runId;
    this._runId += 1;
    if (this._operationGeneration !== null) this.app.session.cancelOperation('finalize', this._operationGeneration);
    this._operationGeneration = null;
    if (this._downloadSession) this._downloadSession.cancel();
    this._downloadSession = null;
    if (transaction) {
      transaction.cancelRequested = true;
      transaction.state = 'cancelled-before-commit';
    }
    if (this.fsm && this.fsm.canTransition('ROLLING_BACK')) {
      this.fsm.transition('ROLLING_BACK');
    }
    this._commitState = 'cancelled-before-commit';
    if (typeof globalEventBus !== 'undefined' && globalEventBus.emit) {
      globalEventBus.emit('ui:status', { message: 'Finalize cancelled before commit.', isError: false });
      globalEventBus.emit('toast:show', {
        message: 'Finalize cancelled. The active Final revision remains unchanged.',
        type: 'info'
      });
    }
    this.closeProgressUI();
    return true;
  }

  _assertCurrentRun(runId, compId, documentId, snapshot) {
    if (runId !== this._runId || !this.isFinalizing) {
      const cancellation = new Error('Finalize operation was cancelled.');
      cancellation.code = 'OPEN_GEO_FINALIZE_CANCELLED';
      throw cancellation;
    }
    if (this.app.activeCompId !== compId || this.app.session.documentId !== documentId) {
      throw new Error('Active map changed while Finalize was running. Please run Finalize again.');
    }
    if (snapshot && !snapshot.isCurrent(this.app)) {
      throw new Error('Map source or operation state changed while Finalize was running. Please run Finalize again.');
    }
  }

  async validate() {
    const activeCompId = this.app.activeCompId;
    if (!activeCompId) {
      throw new Error('No active comp! Create one first.');
    }

    let projectPath = null;
    const state = await this.app.aeBridge.invoke('project.getState');
    if (!state || !state.isSaved) throw new Error('Please save your AE project first to finalize local assets.');
    projectPath = state.path;

    return { projectPath, activeCompId };
  }

  async awaitPendingCameraMutations(activeCompId) {
    const toolbar = this.app.toolbarController;
    if (!toolbar || typeof toolbar.waitForKeyframeMutations !== 'function') return true;
    if (typeof toolbar.hasPendingKeyframeMutation === 'function' &&
        toolbar.hasPendingKeyframeMutation(activeCompId)) {
      globalEventBus.emit('ui:status', {
        message: 'Finalize: Waiting for the latest camera keyframe...',
        isError: false
      });
    }
    const committed = await toolbar.waitForKeyframeMutations(activeCompId);
    if (committed !== true) {
      const error = new Error('The latest camera keyframe was not committed. Finalize was stopped before scanning the path.');
      error.code = 'FINALIZE_KEYFRAME_MUTATION_FAILED';
      throw error;
    }
    return true;
  }

  async scanTimeline(activeCompId, snapshot) {
    globalEventBus.emit('ui:status', { message: 'Finalize: Scanning timeline...', isError: false });
    
    // Constant for Timeline Sample Step
    // MUST BE 1 to prevent missing tiles during fast camera pans! 
    const TIMELINE_SAMPLE_STEP = 1;
    const trajectory = await this.app.aeBridge.invoke('trajectory.scan', { compId: activeCompId, sampleStep: TIMELINE_SAMPLE_STEP }, { timeoutMs: 30000 });
    const frames = trajectory && trajectory.frames ? trajectory.frames : [];
    
    if (frames.length === 0) {
      throw new Error('No animation data found in Work Area');
    }

    // Determine dimensions (Single Source of Truth)
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
      includeBaseCoverage: false
    };

    if (!this.tilePlanner) this.tilePlanner = new TilePlanner(this.app);
    const plan = this.tilePlanner.createPlan(frames, options);

    return { trajectory: frames, plan };
  }

  async downloadTiles(plan, snapshot) {
    globalEventBus.emit('ui:status', {
      message: `Finalize: Downloading ${plan.length} tiles...`,
      isError: false
    });

    const downloadSession = new DownloadSession(snapshot, { maxConcurrent: 6 });
    this._downloadSession = downloadSession;

    const totalTiles = (plan && plan.length) || 1;
    const avgTileBytes = snapshot.sourceTileSize >= 512 ? 140 * 1024 : 65 * 1024;
    const initialTotalBytes = totalTiles * avgTileBytes;
    const initialTotalMB = initialTotalBytes / (1024 * 1024);

    const compW = (snapshot.composition && snapshot.composition.width) || 1920;
    const compH = (snapshot.composition && snapshot.composition.height) || 1080;
    const resolutionStr = `${compW}×${compH}`;

    globalEventBus.emit('ui:download_modal', {
      show: true,
      cancelable: true,
      phase: 'downloading',
      title: 'Downloading Tiles',
      subtitle: 'High-Resolution Map Finalize',
      phaseBadge: 'Stage 1 of 2: Map Imagery',
      info: `Initializing download for ${totalTiles} tiles...`,
      pct: 0,
      done: 0,
      total: totalTiles,
      remainingTiles: totalTiles,
      downloadedMB: 0,
      totalMB: initialTotalMB,
      remainingMB: initialTotalMB,
      speed: '--',
      eta: '--',
      resolution: resolutionStr
    });
    
    let lastDone = 0;
    let lastTime = Date.now();
    let smoothedSpeed = 0;
    let totalBytesAccumulated = 0;

    // First pass returns the same canonical result contract used by Preview.
    const firstPass = await downloadSession.downloadPlan(plan, (done, total, lastResult) => {
      if (!snapshot.isCurrent(this.app)) return;
      const pct = Math.round((done / total) * 100);
      const remainingTiles = Math.max(0, total - done);

      // Accumulate bytes: use result buffer length, file size, or sample average
      const tileBytes = (lastResult && lastResult.buffer && lastResult.buffer.byteLength) || avgTileBytes;
      totalBytesAccumulated += tileBytes;

      const dynamicAvgTileBytes = totalBytesAccumulated / Math.max(1, done);
      const dynamicTotalBytes = totalBytesAccumulated + (remainingTiles * dynamicAvgTileBytes);
      const downloadedMB = totalBytesAccumulated / (1024 * 1024);
      const totalMB = dynamicTotalBytes / (1024 * 1024);
      const remainingMB = Math.max(0, totalMB - downloadedMB);

      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      if (elapsed >= 0.3) {
        const delta = done - lastDone;
        const instantSpeed = delta / elapsed;
        smoothedSpeed = smoothedSpeed === 0 ? instantSpeed : (smoothedSpeed * 0.7 + instantSpeed * 0.3);
        lastTime = now;
        lastDone = done;
      }
      
      const tilesPerSec = smoothedSpeed > 0 ? smoothedSpeed : 1;
      const bytesPerSec = tilesPerSec * dynamicAvgTileBytes;
      const speedMBs = bytesPerSec / (1024 * 1024);
      const speedText = speedMBs >= 1 ? `${speedMBs.toFixed(1)} MB/s` : `${Math.round(bytesPerSec / 1024)} KB/s`;

      const remainingSecs = Math.round(remainingTiles / Math.max(0.2, tilesPerSec));
      const etaText = remainingSecs < 60 ? `~${remainingSecs}s` : `~${Math.round(remainingSecs / 60)}m`;

      const infoText = `Downloading tiles… ${remainingMB >= 1 ? remainingMB.toFixed(1) + ' MB' : Math.round(remainingMB * 1024) + ' KB'} remaining (${remainingTiles} left)`;
      globalEventBus.emit('ui:status', { message: `Downloading high quality tiles… ${pct}% (${done}/${total})`, isError: false });
      globalEventBus.emit('ui:download_modal', {
        show: true,
        cancelable: true,
        phase: 'downloading',
        title: 'Downloading Tiles',
        subtitle: 'High-Resolution Map Finalize',
        phaseBadge: 'Stage 1 of 2: Map Imagery',
        info: infoText,
        pct,
        done,
        total,
        remainingTiles,
        downloadedMB,
        totalMB,
        remainingMB,
        speed: speedText,
        eta: etaText,
        resolution: resolutionStr
      });
    });
    const normalizedPlan = firstPass.plan;
    let syncResult = firstPass.results;
    
    // Retry Logic for Partial Downloads
    const firstMissingKeys = new Set(firstPass.coverage.missingDownloadKeys);
    const failedTiles = normalizedPlan.filter(tile => firstMissingKeys.has(tile.downloadKey));
    if (failedTiles.length > 0) {
      if (!snapshot.isCurrent(this.app)) throw new Error('Map source changed during Finalize download.');
      globalEventBus.emit('ui:download_modal', {
        show: true,
        cancelable: true,
        phase: 'downloading',
        title: 'Retrying Tiles',
        subtitle: 'High-Resolution Map Finalize',
        phaseBadge: 'Stage 1 of 2: Retries',
        info: `Retrying ${failedTiles.length} failed tiles...`,
        pct: 0,
        done: 0,
        total: failedTiles.length,
        remainingTiles: failedTiles.length,
        resolution: resolutionStr
      });
      const retryResult = await downloadSession.downloadTiles(failedTiles, () => {});
      syncResult = syncResult.concat(retryResult);
    }

    const okTiles = PlacementExpander.expandCompleted(normalizedPlan, syncResult);
    CoverageContract.assertCompleteCoverage(normalizedPlan, syncResult, okTiles);
    return okTiles;
  }

  async stitchTiles(assets, projectPath, activeCompId, snapshot, transaction) {
    const compW = (snapshot.composition && snapshot.composition.width) || 1920;
    const compH = (snapshot.composition && snapshot.composition.height) || 1080;
    const resolutionStr = `${compW}×${compH}`;
    const totalAssets = (assets && assets.length) || 1;
    const estimatedMB = (totalAssets * 65) / 1024;

    globalEventBus.emit('ui:download_modal', {
      show: true,
      cancelable: true,
      phase: 'stitching',
      title: 'Assembling MegaTiles',
      subtitle: 'Lossless Canvas Compilation',
      phaseBadge: 'Stage 2 of 2: MegaTile Stitch',
      info: `Compiling ${totalAssets} tiles into MegaTiles...`,
      pct: 0,
      done: 0,
      total: totalAssets,
      remainingTiles: totalAssets,
      downloadedMB: estimatedMB,
      totalMB: estimatedMB,
      remainingMB: 0,
      speed: 'Stitching',
      eta: 'Compiling',
      resolution: resolutionStr
    });
    const fs = require('fs');
    const path = require('path');
    const megaTileRoot = path.resolve(projectPath, 'OpenGeo_Assets', 'MegaTiles');
    const revisionDir = path.resolve(
      megaTileRoot,
      this._safeIdentity(snapshot.documentId),
      this._safeIdentity(transaction.revisionId)
    );
    if (revisionDir.indexOf(megaTileRoot + path.sep) !== 0) {
      throw new Error('Unsafe MegaTile revision directory.');
    }
    transaction.revisionDir = revisionDir;
    fs.mkdirSync(revisionDir, { recursive: true });

    const stitcher = new MegaTileStitcher(
      revisionDir.replace(/\\/g, '/'),
      this._safeIdentity(activeCompId),
      `final_${this._safeIdentity(transaction.revisionId)}`,
      {
        artifactKind: 'finalize-revision',
        providerSignature: snapshot.providerSignature,
        operationId: transaction.revisionId
      }
    );
    try {
      const tiles = await stitcher.stitchHierarchical(assets, (done, total) => {
        const pct = Math.round((done / total) * 100);
        globalEventBus.emit('ui:download_modal', {
          show: true,
          cancelable: true,
          phase: 'stitching',
          title: 'Assembling MegaTiles',
          subtitle: 'Lossless Canvas Compilation',
          phaseBadge: 'Stage 2 of 2: MegaTile Stitch',
          info: `Assembling MegaTile layer ${done} of ${total}...`,
          pct,
          done,
          total,
          remainingTiles: Math.max(0, total - done),
          downloadedMB: estimatedMB,
          totalMB: estimatedMB,
          remainingMB: 0,
          speed: 'Stitching',
          eta: 'Compiling',
          resolution: resolutionStr
        });
      }, snapshot.sourceTileSize);
      const coverage = stitcher.getCoverageReport();
      if (!tiles.length || coverage.some(report =>
        report.decodedCount !== report.expectedCount ||
        JSON.stringify((report.decodedCells || []).slice().sort()) !==
          JSON.stringify((report.expectedCells || []).slice().sort())
      )) {
        throw new Error('MegaTile coverage validation failed. No AE mutation was performed.');
      }
      return { tiles, coverage, revisionDir };
    } finally {
      stitcher.destroy();
    }
  }

  _validateStitchedAssetIds(stitchedTiles, coverage) {
    if (!Array.isArray(stitchedTiles) || stitchedTiles.length === 0) {
      const error = new Error('Finalize stitched tile set is empty.');
      error.code = 'FINALIZE_EMPTY_STITCHED_SET';
      throw error;
    }
    const assetIds = stitchedTiles.map(t => String(t.placementKey || t.downloadKey || t.filePath || '')).filter(Boolean);
    const uniqueAssetIds = new Set(assetIds);
    if (uniqueAssetIds.size !== assetIds.length) {
      const error = new Error('Finalize stitched tiles contain duplicate asset identities.');
      error.code = 'FINALIZE_DUPLICATE_ASSET_IDS';
      error.details = { total: assetIds.length, unique: uniqueAssetIds.size };
      throw error;
    }
    if (!Array.isArray(coverage) || coverage.length === 0) {
      const error = new Error('Finalize coverage report is missing.');
      error.code = 'FINALIZE_COVERAGE_MISSING';
      throw error;
    }
    for (const report of coverage) {
      if (report.expectedCount === undefined || report.decodedCount === undefined) {
        const error = new Error('Finalize coverage report is missing cell counts.');
        error.code = 'FINALIZE_COVERAGE_INCOMPLETE';
        throw error;
      }
      if (report.decodedCount !== report.expectedCount) {
        const error = new Error(`Finalize MegaTile decoded ${report.decodedCount}/${report.expectedCount} expected cells.`);
        error.code = 'FINALIZE_MEGATILE_INCOMPLETE';
        error.details = { decodedCount: report.decodedCount, expectedCount: report.expectedCount };
        throw error;
      }
    }
  }

  async prepareComposition(megaTiles, activeCompId, snapshot, revisionId) {
    globalEventBus.emit('ui:status', { message: `Finalize: Preparing ${megaTiles.length} hidden AE layers...`, isError: false });
    const payloadObject = {
      operationId: revisionId,
      tiles: megaTiles,
      source: snapshot.sourceKey,
      documentId: snapshot.documentId,
      compId: activeCompId,
      compSettings: {
        width: snapshot.composition.width,
        height: snapshot.composition.height
      }
    };

    const prepareTimeoutMs = Math.max(90000, megaTiles.length * 3000);
    return this.app.aeBridge.invokeWithPayloadFile(
      'composition.prepare', payloadObject, this.app.jobManager, { timeoutMs: prepareTimeoutMs }
    );
  }

  async commitComposition(expected, activeCompId, snapshot, revisionId) {
    globalEventBus.emit('ui:status', { message: 'Finalize: Committing verified AE revision...', isError: false });
    globalEventBus.emit('ui:download_modal', {
      show: true,
      cancelable: false,
      info: 'Committing verified revision in After Effects...',
      pct: 100,
      done: expected,
      total: expected
    });
    const commitTimeoutMs = Math.max(90000, expected * 2000);
    return this.app.aeBridge.invoke('composition.commit', {
      operationId: revisionId,
      documentId: snapshot.documentId,
      compId: activeCompId,
      expected,
      source: snapshot.sourceKey,
      metadata: this.app.metadataManager.serializeState(
        this.app.metadataManager.createSnapshotState(snapshot, true, revisionId)
      )
    }, { timeoutMs: commitTimeoutMs });
  }

  async evaluateFinalizeBudget(plan, snapshot, options = {}) {
    let budgetConfig = null;
    try {
      if (this.app && this.app.config) {
        budgetConfig = this.app.config;
      } else if (typeof require !== 'undefined') {
        const path = require('path');
        const fs = require('fs');
        const candidates = [
          path.resolve(__dirname, '../../../config/performance-budgets.json'),
          path.resolve(__dirname, '../../config/performance-budgets.json'),
          path.resolve(__dirname, '../config/performance-budgets.json'),
          path.resolve(process.cwd(), 'config/performance-budgets.json'),
          path.resolve(process.cwd(), '../config/performance-budgets.json')
        ];
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            budgetConfig = JSON.parse(fs.readFileSync(c, 'utf8'));
            break;
          }
        }
      }
    } catch (_e) {}

    const preflight = (budgetConfig && budgetConfig.preflight) || {};
    const fourKConfig = (budgetConfig && budgetConfig.fourK) || {};
    const is4K = snapshot && snapshot.composition && (snapshot.composition.width >= 3840 || snapshot.composition.height >= 2160);
    const quality = (snapshot && snapshot.quality) || 'normal';

    let softLimit = (preflight.uniqueDownloadCacheMisses && preflight.uniqueDownloadCacheMisses.soft) || 2500;
    let hardLimit = (preflight.uniqueDownloadCacheMisses && preflight.uniqueDownloadCacheMisses.hard) || 20000;

    if (is4K && fourKConfig.tileBudgetByQuality && fourKConfig.tileBudgetByQuality[quality]) {
      softLimit = fourKConfig.tileBudgetByQuality[quality];
      hardLimit = Math.max(hardLimit, fourKConfig.tileBudgetByQuality.ultra || 25000);
    }

    const estimatedDownloads = (plan && plan.length) || 0;
    let userConfirmed = (options && options.userConfirmed === true) || (snapshot && snapshot.userConfirmed === true);

    if (estimatedDownloads > hardLimit) {
      const error = new Error(`Finalize requires ${estimatedDownloads} tiles, exceeding the hard budget limit of ${hardLimit}.`);
      error.code = 'FINALIZE_HARD_BUDGET_EXCEEDED';
      throw error;
    }

    if (estimatedDownloads > softLimit && !userConfirmed) {
      if (this.app && this.app.dialog && typeof this.app.dialog.confirm === 'function') {
        const estMB = (estimatedDownloads * 0.15).toFixed(1);
        const confirmed = await this.app.dialog.confirm({
          title: 'Finalize Download Budget',
          message: `This finalize plan requires downloading ${estimatedDownloads.toLocaleString()} tiles (exceeds the soft limit of ${softLimit.toLocaleString()} tiles).\n\nEstimated download size: ~${estMB} MB.\n\nDo you want to proceed with downloading these tiles?`,
          confirmLabel: 'Proceed with Download',
          cancelLabel: 'Cancel'
        });
        if (confirmed) {
          userConfirmed = true;
          if (options && typeof options === 'object' && !Object.isFrozen(options)) {
            options.userConfirmed = true;
          }
          if (snapshot && typeof snapshot === 'object' && !Object.isFrozen(snapshot)) {
            snapshot.userConfirmed = true;
          }
        } else {
          const cancelError = new Error('Finalize cancelled by user.');
          cancelError.code = 'FINALIZE_USER_CANCELLED';
          throw cancelError;
        }
      }
    }

    if (estimatedDownloads > softLimit && !userConfirmed) {
      if (typeof globalEventBus !== 'undefined') {
        globalEventBus.emit('ui:status', {
          message: `Finalize: plan (${estimatedDownloads} tiles) exceeds softLimit of ${softLimit}; user confirmation required.`,
          isError: true
        });
      }
      const confirmError = new Error(`Finalize plan of ${estimatedDownloads} tiles exceeds softLimit of ${softLimit} and requires user confirmation or approval.`);
      confirmError.code = 'FINALIZE_SOFT_BUDGET_UNCONFIRMED';
      confirmError.softLimit = softLimit;
      confirmError.estimatedDownloads = estimatedDownloads;
      throw confirmError;
    }

    return { estimatedDownloads, softLimit, hardLimit, userConfirmed };
  }

  _assertTypedImportResult(result, expected, revisionId, phase, expectedAssetIds) {
    const failed = result && Array.isArray(result.failed) ? result.failed : [];
    const valid = result && result.ok === true &&
      result.operationId === revisionId &&
      result.expected === expected &&
      result.imported === expected && failed.length === 0;
    if (!valid) {
      const firstFailure = failed.length ? failed[0].code : 'INVALID_HOST_RESULT';
      const error = new Error(`Finalize ${phase} failed (${firstFailure}); active Final revision was preserved.`);
      error.code = `FINALIZE_${String(phase).toUpperCase()}_FAILED`;
      error.details = result || null;
      throw error;
    }

    if (Array.isArray(expectedAssetIds) && expectedAssetIds.length > 0) {
      const actualIds = result && Array.isArray(result.assetIds) ? result.assetIds : [];
      let exactMatch = false;
      if (typeof CoverageContract !== 'undefined' && typeof CoverageContract.compareExactSets === 'function') {
        const check = CoverageContract.compareExactSets(expectedAssetIds, actualIds);
        exactMatch = check && check.ok === true;
      } else {
        const expectedSet = new Set(expectedAssetIds);
        const actualSet = new Set(actualIds);
        exactMatch = expectedSet.size === actualSet.size &&
          expectedAssetIds.every(id => actualSet.has(id)) &&
          actualIds.every(id => expectedSet.has(id));
      }
      if (!exactMatch) {
        const error = new Error(`Finalize ${phase} asset identities do not match planned asset set.`);
        error.code = `FINALIZE_${String(phase).toUpperCase()}_ASSET_ID_MISMATCH`;
        error.details = { expectedAssetIds, actualAssetIds: actualIds };
        throw error;
      }
    }
  }

  _safeIdentity(value) {
    return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  _rollbackTransaction(transaction) {
    if (!transaction || transaction.state === 'committed') return Promise.resolve(false);
    if (transaction.rollbackPromise) return transaction.rollbackPromise;
    const removeLocalRevision = () => {
      if (transaction.revisionDir) this._removeRevisionDirectory(transaction.revisionDir);
      transaction.revisionDir = null;
    };
    if (!transaction.hostPrepareStarted) {
      removeLocalRevision();
      transaction.rollbackPromise = Promise.resolve(true);
      return transaction.rollbackPromise;
    }
    transaction.rollbackPromise = this.app.aeBridge.invoke('composition.rollback', {
      operationId: transaction.revisionId,
      documentId: transaction.snapshot.documentId,
      compId: transaction.compId
    }, { timeoutMs: 60000 }).catch(error => {
      console.warn('[FinalizeController] Host rollback warning:', error);
      return false;
    }).then(result => {
      removeLocalRevision();
      return result;
    });
    return transaction.rollbackPromise;
  }

  async _reconcileCommit(transaction) {
    try {
      return await this.app.aeBridge.invoke('composition.getRevision', {
        operationId: transaction.revisionId,
        documentId: transaction.snapshot.documentId,
        compId: transaction.compId
      }, { timeoutMs: 30000 });
    } catch (error) {
      console.warn('[FinalizeController] Commit reconciliation failed:', error);
      return null;
    }
  }

  _cleanupPreviousRevision(projectPath, documentId, previousRevision, currentRevision) {
    if (this._commitState !== 'committed') return;
    if (!previousRevision || previousRevision === 'legacy' || previousRevision === currentRevision) return;
    const path = require('path');
    const root = path.resolve(projectPath, 'OpenGeo_Assets', 'MegaTiles');
    const previousDir = path.resolve(root, this._safeIdentity(documentId), this._safeIdentity(previousRevision));
    this._removeRevisionDirectory(previousDir, root);
  }

  _removeRevisionDirectory(directory, knownRoot) {
    if (!directory) return false;
    try {
      const fs = require('fs');
      const path = require('path');
      const resolvedDirectory = path.resolve(directory);
      const root = knownRoot
        ? path.resolve(knownRoot)
        : path.resolve(resolvedDirectory, '..', '..');
      if (resolvedDirectory === root || resolvedDirectory.indexOf(root + path.sep) !== 0 || !fs.existsSync(resolvedDirectory)) return false;
      if (typeof fs.rmSync === 'function') {
        fs.rmSync(resolvedDirectory, { recursive: true, force: true });
      } else {
        for (const entryName of fs.readdirSync(resolvedDirectory)) {
          const entryPath = path.join(resolvedDirectory, entryName);
          const stat = fs.statSync(entryPath);
          if (stat.isDirectory()) {
            this._removeRevisionDirectory(entryPath, root);
          } else {
            fs.unlinkSync(entryPath);
          }
        }
        if (fs.existsSync(resolvedDirectory)) fs.rmdirSync(resolvedDirectory);
      }
      const documentDir = path.dirname(resolvedDirectory);
      if (fs.existsSync(documentDir) && fs.readdirSync(documentDir).length === 0) {
        if (typeof fs.rmSync === 'function') {
          fs.rmSync(documentDir, { recursive: true, force: true });
        } else {
          fs.rmdirSync(documentDir);
        }
      }
      return true;
    } catch (error) {
      console.warn('[FinalizeController] Revision directory cleanup warning:', error);
      return false;
    }
  }

  handleFinalizeError(error) {
    if (error && error.code === 'FINALIZE_USER_CANCELLED') {
      console.log('[FinalizeController] Finalize cancelled by user.');
      if (typeof globalEventBus !== 'undefined') {
        globalEventBus.emit('ui:status', {
          message: 'Finalize cancelled by user.',
          isError: false
        });
      }
      return;
    }
    console.error('[FinalizeController] Error:', error);
    const needsReconciliation = error && error.code === 'FINALIZE_RECONCILIATION_REQUIRED';
    globalEventBus.emit('toast:show', {
      message: needsReconciliation ? error.message : `Finalize failed: ${error.message}`,
      type: needsReconciliation ? 'warning' : 'error',
      duration: needsReconciliation ? 10000 : 7000
    });
    globalEventBus.emit('ui:status', {
      message: needsReconciliation ? 'Finalize requires AE revision reconciliation.' : 'Finalize aborted due to error.',
      isError: true
    });
  }

  closeProgressUI() {
    globalEventBus.emit('ui:download_modal', { show: false });
  }

  async _autoCaptureThumbnail(activeCompId, snapshot, trajectory) {
    try {
      const assets = this._lastFinalizeAssets || null;
      if (!this.app || !this.app.aeBridge) return;
      const documentId = snapshot && snapshot.documentId;
      if (!documentId) return;

      const prep = await this.app.aeBridge.invoke('project.prepareOpenGeoMapThumbnail', {
        compId: activeCompId,
        documentId: documentId
      }, { timeoutMs: 15000 });

      if (!prep || !prep.thumbnailTargetPath) return;

      const processor = (this.app.projectMapsPanel && this.app.projectMapsPanel.thumbnailProcessor) ||
        (typeof ThumbnailProcessor !== 'undefined' ? new ThumbnailProcessor() : null);
      if (!processor) return;

      const sourceCanvas = this.app.mapRenderer && this.app.mapRenderer.canvas;
      if (!sourceCanvas) return;

      const captureOptions = {
        viewportWidth: this.app.viewport && this.app.viewport.width,
        viewportHeight: this.app.viewport && this.app.viewport.height,
        frameWidth: this.app.mapState && this.app.mapState.frameWidth,
        frameHeight: this.app.mapState && this.app.mapState.frameHeight
      };

      // 1. Capture primary static cover thumbnail
      const optimized = await processor.captureCanvas(sourceCanvas, prep.thumbnailTargetPath, captureOptions);

      // 2. If animated trajectory exists (> 1 frame), generate real PNG sequence & filmstrip
      if (Array.isArray(trajectory) && trajectory.length > 1) {
        try {
          const sampleIndices = processor.sampleTrajectoryIndices(trajectory, 12);
          if (sampleIndices.length >= 2) {
            const frameCanvases = [];
            const aspect = (captureOptions.frameWidth && captureOptions.frameHeight)
              ? (Number(captureOptions.frameWidth) / Number(captureOptions.frameHeight))
              : (16 / 9);
            const frameW = 480;
            const frameH = Math.max(45, Math.round(frameW / (aspect > 0 ? aspect : (16 / 9))));
            const tileSize = (snapshot && snapshot.sourceTileSize) || 256;
            const imageCache = new Map();

            for (let i = 0; i < sampleIndices.length; i++) {
              const cam = trajectory[sampleIndices[i]];
              let frameCanvas = null;
              if (assets && assets.length > 0 && typeof processor.renderFrameFromTiles === 'function') {
                frameCanvas = await processor.renderFrameFromTiles(cam, assets, frameW, frameH, {
                  tileSize,
                  sourceCanvas,
                  imageCache
                });
              } else {
                frameCanvas = document.createElement('canvas');
                frameCanvas.width = frameW;
                frameCanvas.height = frameH;
                const fCtx = frameCanvas.getContext('2d');
                if (fCtx) fCtx.drawImage(sourceCanvas, 0, 0, frameW, frameH);
              }
              frameCanvases.push(frameCanvas);
            }

            // Save the high-quality PNG sequence (thumb_[docId]_0.png, thumb_[docId]_1.png, ...)
            const seqPattern = prep.thumbnailTargetPath.replace(/\.png$/i, '_%d.png');
            if (typeof processor.savePngSequence === 'function') {
              await processor.savePngSequence(frameCanvases, seqPattern);
            }

            // Also assemble filmstrip sprite sheet for backwards compatibility
            if (prep.thumbnailStripTargetPath && typeof processor.createFilmstrip === 'function') {
              await processor.createFilmstrip(frameCanvases, prep.thumbnailStripTargetPath, {
                frameWidth: frameW,
                frameHeight: frameH
              });
            }
          }
        } catch (seqErr) {
          console.warn('[FinalizeController] Motion sequence auto-generation skipped:', seqErr.message);
        }
      }

      // Notify ProjectMapsPanel of the fresh thumbnail revision
      if (typeof globalEventBus !== 'undefined') {
        globalEventBus.emit('project-maps:thumbnail-updated', {
          compId: activeCompId,
          documentId: documentId,
          revision: optimized && optimized.revision
        });
      }
    } catch (err) {
      console.warn('[FinalizeController] Auto-thumbnail capture skipped:', err && err.message);
    }
  }

  dispose() {
    if (this.isFinalizing) this.cancel();
    if (this._downloadSession) this._downloadSession.cancel();
    this._downloadSession = null;
  }

}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FinalizeController;
} else if (typeof window !== 'undefined') {
  window.FinalizeController = FinalizeController;
}
