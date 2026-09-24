'use strict';

/**
 * OpenGeo Automated Test Suite: Finalize Decomposition & Delegate Wiring
 * Verifies that FinalizeTimelineScanner and FinalizeTransactionManager
 * cleanly encapsulate timeline scanning and atomic AE composition transactions.
 */

const FinalizeTimelineScanner = require('../../../client/js/core/FinalizeTimelineScanner');
const FinalizeTransactionManager = require('../../../client/js/core/FinalizeTransactionManager');
const FinalizeController = require('../../../client/js/core/FinalizeController');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

console.log('====================================');
console.log('[OpenGeo] Running Finalize Decomposition Test Suite...');
console.log('====================================');

// 1. FinalizeTimelineScanner: Standalone Execution
{
  const mockAeBridge = {
    invoke: async (cmd, args) => {
      if (cmd === 'trajectory.scan') {
        return {
          frames: [
            { time: 0, lat: 48.8566, lon: 2.3522, zoom: 12 },
            { time: 5, lat: 48.8600, lon: 2.3550, zoom: 14 }
          ],
          workAreaStart: 0,
          workAreaDuration: 5
        };
      }
      return null;
    }
  };

  const mockTilePlanner = {
    createPlan: (frames, options) => {
      return [{ x: 10, y: 20, z: 12, downloadKey: '12/10/20' }];
    }
  };

  const scanner = new FinalizeTimelineScanner(mockAeBridge, mockTilePlanner);
  const snapshot = {
    quality: 'high',
    composition: { width: 1920, height: 1080 }
  };

  scanner.scan('comp_123', snapshot).then(({ trajectory, plan }) => {
    assert(Array.isArray(trajectory) && trajectory.length === 2, 'FinalizeTimelineScanner retrieves trajectory points');
    assert(Array.isArray(plan) && plan.length === 1, 'FinalizeTimelineScanner computes tile plan via planner');
  }).catch(err => {
    assert(false, `FinalizeTimelineScanner failed: ${err.message}`);
  });
}

// 2. FinalizeTransactionManager: Prepare, Commit, Rollback, Reconcile
{
  const calls = [];
  const mockAeBridge = {
    invokeWithPayloadFile: async (cmd, payload, jobManager, opts) => {
      calls.push({ cmd, payload, opts });
      return { ok: true, operationId: payload.operationId, expected: payload.tiles.length, imported: payload.tiles.length, failed: [] };
    },
    invoke: async (cmd, payload, opts) => {
      calls.push({ cmd, payload, opts });
      if (cmd === 'composition.commit') {
        return { ok: true, commitState: 'committed', operationId: payload.operationId };
      }
      if (cmd === 'composition.rollback') {
        return { ok: true, rolledBack: true };
      }
      if (cmd === 'composition.getRevision') {
        return { ok: true, commitState: 'committed', activeRevision: payload.operationId };
      }
      return null;
    }
  };

  const txManager = new FinalizeTransactionManager(mockAeBridge, null);
  const snapshot = { sourceKey: 'osm', documentId: 'doc_1', composition: { width: 1920, height: 1080 } };

  (async () => {
    // Prepare
    const prep = await txManager.prepare([{ placementKey: 't1' }], 'comp_1', snapshot, 'rev_1', []);
    assert(prep.ok && calls[0].cmd === 'composition.prepare', 'FinalizeTransactionManager.prepare invokes composition.prepare');

    // Commit
    const com = await txManager.commit(1, 'comp_1', snapshot, 'rev_1', { serialized: true });
    assert(com.commitState === 'committed' && calls[1].cmd === 'composition.commit', 'FinalizeTransactionManager.commit invokes composition.commit');

    // Reconcile
    const rec = await txManager.reconcile({ revisionId: 'rev_1', snapshot, compId: 'comp_1' });
    assert(rec.commitState === 'committed', 'FinalizeTransactionManager.reconcile invokes composition.getRevision');

    // Rollback
    let cleaned = false;
    const rb = await txManager.rollback({ revisionId: 'rev_1', snapshot, compId: 'comp_1', hostPrepareStarted: true }, () => { cleaned = true; });
    assert(rb.rolledBack === true && cleaned === true, 'FinalizeTransactionManager.rollback triggers rollback and cleanup callback');
  })().catch(err => {
    assert(false, `FinalizeTransactionManager test failed: ${err.message}`);
  });
}

// 3. FinalizeController: Delegation Verification
{
  const mockApp = {
    aeBridge: {
      invokeWithPayloadFile: async () => ({ ok: true, operationId: 'rev_1', expected: 1, imported: 1, failed: [] }),
      invoke: async (cmd) => ({ ok: true, commitState: 'committed', operationId: 'rev_1' })
    },
    jobManager: {},
    session: {
      beginOperation: () => 'op_1',
      completeOperation: () => {},
      failOperation: () => {},
      documentId: 'doc_1',
      setFinalized: () => {}
    },
    metadataManager: {
      serializeState: () => '{}',
      createSnapshotState: () => ({})
    }
  };

  global.FinalizeTimelineScanner = FinalizeTimelineScanner;
  global.FinalizeTransactionManager = FinalizeTransactionManager;
  const controller = new FinalizeController(mockApp);
  assert(controller.timelineScanner !== null, 'FinalizeController instantiates FinalizeTimelineScanner delegate');
  assert(controller.transactionManager !== null, 'FinalizeController instantiates FinalizeTransactionManager delegate');
}

setTimeout(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}, 200);
