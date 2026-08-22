class NetworkPolicy {
  static createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  static validateHttpsUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return { ok: false, error: this.createError('NETWORK_URL_REQUIRED', 'A network URL is required.') };
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:') {
        return { ok: false, error: this.createError('NETWORK_HTTPS_REQUIRED', 'Network requests must use HTTPS.') };
      }
      if (parsed.username || parsed.password) {
        return { ok: false, error: this.createError('NETWORK_URL_CREDENTIALS', 'Credentials are not allowed in network URLs.') };
      }
      return { ok: true, url: parsed.href, origin: parsed.origin };
    } catch (_error) {
      return { ok: false, error: this.createError('NETWORK_URL_INVALID', 'The network URL is invalid.') };
    }
  }

  static validateFinalUrl(originalUrl, responseUrl) {
    const original = this.validateHttpsUrl(originalUrl);
    if (!original.ok) return original;
    if (!responseUrl) return original;
    const finalResult = this.validateHttpsUrl(responseUrl);
    if (!finalResult.ok) {
      return { ok: false, error: this.createError('NETWORK_REDIRECT_REJECTED', 'The response redirected to a non-HTTPS or invalid URL.') };
    }
    return { ok: true, url: finalResult.url, redirected: finalResult.url !== original.url };
  }

  static timeoutMs(value, fallback) {
    const candidate = Number(value);
    const defaultValue = Number(fallback) || 15000;
    return Math.max(1000, Math.min(120000, Number.isFinite(candidate) && candidate > 0 ? candidate : defaultValue));
  }

  static maxBytes(value, fallback) {
    const candidate = Number(value);
    const defaultValue = Number(fallback) || 16 * 1024 * 1024;
    return Math.max(1024, Math.min(64 * 1024 * 1024, Number.isFinite(candidate) && candidate > 0 ? candidate : defaultValue));
  }

  static utf8Bytes(value) {
    const text = String(value || '');
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(text, 'utf8');
    return unescape(encodeURIComponent(text)).length;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = NetworkPolicy;
else if (typeof window !== 'undefined') window.NetworkPolicy = NetworkPolicy;
