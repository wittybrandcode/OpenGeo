/** Theme-native confirm/prompt/alert dialogs; replaces browser chrome in CEP. */
class DialogManager {
  constructor() {
    this.overlay = document.getElementById('opengeo-dialog');
    this.titleElement = document.getElementById('opengeo-dialog-title');
    this.messageElement = document.getElementById('opengeo-dialog-message');
    this.inputElement = document.getElementById('opengeo-dialog-input');
    this.confirmButton = document.getElementById('opengeo-dialog-confirm');
    this.cancelButton = document.getElementById('opengeo-dialog-cancel');
    this.closeButton = document.getElementById('opengeo-dialog-close');
    this.symbolContainer = this.overlay ? this.overlay.querySelector('.opengeo-dialog-symbol') : null;
    this._resolve = null;
    this._mode = 'confirm';
    this._previousFocus = null;
    this._onConfirm = () => this._finish(this._mode === 'prompt' ? this.inputElement.value : true);
    this._onCancel = () => this._finish(this._mode === 'prompt' ? null : (this._mode === 'alert' ? true : false));
    this._onKeyDown = event => {
      if (!this.overlay || !this.overlay.classList.contains('visible')) return;
      if (event.key === 'Escape') { event.preventDefault(); this._onCancel(); }
      else if (event.key === 'Tab') {
        const controls = [this.closeButton, this.inputElement, this.cancelButton, this.confirmButton]
          .filter(control => control && control.style.display !== 'none' && !control.disabled);
        if (!controls.length) return;
        const currentIndex = controls.indexOf(document.activeElement);
        const nextIndex = event.shiftKey
          ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
          : (currentIndex < 0 || currentIndex === controls.length - 1 ? 0 : currentIndex + 1);
        event.preventDefault(); controls[nextIndex].focus();
      }
      else if (event.key === 'Enter' && (this._mode === 'confirm' || this._mode === 'alert' || document.activeElement === this.inputElement)) {
        event.preventDefault(); this._onConfirm();
      }
    };
    if (this.confirmButton) this.confirmButton.addEventListener('click', this._onConfirm);
    if (this.cancelButton) this.cancelButton.addEventListener('click', this._onCancel);
    if (this.closeButton) this.closeButton.addEventListener('click', this._onCancel);
    document.addEventListener('keydown', this._onKeyDown);
  }

  alert(options = {}) { return this._open('alert', options); }
  confirm(options = {}) { return this._open('confirm', options); }
  prompt(options = {}) { return this._open('prompt', options); }

  _open(mode, options = {}) {
    if (this._resolve) this._finish(mode === 'prompt' ? null : (mode === 'alert' ? true : false));
    this._mode = mode;
    this._previousFocus = document.activeElement;
    const defaultTitle = mode === 'prompt' ? 'Enter a value' : (mode === 'alert' ? 'Notice' : 'Confirm action');
    if (this.titleElement) this.titleElement.textContent = options.title || defaultTitle;
    if (this.messageElement) this.messageElement.textContent = options.message || '';
    if (this.confirmButton) {
      this.confirmButton.textContent = options.confirmLabel || (mode === 'alert' ? 'OK' : 'Confirm');
      this.confirmButton.classList.toggle('danger', options.danger === true);
      this.confirmButton.classList.toggle('success', options.success === true);
    }
    if (this.cancelButton) {
      this.cancelButton.textContent = options.cancelLabel || 'Cancel';
      this.cancelButton.style.display = mode === 'alert' ? 'none' : '';
    }
    if (this.inputElement) {
      this.inputElement.style.display = mode === 'prompt' ? 'block' : 'none';
      this.inputElement.value = mode === 'prompt' ? String(options.defaultValue || '') : '';
      this.inputElement.placeholder = options.placeholder || '';
    }

    if (this.symbolContainer && typeof document !== 'undefined') {
      this.symbolContainer.classList.toggle('success', options.success === true);
      const iconName = options.symbol || (options.success ? 'check-circle' : 'sparkles');
      if (typeof SecurityPolicy !== 'undefined' && typeof SecurityPolicy.createLucideIcon === 'function') {
        try {
          const iconEl = SecurityPolicy.createLucideIcon(document, iconName, 16);
          if (typeof this.symbolContainer.replaceChildren === 'function') {
            this.symbolContainer.replaceChildren(iconEl);
          } else {
            this.symbolContainer.textContent = '';
            this.symbolContainer.appendChild(iconEl);
          }
          if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons({ root: this.symbolContainer });
          }
        } catch (_err) {
          // Fallback gracefully
        }
      }
    }

    if (this.overlay) {
      this.overlay.classList.add('visible');
      this.overlay.classList.toggle('success', options.success === true);
      this.overlay.setAttribute('aria-hidden', 'false');
    }
    setTimeout(() => {
      if (mode === 'prompt' && this.inputElement && typeof this.inputElement.focus === 'function') {
        this.inputElement.focus();
      } else if (this.confirmButton && typeof this.confirmButton.focus === 'function') {
        this.confirmButton.focus();
      }
    }, 0);
    return new Promise(resolve => { this._resolve = resolve; });
  }

  _finish(value) {
    if (!this._resolve) return;
    const resolve = this._resolve;
    this._resolve = null;
    if (this.overlay) {
      this.overlay.classList.remove('visible', 'success');
      this.overlay.setAttribute('aria-hidden', 'true');
    }
    if (this.symbolContainer) {
      this.symbolContainer.classList.remove('success');
      if (typeof SecurityPolicy !== 'undefined' && typeof SecurityPolicy.createLucideIcon === 'function' && typeof document !== 'undefined') {
        try {
          const defaultIcon = SecurityPolicy.createLucideIcon(document, 'sparkles', 16);
          if (typeof this.symbolContainer.replaceChildren === 'function') {
            this.symbolContainer.replaceChildren(defaultIcon);
          } else {
            this.symbolContainer.textContent = '';
            this.symbolContainer.appendChild(defaultIcon);
          }
          if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons({ root: this.symbolContainer });
          }
        } catch (_err) {
          /* lucide icon rendering fallback */
        }
      }
    }
    if (this.confirmButton) {
      this.confirmButton.classList.remove('success', 'danger');
    }
    if (this.cancelButton) {
      this.cancelButton.style.display = '';
    }
    if (this._previousFocus && typeof this._previousFocus.focus === 'function') this._previousFocus.focus();
    this._previousFocus = null;
    resolve(value);
  }

  dispose() {
    if (this._resolve) this._finish(this._mode === 'prompt' ? null : (this._mode === 'alert' ? true : false));
    if (this.confirmButton) this.confirmButton.removeEventListener('click', this._onConfirm);
    if (this.cancelButton) this.cancelButton.removeEventListener('click', this._onCancel);
    if (this.closeButton) this.closeButton.removeEventListener('click', this._onCancel);
    document.removeEventListener('keydown', this._onKeyDown);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = DialogManager;
else if (typeof window !== 'undefined') window.DialogManager = DialogManager;
