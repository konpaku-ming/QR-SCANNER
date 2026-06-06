// Content Script
// 注入目标网页，负责当前视口截图解码和 Overlay 渲染

(function () {
  'use strict';

  let isScanning = false;
  let scanToken = 0;
  let overlays = [];
  let currentSettings = QR_UTILS.mergeSettings();

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const isTopFrame = window === window.top;

    if (request.action === 'START_SCAN_SCREENSHOT') {
      if (isTopFrame) startScreenshotScan(request.screenshotUrl);
      sendResponse({ status: isTopFrame ? 'scanning' : 'ignored-in-iframe' });
      return true;
    }

    if (request.action === 'CLEAR_OVERLAYS') {
      if (isTopFrame) {
        clearOverlays({ updateBadge: true, cancelActiveScan: true });
      }
      sendResponse({ status: isTopFrame ? 'cleared' : 'ignored-in-iframe' });
      return true;
    }

    return false;
  });

  // 根据 CSS 坐标渲染覆盖层（当前页扫描使用截图坐标映射）
  function renderOverlayAtRect(x, y, w, h, qrData) {
    const overlayRect = QR_UTILS.overlayRectFromElementRect(
      { left: x, top: y, width: w, height: h },
      window.scrollX,
      window.scrollY
    );
    if (!overlayRect) return;

    const overlay = document.createElement('div');
    overlay.className = 'qrhunt-overlay';
    overlay.title = '点击打开菜单：' + qrData;
    overlay.style.top = `${overlayRect.y}px`;
    overlay.style.left = `${overlayRect.x}px`;
    overlay.style.width = `${overlayRect.width}px`;
    overlay.style.height = `${overlayRect.height}px`;

    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showQrMenu(overlay, qrData);
    });

    document.body.appendChild(overlay);
    overlays.push(overlay);
  }

  // 清除所有覆盖层、菜单和提示
  function clearOverlays(options = {}) {
    if (options.cancelActiveScan) {
      scanToken++;
      isScanning = false;
    }

    overlays.forEach((el) => el.remove());
    document
      .querySelectorAll('.qrhunt-overlay, .qrhunt-menu, .qrhunt-toast')
      .forEach((el) => el.remove());

    overlays = [];
    document.querySelectorAll('img[data-qrhunt-scanned="true"]').forEach((img) => {
      delete img.dataset.qrhuntScanned;
    });

    if (options.updateBadge) {
      updateBadge();
    }
  }

  // 基于截图的整页可见区域二维码扫描
  async function startScreenshotScan(screenshotUrl) {
    if (isScanning) return;

    const token = ++scanToken;
    isScanning = true;
    clearOverlays();

    console.log('[QR SCANNER] Screenshot scanning started...');

    try {
      const screenshotImg = await loadImage(screenshotUrl);
      if (token !== scanToken) return;

      const dpr = window.devicePixelRatio || 1;
      console.log(`[QR SCANNER] Screenshot size: ${screenshotImg.width}x${screenshotImg.height}, DPR: ${dpr}`);

      const results = await QR_ENGINE.decodeImage(screenshotImg);
      if (token !== scanToken) return;

      if (results.length === 0) {
        showScanToast('未识别到二维码', 'warning');
      } else {
        showScanToast(`识别成功，共 ${results.length} 个二维码`, 'success');
        for (const result of results) {
          if (token !== scanToken) return;

          if (result.location) {
            const overlayRect = QR_UTILS.overlayRectFromQrLocation(result.location, dpr);
            if (overlayRect) {
              renderOverlayAtRect(overlayRect.x, overlayRect.y, overlayRect.width, overlayRect.height, result.data);
            } else {
              showFloatingResult(result.data);
            }
          } else {
            showFloatingResult(result.data);
          }
          saveHistory(result.data);
        }
      }
    } catch (err) {
      if (token === scanToken) {
        console.error('[QR SCANNER] Screenshot scan error:', err);
        showScanToast('扫描失败，请确认 zxing-wasm 已加载', 'error');
      }
    } finally {
      if (token === scanToken) {
        updateBadge();
      }
      isScanning = false;
      console.log('[QR SCANNER] Screenshot scanning finished');
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // 更新扩展图标 Badge 计数
  function updateBadge() {
    try {
      chrome.runtime.sendMessage({
        action: 'UPDATE_BADGE',
        count: overlays.length
      });
    } catch (err) {
      console.error('[QR SCANNER] Update badge failed:', err);
    }
  }

  // 保存扫描历史到 chrome.storage.local
  async function saveHistory(qrData) {
    try {
      const result = await chrome.storage.local.get([QR_UTILS.HISTORY_KEY]);
      const history = QR_UTILS.upsertHistoryItem(
        result[QR_UTILS.HISTORY_KEY],
        qrData,
        {
          url: window.location.href,
          title: document.title || ''
        },
        currentSettings
      );

      await chrome.storage.local.set({ [QR_UTILS.HISTORY_KEY]: history });
    } catch (err) {
      console.error('[QR SCANNER] Save history failed:', err);
    }
  }

  // 在页面上显示扫描结果 Toast
  function showScanToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `qrhunt-toast qrhunt-toast-${type}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('qrhunt-toast-show');
    });

    setTimeout(() => {
      toast.classList.remove('qrhunt-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // 显示 Overlay 点击操作菜单
  function showQrMenu(overlayEl, qrData) {
    document.querySelectorAll('.qrhunt-menu').forEach((el) => el.remove());

    const menu = document.createElement('div');
    menu.className = 'qrhunt-menu';

    const content = document.createElement('div');
    content.className = 'qrhunt-menu-content';
    content.textContent = qrData;
    content.title = qrData;

    const actions = document.createElement('div');
    actions.className = 'qrhunt-menu-actions';

    const openUrl = QR_UTILS.getOpenableUrl(qrData, currentSettings);
    if (openUrl) {
      const btnOpen = document.createElement('button');
      btnOpen.className = 'qrhunt-menu-btn primary';
      btnOpen.textContent = '打开链接';
      btnOpen.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(openUrl, '_blank', 'noopener');
        menu.remove();
      });
      actions.appendChild(btnOpen);
    }

    const btnCopy = document.createElement('button');
    btnCopy.className = 'qrhunt-menu-btn secondary';
    btnCopy.textContent = '复制';
    btnCopy.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(qrData).then(() => {
        showScanToast('已复制到剪贴板', 'success');
      }).catch(() => {
        showScanToast('复制失败', 'error');
      });
      menu.remove();
    });

    const btnClose = document.createElement('button');
    btnClose.className = 'qrhunt-menu-btn secondary';
    btnClose.textContent = '关闭';
    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
    });

    actions.appendChild(btnCopy);
    actions.appendChild(btnClose);

    menu.appendChild(content);
    menu.appendChild(actions);

    const rect = overlayEl.getBoundingClientRect();
    menu.style.top = `${window.scrollY + rect.bottom + 8}px`;
    menu.style.left = `${window.scrollX + rect.left + rect.width / 2}px`;
    menu.style.transform = 'translateX(-50%)';

    document.body.appendChild(menu);

    const closeOnClickOutside = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeOnClickOutside);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', closeOnClickOutside);
    }, 0);
  }

  // 当 zxing-wasm 未返回定位信息时，显示浮动结果
  function showFloatingResult(qrData) {
    const box = document.createElement('div');
    box.className = 'qrhunt-menu';
    box.style.position = 'fixed';
    box.style.top = '20px';
    box.style.left = '50%';
    box.style.transform = 'translateX(-50%)';
    box.style.zIndex = '2147483647';

    const content = document.createElement('div');
    content.className = 'qrhunt-menu-content';
    content.textContent = qrData;

    const actions = document.createElement('div');
    actions.className = 'qrhunt-menu-actions';

    const openUrl = QR_UTILS.getOpenableUrl(qrData, currentSettings);
    if (openUrl) {
      const btnOpen = document.createElement('button');
      btnOpen.className = 'qrhunt-menu-btn primary';
      btnOpen.textContent = '打开链接';
      btnOpen.addEventListener('click', () => {
        window.open(openUrl, '_blank', 'noopener');
        box.remove();
      });
      actions.appendChild(btnOpen);
    }

    const btnCopy = document.createElement('button');
    btnCopy.className = 'qrhunt-menu-btn secondary';
    btnCopy.textContent = '复制';
    btnCopy.addEventListener('click', () => {
      navigator.clipboard.writeText(qrData).then(() => {
        showScanToast('已复制到剪贴板', 'success');
      });
      box.remove();
    });

    const btnClose = document.createElement('button');
    btnClose.className = 'qrhunt-menu-btn secondary';
    btnClose.textContent = '关闭';
    btnClose.addEventListener('click', () => box.remove());

    actions.appendChild(btnCopy);
    actions.appendChild(btnClose);

    box.appendChild(content);
    box.appendChild(actions);
    document.body.appendChild(box);
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get([QR_UTILS.SETTINGS_KEY]);
      currentSettings = QR_UTILS.mergeSettings(result[QR_UTILS.SETTINGS_KEY]);
    } catch (err) {
      currentSettings = QR_UTILS.mergeSettings();
    }
    return currentSettings;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[QR_UTILS.SETTINGS_KEY]) return;
    currentSettings = QR_UTILS.mergeSettings(changes[QR_UTILS.SETTINGS_KEY].newValue);
  });

  if (window === window.top) {
    loadSettings();
    QR_ENGINE.init().catch((err) => {
      console.error('[QR SCANNER] zxing-wasm preload failed:', err);
    });
  }
})();
