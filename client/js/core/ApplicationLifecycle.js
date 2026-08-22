/** Owns DOM/EventBus subscriptions so bootstrap code has one disposal boundary. */
class ApplicationLifecycle {
  constructor(eventBus) {
    this.eventBus = eventBus || null;
    this._unsubscribers = [];
    this._disposed = false;
  }

  listen(target, eventName, callback, options) {
    if (this._disposed || !target || typeof target.addEventListener !== 'function') return () => {};
    target.addEventListener(eventName, callback, options);
    let active = true;
    return this._track(() => {
      if (!active) return;
      active = false;
      target.removeEventListener(eventName, callback, options);
    });
  }

  subscribe(eventName, callback) {
    if (this._disposed || !this.eventBus) return () => {};
    return this._track(this.eventBus.on(eventName, callback));
  }

  track(disposable) {
    if (!disposable) return disposable;
    const dispose = typeof disposable === 'function'
      ? disposable
      : (typeof disposable.dispose === 'function' ? () => disposable.dispose() : null);
    if (dispose) this._track(dispose);
    return disposable;
  }

  _track(unsubscribe) {
    if (typeof unsubscribe !== 'function') return () => {};
    this._unsubscribers.push(unsubscribe);
    return unsubscribe;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    const entries = this._unsubscribers.splice(0).reverse();
    for (const unsubscribe of entries) {
      try { unsubscribe(); } catch (error) {
        if (this.eventBus) this.eventBus.emit('error:report', {
          code: 'LIFECYCLE_DISPOSE_FAILED',
          message: error && error.message ? error.message : String(error),
          source: 'ApplicationLifecycle'
        });
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = ApplicationLifecycle;
else if (typeof window !== 'undefined') window.ApplicationLifecycle = ApplicationLifecycle;
