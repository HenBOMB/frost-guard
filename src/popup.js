/**
 * FROST Guard — popup.js
 */
const browser = globalThis.browser ?? globalThis.chrome;

const $ = (sel) => document.querySelector(sel);

// ── Load state ────────────────────────────────────────────────────────────
async function init() {
  const config = await browser.runtime.sendMessage({ type: 'GET_CONFIG' });
  const { usage } = await browser.runtime.sendMessage({ type: 'GET_USAGE' });

  // Get current tab origin
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let origin = '—';
  try {
    origin = new URL(tab.url).origin;
  } catch (_) {}

  // Populate UI
  $('#toggle-enabled').checked = config.enabled;
  $('#site-origin').textContent = origin;
  $('#cap-value').textContent = formatBytes(config.opfsSizeCapBytes);
  $('#jitter-value').textContent = `±${config.timerJitterUs} µs`;

  // Usage for current origin
  const originData = usage[origin];
  if (originData) {
    $('#site-usage').textContent = formatBytes(originData.bytes) + ' used';
    if (originData.blocked > 0) {
      $('#blocked-section').style.display = '';
      $('#blocked-count').textContent = originData.blocked;
      $('#status-card').classList.add('alert');
      $('#status-icon').textContent = '⚠️';
      $('#status-label').textContent = 'Attack Blocked';
      $('#status-detail').textContent = `Suspicious OPFS activity detected on ${origin}`;
    }
  } else {
    $('#site-usage').textContent = '0 B used';
  }

  // Disabled state
  if (!config.enabled) {
    $('#status-card').classList.add('disabled');
    $('#status-icon').textContent = '🔓';
    $('#status-label').textContent = 'Disabled';
    $('#status-detail').textContent = 'FROST Guard protection is turned off';
  }

  // ── Toggle handler ────────────────────────────────────────────────────
  $('#toggle-enabled').addEventListener('change', async (e) => {
    config.enabled = e.target.checked;
    await browser.runtime.sendMessage({ type: 'SAVE_CONFIG', config });

    // Refresh display
    if (config.enabled) {
      $('#status-card').classList.remove('disabled');
      $('#status-icon').textContent = '❄️';
      $('#status-label').textContent = 'Protected';
      $('#status-detail').textContent = 'All FROST attack vectors blocked';
    } else {
      $('#status-card').classList.remove('alert');
      $('#status-card').classList.add('disabled');
      $('#status-icon').textContent = '🔓';
      $('#status-label').textContent = 'Disabled';
      $('#status-detail').textContent = 'FROST Guard protection is turned off';
    }
  });

  // ── Options link ──────────────────────────────────────────────────────
  $('#options-link').addEventListener('click', (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
  });
}

function formatBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}

init();
