// Content Script
// 注入目标网页，负责 DOM 遍历、图像提取、二维码解码和 Overlay 渲染

(function () {
  'use strict';

  let isScanning = false;
  let overlays = [];
  let currentSettings = QR_UTILS.mergeSettings();

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
    const imgs = document.querySelectorAll('img');
    // TODO: 增加 background-image 和 canvas 的收集
    return QR_UTILS.filterImagesBySize(imgs);
  }

  // 对单个图片进行二维码解码（legacy 单图扫描）
  async function decodeSingleImage(imgElement) {
    const results = await QR_ENGINE.decodeImage(imgElement);
    return results.length > 0 ? results[0].data : null;
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
    const overlayRect = QR_UTILS.overlayRectFromElementRect(rect, window.scrollX, window.scrollY);
    if (!overlayRect) return;
    overlay.style.top = `${overlayRect.y}px`;
    overlay.style.left = `${overlayRect.x}px`;
    overlay.style.width = `${overlayRect.width}px`;
    overlay.style.height = `${overlayRect.height}px`;

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

    const overlayRect = QR_UTILS.overlayRectFromElementRect(
      { left: x, top: y, width: w, height: h },
      window.scrollX,
      window.scrollY
    );
    if (!overlayRect) return;
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

      // 使用 QR_ENGINE 进行整图多二维码检测
      const results = await QR_ENGINE.decodeImage(screenshotImg);

      if (results.length === 0) {
        showScanToast('未识别到二维码', 'warning');
      } else {
        showScanToast(`识别成功，共 ${results.length} 个二维码`, 'success');
        for (const result of results) {
          if (result.location) {
            // 将截图中的像素坐标映射为页面 CSS 坐标
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
    return QR_UTILS.filterImagesInViewport(
      document.querySelectorAll('img'),
      window.innerWidth,
      window.innerHeight
    );
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

  // 右键菜单单图扫描
  async function scanSingleImage(imageUrl) {
    const img = findImageByUrl(imageUrl);

    if (img) {
      try {
        const result = await decodeSingleImage(img);
        if (result) {
          renderOverlay(img, result);
          showScanToast(`识别成功：${QR_UTILS.truncate(result, 40)}`, 'success');
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
      const img = findImageByUrl(originalImageUrl);
      if (img) {
        renderOverlay(img, result);
      } else {
        showFloatingResult(result);
      }
      showScanToast(`识别成功：${QR_UTILS.truncate(result, 40)}`, 'success');
      saveHistory(result);
      updateBadge();
    } else {
      showScanToast('未能识别出二维码', 'warning');
    }
  }

  function findImageByUrl(imageUrl) {
    return QR_UTILS.findImageElementByUrl(
      document.querySelectorAll('img'),
      imageUrl,
      document.baseURI
    );
  }

  // 对 Data URL 图片进行二维码解码
  async function decodeDataUrl(dataUrl) {
    const results = await QR_ENGINE.decodeImage(dataUrl);
    return results.length > 0 ? results[0].data : null;
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

  /* ============================================================
     SPA 动态监听 — MutationObserver + 路由变化监听
     ============================================================ */

  let mutationObserver = null;
  let mutationScanTimer = null;
  let lastScanTime = 0;
  let historyObserverInstalled = false;
  const MUTATION_SCAN_DELAY = 1500;
  const MIN_SCAN_INTERVAL = 3000;

  function startMutationObserver() {
    if (mutationObserver) return;

    // 启动后 3 秒内不触发自动扫描，避免与页面初始加载冲突
    lastScanTime = Date.now();

    mutationObserver = new MutationObserver((mutations) => {
      if (!QR_UTILS.shouldScanForMutations(mutations, Node.ELEMENT_NODE)) return;
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

  // 防抖自动扫描：DOM 变化停止后延迟执行，并限制最小扫描间隔
  function debouncedAutoScan() {
    if (mutationScanTimer) {
      clearTimeout(mutationScanTimer);
    }

    mutationScanTimer = setTimeout(() => {
      mutationScanTimer = null;

      const now = Date.now();
      const decision = QR_UTILS.getAutoScanDecision({
        now,
        lastScanTime,
        minInterval: MIN_SCAN_INTERVAL,
        documentHidden: document.hidden,
        settings: currentSettings
      });

      if (!decision.shouldScan && decision.reason === 'too-frequent') {
        console.log('[QR SCANNER] Auto scan skipped: too frequent');
        return;
      }

      if (!decision.shouldScan && decision.reason === 'hidden') {
        console.log('[QR SCANNER] Auto scan skipped: page hidden');
        return;
      }

      if (!decision.shouldScan && decision.reason === 'disabled') {
        console.log('[QR SCANNER] Auto scan skipped: disabled by settings');
        return;
      }

      lastScanTime = now;
      console.log('[QR SCANNER] Auto scan triggered');
      chrome.runtime.sendMessage({ action: 'TRIGGER_AUTO_SCAN' });
    }, MUTATION_SCAN_DELAY);
  }

  // 监听浏览器路由变化（SPA 常用 history API）
  function observeHistoryChanges() {
    if (historyObserverInstalled) return;
    historyObserverInstalled = true;

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

      const crop = QR_UTILS.clampRegionToImage(
        rect,
        dpr,
        screenshotImg.width,
        screenshotImg.height
      );

      if (!crop) {
        showScanToast('选区超出截图范围或过小', 'warning');
        return;
      }

      const { sx, sy, sw, sh } = crop;

      canvas.width = sw;
      canvas.height = sh;
      ctx.drawImage(screenshotImg, sx, sy, sw, sh, 0, 0, sw, sh);

      const imageData = ctx.getImageData(0, 0, sw, sh);
      const results = await QR_ENGINE.decodeImage(imageData);

      if (results.length > 0) {
        showScanToast(`识别成功：${QR_UTILS.truncate(results[0].data, 40)}`, 'success');
        showFloatingResult(results[0].data);
        saveHistory(results[0].data);
      } else {
        showScanToast('选区内未识别到二维码', 'warning');
      }
    } catch (err) {
      console.error('[QR SCANNER] Decode region failed:', err);
      showScanToast('识别失败', 'error');
    }
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

  function applyAutoScanSetting() {
    if (window !== window.top) return;
    if (currentSettings.autoScanEnabled) {
      startMutationObserver();
    } else {
      stopMutationObserver();
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[QR_UTILS.SETTINGS_KEY]) return;
    currentSettings = QR_UTILS.mergeSettings(changes[QR_UTILS.SETTINGS_KEY].newValue);
    applyAutoScanSetting();
  });

  // 只在主页面启动 MutationObserver，避免 iframe 中重复扫描
  if (window === window.top) {
    loadSettings().then(() => applyAutoScanSetting());
    // 预加载 zxing-wasm，避免首次扫描时的初始化延迟
    QR_ENGINE.init().catch(() => {});
  }
})();
