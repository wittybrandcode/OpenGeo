/**
 * AESyncEngine — always-on, bi-directional camera synchronization.
 *
 * Panel writes carry a monotonic revision. After Effects persists that
 * revision beside the controller values and echoes it from camera.getActive.
 * This lets us suppress only the exact write echo instead of dropping every
 * AE camera change inside an arbitrary time window.
 */
class AESyncEngine {
  constructor(aeBridge, session) {
    this.aeBridge = aeBridge;
    this.session = session;

    this.isRunning = false;
    this.isKeyframeRecording = false;
    this._recordingByComp = new Map();
    this.isApplyingAeState = false;

    this._syncTimer = null;
    this._cameraPushTimer = null;
    this._pendingCamera = null;
    this._pollInFlight = false;
    this._pollEpoch = 0;
    this._suspendActiveCompPolling = false;

    this._lastAeCamState = null;
    this._activeControllerId = null;
    this._revisionModulus = 1000000;
    this._revisionClock = Math.floor(Date.now() / 1000) % 900000;
    this._cameraWrites = new Map();
    this._lastAcknowledgedRevision = 0;
    this._latestLocalIntentRevision = 0;
    this._detachedAeCamera = null;

    this._pollBaseIntervalMs = 500;
    this._pollMaxIntervalMs = 5000;
    this._pollFailureCount = 0;
    this._pollHealth = 'healthy';
    this._lastPollDurationMs = 0;

    if (typeof globalEventBus !== 'undefined') {
      const events = typeof OpenGeoEvents !== 'undefined' ? OpenGeoEvents : { VIEWPORT_CHANGED: 'viewport:changed' };
      this._unsubscribeViewport = globalEventBus.on(events.VIEWPORT_CHANGED, () => this._onPanelViewportChanged());
    }
  }

  setActiveComp(compId) {
    this._pollEpoch += 1;
    const existing = this.session.composition || {};
    if (existing.compId !== compId) {
      this.session.setComposition(Object.assign({}, existing, { compId }));
      this._resetCameraProtocol();
    }
    this.isKeyframeRecording = this.isKeyframeRecordingEnabled(compId);
    if (compId) this._suspendActiveCompPolling = false;
  }

  beginNewDocument() {
    this._pollEpoch += 1;
    this._suspendActiveCompPolling = true;
    this._lastAeCamState = null;
    this._activeControllerId = null;
    this._pendingCamera = null;
    this._cameraWrites.clear();
    this._latestLocalIntentRevision = 0;
    this._detachedAeCamera = null;
    this.isKeyframeRecording = false;
    if (this._cameraPushTimer) clearTimeout(this._cameraPushTimer);
    this._cameraPushTimer = null;
  }

  cancelNewDocument() {
    this._suspendActiveCompPolling = false;
  }

  getActiveCompId() {
    return this.session.composition && this.session.composition.compId;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._schedulePoll(0);
  }

  setKeyframeRecording(enabled, compId) {
    const targetCompId = compId === undefined ? this.getActiveCompId() : compId;
    if (!targetCompId) {
      this.isKeyframeRecording = false;
      return false;
    }
    const key = String(targetCompId);
    if (enabled) this._recordingByComp.set(key, true);
    else this._recordingByComp.delete(key);
    if (String(this.getActiveCompId() || '') === key) this.isKeyframeRecording = !!enabled;
    return !!enabled;
  }

  isKeyframeRecordingEnabled(compId) {
    const targetCompId = compId === undefined ? this.getActiveCompId() : compId;
    return !!targetCompId && this._recordingByComp.get(String(targetCompId)) === true;
  }

  getHealth() {
    return {
      state: this._pollHealth,
      consecutiveFailures: this._pollFailureCount,
      lastDurationMs: this._lastPollDurationMs,
      nextIntervalMs: this._getNextPollDelay()
    };
  }

  _schedulePoll(delayMs) {
    if (!this.isRunning || this._syncTimer) return;
    this._syncTimer = setTimeout(() => {
      this._syncTimer = null;
      this._pollAfterEffects();
    }, Math.max(0, delayMs));
  }

  _stopPolling() {
    this._pollEpoch += 1;
    if (this._syncTimer) clearTimeout(this._syncTimer);
    if (this._cameraPushTimer) clearTimeout(this._cameraPushTimer);
    this._syncTimer = null;
    this._cameraPushTimer = null;
    this._pendingCamera = null;
    this._cameraWrites.clear();
    this._latestLocalIntentRevision = 0;
    this._detachedAeCamera = null;
  }

  _nextRevision() {
    this._revisionClock = (this._revisionClock + 1) % this._revisionModulus;
    if (this._revisionClock === 0) this._revisionClock = 1;
    return this._revisionClock;
  }

