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
  }

  /**
   * Main Orchestrator for the Finalize process.
   * Transforms timeline data into high-resolution local assets.
   */
  async finalize() {
    if (this.isFinalizing) {
      globalEventBus.emit('toast:show', { message: 'Finalize is already running.', type: 'warning' });
      return false;
    }

    this.isFinalizing = true;
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
        rollbackPromise: null
      };
      this._activeTransaction = transaction;

      // 2. Planning Phase
      const { trajectory, plan } = await this.scanTimeline(activeCompId, snapshot);
      this._assertCurrentRun(runId, activeCompId, documentId, snapshot);

      if (plan.length === 0) {
        throw new Error('No tiles calculated for download. Timeline might be empty.');
      }
      if (plan.length > 20000) {
        throw new Error(`Finalize requires ${plan.length} tiles, exceeding the 20,000 tile safety limit. Reduce the Work Area, quality, or camera travel.`);
      }

      // 3. Execution Phase (Download & Stitch)
      const assets = await this.downloadTiles(plan, snapshot);
      this._assertCurrentRun(runId, activeCompId, documentId, snapshot);
      const stitched = await this.stitchTiles(assets, projectPath, activeCompId, snapshot, transaction);
      this._assertCurrentRun(runId, activeCompId, documentId, snapshot);

      // 4. Atomic Host Transaction: hidden prepare, validated commit, cleanup.
      transaction.state = 'preparing';
      transaction.hostPrepareStarted = true;
      this._commitState = 'preparing';
      const prepareResult = await this.prepareComposition(
        stitched.tiles, activeCompId, snapshot, transaction.revisionId
      );
      this._assertTypedImportResult(prepareResult, stitched.tiles.length, transaction.revisionId, 'prepare');
      transaction.state = 'prepared';
      this._commitState = 'prepared';
      this._assertCurrentRun(runId, activeCompId, documentId, snapshot);

      transaction.state = 'commit-in-progress';
      this._commitState = 'commit-in-progress';
      const commitResult = await this.commitComposition(
        stitched.tiles.length, activeCompId, snapshot, transaction.revisionId
      );
      this._assertTypedImportResult(commitResult, stitched.tiles.length, transaction.revisionId, 'commit');
      if (commitResult.commitState !== 'committed') {
        const commitError = new Error('After Effects did not confirm the finalized revision commit.');
        commitError.code = 'FINALIZE_COMMIT_UNCONFIRMED';
        throw commitError;
      }
      transaction.state = 'committed';
      this._commitState = 'committed';

      this.app.session.setFinalized(true);
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
      this._cleanupPreviousRevision(projectPath, snapshot.documentId, commitResult.previousRevision, transaction.revisionId);
      transaction.revisionDir = null;
      globalEventBus.emit('toast:show', { message: 'Finalize completed successfully!', type: 'success' });
      return true;

    } catch (error) {
      if (transaction && transaction.state === 'commit-in-progress') {
        const reconciliation = await this._reconcileCommit(transaction);
        if (reconciliation && reconciliation.commitState === 'committed' &&
            reconciliation.activeRevision === transaction.revisionId) {
          transaction.state = 'committed';
          this._commitState = 'committed';
          this.app.session.setFinalized(true);
          if (reconciliation.metadataApplied !== true) {
            await this.app.metadataManager.saveSnapshotToComp(
              transaction.compId, transaction.snapshot, true, transaction.revisionId
            );
          }
          this.app.session.completeOperation('finalize', operationGeneration);
          transaction.revisionDir = null;
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
        await this._rollbackTransaction(transaction);
      }
      if (error && error.code === 'OPEN_GEO_FINALIZE_CANCELLED') return false;
      if (runId !== this._runId) return false;
      if (runId === this._runId) this.app.session.failOperation('finalize', operationGeneration, error && error.code ? error.code : 'FINALIZE_FAILED');
      this.handleFinalizeError(error);
      return false;
    } finally {
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
    if (this._commitState === 'commit-in-progress') {
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
    this._commitState = 'cancelled-before-commit';
    globalEventBus.emit('ui:status', { message: 'Finalize cancelled before commit.', isError: false });
    globalEventBus.emit('toast:show', {
      message: 'Finalize cancelled. The active Final revision remains unchanged.',
      type: 'info'
    });
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
    globalEventBus.emit('ui:download_modal', { show: true, cancelable: true, info: `Initializing download...`, pct: 0, done: 0, total: plan.length });
    
    // First pass returns the same canonical result contract used by Preview.
    const firstPass = await downloadSession.downloadPlan(plan, (done, total) => {
      if (!snapshot.isCurrent(this.app)) return;
      const pct = Math.round((done / total) * 100);
      globalEventBus.emit('ui:status', { message: `Downloading high quality tiles… ${pct}% (${done}/${total})`, isError: false });
      globalEventBus.emit('ui:download_modal', { show: true, cancelable: true, info: `Downloading tiles for final render...`, pct, done, total });
    });
    const normalizedPlan = firstPass.plan;
    let syncResult = firstPass.results;
    
    // Retry Logic for Partial Downloads
    const firstMissingKeys = new Set(firstPass.coverage.missingDownloadKeys);
    const failedTiles = normalizedPlan.filter(tile => firstMissingKeys.has(tile.downloadKey));
    if (failedTiles.length > 0) {
      if (!snapshot.isCurrent(this.app)) throw new Error('Map source changed during Finalize download.');
      globalEventBus.emit('ui:download_modal', { show: true, cancelable: true, info: `Retrying ${failedTiles.length} failed tiles...`, pct: 0, done: 0, total: failedTiles.length });
      const retryResult = await downloadSession.downloadTiles(failedTiles, () => {});
      syncResult = syncResult.concat(retryResult);
    }

    const okTiles = PlacementExpander.expandCompleted(normalizedPlan, syncResult);
    CoverageContract.assertCompleteCoverage(normalizedPlan, syncResult, okTiles);
    return okTiles;
  }

  async stitchTiles(assets, projectPath, activeCompId, snapshot, transaction) {
    globalEventBus.emit('ui:download_modal', { show: true, cancelable: true, info: `Stitching ${assets.length} tiles into MegaTiles...`, pct: 0, done: 0, total: 1 });
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
        globalEventBus.emit('ui:download_modal', { show: true, cancelable: true, info: `Stitching MegaTiles...`, pct, done, total });
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

    return this.app.aeBridge.invokeWithPayloadFile(
      'composition.prepare', payloadObject, this.app.jobManager, { timeoutMs: 90000 }
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
    return this.app.aeBridge.invoke('composition.commit', {
      operationId: revisionId,
      documentId: snapshot.documentId,
      compId: activeCompId,
      expected,
      source: snapshot.sourceKey,
      metadata: this.app.metadataManager.serializeState(
        this.app.metadataManager.createSnapshotState(snapshot, true, revisionId)
      )
    }, { timeoutMs: 90000 });
  }

  _assertTypedImportResult(result, expected, revisionId, phase) {
    const failed = result && Array.isArray(result.failed) ? result.failed : [];
    const valid = result && result.ok === true &&
      result.operationId === revisionId &&
      result.expected === expected &&
      result.imported === expected && failed.length === 0;
    if (valid) return;
    const firstFailure = failed.length ? failed[0].code : 'INVALID_HOST_RESULT';
    const error = new Error(`Finalize ${phase} failed (${firstFailure}); active Final revision was preserved.`);
    error.code = `FINALIZE_${String(phase).toUpperCase()}_FAILED`;
    error.details = result || null;
    throw error;
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
      for (const entryName of fs.readdirSync(resolvedDirectory)) {
        const entryPath = path.join(resolvedDirectory, entryName);
        if (fs.statSync(entryPath).isFile()) fs.unlinkSync(entryPath);
      }
      fs.rmdirSync(resolvedDirectory);
      const documentDir = path.dirname(resolvedDirectory);
      if (fs.existsSync(documentDir) && fs.readdirSync(documentDir).length === 0) fs.rmdirSync(documentDir);
      return true;
    } catch (error) {
      console.warn('[FinalizeController] Revision directory cleanup warning:', error);
      return false;
    }
  }

  handleFinalizeError(error) {
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
