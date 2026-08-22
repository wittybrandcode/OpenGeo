/**
 * Shared, cancellable XHR transport for every OpenGeo tile request.
 * Presentation decoding and filesystem caching stay in their callers; timeout,
 * abort, HTTP validation and response-size validation have one implementation.
 */
class TileTransport {
  static request(url, options = {}) {
    if (!url) throw new Error('No tile URL provided');
    if (typeof XMLHttpRequest === 'undefined') throw new Error('XMLHttpRequest is unavailable in this CEP runtime');

    const policy = typeof NetworkPolicy !== 'undefined' ? NetworkPolicy : null;
    const validation = policy ? policy.validateHttpsUrl(url) : { ok: /^https:\/\//i.test(String(url)), url: String(url) };
    if (!validation.ok) throw (validation.error || new Error('Tile URL must use HTTPS'));

    const request = new XMLHttpRequest();
    const timeoutMs = policy ? policy.timeoutMs(options.timeoutMs, 15000) : (options.timeoutMs || 15000);
    const maxBytes = policy ? policy.maxBytes(options.maxBytes, 16 * 1024 * 1024) : (options.maxBytes || 16 * 1024 * 1024);
    let settled = false;
    let timer = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(value);
    };

    const promise = new Promise((resolve, reject) => {
      request.open('GET', validation.url, true);
      request.responseType = options.responseType || 'arraybuffer';
      timer = setTimeout(() => {
        finish(reject, policy
          ? policy.createError('NETWORK_TIMEOUT', 'Tile download timeout')
          : new Error('Tile download timeout'));
        try { request.abort(); } catch (ignoreAbort) {}
      }, timeoutMs);
      request.onload = () => {
        const finalValidation = policy ? policy.validateFinalUrl(validation.url, request.responseURL) : { ok: true };
        if (!finalValidation.ok) {
          finish(reject, finalValidation.error);
          return;
        }
        if (request.status < 200 || request.status >= 300 || !request.response) {
          finish(reject, new Error(`HTTP ${request.status}`));
          return;
        }
        const minBytes = options.minBytes || 0;
        const responseSize = request.response.byteLength !== undefined ? request.response.byteLength : request.response.size;
        if (minBytes && (!responseSize || responseSize < minBytes)) {
          finish(reject, new Error(`Tile response too small (<${minBytes} bytes)`));
          return;
        }
        if (!responseSize || responseSize > maxBytes) {
          finish(reject, policy
            ? policy.createError('NETWORK_RESPONSE_TOO_LARGE', `Tile response exceeds ${maxBytes} bytes.`)
            : new Error(`Tile response exceeds ${maxBytes} bytes.`));
          return;
        }
        finish(resolve, request.response);
      };
      request.onprogress = event => {
        if (event && event.loaded > maxBytes) {
          finish(reject, policy
            ? policy.createError('NETWORK_RESPONSE_TOO_LARGE', `Tile response exceeds ${maxBytes} bytes.`)
            : new Error(`Tile response exceeds ${maxBytes} bytes.`));
          try { request.abort(); } catch (ignoreAbort) {}
        }
      };
      request.onerror = () => finish(reject, new Error('Network error downloading tile'));
      request.onabort = () => finish(reject, Object.assign(new Error('Tile request aborted'), { name: 'AbortError' }));
      request.send();
    });

    return {
      promise,
      abort: () => {
        try { request.abort(); } catch (ignoreAbort) {}
      }
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TileTransport;
} else if (typeof window !== 'undefined') {
  window.TileTransport = TileTransport;
}