  _isRevisionAfter(candidate, reference) {
    const left = Number(candidate);
    const right = Number(reference);
    if (!isFinite(left) || !isFinite(right) || left === right) return false;
    const delta = (left - right + this._revisionModulus) % this._revisionModulus;
    return delta > 0 && delta < this._revisionModulus / 2;
  }

  _acknowledgeRevision(revision) {
    const normalized = Number(revision);
    if (!isFinite(normalized) || normalized < 0 || normalized >= this._revisionModulus) return;
    if (this._lastAcknowledgedRevision === 0 || normalized === this._lastAcknowledgedRevision ||
        this._isRevisionAfter(normalized, this._lastAcknowledgedRevision)) {
      this._lastAcknowledgedRevision = normalized;
    }
  }

  async _onPanelViewportChanged() {
    const compId = this.getActiveCompId();
    if (!this.isRunning || !compId || this.isApplyingAeState) return;
    this._pendingCamera = {
      compId,
      lat: this.session.mapState.latitude,
      lng: this.session.mapState.longitude,
      zoom: this.session.mapState.compZoom,
      recordKeyframe: this.isKeyframeRecording,
      revision: this._nextRevision()
    };
    // A poll that started before this local intent is necessarily stale, even
    // while the debounced write has not reached After Effects yet.
    this._latestLocalIntentRevision = this._pendingCamera.revision;
    this._detachedAeCamera = null;

    clearTimeout(this._cameraPushTimer);
    this._cameraPushTimer = setTimeout(async () => {
      this._cameraPushTimer = null;
      const camera = this._pendingCamera;
      this._pendingCamera = null;
      if (!camera || !this.isRunning || camera.compId !== this.getActiveCompId()) return;

      this._cameraWrites.set(camera.revision, camera);
      this._pruneCameraWrites();
      try {
        const result = await this.aeBridge.invoke('camera.update', camera, { timeoutMs: 10000 });
        if (result && result.applied === false) {
          this._cameraWrites.delete(camera.revision);
          if (camera.revision === this._latestLocalIntentRevision) {
            this._latestLocalIntentRevision = this._lastAcknowledgedRevision;
            this._detachedAeCamera = result.camera || null;
          }
          return;
        }
        if (result && result.camera) {
          this._cameraWrites.set(camera.revision, Object.assign({}, camera, result.camera));
        }
        if (result && isFinite(Number(result.appliedRevision))) {
          this._acknowledgeRevision(result.appliedRevision);
        }
      } catch (e) {
        this._cameraWrites.delete(camera.revision);
        if (camera.revision === this._latestLocalIntentRevision) {
          this._latestLocalIntentRevision = this._lastAcknowledgedRevision;
        }
        console.warn('[AESyncEngine] Camera sync failed', e.message);
      }
    }, 200);
  }

  async _pollAfterEffects() {
    if (!this.isRunning || this._pollInFlight) return;
    this._pollInFlight = true;
    const pollEpoch = this._pollEpoch;
    const startedAt = Date.now();

    try {
      const state = await this.aeBridge.invoke('camera.getActive', {}, { timeoutMs: 10000 });
      this._markPollSuccess(Date.now() - startedAt);
      if (!state || !this.isRunning || pollEpoch !== this._pollEpoch || this._suspendActiveCompPolling) return;

      const activeCompId = this.getActiveCompId();
      if (!state.compId && activeCompId) {
        const oldId = activeCompId;
        this.setActiveComp(null);
        this._activeControllerId = null;
        if (typeof globalEventBus !== 'undefined') {
          const eventName = typeof OpenGeoEvents !== 'undefined' ? OpenGeoEvents.SYNC_COMP_CHANGED : 'sync:compChanged';
          globalEventBus.emit(eventName, { newId: null, oldId });
        }
        return;
      }
      if (state.compId && state.compId !== activeCompId) {
        const oldId = activeCompId;
        this.setActiveComp(state.compId);
        this._activeControllerId = state.controllerId || null;
        if (typeof globalEventBus !== 'undefined') {
          const eventName = typeof OpenGeoEvents !== 'undefined' ? OpenGeoEvents.SYNC_COMP_CHANGED : 'sync:compChanged';
          globalEventBus.emit(eventName, { newId: state.compId, oldId });
        }
        return;
      }

      if (state.controllerId !== undefined && state.controllerId !== this._activeControllerId) {
        // Controller replacement invalidates pending acknowledgements, even if
        // the composition id is unchanged.
        if (this._activeControllerId !== null) this._resetCameraProtocol();
        this._activeControllerId = state.controllerId;
      }

      if (state.camera) {
        const camHash = `${state.camera.lat}_${state.camera.lng}_${state.camera.zoom}`;
        if (this._shouldIgnoreAeCamera(state.camera, state.appliedRevision)) return;
        if (camHash !== this._lastAeCamState) {
          this._lastAeCamState = camHash;
          if (typeof globalEventBus !== 'undefined') {
            const eventName = typeof OpenGeoEvents !== 'undefined' ? OpenGeoEvents.SYNC_AE_CAMERA : 'sync:aeCamera';
            globalEventBus.emit(eventName, state.camera);
          }
        }
      }
    } catch (e) {
      this._markPollFailure(e, Date.now() - startedAt);
    } finally {
      this._pollInFlight = false;
      if (this.isRunning) this._schedulePoll(this._getNextPollDelay());
    }
  }

