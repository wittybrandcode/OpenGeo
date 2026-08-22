/** Theme-native confirm/prompt dialogs; replaces browser chrome in CEP. */
class DialogManager {
  constructor() {
    this.overlay = document.getElementById('opengeo-dialog');
    this.titleElement = document.getElementById('opengeo-dialog-title');
    this.messageElement = document.getElementById('opengeo-dialog-message');
    this.inputElement = document.getElementById('opengeo-dialog-input');
    this.confirmButton = document.getElementById('opengeo-dialog-confirm');
    this.cancelButton = document.getElementById('opengeo-dialog-cancel');
    this.closeButton = document.getElementById('opengeo-dialog-close');
    this._resolve = null;
    this._mode = 'confirm';
    this._previousFocus = null;
    this._onConfirm = () => this._finish(this._mode === 'prompt' ? this.inputElement.value : true);
    this._onCancel = () => this._finish(this._mode === 'prompt' ? null : false);
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
      else if (event.key === 'Enter' && (this._mode === 'confirm' || document.activeElement === this.inputElement)) {
        event.preventDefault(); this._onConfirm();
      }
    };
    if (this.confirmButton) this.confirmButton.addEventListener('click', this._onConfirm);
    if (this.cancelButton) this.cancelButton.addEventListener('click', this._onCancel);
    if (this.closeButton) this.closeButton.addEventListener('click', this._onCancel);
    document.addEventListener('keydown', this._onKeyDown);
  }

  confirm(options = {}) { return this._open('confirm', options); }
  prompt(options = {}) { return this._open('prompt', options); }

  _open(mode, options) {
    if (this._resolve) this._finish(mode === 'prompt' ? null : false);
    this._mode = mode;
    this._previousFocus = document.activeElement;
    this.titleElement.textContent = options.title || (mode === 'prompt' ? 'Enter a value' : 'Confirm action');
    this.messageElement.textContent = options.message || '';
    this.confirmButton.textContent = options.confirmLabel || 'Confirm';
    this.cancelButton.textContent = options.cancelLabel || 'Cancel';
    this.confirmButton.classList.toggle('danger', options.danger === true);
    this.inputElement.style.display = mode === 'prompt' ? 'block' : 'none';
    this.inputElement.value = mode === 'prompt' ? String(options.defaultValue || '') : '';
    this.inputElement.placeholder = options.placeholder || '';
    this.overlay.classList.add('visible');
    this.overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => mode === 'prompt' ? this.inputElement.focus() : this.confirmButton.focus(), 0);
    return new Promise(resolve => { this._resolve = resolve; });
  }

  _finish(value) {
    if (!this._resolve) return;
    const resolve = this._resolve;
    this._resolve = null;
    this.overlay.classList.remove('visible');
    this.overlay.setAttribute('aria-hidden', 'true');
    if (this._previousFocus && typeof this._previousFocus.focus === 'function') this._previousFocus.focus();
    this._previousFocus = null;
    resolve(value);
  }

  dispose() {
    if (this._resolve) this._finish(this._mode === 'prompt' ? null : false);
    if (this.confirmButton) this.confirmButton.removeEventListener('click', this._onConfirm);
    if (this.cancelButton) this.cancelButton.removeEventListener('click', this._onCancel);
    if (this.closeButton) this.closeButton.removeEventListener('click', this._onCancel);
    document.removeEventListener('keydown', this._onKeyDown);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = DialogManager;
else if (typeof window !== 'undefined') window.DialogManager = DialogManager;
