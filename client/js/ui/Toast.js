class Toast {
  constructor(containerId = 'toast-container') {
    this.container = document.getElementById(containerId);
    this._timers = new Set();
    
    if (typeof globalEventBus !== 'undefined') {
      this._unsubscribe = globalEventBus.on('toast:show', (data) => this.show(data.message, data.type, data.duration));
    }
  }

  show(message, type = 'info', duration = 3000) {
    if (!this.container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = document.createElement('i');
    icon.className = 'toast-icon';
    icon.setAttribute('data-lucide', type === 'error' ? 'circle-alert' : (type === 'success' ? 'circle-check' : (type === 'warning' ? 'triangle-alert' : 'info')));
    const text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = message;
    toast.appendChild(icon);
    toast.appendChild(text);
    
    this.container.appendChild(toast);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
    const exitTimer = setTimeout(() => {
      toast.classList.add('toast-exit');
      const removeTimer = setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
        this._timers.delete(removeTimer);
      }, 260);
      this._timers.delete(exitTimer);
      this._timers.add(removeTimer);
    }, duration);
    this._timers.add(exitTimer);
  }

  dispose() {
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = null;
    this._timers.forEach(timer => clearTimeout(timer));
    this._timers.clear();
  }
}
