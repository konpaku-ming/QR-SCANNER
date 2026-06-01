# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QR SCANNER is a Microsoft Edge browser extension (Manifest V3) that scans web pages for QR codes in `<img>` elements and renders clickable overlay highlights. It is written in vanilla JavaScript with no build system or bundler.

## Project Structure

```
manifest.json              # Manifest V3 entry point
src/
  background.js            # Service Worker: context menus, shortcuts, scan orchestration
  content_script.js        # Injected into all pages: DOM traversal, decoding, overlay rendering
  popup/                   # Extension popup (scan/clear controls)
  options/                 # Settings page (currently a placeholder)
  lib/jsQR.js              # Bundled third-party QR decoder (~10k lines)
styles/overlay.css         # Injected overlay styles (z-index: 2147483647)
assets/icons/              # Extension icons (16, 32, 48, 128)
Plan.md                    # Development plan (in Chinese); contains roadmap and known technical challenges
```

## Architecture & Key Data Flows

1. **Scan Trigger**: Popup button, context menu (image right-click), or keyboard shortcut (`Alt+Shift+Q`) → `background.js` calls `triggerScan(tabId)`.
2. **Screenshot Capture**: `triggerScan` calls `chrome.tabs.captureVisibleTab()` to capture the current viewport as a PNG data URL, injects `src/lib/jsQR.js`, then sends `START_SCAN_SCREENSHOT` with the screenshot URL to the content script.
3. **Content Script Scanning**: `content_script.js` collects `<img>` elements visible in the viewport (`width > 50 && height > 50`, partially or fully visible). For each image, it maps the element's viewport CSS coordinates (`getBoundingClientRect`) to physical pixel coordinates in the screenshot using `window.devicePixelRatio`, crops the corresponding region from the screenshot, and runs `jsQR(imageData, width, height)`.
4. **Overlay Rendering**: On successful decode, `renderOverlay` creates an absolutely positioned `div` with class `qrhunt-overlay` at the image's page location. Clicking the overlay shows a floating action menu (`showQrMenu`) with "Open Link" and "Copy" buttons. The menu is styled by `.qrhunt-menu` in `overlay.css`.
5. **Context Menu Scan**: Right-clicking an image triggers `contextMenus.onClicked` in `background.js`, which injects jsQR and sends `SCAN_SINGLE_IMAGE` with the image URL. The content script first tries direct `decodeImage`; if CORS blocks it, it sends `FETCH_IMAGE` back to the background, which fetches the image as a blob, converts it to a data URL, and returns it via the response callback. The content script then decodes the data URL and renders the overlay.
6. **Clipboard Scan**: Clicking the "识别剪贴板" button in the popup calls `navigator.clipboard.read()` (requires the `clipboardRead` permission). It searches the clipboard items for an image blob, converts it to a data URL using `FileReader`, decodes it with jsQR inside the popup context, saves the result to `chrome.storage.local`, and refreshes the history list. This works for any screenshot taken with system tools (e.g., Win+Shift+S), bypassing browser page boundaries entirely.
7. **History Persistence**: On every successful decode, `saveHistory(qrData)` is called in the content script. It reads `qr_scanner_history` from `chrome.storage.local`, deduplicates by `data`, prepends a new entry with `{id, data, url, title, timestamp}`, and caps the list at 50 items. The popup reads the same key to render the 5 most recent items with open/copy/delete actions.
8. **Scan Feedback**: After any scan completes, `updateBadge()` sends `UPDATE_BADGE` to the background, which sets the extension action badge text to the count of found QR codes. `showScanToast` displays a transient fixed-position toast on the page for success/warning/error states.
9. **SPA Dynamic Re-scanning**: A `MutationObserver` watches `document.documentElement` for childList changes. `shouldScanForMutations` filters mutations to only those that add `<img>` elements (or containers containing `<img>`). A debounced auto-scan fires 1.5s after the last relevant mutation, with a 3s minimum interval between scans. `observeHistoryChanges` monkey-patches `history.pushState`/`replaceState` and listens to `popstate` to detect SPA route changes. Auto-scan sends `TRIGGER_AUTO_SCAN` to the background, which captures a new screenshot and sends `START_AUTO_SCAN_SCREENSHOT` back to the content script. The content script runs `startScreenshotScan(..., { clearExisting: false })` so existing overlays are preserved and only newly added images get highlighted.
10. **Message API**: Cross-context communication uses `chrome.runtime.sendMessage` / `onMessage` with actions: `START_SCAN` (legacy direct canvas scan), `START_SCAN_SCREENSHOT` (manual screenshot scan), `START_AUTO_SCAN_SCREENSHOT` (auto re-scan preserving overlays), `SCAN_SINGLE_IMAGE` (context-menu image scan), `SCAN_IMAGE_DATA_URL` (decode a prefetched image), `FETCH_IMAGE` (background fetch for CORS bypass), `UPDATE_BADGE` (set action badge count), `TRIGGER_AUTO_SCAN` (content script requests background to trigger auto-scan), `CLEAR_OVERLAYS`.

