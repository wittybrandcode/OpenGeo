/**
 * OpenGeo TooltipManager
 * High-performance, zero-dependency, theme-native floating tooltip subsystem.
 * Binds directly to the document root at --z-tooltip elevation (2250) to guarantee
 * that tooltips float above toolbars, action bars, search results, drawers, and modal dialogs.
 */
class TooltipManager {
  constructor() {
    this._tooltipEl = null;
    this._currentTarget = null;
    this._showTimeout = null;
    this._bound = false;

    this._onMouseOver = this._onMouseOver.bind(this);
    this._onMouseOut = this._onMouseOut.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onWindowBlur = this._onWindowBlur.bind(this);
  }

  init() {
    if (this._bound || typeof document === 'undefined') return;
    this._ensureElement();

    document.addEventListener('mouseover', this._onMouseOver, { passive: true, capture: true });
    document.addEventListener('mouseout', this._onMouseOut, { passive: true, capture: true });
    document.addEventListener('mousedown', this._onPointerDown, { passive: true, capture: true });
    window.addEventListener('blur', this._onWindowBlur, { passive: true });
    window.addEventListener('resize', this._onWindowBlur, { passive: true });

    this._bound = true;
  }

  _ensureElement() {
    if (this._tooltipEl || typeof document === 'undefined') return;
    let el = document.getElementById('opengeo-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'opengeo-tooltip';
      el.className = 'opengeo-tooltip';
      el.setAttribute('role', 'tooltip');
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    this._tooltipEl = el;
  }

  _onMouseOver(e) {
    const target = e.target && e.target.closest ? e.target.closest('[title], [data-tooltip]') : null;
    if (!target || target === this._currentTarget) return;

    // Suppress floating tooltips inside components that manage their own rich badges (e.g. Finalize split group)
    if (target.closest('.finalize-split-group, [data-no-tooltip]')) {
      this.hide();
      return;
    }

    const rawText = target.getAttribute('data-tooltip') || target.getAttribute('title');
    if (!rawText || !rawText.trim()) return;

    // Preserve native accessibility while preventing the native browser delayed tooltip
    if (target.hasAttribute('title')) {
      const titleVal = target.getAttribute('title');
      if (titleVal) {
        target.setAttribute('data-tooltip', titleVal);
        if (!target.hasAttribute('aria-label')) {
          target.setAttribute('aria-label', titleVal);
        }
        target.removeAttribute('title');
      }
    }

    const text = target.getAttribute('data-tooltip');
    if (!text) return;

    this._currentTarget = target;
    clearTimeout(this._showTimeout);
    // Instant or ultra-responsive micro-delay (40ms) to avoid flicker during fast sweeps
    this._showTimeout = setTimeout(() => {
      if (this._currentTarget === target) {
        this._show(target, text);
      }
    }, 40);
  }

  _onMouseOut(e) {
    const related = e.relatedTarget;
    if (this._currentTarget && (!related || !this._currentTarget.contains(related))) {
      this.hide();
    }
  }

  _onPointerDown() {
    this.hide();
  }

  _onWindowBlur() {
    this.hide();
  }

  _show(target, text) {
    this._ensureElement();
    if (!this._tooltipEl || !target || !target.isConnected) return;

    this._tooltipEl.textContent = text;
    this._tooltipEl.classList.remove('visible');
    this._tooltipEl.style.display = 'block';

    const targetRect = target.getBoundingClientRect();
    const tooltipRect = this._tooltipEl.getBoundingClientRect();
    const padding = 6;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 800;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 600;

    // Horizontal centering relative to target
    let left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
    // Clamp to viewport edges
    left = Math.max(padding, Math.min(left, viewportWidth - tooltipRect.width - padding));

    // Vertical placement: default is above, fallback to below if target is near top
    let top;
    const spaceAbove = targetRect.top;
    const spaceBelow = viewportHeight - targetRect.bottom;

    if (spaceAbove >= tooltipRect.height + padding + 2) {
      // Place above target
      top = targetRect.top - tooltipRect.height - padding;
    } else if (spaceBelow >= tooltipRect.height + padding + 2) {
      // Place below target
      top = targetRect.bottom + padding;
    } else {
      top = Math.max(padding, targetRect.top - tooltipRect.height - padding);
    }

    this._tooltipEl.style.left = `${Math.round(left)}px`;
    this._tooltipEl.style.top = `${Math.round(top)}px`;
    this._tooltipEl.setAttribute('aria-hidden', 'false');

    // Trigger smooth micro-animation frame
    requestAnimationFrame(() => {
      if (this._currentTarget === target && this._tooltipEl) {
        this._tooltipEl.classList.add('visible');
      }
    });
  }

  hide() {
    clearTimeout(this._showTimeout);
    this._currentTarget = null;
    if (this._tooltipEl) {
      this._tooltipEl.classList.remove('visible');
      this._tooltipEl.setAttribute('aria-hidden', 'true');
    }
  }

  dispose() {
    this.hide();
    if (this._bound && typeof document !== 'undefined') {
      document.removeEventListener('mouseover', this._onMouseOver, { capture: true });
      document.removeEventListener('mouseout', this._onMouseOut, { capture: true });
      document.removeEventListener('mousedown', this._onPointerDown, { capture: true });
      window.removeEventListener('blur', this._onWindowBlur);
      window.removeEventListener('resize', this._onWindowBlur);
      this._bound = false;
    }
    if (this._tooltipEl && this._tooltipEl.parentNode) {
      this._tooltipEl.parentNode.removeChild(this._tooltipEl);
      this._tooltipEl = null;
    }
  }
}

// Global Singleton
const globalTooltipManager = new TooltipManager();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TooltipManager, globalTooltipManager };
} else if (typeof window !== 'undefined') {
  window.TooltipManager = TooltipManager;
  window.globalTooltipManager = globalTooltipManager;
}
