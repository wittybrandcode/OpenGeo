const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('====================================');
console.log('OpenGeo Tooltip Manager & Z-Index Suite');
console.log('====================================');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

// 1. Verify CSS tokens and styling
test('CSS defines elevated --z-tooltip token above dialogs', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../client/css/modules/01-tokens.css'), 'utf8');
  const match = css.match(/--z-tooltip:\s*(\d+);/);
  assert(match, 'CSS must define --z-tooltip');
  const zTooltip = parseInt(match[1], 10);
  assert(zTooltip >= 2200, `--z-tooltip (${zTooltip}) must float above modals and dialogs (>=2200)`);
  assert(zTooltip < 2300, `--z-tooltip (${zTooltip}) must remain below emergency toasts (<2300)`);
});

test('CSS defines .opengeo-tooltip styling with proper z-index and blur', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../client/css/modules/12-feedback.css'), 'utf8');
  assert(css.includes('.opengeo-tooltip'), '12-feedback.css defines .opengeo-tooltip');
  assert(css.includes('z-index: var(--z-tooltip, 2250);'), '.opengeo-tooltip binds to --z-tooltip');
  assert(css.includes('pointer-events: none;'), '.opengeo-tooltip uses pointer-events: none');
  assert(css.includes('position: fixed;'), '.opengeo-tooltip is fixed on screen');
});

test('CSS elevates .bottom-bar z-index on hover/focus to prevent badge clipping', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../client/css/modules/06-bottom-bar.css'), 'utf8');
  assert(css.includes('.bottom-bar:hover'), 'bottom-bar.css defines hover elevation');
  assert(css.includes('calc(var(--z-search-bar, 500) + 10)'), 'bottom-bar elevates above search bar on hover');
});

// 2. Verify all buttons in index.html have tooltips or dedicated badge
test('All buttons in client/index.html have titles or dedicated badges with aria-labels', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../../client/index.html'), 'utf8');
  const buttonRegex = /<button([^>]*)>/gi;
  let match;
  let missingTooltipCount = 0;
  const missing = [];

  while ((match = buttonRegex.exec(html)) !== null) {
    const attrs = match[1];
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);
    const titleMatch = attrs.match(/title=["']([^"']+)["']/i);
    const badgeMatch = attrs.match(/data-estimate-badge=["']true["']/i);
    const ariaMatch = attrs.match(/aria-label=["']([^"']+)["']/i);
    const id = idMatch ? idMatch[1] : '(anonymous)';

    const hasTooltip = (titleMatch && titleMatch[1].trim()) || (badgeMatch && ariaMatch && ariaMatch[1].trim());
    if (!hasTooltip) {
      missingTooltipCount++;
      missing.push(id);
    }
  }

  assert.strictEqual(missingTooltipCount, 0, `All buttons must have tooltips or dedicated badge. Missing: ${missing.join(', ')}`);
});

// 3. Verify TooltipManager behavior
test('TooltipManager transfers title to data-tooltip and sets aria-label', () => {
  const eventListeners = {};
  const mockBody = {
    appendChild: (el) => { el.parentNode = mockBody; mockBody.child = el; },
    removeChild: (el) => { if (el) el.parentNode = null; mockBody.child = null; }
  };

  const mockTarget = {
    isConnected: true,
    attributes: {
      title: 'Zoom In Action'
    },
    hasAttribute(name) { return name in this.attributes; },
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, val) { this.attributes[name] = val; },
    removeAttribute(name) { delete this.attributes[name]; },
    closest(selector) {
      if (selector.includes('finalize-split-group') || selector.includes('data-no-tooltip')) return null;
      if (selector.includes('title') || selector.includes('data-tooltip')) return mockTarget;
      return null;
    },
    getBoundingClientRect() { return { left: 100, top: 10, width: 30, height: 30, bottom: 40 }; },
    contains(other) { return this === other; }
  };

  global.document = {
    body: mockBody,
    getElementById: (id) => mockBody.child && mockBody.child.id === id ? mockBody.child : null,
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      style: {},
      classList: {
        add(cls) { this[cls] = true; },
        remove(cls) { delete this[cls]; },
        contains(cls) { return !!this[cls]; }
      },
      setAttribute(k, v) { this[k] = v; },
      removeAttribute(k) { delete this[k]; }
    }),
    addEventListener(name, handler) {
      eventListeners[name] = handler;
    },
    removeEventListener(name) {
      delete eventListeners[name];
    },
    documentElement: { clientWidth: 800, clientHeight: 600 }
  };

  global.window = {
    innerWidth: 800,
    innerHeight: 600,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (cb) => cb()
  };

  const { TooltipManager } = require('../../../client/js/ui/TooltipManager');
  const manager = new TooltipManager();
  manager.init();

  assert(mockBody.child, 'TooltipManager appended tooltip element to body');
  assert.strictEqual(mockBody.child.id, 'opengeo-tooltip');

  // Trigger mouseover
  eventListeners['mouseover']({ target: mockTarget });

  assert.strictEqual(mockTarget.getAttribute('data-tooltip'), 'Zoom In Action', 'title moved to data-tooltip');
  assert(!mockTarget.hasAttribute('title'), 'original title attribute removed to suppress browser tooltip');
  assert.strictEqual(mockTarget.getAttribute('aria-label'), 'Zoom In Action', 'aria-label preserved for accessibility');

  manager.dispose();
  assert(!mockBody.child, 'Tooltip element cleaned up on dispose');
});

test('TooltipManager suppresses floating tooltips for finalize-split-group to avoid duplicate popups', () => {
  const eventListeners = {};
  const mockBody = {
    appendChild: (el) => { el.parentNode = mockBody; mockBody.child = el; },
    removeChild: (el) => { if (el) el.parentNode = null; mockBody.child = null; }
  };

  const mockFinalizeTarget = {
    isConnected: true,
    attributes: {
      title: 'Finalize Action'
    },
    hasAttribute(name) { return name in this.attributes; },
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, val) { this.attributes[name] = val; },
    removeAttribute(name) { delete this.attributes[name]; },
    closest(selector) {
      if (selector.includes('finalize-split-group')) return {};
      return null;
    },
    getBoundingClientRect() { return { left: 100, top: 10, width: 30, height: 30, bottom: 40 }; },
    contains(other) { return this === other; }
  };

  global.document = {
    body: mockBody,
    getElementById: (id) => mockBody.child && mockBody.child.id === id ? mockBody.child : null,
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      style: {},
      classList: {
        add(cls) { this[cls] = true; },
        remove(cls) { delete this[cls]; },
        contains(cls) { return !!this[cls]; }
      },
      setAttribute(k, v) { this[k] = v; },
      removeAttribute(k) { delete this[k]; }
    }),
    addEventListener(name, handler) { eventListeners[name] = handler; },
    removeEventListener(name) { delete eventListeners[name]; },
    documentElement: { clientWidth: 800, clientHeight: 600 }
  };

  const { TooltipManager } = require('../../../client/js/ui/TooltipManager');
  const manager = new TooltipManager();
  manager.init();

  eventListeners['mouseover']({ target: mockFinalizeTarget });

  assert.strictEqual(mockFinalizeTarget.getAttribute('data-tooltip'), null, 'Finalize target was not given data-tooltip');
  assert(!mockBody.child.classList.contains('visible'), 'Floating tooltip was suppressed for finalize group');

  manager.dispose();
});

console.log('====================================');
console.log(`Tooltip Tests: Passed: ${passed} | Failed: ${failed}`);
console.log('====================================');

if (failed > 0) {
  process.exit(1);
}
