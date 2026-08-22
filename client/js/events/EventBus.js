class EventBus {
  constructor(options = {}) {
    this._listeners = new Map();
    this._onListenerError = typeof options.onListenerError === 'function'
      ? options.onListenerError
      : null;
  }

  on(event, callback) {
    if (typeof callback !== 'function') throw new TypeError('EventBus listener must be a function.');
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this._listeners.has(event)) return;
    const callbacks = this._listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index !== -1) {
      callbacks.splice(index, 1);
      if (callbacks.length === 0) this._listeners.delete(event);
    }
  }

  once(event, callback) {
    const onceCallback = (data) => {
      this.off(event, onceCallback);
      return callback(data);
    };
    return this.on(event, onceCallback);
  }

  emit(event, data) {
    if (typeof OpenGeoEventContracts !== 'undefined' && !OpenGeoEventContracts.isValid(event, data)) {
      console.warn(`[OpenGeo.EventBus] Invalid payload for ${event}`);
    }
    if (!this._listeners.has(event)) return;
    const callbacks = this._listeners.get(event).slice();
    for (const callback of callbacks) {
      try {
        const result = callback(data);
        if (result && typeof result.then === 'function') {
          Promise.resolve(result).catch(error => this._reportListenerError(event, error));
        }
      } catch (e) {
        this._reportListenerError(event, e);
      }
    }
  }

  _reportListenerError(event, error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    if (this._onListenerError) {
      try {
        this._onListenerError({ event, error: normalizedError });
        return;
      } catch (handlerError) {
        console.error('[OpenGeo.EventBus] Error handler failed:', handlerError);
      }
    }
    if (event !== 'error:report') {
      this.emit('error:report', {
        code: 'EVENT_LISTENER_ERROR',
        message: normalizedError.message,
        event,
        stack: normalizedError.stack
      });
    }
    console.error(`Error in event listener for ${event}:`, normalizedError);
  }

  clear() {
    this._listeners.clear();
  }
}

// Global instance for the app
const globalEventBus = new EventBus();