  _shouldIgnoreAeCamera(camera, appliedRevision) {
    const revision = Number(appliedRevision);
    const hasRevision = isFinite(revision) && revision >= 0;

    // Revision zero is the Host sentinel for "no panel write acknowledged";
    // it is not a member of the circular sequence generated by _nextRevision().
    // Any pending local intent is therefore newer than zero regardless of the
    // clock's position relative to the modulus midpoint.
    if (hasRevision && this._latestLocalIntentRevision > 0 &&
        (revision === 0 || this._isRevisionAfter(this._latestLocalIntentRevision, revision))) return true;

    if (this._detachedAeCamera) {
      if (MercatorProjection.camerasEquivalent(camera, this._detachedAeCamera, { pixelTolerance: 2, zoomTolerance: 0.002 })) {
        // Navigation outside a keyframe intentionally remains local while
        // Record is off. Repeating the unchanged timeline camera must not snap
        // the panel back. A real timeline/AE camera change clears this guard.
        return true;
      }
      this._detachedAeCamera = null;
    }

    if (!hasRevision) return false;

    const localWrite = this._cameraWrites.get(revision);
    if (localWrite) {
      this._acknowledgeRevision(revision);
      this._deleteAcknowledgedWrites(revision);
      if (MercatorProjection.camerasEquivalent(camera, localWrite, { pixelTolerance: 1, zoomTolerance: 0.002 })) {
        this._lastAeCamState = `${camera.lat}_${camera.lng}_${camera.zoom}`;
        return true;
      }
      // Same revision but different values means the user subsequently moved
      // the camera in AE. It is a real remote update and must be applied.
      return false;
    }

    // A response older than an already acknowledged write was in flight before
    // the write reached AE. Suppress that stale snapshot only.
    if (this._lastAcknowledgedRevision > 0 && this._isRevisionAfter(this._lastAcknowledgedRevision, revision)) return true;
    this._acknowledgeRevision(revision);
    return false;
  }

  _markPollSuccess(durationMs) {
    this._lastPollDurationMs = durationMs;
    const recovered = this._pollHealth === 'degraded';
    this._pollFailureCount = 0;
    this._pollHealth = 'healthy';
    if (recovered) this._emitHealth('AE sync recovered.', false);
  }

  _markPollFailure(error, durationMs) {
    this._lastPollDurationMs = durationMs;
    this._pollFailureCount += 1;
    if (this._pollFailureCount >= 3 && this._pollHealth !== 'degraded') {
      this._pollHealth = 'degraded';
      this._emitHealth('AE sync temporarily degraded; retrying in the background.', false, error);
    }
  }

  _getNextPollDelay() {
    if (this._pollFailureCount === 0) return this._pollBaseIntervalMs;
    return Math.min(this._pollMaxIntervalMs, this._pollBaseIntervalMs * Math.pow(2, this._pollFailureCount - 1));
  }

  _emitHealth(message, isError, error) {
    if (typeof globalEventBus === 'undefined') return;
    const detail = {
      state: this._pollHealth,
      consecutiveFailures: this._pollFailureCount,
      durationMs: this._lastPollDurationMs,
      message,
      error: error ? String(error.message || error) : null
    };
    globalEventBus.emit('sync:health', detail);
    globalEventBus.emit('ui:status', { message, isError: !!isError });
  }

  _deleteAcknowledgedWrites(revision) {
    for (const candidate of this._cameraWrites.keys()) {
      if (candidate === revision || this._isRevisionAfter(revision, candidate)) this._cameraWrites.delete(candidate);
    }
  }

  _pruneCameraWrites() {
    while (this._cameraWrites.size > 32) {
      const oldest = this._cameraWrites.keys().next();
      if (oldest.done) break;
      this._cameraWrites.delete(oldest.value);
    }
  }

  _resetCameraProtocol() {
    this._lastAeCamState = null;
    this._activeControllerId = null;
    this._cameraWrites.clear();
    this._lastAcknowledgedRevision = 0;
    this._latestLocalIntentRevision = 0;
    this._detachedAeCamera = null;
  }

  dispose() {
    this.isRunning = false;
    this._stopPolling();
    this._recordingByComp.clear();
    this.isKeyframeRecording = false;
    if (this._unsubscribeViewport) this._unsubscribeViewport();
    this._unsubscribeViewport = null;
  }
}
