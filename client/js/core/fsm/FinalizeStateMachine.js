/**
 * OpenGeo Finite State Machine — Finalize / Export Lifecycle
 * Replaces ad-hoc boolean flags with deterministic state verification,
 * preventing race conditions, overlapping exports, and invalid state transitions.
 */

const FinalizeState = Object.freeze({
  IDLE: 'IDLE',
  VALIDATING: 'VALIDATING',
  PLANNING: 'PLANNING',
  PREPARING_STAGE: 'PREPARING_STAGE',
  DOWNLOADING_TILES: 'DOWNLOADING_TILES',
  STITCHING_MEGATILES: 'STITCHING_MEGATILES',
  HOST_PREPARING: 'HOST_PREPARING',
  HOST_COMMITTING: 'HOST_COMMITTING',
  FINALIZED: 'FINALIZED',
  ROLLING_BACK: 'ROLLING_BACK',
  ROLLED_BACK: 'ROLLED_BACK'
});

class FinalizeStateMachine {
  constructor(options = {}) {
    this._state = FinalizeState.IDLE;
    this._history = [];
    this._maxHistory = options.maxHistory || 30;
    this._onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;

    this._transitions = {
      [FinalizeState.IDLE]: [FinalizeState.VALIDATING],
      [FinalizeState.VALIDATING]: [FinalizeState.PLANNING, FinalizeState.ROLLING_BACK, FinalizeState.IDLE],
      [FinalizeState.PLANNING]: [FinalizeState.PREPARING_STAGE, FinalizeState.ROLLING_BACK, FinalizeState.IDLE],
      [FinalizeState.PREPARING_STAGE]: [FinalizeState.DOWNLOADING_TILES, FinalizeState.ROLLING_BACK],
      [FinalizeState.DOWNLOADING_TILES]: [FinalizeState.STITCHING_MEGATILES, FinalizeState.ROLLING_BACK],
      [FinalizeState.STITCHING_MEGATILES]: [FinalizeState.HOST_PREPARING, FinalizeState.ROLLING_BACK],
      [FinalizeState.HOST_PREPARING]: [FinalizeState.HOST_COMMITTING, FinalizeState.ROLLING_BACK],
      [FinalizeState.HOST_COMMITTING]: [FinalizeState.FINALIZED, FinalizeState.ROLLING_BACK],
      [FinalizeState.FINALIZED]: [FinalizeState.IDLE],
      [FinalizeState.ROLLING_BACK]: [FinalizeState.ROLLED_BACK, FinalizeState.IDLE],
      [FinalizeState.ROLLED_BACK]: [FinalizeState.IDLE]
    };
  }

  get state() {
    return this._state;
  }

  get isBusy() {
    return this._state !== FinalizeState.IDLE &&
           this._state !== FinalizeState.FINALIZED &&
           this._state !== FinalizeState.ROLLED_BACK;
  }

  get canCancel() {
    return this._state !== FinalizeState.HOST_COMMITTING &&
           this._state !== FinalizeState.ROLLING_BACK &&
           this._state !== FinalizeState.ROLLED_BACK &&
           this._state !== FinalizeState.IDLE &&
           this._state !== FinalizeState.FINALIZED;
  }

  canTransition(targetState) {
    const allowed = this._transitions[this._state];
    return Array.isArray(allowed) && allowed.indexOf(targetState) !== -1;
  }

  transition(targetState, metadata = {}) {
    if (!this.canTransition(targetState)) {
      const error = new Error(`Invalid FinalizeStateMachine transition: ${this._state} -> ${targetState}`);
      error.code = 'FSM_ILLEGAL_TRANSITION';
      error.fromState = this._state;
      error.targetState = targetState;
      throw error;
    }

    const previousState = this._state;
    this._state = targetState;

    const transitionRecord = {
      from: previousState,
      to: targetState,
      timestamp: Date.now(),
      metadata: metadata || {}
    };

    this._history.push(transitionRecord);
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }

    if (this._onStateChange) {
      try {
        this._onStateChange(targetState, previousState, transitionRecord);
      } catch (cbErr) {
        // Callback errors should not disrupt the state machine
      }
    }

    return targetState;
  }

  reset() {
    this._state = FinalizeState.IDLE;
  }

  getHistory() {
    return this._history.slice();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FinalizeStateMachine, FinalizeState };
}

if (typeof window !== 'undefined') {
  window.FinalizeStateMachine = FinalizeStateMachine;
  window.FinalizeState = FinalizeState;
}
