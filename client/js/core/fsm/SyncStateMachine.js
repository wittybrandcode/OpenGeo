/**
 * OpenGeo Finite State Machine — Camera & Timeline Synchronization Lifecycle
 * Replaces ad-hoc boolean locks with formal state verification,
 * preventing race conditions during timeline scrubs, keyframe recording, and previews.
 */

const SyncState = Object.freeze({
  DETACHED: 'DETACHED',
  ATTACHED_IDLE: 'ATTACHED_IDLE',
  SCRUBBING_CTI: 'SCRUBBING_CTI',
  QUEUEING_EXPORT: 'QUEUEING_EXPORT',
  EXPORTING_PREVIEW: 'EXPORTING_PREVIEW',
  RECORDING_KEYFRAMES: 'RECORDING_KEYFRAMES',
  CAPTURING_TRAJECTORY: 'CAPTURING_TRAJECTORY'
});

class SyncStateMachine {
  constructor(options = {}) {
    this._state = SyncState.DETACHED;
    this._history = [];
    this._maxHistory = options.maxHistory || 30;
    this._onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;

    this._transitions = {
      [SyncState.DETACHED]: [SyncState.ATTACHED_IDLE],
      [SyncState.ATTACHED_IDLE]: [
        SyncState.DETACHED,
        SyncState.SCRUBBING_CTI,
        SyncState.QUEUEING_EXPORT,
        SyncState.EXPORTING_PREVIEW,
        SyncState.RECORDING_KEYFRAMES,
        SyncState.CAPTURING_TRAJECTORY
      ],
      [SyncState.SCRUBBING_CTI]: [
        SyncState.ATTACHED_IDLE,
        SyncState.QUEUEING_EXPORT,
        SyncState.CAPTURING_TRAJECTORY,
        SyncState.DETACHED
      ],
      [SyncState.QUEUEING_EXPORT]: [
        SyncState.EXPORTING_PREVIEW,
        SyncState.CAPTURING_TRAJECTORY,
        SyncState.RECORDING_KEYFRAMES,
        SyncState.ATTACHED_IDLE,
        SyncState.DETACHED
      ],
      [SyncState.EXPORTING_PREVIEW]: [
        SyncState.ATTACHED_IDLE,
        SyncState.DETACHED
      ],
      [SyncState.RECORDING_KEYFRAMES]: [
        SyncState.ATTACHED_IDLE,
        SyncState.CAPTURING_TRAJECTORY,
        SyncState.QUEUEING_EXPORT,
        SyncState.DETACHED
      ],
      [SyncState.CAPTURING_TRAJECTORY]: [
        SyncState.ATTACHED_IDLE,
        SyncState.DETACHED
      ]
    };
  }

  get state() {
    return this._state;
  }

  get isAttached() {
    return this._state !== SyncState.DETACHED;
  }

  get isExporting() {
    return this._state === SyncState.EXPORTING_PREVIEW ||
           this._state === SyncState.CAPTURING_TRAJECTORY;
  }

  canTransition(targetState) {
    if (targetState === SyncState.DETACHED) return true; // Always allow detachment
    if (targetState === this._state) return true; // Idempotent self-transition
    const allowed = this._transitions[this._state];
    return Array.isArray(allowed) && allowed.indexOf(targetState) !== -1;
  }

  transition(targetState, metadata = {}) {
    if (targetState === this._state) return;
    if (!this.canTransition(targetState)) {
      const error = new Error(`Invalid SyncStateMachine transition: ${this._state} -> ${targetState}`);
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

  detach() {
    this._state = SyncState.DETACHED;
  }

  reset() {
    this._state = SyncState.DETACHED;
  }

  getHistory() {
    return this._history.slice();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SyncStateMachine, SyncState };
}

if (typeof window !== 'undefined') {
  window.SyncStateMachine = SyncStateMachine;
  window.SyncState = SyncState;
}
