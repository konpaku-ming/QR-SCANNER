# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QR SCANNER is a Microsoft Edge browser extension (Manifest V3) that scans web pages for QR codes and renders clickable overlay highlights. It uses **zxing-wasm** (ZXing-C++ WebAssembly) as the primary decoding engine for high-accuracy multi-QR detection, with a fallback to jsQR. It is written in vanilla JavaScript with no build system or bundler.

## Project Structure

```
manifest.json              # Manifest V3 entry point
src/
  background.js            # Service Worker: context menus, shortcuts, scan orchestration
  content_script.js        # Injected into all pages: screenshot decoding, region selection, overlays
  popup/                   # Extension popup (scan/region/clipboard/clear/history controls)
    popup.html
    popup.js
  options/                 # Settings page (auto-scan/history/open-link policy)
  lib/
    zxing-wasm/            # ZXing-C++ WASM build (reader only, ~843KB)
      zxing-wasm.iife.js   # IIFE build entry
      zxing_reader.wasm    # WASM binary
    qr-utils.js            # Shared pure helpers (settings, URL safety, image matching, region clamp)
    qr-engine.js           # Unified decoding facade (zxing-wasm → fallback jsQR)
    qr-decoder.js          # Fallback pure-JS decoder (greedy erase + sliding window + adaptive threshold)
    jsQR.js                # Bundled third-party QR decoder (~10k lines, fallback only)
styles/overlay.css         # Injected overlay styles (z-index: 2147483647)
assets/icons/              # Extension icons (16, 32, 48, 128)
Plan.md                    # Development plan (in Chinese)
docs/
  zxing-wasm-migration-plan.md  # Migration plan (implemented)
tests/
  node-unit-test.js        # Node.js pure-logic tests
  unit-test.html           # Browser unit tests
  manual-test.html         # Manual interactive tests
  e2e-spa.html             # SPA auto-rescan E2E tests
```

## Architecture & Key Data Flows

