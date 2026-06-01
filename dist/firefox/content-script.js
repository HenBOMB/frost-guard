/**
 * FROST Guard — content-script.js
 *
 * Runs in the ISOLATED world at document_start.
 * Bridges inject.js (page context) ↔ background.js (service worker).
 */
(() => {
  'use strict';

  const browser = globalThis.browser ?? globalThis.chrome;

  let secret = null;

  // Listen for the secret token from inject.js (dispatched synchronously at document_start)
  document.addEventListener('FROST_GUARD_SECRET', (e) => {
    secret = e.detail;
    pushConfig();
  }, { once: true });

  // ── Forward config to inject.js ─────────────────────────────────────────
  async function pushConfig() {
    if (!secret) return;
    try {
      const config = await browser.runtime.sendMessage({ type: 'GET_CONFIG' });
      window.postMessage({ type: 'FROST_GUARD_CONFIG', config, secret }, '*');
    } catch (_) {
      // Extension context invalidated — ignore
    }
  }

  // Listen for config changes from background
  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'CONFIG_UPDATED' && secret) {
      window.postMessage({ type: 'FROST_GUARD_CONFIG', config: msg.config, secret }, '*');
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
