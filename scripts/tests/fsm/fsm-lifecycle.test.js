'use strict';

/**
 * OpenGeo Automated Test Suite: FSM Governance & Lifecycle Safety
 * Verifies mathematical state transitions, transition invariants,
 * cancellation guards, and illegal transition rejections.
 */

const { FinalizeStateMachine, FinalizeState } = require('../../../client/js/core/fsm/FinalizeStateMachine');
const { SyncStateMachine, SyncState } = require('../../../client/js/core/fsm/SyncStateMachine');

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
console.log('[OpenGeo] Running FSM Lifecycle Test Suite...');
console.log('====================================');

// 1. FinalizeStateMachine: Initial State & Status Flags
{
  const fsm = new FinalizeStateMachine();
  assert(fsm.state === FinalizeState.IDLE, 'FinalizeStateMachine initializes in IDLE state');
  assert(!fsm.isBusy, 'FinalizeStateMachine is not busy in IDLE state');
  assert(!fsm.canCancel, 'Cannot cancel in IDLE state');
}

// 2. FinalizeStateMachine: Happy Path Lifecycle
{
  const events = [];
  const fsm = new FinalizeStateMachine({
    onStateChange: (to, from) => events.push(`${from}->${to}`)
  });

  fsm.transition(FinalizeState.VALIDATING);
  assert(fsm.state === FinalizeState.VALIDATING && fsm.isBusy && fsm.canCancel, 'Transitioned to VALIDATING: isBusy=true, canCancel=true');

  fsm.transition(FinalizeState.PLANNING);
  assert(fsm.state === FinalizeState.PLANNING && fsm.canCancel, 'Transitioned to PLANNING: canCancel=true');

  fsm.transition(FinalizeState.PREPARING_STAGE);
  assert(fsm.state === FinalizeState.PREPARING_STAGE, 'Transitioned to PREPARING_STAGE');

  fsm.transition(FinalizeState.DOWNLOADING_TILES);
  assert(fsm.state === FinalizeState.DOWNLOADING_TILES, 'Transitioned to DOWNLOADING_TILES');

  fsm.transition(FinalizeState.STITCHING_MEGATILES);
  assert(fsm.state === FinalizeState.STITCHING_MEGATILES, 'Transitioned to STITCHING_MEGATILES');

  fsm.transition(FinalizeState.HOST_PREPARING);
  assert(fsm.state === FinalizeState.HOST_PREPARING && fsm.canCancel, 'Transitioned to HOST_PREPARING: canCancel=true');

  fsm.transition(FinalizeState.HOST_COMMITTING);
  assert(fsm.state === FinalizeState.HOST_COMMITTING && !fsm.canCancel, 'Transitioned to HOST_COMMITTING: Atomic section blocks cancellation (canCancel=false)');

  fsm.transition(FinalizeState.FINALIZED);
  assert(fsm.state === FinalizeState.FINALIZED && !fsm.isBusy, 'Transitioned to FINALIZED: isBusy=false');

  fsm.transition(FinalizeState.IDLE);
  assert(fsm.state === FinalizeState.IDLE, 'Returned to IDLE successfully');
  assert(events.length === 9, 'All 9 lifecycle transitions triggered callbacks');
}

// 3. FinalizeStateMachine: Illegal Transition Rejection
{
  const fsm = new FinalizeStateMachine();
  let caught = false;
  try {
    fsm.transition(FinalizeState.HOST_COMMITTING); // Illegal skip from IDLE
  } catch (err) {
    caught = err.code === 'FSM_ILLEGAL_TRANSITION';
  }
  assert(caught, 'Rejects illegal direct transition from IDLE to HOST_COMMITTING');
  assert(fsm.state === FinalizeState.IDLE, 'State remains IDLE after rejected transition');
}

