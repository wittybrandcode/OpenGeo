/**
 * OpenGeo — FinalizeTransactionManager
 *
 * Manages atomic AE composition transactions (Prepare, Commit, Rollback, and Reconcile)
 * ensuring that failures leave existing footage untouched and temporary files are cleaned.
 * Pure service with zero DOM coupling.
 */

class FinalizeTransactionManager {
  constructor(aeBridge, jobManager) {
    this.aeBridge = aeBridge;
    this.jobManager = jobManager;
  }

  /**
   * Prepares hidden footage layers in the After Effects composition.
   * @param {Array} megaTiles
   * @param {number|string} activeCompId
   * @param {object} snapshot
   * @param {string} revisionId
   * @param {Array} [zoomTransitions]
   * @returns {Promise<object>}
   */
  async prepare(megaTiles, activeCompId, snapshot, revisionId, zoomTransitions) {
    const payloadObject = {
      operationId: revisionId,
      tiles: megaTiles,
      source: snapshot.sourceKey,
      documentId: snapshot.documentId,
      compId: activeCompId,
      camera: snapshot.camera,
      zoomTransitions: zoomTransitions || [],
      compSettings: {
        width: snapshot.composition.width,
        height: snapshot.composition.height
      }
    };

    const prepareTimeoutMs = Math.max(90000, megaTiles.length * 3000);
    return this.aeBridge.invokeWithPayloadFile(
      'composition.prepare',
      payloadObject,
      this.jobManager,
      { timeoutMs: prepareTimeoutMs }
    );
  }

  /**
   * Atomically commits prepared hidden layers, replacing old footage.
   * @param {number} expected
   * @param {number|string} activeCompId
   * @param {object} snapshot
   * @param {string} revisionId
   * @param {object} [metadata]
   * @returns {Promise<object>}
   */
  async commit(expected, activeCompId, snapshot, revisionId, metadata) {
    const commitTimeoutMs = Math.max(90000, expected * 2000);
    const payload = {
      operationId: revisionId,
      documentId: snapshot.documentId,
      compId: activeCompId,
      expected: expected,
      source: snapshot.sourceKey
    };
    if (metadata) {
      payload.metadata = metadata;
    }
    return this.aeBridge.invoke('composition.commit', payload, { timeoutMs: commitTimeoutMs });
  }

  /**
   * Rolls back a prepared or aborted revision in After Effects.
   * @param {object} transaction
   * @param {Function} [onCleanup]
   * @returns {Promise<object>}
   */
  async rollback(transaction, onCleanup) {
    if (!transaction || transaction.state === 'committed') return Promise.resolve(false);
    if (!transaction.hostPrepareStarted) {
      if (typeof onCleanup === 'function') onCleanup();
      return Promise.resolve(true);
    }
    return this.aeBridge.invoke('composition.rollback', {
      operationId: transaction.revisionId,
      documentId: transaction.snapshot ? transaction.snapshot.documentId : null,
      compId: transaction.compId
    }, { timeoutMs: 60000 }).catch(error => {
      console.warn('[FinalizeTransactionManager] Host rollback warning:', error);
      return false;
    }).then(result => {
      if (typeof onCleanup === 'function') onCleanup();
      return result;
    });
  }

  /**
   * Reconciles commit status after an uncertain or timed-out commit response.
   * @param {object} transaction
   * @returns {Promise<object>}
   */
  async reconcile(transaction) {
    if (!transaction) return null;
    try {
      return await this.aeBridge.invoke('composition.getRevision', {
        operationId: transaction.revisionId,
        documentId: transaction.snapshot ? transaction.snapshot.documentId : null,
        compId: transaction.compId
      }, { timeoutMs: 30000 });
    } catch (error) {
      console.warn('[FinalizeTransactionManager] Commit reconciliation warning:', error);
      return null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FinalizeTransactionManager;
}
if (typeof window !== 'undefined') {
  window.FinalizeTransactionManager = FinalizeTransactionManager;
}
