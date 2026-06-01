/**
 * FROST Guard — content-script.js
 *
 * Runs in the ISOLATED world at document_start.
 * Bridges inject.js (page context) ↔ background.js (service worker).
 */
(() => {
  'use strict';

  const browser = globalThis.browser ?? globalThis.chrome;

  // ── Forward config to inject.js ─────────────────────────────────────────
  async function pushConfig() {
    try {
      const config = await browser.runtime.sendMessage({ type: 'GET_CONFIG' });
      window.postMessage({ type: 'FROST_GUARD_CONFIG', config }, '*');
    } catch (_) {
      // Extension context invalidated — ignore
    }
  }
  pushConfig();

  // Listen for config changes from background
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'CONFIG_UPDATED') {
      window.postMessage({ type: 'FROST_GUARD_CONFIG', config: msg.config }, '*');
    }
  });

  // ── Forward events from inject.js → background ─────────────────────────
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type !== 'FROST_GUARD_EVENT') return;

    try {
      browser.runtime.sendMessage({
        type: 'PAGE_EVENT',
        event: e.data.event,
        origin: e.data.origin,
        detail: e.data.detail,
      });
    } catch (_) {
      // Ignore if extension context died
    }
  });
})();