// 4. FinalizeStateMachine: Rollback Path
{
  const fsm = new FinalizeStateMachine();
  fsm.transition(FinalizeState.VALIDATING);
  fsm.transition(FinalizeState.PLANNING);
  fsm.transition(FinalizeState.PREPARING_STAGE);
  fsm.transition(FinalizeState.DOWNLOADING_TILES);

  // Failure occurs during tile download -> Rollback initiated
  fsm.transition(FinalizeState.ROLLING_BACK);
  assert(fsm.state === FinalizeState.ROLLING_BACK && !fsm.canCancel, 'Rolling back state active');

  fsm.transition(FinalizeState.ROLLED_BACK);
  assert(fsm.state === FinalizeState.ROLLED_BACK && !fsm.isBusy, 'Rolled back complete');

  fsm.transition(FinalizeState.IDLE);
  assert(fsm.state === FinalizeState.IDLE, 'Safely returned to IDLE after rollback');

  const history = fsm.getHistory();
  assert(history.length === 7, 'Audit history records all 7 rollback lifecycle events');
}

// 5. SyncStateMachine: Initial State & Detached Status
{
  const syncFsm = new SyncStateMachine();
  assert(syncFsm.state === SyncState.DETACHED, 'SyncStateMachine initializes in DETACHED state');
  assert(!syncFsm.isAttached, 'isAttached is false when DETACHED');
  assert(!syncFsm.isExporting, 'isExporting is false when DETACHED');
}

// 6. SyncStateMachine: Attachment & Timeline Scrub Workflow
{
  const syncFsm = new SyncStateMachine();

  syncFsm.transition(SyncState.ATTACHED_IDLE);
  assert(syncFsm.state === SyncState.ATTACHED_IDLE && syncFsm.isAttached, 'Attached to OpenGeo composition: isAttached=true');

  syncFsm.transition(SyncState.SCRUBBING_CTI);
  assert(syncFsm.state === SyncState.SCRUBBING_CTI, 'Transitioned to SCRUBBING_CTI on AE timeline move');

  syncFsm.transition(SyncState.QUEUEING_EXPORT);
  assert(syncFsm.state === SyncState.QUEUEING_EXPORT, 'Debounced timer ticks in QUEUEING_EXPORT');

  syncFsm.transition(SyncState.EXPORTING_PREVIEW);
  assert(syncFsm.state === SyncState.EXPORTING_PREVIEW && syncFsm.isExporting, 'Active export to AE sets isExporting=true');

  syncFsm.transition(SyncState.ATTACHED_IDLE);
  assert(syncFsm.state === SyncState.ATTACHED_IDLE && !syncFsm.isExporting, 'Export complete: returned to ATTACHED_IDLE');
}

// 7. SyncStateMachine: Keyframe Recording & Trajectory Workflow
{
  const syncFsm = new SyncStateMachine();
  syncFsm.transition(SyncState.ATTACHED_IDLE);

  syncFsm.transition(SyncState.RECORDING_KEYFRAMES);
  assert(syncFsm.state === SyncState.RECORDING_KEYFRAMES, 'Entered RECORDING_KEYFRAMES state');

  syncFsm.transition(SyncState.ATTACHED_IDLE);
  assert(syncFsm.state === SyncState.ATTACHED_IDLE, 'Exited recording back to ATTACHED_IDLE');

  syncFsm.transition(SyncState.CAPTURING_TRAJECTORY);
  assert(syncFsm.state === SyncState.CAPTURING_TRAJECTORY && syncFsm.isExporting, 'Entered CAPTURING_TRAJECTORY: isExporting=true');

  syncFsm.transition(SyncState.ATTACHED_IDLE);
  assert(syncFsm.state === SyncState.ATTACHED_IDLE, 'Trajectory capture completed');
}

// 8. SyncStateMachine: Immediate Detach Resilience
{
  const syncFsm = new SyncStateMachine();
  syncFsm.transition(SyncState.ATTACHED_IDLE);
  syncFsm.transition(SyncState.SCRUBBING_CTI);

  // User closes AE project or focuses a different comp
  syncFsm.transition(SyncState.DETACHED);
  assert(syncFsm.state === SyncState.DETACHED && !syncFsm.isAttached, 'Immediately detaches from SCRUBBING_CTI safely');
}