1. **Scan Trigger**: Popup button, context menu (image right-click), or keyboard shortcut (`Alt+Shift+Q`) → `background.js` calls `triggerScan(tabId)`.
2. **Screenshot Capture**: `triggerScan` calls `chrome.tabs.captureVisibleTab()` to capture the current viewport as a PNG data URL, then sends `START_SCAN_SCREENSHOT` with the screenshot URL to the content script. **No dynamic script injection** is performed; all libraries are loaded automatically by `manifest.json` `content_scripts`.
3. **Decoding**: `content_script.js` loads the screenshot into an `Image`, then calls `QR_ENGINE.decodeImage(screenshotImg)`. `qr-engine.js` first attempts **zxing-wasm** (`readBarcodes` with `maxNumberOfSymbols: 0` for unlimited multi-QR detection). If zxing-wasm fails to initialize, it automatically falls back to `qr-decoder.js` (greedy erase + sliding window + adaptive threshold).
4. **Overlay Rendering**: On successful decode, `renderOverlayAtRect` creates an absolutely positioned `div` with class `qrhunt-overlay` at the decoded QR code's location (mapped from screenshot pixels to page CSS coordinates via `window.devicePixelRatio`). Clicking the overlay shows a floating action menu (`showQrMenu`) with "Open Link" and "Copy" buttons. The menu is styled by `.qrhunt-menu` in `overlay.css`.
5. **Context Menu Scan**: Right-clicking an image triggers `contextMenus.onClicked` in `background.js`, which sends `SCAN_SINGLE_IMAGE` with the image URL. The content script calls `QR_ENGINE.decodeImage(imgElement)`. If CORS blocks direct canvas read, it sends `FETCH_IMAGE` back to the background, which fetches the image as a blob, converts it to a data URL, and returns it. The content script then decodes the data URL and renders the overlay.
6. **Region Scan**: Clicking "框选页面区域" in the popup sends `START_REGION_SELECT` to the active tab. The content script renders a full-page selection mask, captures the visible tab via `CAPTURE_REGION`, clamps the selected rectangle with `QR_UTILS.clampRegionToImage`, decodes the cropped `ImageData`, and shows a floating result.
7. **Clipboard Scan**: Clicking the "识别剪贴板" button in the popup calls `navigator.clipboard.read()` (requires the `clipboardRead` permission). It searches the clipboard items for an image blob, converts it to a data URL using `FileReader`, then calls `QR_ENGINE.decodeImage(img)` inside the popup context. This works for any screenshot taken with system tools (e.g., Win+Shift+S), bypassing browser page boundaries entirely.
8. **History Persistence**: On every successful decode, `saveHistory(qrData)` is called. It reads `qr_scanner_history` from `chrome.storage.local`, deduplicates by `data`, prepends a new entry with `{id, data, url, title, timestamp}`, and caps the list at `qr_scanner_settings.maxHistoryItems` (default 50). The popup reads the same key to render the 5 most recent items with open/copy/delete actions.
9. **Settings Persistence**: `qr-utils.js` defines defaults under `QR_UTILS.DEFAULT_SETTINGS` and the storage key `qr_scanner_settings`. Options, popup, and content script all merge stored settings through `QR_UTILS.mergeSettings`.
10. **Scan Feedback**: After any scan completes, `updateBadge()` sends `UPDATE_BADGE` to the background, which sets the extension action badge text to the count of found QR codes. `showScanToast` displays a transient fixed-position toast on the page for success/warning/error states.
11. **SPA Dynamic Re-scanning**: A `MutationObserver` watches `document.documentElement` for childList changes only when `autoScanEnabled` is true. `shouldScanForMutations` filters mutations to only those that add `<img>` elements (or containers containing `<img>`). A debounced auto-scan fires 1.5s after the last relevant mutation, with a 3s minimum interval between scans. `observeHistoryChanges` monkey-patches `history.pushState`/`replaceState` and listens to `popstate` to detect SPA route changes. Auto-scan sends `TRIGGER_AUTO_SCAN` to the background, which captures a new screenshot and sends `START_AUTO_SCAN_SCREENSHOT` back to the content script. The content script runs `startScreenshotScan(..., { clearExisting: false })` so existing overlays are preserved.
12. **Message API**: Cross-context communication uses `chrome.runtime.sendMessage` / `onMessage` with actions: `START_SCAN` (legacy direct canvas scan), `START_SCAN_SCREENSHOT` (manual screenshot scan), `START_AUTO_SCAN_SCREENSHOT` (auto re-scan preserving overlays), `SCAN_SINGLE_IMAGE` (context-menu image scan), `SCAN_IMAGE_DATA_URL` (decode a prefetched image), `FETCH_IMAGE` (background fetch for CORS bypass), `UPDATE_BADGE` (set action badge count), `TRIGGER_AUTO_SCAN` (content script requests background to trigger auto-scan), `TRIGGER_SCAN` (popup requests background to trigger scan), `CLEAR_OVERLAYS`, `START_REGION_SELECT`, `CAPTURE_REGION`.

## Important Implementation Details

