// Content Script
// 注入目标网页，负责 DOM 遍历、图像提取、二维码解码和 Overlay 渲染

(function () {
  'use strict';

  let isScanning = false;
  let overlays = [];

  // 监听来自 Background 的消息
  // 注意：all_frames=true 后，iframe 中也会收到消息，
  // 但涉及全屏 UI 的操作只在主 frame (window.top) 中执行
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const isTopFrame = window === window.top;

    if (request.action === 'START_SCAN') {
      if (isTopFrame) startScan();
      sendResponse({ status: isTopFrame ? 'scanning' : 'ignored-in-iframe' });
    } else if (request.action === 'START_SCAN_SCREENSHOT') {
      if (isTopFrame) startScreenshotScan(request.screenshotUrl);
      sendResponse({ status: isTopFrame ? 'scanning' : 'ignored-in-iframe' });
    } else if (request.action === 'START_AUTO_SCAN_SCREENSHOT') {
      if (isTopFrame) startScreenshotScan(request.screenshotUrl, { clearExisting: false });
      sendResponse({ status: isTopFrame ? 'scanning' : 'ignored-in-iframe' });
    } else if (request.action === 'SCAN_SINGLE_IMAGE') {
      // iframe 中也可能需要单图扫描
      scanSingleImage(request.imageUrl);
      sendResponse({ status: 'scanning' });
    } else if (request.action === 'SCAN_IMAGE_DATA_URL') {
      scanSingleImageDataUrl(request.dataUrl, request.imageUrl);
      sendResponse({ status: 'scanning' });
    } else if (request.action === 'CLEAR_OVERLAYS') {
      if (isTopFrame) clearOverlays();
      sendResponse({ status: isTopFrame ? 'cleared' : 'ignored-in-iframe' });
    } else if (request.action === 'START_REGION_SELECT') {
      if (isTopFrame) startRegionSelect();
      sendResponse({ status: isTopFrame ? 'selecting' : 'ignored-in-iframe' });
    }
    return true;
  });

  async function startScan() {
    if (isScanning) return;
    isScanning = true;
    clearOverlays();

    console.log('[QR SCANNER] Scanning started...');

    const images = collectImages();
    console.log(`[QR SCANNER] Found ${images.length} images to scan`);

    for (const img of images) {
      try {
        const result = await decodeSingleImage(img);
        if (result) {
          renderOverlay(img, result);
          saveHistory(result);
        }
      } catch (e) {
        // 单张图片解码失败继续
      }
    }

    isScanning = false;
    console.log('[QR SCANNER] Scanning finished');
    updateBadge();
  }

  // 收集页面中所有图片元素
  function collectImages() {
    const imgs = Array.from(document.querySelectorAll('img'));
    // TODO: 增加 background-image 和 canvas 的收集
    return imgs.filter((img) => img.width > 50 && img.height > 50);
  }

  // 对单个图片进行二维码解码（legacy 单图扫描）
  async function decodeSingleImage(imgElement) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      canvas.width = imgElement.naturalWidth || imgElement.width;
      canvas.height = imgElement.naturalHeight || imgElement.height;

      // CORS 处理：如果图片跨域，drawImage 会污染 canvas
      try {
        ctx.drawImage(imgElement, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // 检查 jsQR 是否可用（由 background.js 动态注入）
        if (typeof jsQR !== 'function') {
          console.warn('[QR SCANNER] jsQR not loaded');
          resolve(null);
          return;
        }

        const code = jsQR(imageData.data, canvas.width, canvas.height);
        resolve(code ? code.data : null);
      } catch (err) {
        // 常见于跨域图片
        resolve(null);
      }
    });
  }

  // 在二维码位置渲染覆盖层
  function renderOverlay(imgElement, qrData) {
    if (imgElement.dataset.qrhuntScanned === 'true') return;
    imgElement.dataset.qrhuntScanned = 'true';

    const rect = imgElement.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.className = 'qrhunt-overlay';
    overlay.title = '点击打开菜单：' + qrData;

    // 定位
    overlay.style.top = `${window.scrollY + rect.top}px`;
    overlay.style.left = `${window.scrollX + rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    // 点击事件：显示操作菜单
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showQrMenu(overlay, qrData);
    });

    document.body.appendChild(overlay);
    overlays.push(overlay);
  }

  // 根据 CSS 坐标渲染覆盖层（不依赖 <img> 元素）
  function renderOverlayAtRect(x, y, w, h, qrData) {
    const overlay = document.createElement('div');
    overlay.className = 'qrhunt-overlay';
    overlay.title = '点击打开菜单：' + qrData;

    overlay.style.top = `${window.scrollY + y}px`;
    overlay.style.left = `${window.scrollX + x}px`;
    overlay.style.width = `${w}px`;
    overlay.style.height = `${h}px`;

    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showQrMenu(overlay, qrData);
    });

    document.body.appendChild(overlay);
    overlays.push(overlay);
  }

  // 清除所有覆盖层和菜单
  function clearOverlays() {
    overlays.forEach((el) => el.remove());
    overlays = [];
    document.querySelectorAll('.qrhunt-menu').forEach((el) => el.remove());
    document.querySelectorAll('img[data-qrhunt-scanned="true"]').forEach((img) => {
      delete img.dataset.qrhuntScanned;
    });
  }

  // 基于截图的整图二维码扫描（不再依赖 <img> 元素裁剪）
  async function startScreenshotScan(screenshotUrl, options = {}) {
    if (isScanning) return;
    isScanning = true;
    if (options.clearExisting !== false) {
      clearOverlays();
    }

    console.log('[QR SCANNER] Screenshot scanning started...');

    try {
      const screenshotImg = await loadImage(screenshotUrl);
      const dpr = window.devicePixelRatio || 1;

      console.log(`[QR SCANNER] Screenshot size: ${screenshotImg.width}x${screenshotImg.height}, DPR: ${dpr}`);

      // 使用共享的 decodeImage 进行整图多二维码检测
      const results = decodeImage(screenshotImg);

      if (results.length === 0) {
        showScanToast('未识别到二维码', 'warning');
      } else {
        showScanToast(`识别成功，共 ${results.length} 个二维码`, 'success');
        for (const result of results) {
          if (result.location) {
            // 将截图中的像素坐标映射为页面 CSS 坐标
            const loc = result.location;
            const xs = [loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomRightCorner.x, loc.bottomLeftCorner.x];
            const ys = [loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomRightCorner.y, loc.bottomLeftCorner.y];
            const minX = Math.min(...xs) / dpr;
            const maxX = Math.max(...xs) / dpr;
            const minY = Math.min(...ys) / dpr;
            const maxY = Math.max(...ys) / dpr;
            renderOverlayAtRect(minX, minY, maxX - minX, maxY - minY, result.data);
          } else {
            showFloatingResult(result.data);
          }
          saveHistory(result.data);
        }
      }
    } catch (err) {
      console.error('[QR SCANNER] Screenshot scan error:', err);
      showScanToast('扫描失败', 'error');
    } finally {
      isScanning = false;
      console.log('[QR SCANNER] Screenshot scanning finished');
      updateBadge();
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

  // 收集视口内可见的图片元素（至少部分可见）
  function collectImagesInViewport() {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.filter((img) => {
      if (img.width <= 50 || img.height <= 50) return false;
      const rect = img.getBoundingClientRect();
      return (
        rect.top < window.innerHeight &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.right > 0
      );
    });
  }

  // 更新扩展图标 Badge 计数
  function updateBadge() {
    chrome.runtime.sendMessage({
      action: 'UPDATE_BADGE',
      count: overlays.length
    });
  }

  // 保存扫描历史到 chrome.storage.local
  async function saveHistory(qrData) {
    try {
      const MAX_HISTORY = 50;
      const result = await chrome.storage.local.get(['qr_scanner_history']);
      let history = result.qr_scanner_history || [];

      // 去重：移除相同 data 的旧记录
      history = history.filter((item) => item.data !== qrData);

      const newItem = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        data: qrData,
        url: window.location.href,
        title: document.title || '',
        timestamp: Date.now()
      };
      history.unshift(newItem);

      if (history.length > MAX_HISTORY) {
        history = history.slice(0, MAX_HISTORY);
      }

      await chrome.storage.local.set({ qr_scanner_history: history });
    } catch (err) {
      console.error('[QR SCANNER] Save history failed:', err);
    }
  }

  // 右键菜单单图扫描
  async function scanSingleImage(imageUrl) {
    const img = Array.from(document.querySelectorAll('img')).find((i) => i.src === imageUrl);

    if (img) {
      try {
        const result = await decodeSingleImage(img);
        if (result) {
          renderOverlay(img, result);
          showScanToast(`识别成功：${truncate(result, 40)}`, 'success');
          saveHistory(result);
          updateBadge();
          return;
        }
      } catch (e) {
        // 直接解码失败（通常是 CORS），继续 fallback
      }
    }

    // Fallback：请求 Background 通过 fetch 绕过 CORS 获取图片
    try {
      chrome.runtime.sendMessage({ action: 'FETCH_IMAGE', imageUrl }, async (response) => {
        if (response && response.dataUrl) {
          await scanSingleImageDataUrl(response.dataUrl, imageUrl);
        } else {
          showScanToast('无法读取该图片，可能受跨域限制', 'error');
        }
      });
    } catch (err) {
      showScanToast('扫描失败', 'error');
    }
  }

  // 使用 Data URL 解码单张图片
  async function scanSingleImageDataUrl(dataUrl, originalImageUrl) {
    const result = await decodeDataUrl(dataUrl);
    if (result) {
      const img = Array.from(document.querySelectorAll('img')).find((i) => i.src === originalImageUrl);
      if (img) {
        renderOverlay(img, result);
      } else {
        showFloatingResult(result);
      }
      showScanToast(`识别成功：${truncate(result, 40)}`, 'success');
      saveHistory(result);
      updateBadge();
    } else {
      showScanToast('未能识别出二维码', 'warning');
    }
  }

  // 对 Data URL 图片进行二维码解码
  function decodeDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          if (typeof jsQR !== 'function') {
            resolve(null);
            return;
          }
          const code = jsQR(imageData.data, canvas.width, canvas.height);
          resolve(code ? code.data : null);
        } catch (err) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
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
    // 移除已存在的菜单
    document.querySelectorAll('.qrhunt-menu').forEach((el) => el.remove());

    const menu = document.createElement('div');
    menu.className = 'qrhunt-menu';

    const content = document.createElement('div');
    content.className = 'qrhunt-menu-content';
    content.textContent = qrData;
    content.title = qrData;

    const actions = document.createElement('div');
    actions.className = 'qrhunt-menu-actions';

    const btnOpen = document.createElement('button');
    btnOpen.className = 'qrhunt-menu-btn primary';
    btnOpen.textContent = '打开链接';
    btnOpen.addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(qrData, '_blank');
      menu.remove();
    });

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

    actions.appendChild(btnOpen);
    actions.appendChild(btnCopy);
    actions.appendChild(btnClose);

    menu.appendChild(content);
    menu.appendChild(actions);

    // 定位菜单在 Overlay 下方居中
    const rect = overlayEl.getBoundingClientRect();
    menu.style.top = `${window.scrollY + rect.bottom + 8}px`;
    menu.style.left = `${window.scrollX + rect.left + rect.width / 2}px`;
    menu.style.transform = 'translateX(-50%)';

    document.body.appendChild(menu);

    // 点击页面其他区域关闭菜单
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

  // 当无法定位到原 DOM 元素时，显示浮动结果
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

    const btnOpen = document.createElement('button');
    btnOpen.className = 'qrhunt-menu-btn primary';
    btnOpen.textContent = '打开链接';
    btnOpen.addEventListener('click', () => {
      window.open(qrData, '_blank');
      box.remove();
    });

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

    actions.appendChild(btnOpen);
    actions.appendChild(btnCopy);
    actions.appendChild(btnClose);

    box.appendChild(content);
    box.appendChild(actions);
    document.body.appendChild(box);
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  /* ============================================================
     SPA 动态监听 — MutationObserver + 路由变化监听
     ============================================================ */

  let mutationObserver = null;
  let mutationScanTimer = null;
  let lastScanTime = 0;
  const MUTATION_SCAN_DELAY = 1500;
  const MIN_SCAN_INTERVAL = 3000;

  function startMutationObserver() {
    if (mutationObserver) return;

    // 启动后 3 秒内不触发自动扫描，避免与页面初始加载冲突
    lastScanTime = Date.now();

    mutationObserver = new MutationObserver((mutations) => {
      if (!shouldScanForMutations(mutations)) return;
      debouncedAutoScan();
    });

    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    observeHistoryChanges();
    console.log('[QR SCANNER] MutationObserver started');
  }

  function stopMutationObserver() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
      console.log('[QR SCANNER] MutationObserver stopped');
    }
  }

  // 判断 DOM 变化中是否包含值得扫描的新图片
  function shouldScanForMutations(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'IMG' || (node.querySelector && node.querySelector('img'))) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // 防抖自动扫描：DOM 变化停止后延迟执行，并限制最小扫描间隔
  function debouncedAutoScan() {
    if (mutationScanTimer) {
      clearTimeout(mutationScanTimer);
    }

    mutationScanTimer = setTimeout(() => {
      mutationScanTimer = null;

      const now = Date.now();
      if (now - lastScanTime < MIN_SCAN_INTERVAL) {
        console.log('[QR SCANNER] Auto scan skipped: too frequent');
        return;
      }

      if (document.hidden) {
        console.log('[QR SCANNER] Auto scan skipped: page hidden');
        return;
      }

      lastScanTime = now;
      console.log('[QR SCANNER] Auto scan triggered');
      chrome.runtime.sendMessage({ action: 'TRIGGER_AUTO_SCAN' });
    }, MUTATION_SCAN_DELAY);
  }

  // 监听浏览器路由变化（SPA 常用 history API）
  function observeHistoryChanges() {
    window.addEventListener('popstate', () => {
      console.log('[QR SCANNER] Route change detected (popstate)');
      debouncedAutoScan();
    });

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      console.log('[QR SCANNER] Route change detected (pushState)');
      debouncedAutoScan();
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      console.log('[QR SCANNER] Route change detected (replaceState)');
      debouncedAutoScan();
    };
  }

  /* ============================================================
     区域截图选区识别
     ============================================================ */

  let regionSelecting = false;

  function startRegionSelect() {
    if (regionSelecting) return;
    regionSelecting = true;

    cleanupRegionSelect();

    const mask = document.createElement('div');
    mask.className = 'qrhunt-region-mask';

    const box = document.createElement('div');
    box.className = 'qrhunt-region-box';

    const hint = document.createElement('div');
    hint.className = 'qrhunt-region-hint';
    hint.textContent = '拖拽框选二维码区域，按 ESC 取消';

    document.body.appendChild(mask);
    document.body.appendChild(box);
    document.body.appendChild(hint);

    let startX, startY;

    function onMouseDown(e) {
      startX = e.clientX;
      startY = e.clientY;
      box.style.left = startX + 'px';
      box.style.top = startY + 'px';
      box.style.width = '0';
      box.style.height = '0';
      box.style.display = 'block';

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      box.style.left = x + 'px';
      box.style.top = y + 'px';
      box.style.width = w + 'px';
      box.style.height = h + 'px';
    }

    async function onMouseUp(e) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);

      const rect = box.getBoundingClientRect();
      cleanupRegionSelect();

      if (rect.width < 20 || rect.height < 20) {
        showScanToast('选区太小，请重新选择', 'warning');
        regionSelecting = false;
        return;
      }

      showScanToast('正在识别选区...', 'info');
      await requestRegionScreenshot(rect);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        cleanupRegionSelect();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('keydown', onKeyDown);
        regionSelecting = false;
        showScanToast('已取消框选', 'info');
      }
    }

    mask.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
  }

  function cleanupRegionSelect() {
    document.querySelectorAll('.qrhunt-region-mask, .qrhunt-region-box, .qrhunt-region-hint').forEach((el) => el.remove());
  }

  async function requestRegionScreenshot(rect) {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'CAPTURE_REGION' }, resolve);
      });

      if (!response || !response.screenshotUrl) {
        showScanToast('截图失败', 'error');
        regionSelecting = false;
        return;
      }

      await decodeRegion(response.screenshotUrl, rect);
    } catch (err) {
      console.error('[QR SCANNER] Region scan failed:', err);
      showScanToast('区域扫描失败', 'error');
    } finally {
      regionSelecting = false;
    }
  }

  async function decodeRegion(screenshotUrl, rect) {
    try {
      const screenshotImg = await loadImage(screenshotUrl);
      const dpr = window.devicePixelRatio || 1;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const sx = Math.round(rect.left * dpr);
      const sy = Math.round(rect.top * dpr);
      const sw = Math.round(rect.width * dpr);
      const sh = Math.round(rect.height * dpr);

      canvas.width = sw;
      canvas.height = sh;
      ctx.drawImage(screenshotImg, sx, sy, sw, sh, 0, 0, sw, sh);

      if (typeof jsQR !== 'function') {
        showScanToast('jsQR 未加载', 'error');
        return;
      }

      const imageData = ctx.getImageData(0, 0, sw, sh);
      const code = jsQR(imageData.data, sw, sh);

      if (code && code.data) {
        showScanToast(`识别成功：${truncate(code.data, 40)}`, 'success');
        showFloatingResult(code.data);
        saveHistory(code.data);
      } else {
        showScanToast('选区内未识别到二维码', 'warning');
      }
    } catch (err) {
      console.error('[QR SCANNER] Decode region failed:', err);
      showScanToast('识别失败', 'error');
    }
  }

  // 只在主页面启动 MutationObserver，避免 iframe 中重复扫描
  if (window === window.top) {
    startMutationObserver();
  }
})();