## Important Implementation Details

- **No build system**: There is no `package.json`, bundler, or transpilation. Files are loaded directly by the browser. Extension code must remain plain ES2020-compatible JavaScript.
- **CORS handling**: Cross-origin images are now handled via `chrome.tabs.captureVisibleTab` screenshot scanning. The content script maps each image's viewport CSS coordinates (`getBoundingClientRect`) to physical pixel coordinates in the screenshot using `window.devicePixelRatio`, crops the region, and feeds it to jsQR. The legacy `START_SCAN` direct-canvas path remains for same-origin images but is no longer used by popup/shortcut triggers.
- **Dynamic library loading**: `jsQR` is not bundled into the content script. Both `background.js` and `popup.js` inject `src/lib/jsQR.js` explicitly before scanning. Any change to this path must be updated in both files.
- **Overlay CSS isolation**: `styles/overlay.css` is declared in `manifest.json` as a content script CSS file, so it is automatically injected into all matched pages. The overlay class name is `qrhunt-overlay`.
- **Manifest permissions**: `activeTab`, `scripting`, `storage`, `contextMenus`, `tabs`, and `<all_urls>` host permission. `storage` and `tabs` are declared but largely unused in the current implementation.
- **TODOs in codebase**: Options page persistence, `background-image` / Canvas scanning, and image preprocessing are still unimplemented (see `Plan.md` §4–5). Scan history, SPA MutationObserver re-scanning, and clipboard scan are now implemented.

## Common Development Tasks

- **Load in Edge**: Open `edge://extensions/`, enable Developer mode, click "Load unpacked", and select the repository root.
- **Test changes**: Reload the extension on `edge://extensions/` after editing background/popup/options files. Content script and CSS changes usually require a page refresh.
- **Run jsQR standalone**: Open any webpage, paste `src/lib/jsQR.js` into the console, then call `jsQR(imageData.data, width, height)`.
- **Package for distribution**: Zip the repository root (excluding `.git`, `.claude/`, and ignored files) and upload to the Edge Add-ons portal.

## Style & Conventions

- UI text and comments are in Chinese.
- Use `console.log('[QR SCANNER] ...')` for logging.
- Overlay element class name: `qrhunt-overlay`.
- Prefer `chrome.*` APIs over `browser.*` (this is a Chromium-only extension).

## Testing

- **Node.js unit tests**: `node tests/node-unit-test.js` — tests pure logic (truncate, coordinate mapping, image filtering, jsQR loading) with zero browser dependencies.
- **Browser unit tests**: Start `python3 -m http.server` from repo root, then open `http://localhost:8765/tests/unit-test.html` in a browser. Requires network to load a test QR code image from `api.qrserver.com`.
- **Manual browser tests**: Open `http://localhost:8765/tests/manual-test.html` with the extension loaded in Edge to verify screenshot scanning, context-menu scanning, overlay menus, badge counts, and toast notifications interactively.
- When adding new pure functions in `content_script.js`, add corresponding test cases in `tests/node-unit-test.js` and `tests/unit-test.html`.

## Documentation Maintenance

- **`README.md`** is the user-facing manual. Any functional change (adding/removing features, changing behavior, updating permissions, or modifying UI text) must be reflected in `README.md` in the same commit or change set. Keep the "已支持 / 暂不支持" feature tables and "已知限制" section up to date.
