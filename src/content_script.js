// Content Script
// 注入目标网页，负责 DOM 遍历、图像提取、二维码解码和 Overlay 渲染

(function () {
  'use strict';

  let isScanning = false;
  let overlays = [];

  // 监听来自 Background 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_SCAN') {
      startScan();
      sendResponse({ status: 'scanning' });
    } else if (request.action === 'START_SCAN_SCREENSHOT') {
      startScreenshotScan(request.screenshotUrl);
      sendResponse({ status: 'scanning' });
    } else if (request.action === 'SCAN_SINGLE_IMAGE') {
      scanSingleImage(request.imageUrl);
      sendResponse({ status: 'scanning' });
    } else if (request.action === 'SCAN_IMAGE_DATA_URL') {
      scanSingleImageDataUrl(request.dataUrl, request.imageUrl);
      sendResponse({ status: 'scanning' });
    } else if (request.action === 'CLEAR_OVERLAYS') {
      clearOverlays();
      sendResponse({ status: 'cleared' });
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
        const result = await decodeImage(img);
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

  // 对单个图片进行二维码解码
  async function decodeImage(imgElement) {
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

  // 清除所有覆盖层和菜单
  function clearOverlays() {
    overlays.forEach((el) => el.remove());
    overlays = [];
    document.querySelectorAll('.qrhunt-menu').forEach((el) => el.remove());
  }

  // 基于截图的二维码扫描（解决 CORS 跨域限制）
  async function startScreenshotScan(screenshotUrl) {
    if (isScanning) return;
    isScanning = true;
    clearOverlays();

    console.log('[QR SCANNER] Screenshot scanning started...');

    try {
      const images = collectImagesInViewport();
      console.log(`[QR SCANNER] Found ${images.length} images in viewport to scan`);

      if (images.length === 0) {
        isScanning = false;
        return;
      }

      // 加载截图
      const screenshotImg = await loadImage(screenshotUrl);
      const dpr = window.devicePixelRatio || 1;

      // 创建 canvas 并绘制完整截图
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = screenshotImg.width;
      canvas.height = screenshotImg.height;
      ctx.drawImage(screenshotImg, 0, 0);

      console.log(`[QR SCANNER] Screenshot size: ${canvas.width}x${canvas.height}, DPR: ${dpr}`);

      for (const img of images) {
        try {
          const rect = img.getBoundingClientRect();

          // 将视口 CSS 坐标映射为截图物理像素坐标
          const sx = Math.round(rect.left * dpr);
          const sy = Math.round(rect.top * dpr);
          const sWidth = Math.round(rect.width * dpr);
          const sHeight = Math.round(rect.height * dpr);

          // 边界检查：跳过完全在截图外的元素
          if (sx >= canvas.width || sy >= canvas.height) continue;
          if (sx + sWidth <= 0 || sy + sHeight <= 0) continue;

          // 裁剪到截图有效区域内
          const clampedSx = Math.max(0, sx);
          const clampedSy = Math.max(0, sy);
          const clampedWidth = Math.min(sWidth, canvas.width - clampedSx);
          const clampedHeight = Math.min(sHeight, canvas.height - clampedSy);

          if (clampedWidth < 50 || clampedHeight < 50) continue;

          const imageData = ctx.getImageData(clampedSx, clampedSy, clampedWidth, clampedHeight);

          if (typeof jsQR !== 'function') {
            console.warn('[QR SCANNER] jsQR not loaded');
            continue;
          }

          const code = jsQR(imageData.data, clampedWidth, clampedHeight);
          if (code && code.data) {
            console.log('[QR SCANNER] Screenshot scan found:', code.data.substring(0, 100));
            renderOverlay(img, code.data);
            saveHistory(code.data);
          }
        } catch (e) {
          // 单张图片扫描失败，继续下一张
        }
      }
    } catch (err) {
      console.error('[QR SCANNER] Screenshot scan error:', err);
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
        const result = await decodeImage(img);
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
})();
