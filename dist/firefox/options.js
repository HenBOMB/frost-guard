/**
 * FROST Guard — options.js
 */
const browser = globalThis.browser ?? globalThis.chrome;

const $ = (sel) => document.querySelector(sel);

let currentConfig = {};

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  currentConfig = await browser.runtime.sendMessage({ type: 'GET_CONFIG' });

  // Populate controls
  $('#opfs-cap').value = currentConfig.opfsSizeCapBytes / (1024 * 1024);
  $('#opfs-cap-value').textContent = formatMB(currentConfig.opfsSizeCapBytes);
  $('#timer-jitter').value = currentConfig.timerJitterUs;
  $('#timer-jitter-value').textContent = `±${currentConfig.timerJitterUs} µs`;
  $('#show-notifications').checked = currentConfig.showNotifications ?? true;

  renderAllowlist();
  await loadUsage();

  // ── Range live-update ──────────────────────────────────────────────────
  $('#opfs-cap').addEventListener('input', (e) => {
    const mb = parseInt(e.target.value, 10);
    $('#opfs-cap-value').textContent = mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB';
  });

  $('#timer-jitter').addEventListener('input', (e) => {
    $('#timer-jitter-value').textContent = `±${e.target.value} µs`;
  });

  // ── Add to allowlist ───────────────────────────────────────────────────
  $('#add-btn').addEventListener('click', addOrigin);
  $('#add-origin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addOrigin();
  });

  // ── Save ───────────────────────────────────────────────────────────────
  $('#save-btn').addEventListener('click', save);

  // ── Clear usage ────────────────────────────────────────────────────────
  $('#clear-usage-btn').addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'CLEAR_USAGE' });
    await loadUsage();
  });
}

// ── Allowlist ─────────────────────────────────────────────────────────────
function renderAllowlist() {
  const container = $('#allowlist');
  container.innerHTML = '';

  if (!currentConfig.allowlist?.length) {
    container.innerHTML = '<p class="empty-state">No allowed origins.</p>';
    return;
  }

  currentConfig.allowlist.forEach((origin, i) => {
    const el = document.createElement('div');
    el.className = 'allowlist-item';
    el.innerHTML = `<span>${escapeHtml(origin)}</span><button data-i="${i}" title="Remove">✕</button>`;
    el.querySelector('button').addEventListener('click', () => {
      currentConfig.allowlist.splice(i, 1);
      renderAllowlist();
    });
    container.appendChild(el);
  });
}

function addOrigin() {
  const input = $('#add-origin');
  const val = input.value.trim();
  if (!val) return;

  if (!currentConfig.allowlist) currentConfig.allowlist = [];
  if (!currentConfig.allowlist.includes(val)) {
    currentConfig.allowlist.push(val);
    renderAllowlist();
  }
  input.value = '';
}

// ── Usage Table ───────────────────────────────────────────────────────────
async function loadUsage() {
  const { usage } = await browser.runtime.sendMessage({ type: 'GET_USAGE' });
  const container = $('#usage-table');

  const origins = Object.keys(usage);
  if (!origins.length) {
    container.innerHTML = '<p class="empty-state">No OPFS activity recorded this session.</p>';
    return;
  }

  container.innerHTML = origins.map((origin) => {
    const data = usage[origin];
    return `
      <div class="usage-row">
        <span class="usage-origin">${escapeHtml(origin)}</span>
        <span class="usage-bytes">${formatBytes(data.bytes)}</span>
        ${data.blocked ? `<span class="usage-blocked">${data.blocked} blocked</span>` : '<span></span>'}
      </div>`;
  }).join('');
}

// ── Save ──────────────────────────────────────────────────────────────────
async function save() {
  currentConfig.opfsSizeCapBytes = parseInt($('#opfs-cap').value, 10) * 1024 * 1024;
  currentConfig.timerJitterUs = parseInt($('#timer-jitter').value, 10);
  currentConfig.showNotifications = $('#show-notifications').checked;

  await browser.runtime.sendMessage({ type: 'SAVE_CONFIG', config: currentConfig });

  const status = $('#save-status');
  status.textContent = '✓ Settings saved';
  setTimeout(() => { status.textContent = ''; }, 2000);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}

function formatMB(b) {
  const mb = b / (1024 * 1024);
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB';
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

init();