// 9. FinalizeController + FinalizeStateMachine Integration
{
  global.globalEventBus = { emit: () => {} };
  global.FinalizeStateMachine = FinalizeStateMachine;
  global.FinalizeState = FinalizeState;
  const FinalizeController = require('../../../client/js/core/FinalizeController');
  const mockApp = {
    session: {
      mapState: { compZoom: 10, latitude: 48.85, longitude: 2.35 },
      beginOperation: () => 1,
      completeOperation: () => {},
      failOperation: () => {}
    }
  };
  const controller = new FinalizeController(mockApp);
  assert(controller.fsm !== null, 'FinalizeController successfully initializes FSM when available in scope');
  assert(controller.fsm.state === FinalizeState.IDLE, 'FinalizeController starts in IDLE state');
  assert(controller._commitState === 'idle', 'Controller _commitState starts in idle');

  // Verify cancel() pre-commit
  controller.isFinalizing = true;
  controller._commitState = 'preparing';
  controller.fsm.transition(FinalizeState.VALIDATING);
  controller.fsm.transition(FinalizeState.PLANNING);
  controller.fsm.transition(FinalizeState.PREPARING_STAGE);
  controller.fsm.transition(FinalizeState.DOWNLOADING_TILES);
  const cancelSuccess = controller.cancel();
  assert(cancelSuccess === true, 'controller.cancel() returns true before commit');
  assert(controller._commitState === 'cancelled-before-commit', 'controller._commitState updated to cancelled-before-commit');

  // Complete rollback and reset to IDLE for next run
  controller.fsm.transition(FinalizeState.ROLLED_BACK);
  controller.fsm.transition(FinalizeState.IDLE);

  // Verify cancel() rejected during HOST_COMMITTING
  controller.isFinalizing = true;
  controller._commitState = 'commit-in-progress';
  controller.fsm.transition(FinalizeState.VALIDATING);
  controller.fsm.transition(FinalizeState.PLANNING);
  controller.fsm.transition(FinalizeState.PREPARING_STAGE);
  controller.fsm.transition(FinalizeState.DOWNLOADING_TILES);
  controller.fsm.transition(FinalizeState.STITCHING_MEGATILES);
  controller.fsm.transition(FinalizeState.HOST_PREPARING);
  controller.fsm.transition(FinalizeState.HOST_COMMITTING);
  const cancelBlocked = controller.cancel();
  assert(cancelBlocked === false, 'controller.cancel() returns false during atomic HOST_COMMITTING');
  assert(controller._commitState === 'commit-in-progress', 'controller._commitState remains commit-in-progress');
}

// 10. SyncManager + SyncStateMachine Integration
{
  global.SyncStateMachine = SyncStateMachine;
  global.SyncState = SyncState;
  const SyncManager = require('../../../client/js/core/SyncManager');
  const mockApp = {
    activeCompId: 42,
    finalizeController: { isFinalizing: false },
    session: {
      mapState: { compZoom: 10, latitude: 48.85, longitude: 2.35, tileSize: 256 },
      isFinalized: false,
      operations: { sync: 'idle', preview: 'idle' },
      generations: { sync: 1, preview: 1 },
      nextGeneration: () => 2,
      cancelOperation: () => true
    }
  };
  const syncManager = new SyncManager(mockApp);
  assert(syncManager.fsm !== null, 'SyncManager initializes SyncStateMachine');
  assert(syncManager.fsm.state === SyncState.ATTACHED_IDLE, 'SyncManager enters ATTACHED_IDLE when activeCompId is set');
  assert(syncManager.fsm.isAttached, 'SyncManager reports isAttached=true');

  syncManager.queueAutoExport();
  assert(syncManager.fsm.state === SyncState.QUEUEING_EXPORT, 'queueAutoExport() transitions to QUEUEING_EXPORT');

  syncManager.prepareForKeyframeMutation();
  assert(syncManager.fsm.state === SyncState.RECORDING_KEYFRAMES, 'prepareForKeyframeMutation() transitions to RECORDING_KEYFRAMES');

  syncManager.invalidateBackgroundWork();
  assert(syncManager.fsm.state === SyncState.ATTACHED_IDLE, 'invalidateBackgroundWork() safely returns to ATTACHED_IDLE');

  syncManager.dispose();
  assert(syncManager.fsm.state === SyncState.DETACHED, 'dispose() transitions to DETACHED');
  assert(!syncManager.fsm.isAttached, 'isAttached is false after dispose()');
}

console.log('====================================');
console.log(`FSM Lifecycle Tests: Passed: ${passed} | Failed: ${failed}`);
console.log('====================================');

if (failed > 0) {
  process.exit(1);
}
