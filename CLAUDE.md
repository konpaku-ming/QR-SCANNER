# CLAUDE.md

This file gives repository-specific guidance for coding agents working on QR SCANNER.

## Project Summary

QR SCANNER is a Manifest V3 browser extension for Microsoft Edge and Google Chrome. It recognizes QR codes locally from:

- the current visible page screenshot;
- an image currently stored in the clipboard.

Those are the only QR recognition entry points. The extension may keep utility actions such as clearing markers, managing history, and editing settings.

The runtime decoder is **zxing-wasm only**. Do not restore `jsQR`, `qr-decoder`, or any second QR decoding path.

## Product Boundaries

Keep these constraints intact unless the user explicitly changes them:

- No region selection or drag-to-select scan UI.
- No context-menu image scan.
- No automatic scan, MutationObserver scan, or SPA auto re-scan.
- No remote QR decoding service.
- No decoder fallback outside zxing-wasm.

## Repository Layout

```
manifest.json
src/
  background.js            # Service Worker: screenshot scan orchestration and badge updates
  content_script.js        # Screenshot decode, overlay rendering, menus, clear markers
  popup/                   # Current page scan, clipboard scan, clear markers, history
  options/                 # History limit and safe-open settings
  lib/
    qr-utils.js            # Settings, URL safety, overlay geometry, history helpers
    qr-engine.js           # zxing-wasm-only multi-stage decoder
    zxing-wasm/
      zxing-wasm.iife.js
      zxing_reader.wasm
styles/overlay.css
assets/icons/
tests/
  node-unit-test.js
  unit-test.html
  manual-test.html
```

## Runtime Architecture

### Current Page Scan

1. Popup sends `TRIGGER_SCAN`, or the user presses `Alt + Shift + Q`.
2. `background.js` calls `chrome.tabs.captureVisibleTab()` for the active tab's visible viewport.
3. `background.js` sends `START_SCAN_SCREENSHOT` and the screenshot Data URL to the tab.
4. Top-frame `content_script.js` loads the screenshot and calls `QR_ENGINE.decodeImage()`.
5. `qr-engine.js` runs the zxing-wasm-only multi-stage strategy.
6. `content_script.js` maps QR locations from screenshot pixels to page CSS coordinates using DPR.
7. `.qrhunt-overlay` elements are rendered, history is saved, and the extension badge is updated.

### Clipboard Scan

1. Popup calls `navigator.clipboard.read()`.
2. It finds the first image item, converts it to a Data URL, and loads it into an `Image`.
3. It calls `QR_ENGINE.decodeImage()`.
4. Recognized text is saved into history and shown in the popup.

### Clear Markers

Popup sends `CLEAR_OVERLAYS` to the active tab. The content script:

- increments `scanToken` to cancel any in-flight scan;
- removes `.qrhunt-overlay`, `.qrhunt-menu`, and `.qrhunt-toast`;
- clears its in-memory overlay list;
- updates the badge count.

This prevents a previous async scan from drawing blue boxes after the user clears them.

## Decoder Details

The bundled `src/lib/zxing-wasm/zxing-wasm.iife.js` exposes:

- `setZXingModuleOverrides`
- `getZXingModule`
- `readBarcodesFromImageData`

Do not use `prepareZXingModule` or `readBarcodes`; those APIs are not present in the bundled file.

`src/lib/qr-engine.js` uses a balanced multi-stage strategy:

1. `full-fast`: quick whole-image QRCode scan with `tryHarder: false`.
2. `full-try-harder`: stronger whole-image scan with QRCode and MicroQRCode.
3. `scaled-*`: downscale large images or upscale very small images, then remap coordinates.
4. `window-original`: overlapping local-window zxing scans.
5. `threshold-full`: adaptive-threshold preprocessing, then whole-image scan.
6. `threshold-window`: adaptive-threshold preprocessing, then local-window scan.

The default `scanMode` is `balanced`: once a located result is found, heavier stages stop. If only text is found without location, later stages continue to try to recover coordinates for overlay rendering.

## Current Permissions

```json
{
  "permissions": ["activeTab", "storage", "tabs", "clipboardRead"],
  "host_permissions": ["<all_urls>"]
}
```

- `activeTab` / `tabs`: active tab lookup and visible viewport screenshot.
- `storage`: settings and history.
- `clipboardRead`: clipboard image scanning.
- `<all_urls>`: content script injection and overlay rendering on normal webpages.

## Development Notes

- There is no build system; browser files are loaded directly.
- Content scripts are loaded by `manifest.json` in this order:
  1. `src/lib/zxing-wasm/zxing-wasm.iife.js`
  2. `src/lib/qr-utils.js`
  3. `src/lib/qr-engine.js`
  4. `src/content_script.js`
- `qr-engine.js` also exports `module.exports` for Node unit tests.
- Settings key: `QR_UTILS.SETTINGS_KEY`.
- History key: `QR_UTILS.HISTORY_KEY`.
- Overlay class: `.qrhunt-overlay`.

## Common Commands

Run Node tests:

```bash
node tests/node-unit-test.js
```

Package the extension:

```bash
python3 scripts/build-release.py v0.2.0
```

Manual browser checks:

- load the repository root as an unpacked extension;
- open `tests/manual-test.html`;
- verify current page scan, clipboard scan, overlay interaction, clear markers, and history.

## Maintenance Checklist

When changing behavior, keep these in the same change set:

- code;
- `tests/node-unit-test.js`;
- `tests/manual-test.html` if manual behavior changes;
- `README.md`;
- `Plan.md`;
- `RELEASE_TEMPLATE.md`;
- this file.
