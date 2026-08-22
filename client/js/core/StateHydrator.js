/**
 * Validates and restores one persisted AE document as a single MapSession
 * transaction. Runtime adapters are deliberately outside this class: no tile
 * request, EventBus publication, toast or metadata write can run before the
 * state commit succeeds.
 */
class StateHydrator {
  constructor(session, providerManager) {
    this.session = session;
    this.providerManager = providerManager || null;
  }

  normalize(metadata, compId) {
    if (!metadata || typeof metadata !== 'object') return this._failure('HYDRATION_METADATA_INVALID', 'Composition metadata is missing or invalid.');
    const before = this.session.snapshot();
    const width = Number(metadata.compWidth);
    const height = Number(metadata.compHeight);
    if (metadata.compWidth !== undefined && (!Number.isFinite(width) || width <= 0)) {
      return this._failure('HYDRATION_COMPOSITION_INVALID', 'Persisted composition width is invalid.');
    }
    if (metadata.compHeight !== undefined && (!Number.isFinite(height) || height <= 0)) {
      return this._failure('HYDRATION_COMPOSITION_INVALID', 'Persisted composition height is invalid.');
    }
    if (metadata.tileSize !== undefined && metadata.tileSize !== 256 && metadata.tileSize !== 512) {
      return this._failure('HYDRATION_TILE_SIZE_INVALID', 'Persisted tile size is invalid.');
    }
    if (metadata.documentId !== undefined && (typeof metadata.documentId !== 'string' || !metadata.documentId)) {
      return this._failure('HYDRATION_DOCUMENT_INVALID', 'Persisted document identity is invalid.');
    }
    if (metadata.isFinalized !== undefined && typeof metadata.isFinalized !== 'boolean') {
      return this._failure('HYDRATION_FINALIZATION_INVALID', 'Persisted finalization state is invalid.');
    }
    if (metadata.features !== undefined && (!Array.isArray(metadata.features) || metadata.features.length > 500)) {
      return this._failure('HYDRATION_FEATURES_INVALID', 'Persisted feature registry is invalid.');
    }
    const lat = metadata.centerLat === undefined ? before.camera.lat : Number(metadata.centerLat);
    const lng = metadata.centerLng === undefined ? before.camera.lng : Number(metadata.centerLng);
    const compZoom = metadata.zoom === undefined ? before.camera.compZoom : Number(metadata.zoom);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(compZoom)) return this._failure('HYDRATION_CAMERA_INVALID', 'Persisted camera values are invalid.');

    const providerCandidate = typeof metadata.source === 'string' && metadata.source ? metadata.source : before.providerId;
    const providerId = this.providerManager && !this.providerManager.getProvider(providerCandidate)
      ? before.providerId
      : providerCandidate;
    const tileSize = metadata.tileSize === undefined ? before.camera.tileSize : metadata.tileSize;
    const documentId = typeof metadata.documentId === 'string' && metadata.documentId
      ? metadata.documentId
      : before.documentId;

    return {
      ok: true,
      value: {
        documentId,
        composition: {
          compId: compId || (before.composition && before.composition.compId) || null,
          width: Number.isFinite(width) && width > 0 ? width : before.layout.compWidth,
          height: Number.isFinite(height) && height > 0 ? height : before.layout.compHeight,
          displayName: String(metadata.displayName || (before.composition && before.composition.displayName) || 'OpenGeo Map').slice(0, 80)
        },
        providerId,
        tileSize,
        camera: { lat, lng, compZoom },
        isFinalized: typeof metadata.isFinalized === 'boolean' ? metadata.isFinalized : before.isFinalized,
        features: Array.isArray(metadata.features) ? metadata.features : []
      }
    };
  }

  hydrate(metadata, compId) {
    const normalized = this.normalize(metadata, compId);
    if (!normalized.ok) return normalized;
    try {
      const snapshot = this.session.hydrateDocument(normalized.value, { origin: 'metadata' });
      return { ok: true, snapshot, state: normalized.value };
    } catch (error) {
      return this._failure('HYDRATION_COMMIT_FAILED', error.message || 'Composition state could not be restored.');
    }
  }

  _failure(code, message) {
    return { ok: false, error: { code, message } };
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = StateHydrator;
else if (typeof window !== 'undefined') window.StateHydrator = StateHydrator;
