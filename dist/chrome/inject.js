/**
 * FROST Guard — inject.js
 *
 * Runs in the page's JS context (world: "MAIN") and wraps the browser APIs
 * that the FROST attack depends on:
 *
 *   1. OPFS writes — capped so files stay in the OS page cache (no SSD reads)
 *   2. performance.now() — jittered when OPFS is active (destroys timing accuracy)
 *   3. Worker constructor — injects the same defenses into Web Workers
 *
 * Why this works: FROST needs an OPFS file larger than RAM to force cache
 * eviction. At the default 512 MB cap the file fits in memory, reads never
 * touch the SSD, and the contention side-channel disappears entirely.
 */
(() => {
  'use strict';

  if (window.__FROST_GUARD_ACTIVE__) return;
  window.__FROST_GUARD_ACTIVE__ = true;

  // ── Defaults (overridden by config message from content-script) ─────────
  const cfg = {
    enabled: true,
    opfsSizeCapBytes: 512 * 1024 * 1024,   // 512 MB
    timerJitterUs: 100,                      // ±100 µs
    allowlist: [],
  };

  // Check allowlist
  const origin = location.origin;
  function isAllowed() {
    return cfg.allowlist.some(p => origin.includes(p));
  }

  // Accept dynamic config updates from the content-script (isolated world)
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type === 'FROST_GUARD_CONFIG') {
      Object.assign(cfg, e.data.config);
    }
  });

  // Report events to content-script → background
  function report(event, detail = {}) {
    window.postMessage({
      type: 'FROST_GUARD_EVENT',
      event,
      origin,
      detail,
    }, '*');
  }

  // ── Per-origin byte tracking ────────────────────────────────────────────
  let totalBytesWritten = 0;
  let opfsActive = false;

  function checkQuota(bytes) {
    if (!cfg.enabled || isAllowed()) return true;
    if (totalBytesWritten + bytes > cfg.opfsSizeCapBytes) {
      report('quota_exceeded', {
        attempted: bytes,
        total: totalBytesWritten,
        cap: cfg.opfsSizeCapBytes,
      });
      return false;
    }
    return true;
  }

  function trackWrite(bytes) {
    totalBytesWritten += bytes;
    report('opfs_write', { bytes, total: totalBytesWritten });
  }

  // ── 1. Fuzz performance.now() ───────────────────────────────────────────
  const _perfNow = performance.now.bind(performance);

  Object.defineProperty(performance, 'now', {
    configurable: true,
    writable: true,
    value: function () {
      const real = _perfNow();
      if (!cfg.enabled || isAllowed() || !opfsActive) return real;
      const jitterMs = (Math.random() - 0.5) * 2 * (cfg.timerJitterUs / 1000);
      return real + jitterMs;
    },
  });

  // ── 2. Wrap OPFS entry-point ────────────────────────────────────────────
  if (navigator.storage?.getDirectory) {
    const _getDirectory = navigator.storage.getDirectory.bind(navigator.storage);

    navigator.storage.getDirectory = async function () {
      opfsActive = true;
      report('opfs_access');
      const root = await _getDirectory();

      if (!cfg.enabled || isAllowed()) return root;
      return wrapDirectoryHandle(root);
    };
  }

  // ── Handle wrappers ────────────────────────────────────────────────────
  function wrapDirectoryHandle(handle) {
    const _getFileHandle = handle.getFileHandle.bind(handle);
    const _getDirectoryHandle = handle.getDirectoryHandle?.bind(handle);

    handle.getFileHandle = async function (name, opts) {
      const fh = await _getFileHandle(name, opts);
      return wrapFileHandle(fh);
    };

    if (_getDirectoryHandle) {
      handle.getDirectoryHandle = async function (name, opts) {
        const dh = await _getDirectoryHandle(name, opts);
        return wrapDirectoryHandle(dh);
      };
    }

    return handle;
  }

  function wrapFileHandle(handle) {
    // Wrap createWritable (main thread)
    if (handle.createWritable) {
      const _createWritable = handle.createWritable.bind(handle);
      handle.createWritable = async function (opts) {
        const writable = await _createWritable(opts);
        return wrapWritableStream(writable);
      };
    }

    // Wrap createSyncAccessHandle (workers only, but guard anyway)
    if (handle.createSyncAccessHandle) {
      const _createSync = handle.createSyncAccessHandle.bind(handle);
      handle.createSyncAccessHandle = async function () {
        const syncHandle = await _createSync();
        return wrapSyncAccessHandle(syncHandle);
      };
    }

    return handle;
  }

  function wrapWritableStream(writable) {
    const _write = writable.write.bind(writable);

    writable.write = async function (data) {
      const size = data?.byteLength ?? data?.size ?? (typeof data === 'string' ? data.length : 0);
      if (!checkQuota(size)) {
        throw new DOMException(
          `FROST Guard: OPFS write blocked — origin exceeded ${formatBytes(cfg.opfsSizeCapBytes)} cap.`,
          'QuotaExceededError'
        );
      }
      trackWrite(size);
      return _write(data);
    };

    return writable;
  }

  function wrapSyncAccessHandle(syncHandle) {
    const _write = syncHandle.write.bind(syncHandle);
    const _truncate = syncHandle.truncate?.bind(syncHandle);

    syncHandle.write = function (buffer, opts) {
      const size = buffer?.byteLength ?? buffer?.length ?? 0;
      if (!checkQuota(size)) {
        throw new DOMException(
          `FROST Guard: OPFS write blocked — origin exceeded ${formatBytes(cfg.opfsSizeCapBytes)} cap.`,
          'QuotaExceededError'
        );
      }
      trackWrite(size);
      return _write(buffer, opts);
    };

    if (_truncate) {
      syncHandle.truncate = function (newSize) {
        if (newSize > cfg.opfsSizeCapBytes) {
          throw new DOMException(
            `FROST Guard: OPFS truncate blocked — ${formatBytes(newSize)} exceeds cap.`,
            'QuotaExceededError'
          );
        }
        return _truncate(newSize);
      };
    }

    return syncHandle;
  }

  // ── 3. Inject defenses into Web Workers ────────────────────────────────
  const _Worker = window.Worker;
  const _Blob = window.Blob;

  // Defense code injected into every worker
  const WORKER_DEFENSE = `
(function(){
  if(self.__FROST_GUARD_ACTIVE__)return;
  self.__FROST_GUARD_ACTIVE__=true;

  var _cfg={enabled:true,opfsSizeCapBytes:${cfg.opfsSizeCapBytes},timerJitterUs:${cfg.timerJitterUs}};
  var _totalBytes=0;
  var _opfsActive=false;

  function _checkQuota(b){
    if(!_cfg.enabled)return true;
    return(_totalBytes+b)<=_cfg.opfsSizeCapBytes;
  }
  function _trackWrite(b){_totalBytes+=b;}

  /* Fuzz performance.now() */
  var _pn=performance.now.bind(performance);
  performance.now=function(){
    var r=_pn();
    if(!_cfg.enabled||!_opfsActive)return r;
    return r+(Math.random()-0.5)*2*(_cfg.timerJitterUs/1000);
  };

  /* Wrap navigator.storage.getDirectory */
  if(navigator.storage&&navigator.storage.getDirectory){
    var _gd=navigator.storage.getDirectory.bind(navigator.storage);
    navigator.storage.getDirectory=function(){
      _opfsActive=true;
      return _gd().then(function(root){
        if(!_cfg.enabled)return root;
        return _wrapDir(root);
      });
    };
  }

  function _wrapDir(h){
    var _gfh=h.getFileHandle.bind(h);
    h.getFileHandle=function(n,o){return _gfh(n,o).then(_wrapFH);};
    if(h.getDirectoryHandle){
      var _gdh=h.getDirectoryHandle.bind(h);
      h.getDirectoryHandle=function(n,o){return _gdh(n,o).then(_wrapDir);};
    }
    return h;
  }

  function _wrapFH(h){
    if(h.createSyncAccessHandle){
      var _cs=h.createSyncAccessHandle.bind(h);
      h.createSyncAccessHandle=function(){return _cs().then(_wrapSAH);};
    }
    if(h.createWritable){
      var _cw=h.createWritable.bind(h);
      h.createWritable=function(o){return _cw(o).then(_wrapWS);};
    }
    return h;
  }

  function _wrapSAH(s){
    var _w=s.write.bind(s);
    s.write=function(buf,opts){
      var sz=buf&&buf.byteLength?buf.byteLength:0;
      if(!_checkQuota(sz))throw new DOMException('FROST Guard: OPFS write blocked','QuotaExceededError');
      _trackWrite(sz);
      return _w(buf,opts);
    };
    if(s.truncate){
      var _t=s.truncate.bind(s);
      s.truncate=function(n){
        if(n>_cfg.opfsSizeCapBytes)throw new DOMException('FROST Guard: truncate blocked','QuotaExceededError');
        return _t(n);
      };
    }
    return s;
  }

  function _wrapWS(w){
    var _wr=w.write.bind(w);
    w.write=function(d){
      var sz=d&&d.byteLength?d.byteLength:d&&d.size?d.size:typeof d==='string'?d.length:0;
      if(!_checkQuota(sz))throw new DOMException('FROST Guard: OPFS write blocked','QuotaExceededError');
      _trackWrite(sz);
      return _wr(d);
    };
    return w;
  }
})();
`;

  window.Worker = function (source, options) {
    const sourceStr = String(source);
    const isModule = options?.type === 'module';

    try {
      let wrapper;
      if (isModule) {
        wrapper = WORKER_DEFENSE + '\nimport ' + JSON.stringify(sourceStr) + ';\n';
      } else {
        wrapper = WORKER_DEFENSE + '\nimportScripts(' + JSON.stringify(sourceStr) + ');\n';
      }

      const blob = new _Blob([wrapper], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new _Worker(url, options);
      report('worker_intercepted');
      return worker;
    } catch (_e) {
      // Fallback: if wrapping fails, create original worker
      return new _Worker(source, options);
    }
  };

  // Preserve Worker prototype chain and static properties
  window.Worker.prototype = _Worker.prototype;
  Object.defineProperty(window.Worker, 'name', { value: 'Worker', configurable: true });

  // ── Helpers ─────────────────────────────────────────────────────────────
  function formatBytes(b) {
    if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
  }

  report('initialized');
  console.log(
    '%c❄️ FROST Guard active%c — OPFS cap: ' + formatBytes(cfg.opfsSizeCapBytes) +
    ', timer jitter: ±' + cfg.timerJitterUs + 'µs',
    'color:#60a5fa;font-weight:bold', 'color:#94a3b8'
  );
})();
