/**
 * FROST Guard — background.js (Manifest V3 service worker)
 *
 * Manages extension state: per-origin OPFS tracking, config storage,
 * badge updates, and notifications.
 */
const browser = globalThis.browser ?? globalThis.chrome;

// ── Default config ────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  enabled: true,
  opfsSizeCapBytes: 512 * 1024 * 1024,  // 512 MB
  timerJitterUs: 100,                    // ±100 µs
  allowlist: [],
  showNotifications: true,
};

// In-memory tracking of OPFS usage per origin
const originUsage = {};

// ── Config persistence ────────────────────────────────────────────────────
async function getConfig() {
  const result = await browser.storage.sync.get('config');
  return { ...DEFAULT_CONFIG, ...(result.config || {}) };
}

async function setConfig(config) {
  await browser.storage.sync.set({ config });
  // Notify all tabs of the change
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    try {
      browser.tabs.sendMessage(tab.id, { type: 'CONFIG_UPDATED', config });
    } catch (_) { /* tab may not have content script */ }
  }
}

// ── Badge & notification helpers ──────────────────────────────────────────
function updateBadge(tabId, text, color) {
  browser.action.setBadgeText({ text, tabId });
  browser.action.setBadgeBackgroundColor({ color, tabId });
}

async function notifyUser(title, message) {
  const config = await getConfig();
  if (!config.showNotifications) return;
  browser.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '❄️ ' + title,
    message,
  });
}

// ── Message handling ──────────────────────────────────────────────────────
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_CONFIG') {
    getConfig().then(sendResponse);
    return true; // async response
  }

  if (msg.type === 'SAVE_CONFIG') {
    setConfig(msg.config).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'GET_USAGE') {
    sendResponse({ usage: { ...originUsage } });
    return false;
  }

  if (msg.type === 'CLEAR_USAGE') {
    if (msg.origin) {
      delete originUsage[msg.origin];
    } else {
      Object.keys(originUsage).forEach(k => delete originUsage[k]);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'PAGE_EVENT') {
    handlePageEvent(msg, sender);
    return false;
  }
});

function handlePageEvent(msg, sender) {
  const tabId = sender.tab?.id;
  const origin = msg.origin || 'unknown';

  switch (msg.event) {
    case 'initialized':
      if (tabId) updateBadge(tabId, '✓', '#22c55e');
      break;

    case 'opfs_access':
      if (!originUsage[origin]) originUsage[origin] = { bytes: 0, blocked: 0 };
      if (tabId) updateBadge(tabId, 'FS', '#f59e0b');
      break;

    case 'opfs_write':
      if (!originUsage[origin]) originUsage[origin] = { bytes: 0, blocked: 0 };
      originUsage[origin].bytes = msg.detail.total || 0;
      break;

    case 'quota_exceeded':
      if (!originUsage[origin]) originUsage[origin] = { bytes: 0, blocked: 0 };
      originUsage[origin].blocked++;
      if (tabId) updateBadge(tabId, '⚠', '#ef4444');
      notifyUser(
        'OPFS Write Blocked',
        `${origin} tried to exceed the ${formatBytes(msg.detail.cap)} storage cap.\n` +
        `This is a behavior used by the FROST side-channel attack.`
      );
      break;

    case 'worker_intercepted':
      // silent tracking
      break;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
  return (b / 1024).toFixed(0) + ' KB';
}

// ── Install/update welcome ────────────────────────────────────────────────
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    browser.storage.sync.set({ config: DEFAULT_CONFIG });
    notifyUser('FROST Guard Installed', 'You are now protected against OPFS-based SSD timing attacks.');
  }
});