- **No build system**: There is no `package.json`, bundler, or transpilation. Files are loaded directly by the browser. Extension code must remain plain ES2020-compatible JavaScript.
- **Primary decoder: zxing-wasm**: The extension uses `zxing-wasm` (ZXing-C++ compiled to WebAssembly) as the primary QR decoder. It is loaded via IIFE script in `manifest.json` `content_scripts.js`. WASM files are served from the extension itself via `chrome.runtime.getURL()` and `web_accessible_resources`.
- **Fallback decoder: qr-decoder.js + jsQR**: If zxing-wasm fails to initialize (e.g., CSP blocks WASM), `qr-engine.js` automatically falls back to `qr-decoder.js`, which implements greedy erase-and-rescan, sliding window multi-scale scanning, and integral-image adaptive thresholding.
- **CORS handling**: Cross-origin images are handled via `chrome.tabs.captureVisibleTab` screenshot scanning. The content script maps each QR code's location in the screenshot (from zxing-wasm's `position` output) to page CSS coordinates using `window.devicePixelRatio`. The legacy `START_SCAN` direct-canvas path remains for same-origin images but is no longer used by popup/shortcut triggers.
- **Library loading**: All libraries (zxing-wasm.iife.js, qr-utils.js, qr-engine.js, qr-decoder.js, jsQR.js) are loaded automatically by `manifest.json` `content_scripts` in the isolated world. `background.js` no longer performs any `executeScript` dynamic injection.
- **Shared helpers**: Put reusable pure logic in `src/lib/qr-utils.js` so it can be used by content scripts, extension pages, and Node tests. Current helpers cover settings defaults/merge, URL normalization and safe-open checks, image URL matching, and region crop clamping.
- **WASM preloading**: `QR_ENGINE.init()` is called eagerly in both the content script (on page load) and the popup (on DOMContentLoaded) to avoid the ~100–300ms WASM compilation delay on the first scan.
- **Overlay CSS isolation**: `styles/overlay.css` is declared in `manifest.json` as a content script CSS file, so it is automatically injected into all matched pages. The overlay class name is `qrhunt-overlay`.
- **Manifest permissions**: `activeTab`, `scripting`, `storage`, `contextMenus`, `tabs`, `clipboardRead`, and `<all_urls>` host permission. `storage` is used for settings/history; `tabs` is used for active-tab lookup and visible-tab capture orchestration.
- **Current implementation status**: Scan history, Options persistence, region selection, SPA MutationObserver re-scanning, clipboard scan, zxing-wasm integration, whole-image multi-QR detection, right-click URL matching, and safe-open filtering are implemented. Browser automation remains a future improvement; manual browser test pages are still the primary end-to-end validation path.

## Common Development Tasks

- **Load in Edge**: Open `edge://extensions/`, enable Developer mode, click "Load unpacked", and select the repository root.
- **Reload after changes**: After editing background/popup/options files, click the **Reload** button on `edge://extensions/`. Content script and CSS changes usually require a **page refresh**.
- **Verify zxing-wasm loaded**: Open any webpage, open DevTools Console, and look for `[QR SCANNER] zxing-wasm initialized`.
- **Run jsQR standalone**: Open any webpage, paste `src/lib/jsQR.js` into the console, then call `jsQR(imageData.data, width, height)`.
- **Run zxing-wasm standalone**: Open any webpage, ensure `ZXingWASM` is loaded, then call `await ZXingWASM.readBarcodes(imageData, { formats: ['QRCode'], maxNumberOfSymbols: 0 })`.
- **Package for distribution**: Run `python3 scripts/build-release.py v0.1.0`; the script excludes development-only files and writes `dist/qr-scanner-v0.1.0.zip`.

## Style & Conventions

- UI text and comments are in Chinese.
- Use `console.log('[QR SCANNER] ...')` for logging.
- Overlay element class name: `qrhunt-overlay`.
- Prefer `chrome.*` APIs over `browser.*` (this is a Chromium-only extension).

## Testing

- **Node.js unit tests**: `node tests/node-unit-test.js` — tests pure logic (truncate, coordinate mapping, `qr-utils.js`, image filtering, jsQR loading, qr-decoder pure functions) with zero browser dependencies.
- **Browser unit tests**: Start `python3 -m http.server` from repo root, then open `http://localhost:8765/tests/unit-test.html` in a browser. Requires network to load a test QR code image from `api.qrserver.com`.
- **Manual browser tests**: Open `http://localhost:8765/tests/manual-test.html` with the extension loaded in Edge to verify screenshot scanning, context-menu scanning, overlay menus, badge counts, and toast notifications interactively.
- **SPA E2E tests**: Open `http://localhost:8765/tests/e2e-spa.html` to verify MutationObserver auto-rescan with dynamic content and route changes.
- When adding new pure functions in `content_script.js`, add corresponding test cases in `tests/node-unit-test.js` and `tests/unit-test.html`.

## Documentation Maintenance

- **`README.md`** is the user-facing manual. Any functional change (adding/removing features, changing behavior, updating permissions, or modifying UI text) must be reflected in `README.md` in the same commit or change set. Keep feature status descriptions and the "已知限制" section up to date.
- **`CLAUDE.md`** is the developer-facing architecture guide. Any structural change (new files, changed data flows, modified library loading strategy) must be reflected here.
