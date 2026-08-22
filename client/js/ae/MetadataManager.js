/**
 * MetadataManager — Handles persistent GIS state inside After Effects compositions.
 * It reads and writes JSON configuration data to the composition's comment field
 * or via XMP metadata, ensuring projects survive being closed and reopened.
 */
class MetadataManager {
  constructor(aeBridge, cartographyPolicy) {
    this.aeBridge = aeBridge;
    this.cartographyPolicy = cartographyPolicy || null;
  }

  _getCartographyStamp() {
    if (this.cartographyPolicy && typeof this.cartographyPolicy.getMetadataStamp === 'function') {
      return this.cartographyPolicy.getMetadataStamp();
    }
    return {
      policyId: 'opengeo-cartography-policy',
      policyVersion: typeof OpenGeoVersions !== 'undefined' ? OpenGeoVersions.cartographyPolicy : 'unknown',
      dataBundleVersion: 'unknown',
      activeProfileIds: [],
      sourcePolicySha256: null
    };
  }

  /**
   * Serialize current map state and save to active AE Composition.
   */
  async saveToComp(compId, viewport, tileManager, session) {
    if (!compId || !viewport || !tileManager) return false;

    const state = {
      opengeo: {
        version: typeof OpenGeoVersions !== 'undefined' ? OpenGeoVersions.metadataSchema : '2.2.0',
        centerLat: viewport.mapState.latitude,
        centerLng: viewport.mapState.longitude,
        zoom: viewport.mapState.compZoom,
        tileSize: viewport.tileSize,
        source: tileManager.source,
        documentId: session ? session.documentId : null,
        isFinalized: session ? !!session.isFinalized : false,
        compWidth: viewport.mapState.compWidth,
        compHeight: viewport.mapState.compHeight,
        displayName: String(session && session.composition && session.composition.displayName || 'OpenGeo Map').slice(0, 80),
        cartography: this._getCartographyStamp(),
        features: session && session.featureRegistry ? session.featureRegistry.serialize() : []
      }
    };

    try {
      await this.aeBridge.invoke('metadata.set', { compId, data: this.serializeState(state) });
      return true;
    } catch (e) {
      console.warn('MetadataManager: Failed to save comp metadata', e);
      return false;
    }
  }

  async saveSnapshotToComp(compId, snapshot, isFinalized, activeRevision) {
    if (!compId || !snapshot) return false;
    const state = this.createSnapshotState(snapshot, isFinalized, activeRevision);
    try {
      await this.aeBridge.invoke('metadata.set', { compId, data: this.serializeState(state) });
      return true;
    } catch (error) {
      console.warn('MetadataManager: Failed to save immutable comp metadata', error);
      return false;
    }
  }

  createSnapshotState(snapshot, isFinalized, activeRevision) {
    return {
      opengeo: {
        version: typeof OpenGeoVersions !== 'undefined' ? OpenGeoVersions.metadataSchema : '2.2.0',
        centerLat: snapshot.camera.lat,
        centerLng: snapshot.camera.lon,
        zoom: snapshot.camera.zoom,
        tileSize: snapshot.tileSize,
        source: snapshot.sourceKey,
        documentId: snapshot.documentId,
        isFinalized: isFinalized === true,
        compWidth: snapshot.composition.width,
        compHeight: snapshot.composition.height,
        displayName: String(snapshot.composition.displayName || 'OpenGeo Map').slice(0, 80),
        activeRevision: activeRevision || snapshot.operationId,
        cartography: this._getCartographyStamp(),
        features: Array.isArray(snapshot.features) ? snapshot.features : []
      }
    };
  }

  serializeState(state) {
    const serialized = JSON.stringify(state);
    if (serialized.length > 262144) {
      const error = new Error('OpenGeo composition metadata exceeds the 256 KB safety limit.');
      error.code = 'METADATA_SIZE_LIMIT';
      throw error;
    }
    return serialized;
  }

  /**
   * Read saved map state from an AE Composition.
   */
  async loadFromComp(compId) {
    if (!compId) return null;
    
    try {
      const data = await this.aeBridge.invoke('metadata.get', { compId });
      if (!data) return null;
      if (typeof OpenGeoVersionMigrations !== 'undefined') {
        const migration = OpenGeoVersionMigrations.migrateMetadata(data);
        if (!migration.ok) return null;
        if (migration.future) console.warn('MetadataManager: Newer metadata schema loaded in compatibility mode:', migration.from);
        return migration.value;
      }
      return data && data.opengeo ? data.opengeo : null;
    } catch (e) {
      console.warn('MetadataManager: Failed to load comp metadata', e);
    }
    return null;
  }
}
