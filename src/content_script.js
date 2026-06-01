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
        }
      } catch (e) {
        // 单张图片解码失败继续
      }
    }

    isScanning = false;
    console.log('[QR SCANNER] Scanning finished');
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
    overlay.title = '点击跳转：' + qrData;

    // 定位
    overlay.style.top = `${window.scrollY + rect.top}px`;
    overlay.style.left = `${window.scrollX + rect.left}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    // 点击事件
    overlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm(`是否跳转到：\n${qrData}`)) {
        window.open(qrData, '_blank');
      }
    });

    document.body.appendChild(overlay);
    overlays.push(overlay);
  }

  // 清除所有覆盖层
  function clearOverlays() {
    overlays.forEach((el) => el.remove());
    overlays = [];
  }
})();
