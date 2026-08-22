class SecurityPolicy {
  static normalizeHttpsUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
      return parsed.href;
    } catch (_error) {
      return '';
    }
  }

  static createLucideIcon(documentRef, iconName, size) {
    const safeName = String(iconName || '');
    if (!/^[a-z0-9-]{1,48}$/.test(safeName)) throw new Error('Invalid icon name.');
    if (!documentRef || typeof documentRef.createElement !== 'function') throw new Error('A DOM document is required.');
    const icon = documentRef.createElement('i');
    icon.setAttribute('data-lucide', safeName);
    const pixelSize = Number.isFinite(Number(size)) ? Math.max(8, Math.min(64, Number(size))) : 14;
    icon.style.width = `${pixelSize}px`;
    icon.style.height = `${pixelSize}px`;
    return icon;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = SecurityPolicy;
else if (typeof window !== 'undefined') window.SecurityPolicy = SecurityPolicy;
