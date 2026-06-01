# ❄️ FROST Guard

**Browser extension that protects against the FROST side-channel attack.**

FROST (*Fingerprinting Remotely using OPFS-based SSD Timing*) is a browser-based side-channel attack that lets malicious websites spy on your system activity — detecting which websites you visit and which applications you open — by measuring SSD contention through the Origin Private File System (OPFS) API. No user interaction is required; the attack runs silently in the background.

FROST Guard neutralizes this attack at the API level, before it can collect any data.

---

## How the Attack Works

1. A malicious website creates a **large file via OPFS** (bigger than your RAM) — no permissions needed
2. The file is too big for the OS page cache, so every read hits the **physical SSD**
3. The site measures **SSD access latency** with `performance.now()` to detect contention from your other activities
4. A machine-learning classifier identifies which **websites you visit** (F1: 89%) and which **apps you open** (F1: 96%)

## How FROST Guard Stops It

| Defense Layer | What It Does | Why It Works |
|---|---|---|
| **OPFS Size Cap** | Limits OPFS storage to 512 MB per origin (configurable) | File stays in the page cache → reads never hit the SSD → **zero contention signal** |
| **Timer Fuzzing** | Adds ±100 µs random jitter to `performance.now()` when OPFS is active | The attack needs sub-100 µs accuracy; jitter makes measurements useless |
| **Worker Injection** | Injects the same defenses into Web Workers created by the page | The attack uses `FileSystemSyncAccessHandle` in workers; this closes that path |
| **Activity Monitor** | Tracks OPFS usage per origin and alerts on suspicious behavior | You'll know immediately if a site tries to exploit you |

---

## Installation

### Chrome / Edge / Brave (Chromium)

1. Download or build `frost-guard-chrome.zip` (see [Building](#building))
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the extracted `dist/chrome/` folder
5. FROST Guard appears in your toolbar — you're protected ❄️

### Firefox

1. Download or build `frost-guard-firefox.zip` (see [Building](#building))
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** and select `manifest.json` from the extracted `dist/firefox/` folder
4. For permanent installation, the extension must be signed via [addons.mozilla.org](https://addons.mozilla.org)

> **Note:** Firefox support requires Firefox 128+ (for `world: "MAIN"` content script support).

---

## Building

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/frost-guard.git
cd frost-guard

# Build both targets
./build.sh

# Or build one target
./build.sh chrome
./build.sh firefox
```

Output:
```
dist/
├── frost-guard-chrome.zip
├── frost-guard-firefox.zip
├── chrome/          ← load this as unpacked extension
└── firefox/         ← load this as temporary add-on
```

**Requirements:** `zip` command (pre-installed on most systems).

---

## Configuration

Click the FROST Guard icon in your toolbar for a quick status view, or go to **Settings** for full control:

| Setting | Default | Description |
|---|---|---|
| **OPFS Size Cap** | 512 MB | Max OPFS storage per origin. Keep below your RAM size. |
| **Timer Jitter** | ±100 µs | Noise added to `performance.now()` when OPFS is active. |
| **Notifications** | On | Alert when an attack is blocked. |
| **Allowlist** | Empty | Origins that bypass protections (e.g., `figma.com`). |

### Allowlist Guidance

Some legitimate web apps use large OPFS files (browser-based IDEs, design tools, video editors). If an app you trust stops working, add its origin to the allowlist. Only allowlist sites you fully trust.

---

## How It Works (Technical)

FROST Guard injects a defense script into every page's JavaScript context using Manifest V3's `world: "MAIN"` content script injection. This script:

1. **Wraps `navigator.storage.getDirectory()`** — returns proxied handles that enforce the size cap on all write operations (`write()`, `truncate()`)
2. **Wraps `performance.now()`** — adds configurable random jitter when OPFS handles are open
3. **Wraps the `Worker` constructor** — prepends defense code into any Web Worker the page creates, covering `FileSystemSyncAccessHandle` operations
4. **Reports activity** to the background service worker via a content-script bridge for monitoring and badge updates

The defense is **passive and zero-config** — it works immediately on install with no user interaction required.

---

## FAQ

**Will this break normal websites?**
No. Almost no legitimate website creates OPFS files larger than 512 MB. Normal `localStorage`, `IndexedDB`, and small OPFS usage are completely unaffected.

**Does this affect browsing speed?**
No measurable impact. The API wrapping adds nanoseconds of overhead per call, and timer jitter is only applied when OPFS is actively in use.

**What about multi-origin attacks?**
The paper mentions attackers using multiple origins to bypass per-origin storage limits. FROST Guard enforces its cap *per origin independently*, so each origin is still limited to 512 MB — the attacker would need hundreds of cooperating origins to exceed typical RAM sizes, which is impractical.

**Can the page detect FROST Guard?**
In theory, a page could try to detect the API wrapping. However, the defense code runs before any page scripts (`document_start`), and the wrapped APIs maintain the same interface. Sophisticated detection is possible but adds complexity for the attacker with no benefit — the defense still works even if detected.

---

## References

- [FROST: Fingerprinting Remotely using OPFS-based SSD Timing](https://gruss.cc) — Weissteiner et al., Graz University of Technology
- [Origin Private File System — MDN](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)
- [Chrome Manifest V3 — Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

---

## License

MIT
