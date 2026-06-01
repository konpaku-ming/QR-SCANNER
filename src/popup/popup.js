// Popup 逻辑
// 提供快捷扫描、清除功能与最近识别记录

document.addEventListener('DOMContentLoaded', async () => {
  const btnScan = document.getElementById('btn-scan');
  const btnRegion = document.getElementById('btn-region');
  const btnClear = document.getElementById('btn-clear');
  const btnClearHistory = document.getElementById('btn-clear-history');
  const statusEl = document.getElementById('status');
  const historyList = document.getElementById('history-list');

  // 初始化加载历史记录
  await loadHistory();

  btnScan.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
      // 1. 截取当前可见视口（解决 CORS 跨域限制）
      const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'png'
      });

      // 2. 注入 jsQR 库
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/lib/jsQR.js']
      });

      // 3. 发送截图扫描指令
      await chrome.tabs.sendMessage(tab.id, {
        action: 'START_SCAN_SCREENSHOT',
        screenshotUrl
      });
      setStatus('扫描已启动...');
    } catch (err) {
      setStatus('扫描失败: ' + err.message);
    }
  });

  btnRegion.addEventListener('click', async () => {
    try {
      const items = await navigator.clipboard.read();
      let imageBlob = null;

      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            imageBlob = await item.getType(type);
            break;
          }
        }
        if (imageBlob) break;
      }

      if (!imageBlob) {
        setStatus('剪贴板中没有图片，请先按 Win+Shift+S 截图');
        return;
      }

      setStatus('正在识别...');

      const dataUrl = await blobToDataUrl(imageBlob);
      const results = await decodeImageDataUrl(dataUrl);

      if (results && results.length > 0) {
        setStatus(`识别成功，共 ${results.length} 个二维码`);
        for (const qr of results) {
          await saveHistoryItem(qr);
        }
        await loadHistory();
      } else {
        setStatus('未能识别出二维码，请尝试截取单个、清晰的二维码');
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setStatus('没有剪贴板读取权限');
      } else {
        setStatus('识别失败: ' + err.message);
      }
    }
  });

  btnClear.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_OVERLAYS' });
      setStatus('标记已清除');
    } catch (err) {
      setStatus('清除失败');
    }
  });

  btnClearHistory.addEventListener('click', async () => {
    if (!confirm('确定清空所有历史记录吗？')) return;
    try {
      await chrome.storage.local.remove('qr_scanner_history');
      renderHistory([]);
      setStatus('历史记录已清空');
    } catch (err) {
      setStatus('清空失败');
    }
  });

  async function loadHistory() {
    try {
      const result = await chrome.storage.local.get(['qr_scanner_history']);
      renderHistory(result.qr_scanner_history || []);
    } catch (err) {
      console.error('[QR SCANNER] Load history failed:', err);
      historyList.innerHTML = '<div class="history-empty">加载失败</div>';
    }
  }

  function renderHistory(history) {
    historyList.innerHTML = '';
    if (history.length === 0) {
      historyList.innerHTML = '<div class="history-empty">暂无记录</div>';
      return;
    }

    // 只展示最近 5 条
    history.slice(0, 5).forEach((item) => {
      const el = document.createElement('div');
      el.className = 'history-item';

      const content = document.createElement('div');
      content.className = 'history-content';
      content.textContent = item.data;
      content.title = item.data;

      const meta = document.createElement('div');
      meta.className = 'history-meta';

      const time = document.createElement('span');
      time.className = 'history-time';
      time.textContent = formatTime(item.timestamp);

      const actions = document.createElement('div');
      actions.className = 'history-actions';

      const btnOpen = document.createElement('button');
      btnOpen.className = 'btn-text';
      btnOpen.textContent = '打开';
      btnOpen.addEventListener('click', () => {
        window.open(item.data, '_blank');
      });

      const btnCopy = document.createElement('button');
      btnCopy.className = 'btn-text';
      btnCopy.textContent = '复制';
      btnCopy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.data);
          setStatus('已复制');
        } catch (err) {
          setStatus('复制失败');
        }
      });

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn-text';
      btnDelete.textContent = '删除';
      btnDelete.addEventListener('click', async () => {
        await deleteHistoryItem(item.id);
        await loadHistory();
      });

      actions.appendChild(btnOpen);
      actions.appendChild(btnCopy);
      actions.appendChild(btnDelete);

      meta.appendChild(time);
      meta.appendChild(actions);

      el.appendChild(content);
      el.appendChild(meta);
      historyList.appendChild(el);
    });
  }

  async function deleteHistoryItem(id) {
    try {
      const result = await chrome.storage.local.get(['qr_scanner_history']);
      let history = result.qr_scanner_history || [];
      history = history.filter((item) => item.id !== id);
      await chrome.storage.local.set({ qr_scanner_history: history });
    } catch (err) {
      console.error('[QR SCANNER] Delete history item failed:', err);
    }
  }

  function formatTime(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function setStatus(text) {
    statusEl.textContent = text;
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  }

  // 将 Blob 转为 Data URL
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // 对 Data URL 图片进行二维码解码（支持多二维码 + 预处理）
  async function decodeImageDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const results = decodeImage(img);
          resolve(results.length > 0 ? results : null);
        } catch (err) {
          console.error('[QR SCANNER] Decode error:', err);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // 核心解码逻辑：多尺度贪心扫描 → 滑动窗口 → 预处理后再扫描
  function decodeImage(img) {
    if (typeof jsQR !== 'function') {
      console.warn('[QR SCANNER] jsQR not available');
      return [];
    }

    const originalW = img.naturalWidth;
    const originalH = img.naturalHeight;
    console.log(`[QR SCANNER] Original image ${originalW}x${originalH}`);

    const allFound = new Set();

    // 阶段 1：多尺度整图贪心扫描（计算量小，遍历所有尺度）
    const scales = [1.0];
    if (originalW > 2000 || originalH > 2000) {
      scales.push(0.5, 0.33);
    } else if (originalW > 1000 || originalH > 1000) {
      scales.push(0.75, 0.5);
    } else if (originalW < 200 || originalH < 200) {
      scales.push(2.0);
    }

    for (const scale of scales) {
      const w = Math.round(originalW * scale);
      const h = Math.round(originalH * scale);
      if (w < 50 || h < 50) continue;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      const imageData = ctx.getImageData(0, 0, w, h);
      console.log(`[QR SCANNER] Scale ${scale} greedy scan (${w}x${h})`);

      const found = decodeMultipleQRs(imageData, w, h);
      found.forEach((code) => allFound.add(code));

      // 已找到足够多，提前退出
      if (allFound.size >= 5) break;
    }

    // 阶段 2：原始尺度滑动窗口（应对多二维码被 jsQR "压制"的情况）
    if (allFound.size <= 1) {
      console.log('[QR SCANNER] Running sliding window on original image');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = originalW;
      canvas.height = originalH;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, originalW, originalH);

      const slidingFound = decodeWithSlidingWindows(imageData, originalW, originalH);
      slidingFound.forEach((code) => allFound.add(code));
    }

    // 阶段 3：自适应阈值预处理后，再次贪心 + 滑动窗口
    if (allFound.size <= 1) {
      const ratio = Math.min(1, 2000 / originalW, 2000 / originalH);
      const w = Math.round(originalW * ratio);
      const h = Math.round(originalH * ratio);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);

      const imageData = ctx.getImageData(0, 0, w, h);
      console.log(`[QR SCANNER] Adaptive threshold scan at ${w}x${h}`);
      const processed = fastAdaptiveThreshold(imageData, 31, 10);

      const found = decodeMultipleQRs(processed, w, h);
      found.forEach((code) => allFound.add(code));

      if (allFound.size <= 1) {
        const slidingFound = decodeWithSlidingWindows(processed, w, h);
        slidingFound.forEach((code) => allFound.add(code));
      }
    }

    console.log(`[QR SCANNER] Total found: ${allFound.size}`);
    return Array.from(allFound);
  }

  // 贪心多二维码扫描：识别一个 → 根据角点坐标涂白 → 再找下一个
  function decodeMultipleQRs(imageData, width, height) {
    const found = new Set();
    const data = new Uint8ClampedArray(imageData.data);
    const MAX_ATTEMPTS = 20;
    let repeatCount = 0;

    for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
      const code = jsQR(data, width, height);
      if (!code || !code.data) break;

      // 已识别过 → 大幅扩大涂白再试（防止 finder pattern 残留）
      if (found.has(code.data)) {
        repeatCount++;
        if (repeatCount >= 3 || !code.location) break;
        // 根据二维码尺寸计算超大涂白范围
        const dx = code.location.topRightCorner.x - code.location.bottomLeftCorner.x;
        const dy = code.location.topRightCorner.y - code.location.bottomLeftCorner.y;
        const diagonal = Math.hypot(dx, dy);
        const bigPadding = Math.max(200, Math.floor(diagonal * 0.8));
        eraseQRRegion(data, code.location, width, height, bigPadding);
        continue;
      }

      repeatCount = 0;
      found.add(code.data);
      console.log(`[QR SCANNER] QR #${found.size}: ${code.data.substring(0, 60)}`);

      if (code.location) {
        // 动态 padding：对角线的 60% + 20px，确保覆盖 quiet zone
        const dx = code.location.topRightCorner.x - code.location.bottomLeftCorner.x;
        const dy = code.location.topRightCorner.y - code.location.bottomLeftCorner.y;
        const diagonal = Math.hypot(dx, dy);
        const padding = Math.max(60, Math.floor(diagonal * 0.6) + 20);
        eraseQRRegion(data, code.location, width, height, padding);
      } else {
        break;
      }
    }

    return Array.from(found);
  }

  // 根据 jsQR 返回的角点坐标涂白区域
  // jsQR location 属性名：topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner
  function eraseQRRegion(pixelData, location, width, height, padding) {
    const xs = [
      location.topLeftCorner.x,
      location.topRightCorner.x,
      location.bottomRightCorner.x,
      location.bottomLeftCorner.x
    ];
    const ys = [
      location.topLeftCorner.y,
      location.topRightCorner.y,
      location.bottomRightCorner.y,
      location.bottomLeftCorner.y
    ];

    const minX = Math.max(0, Math.floor(Math.min(...xs) - padding));
    const maxX = Math.min(width, Math.ceil(Math.max(...xs) + padding));
    const minY = Math.max(0, Math.floor(Math.min(...ys) - padding));
    const maxY = Math.min(height, Math.ceil(Math.max(...ys) + padding));

    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const idx = (y * width + x) * 4;
        pixelData[idx] = 255;
        pixelData[idx + 1] = 255;
        pixelData[idx + 2] = 255;
        pixelData[idx + 3] = 255;
      }
    }
  }

  // 从大图 ImageData 中提取子区域为独立的 Uint8ClampedArray
  function extractRegion(srcData, srcWidth, srcHeight, x, y, w, h) {
    if (x < 0 || y < 0 || x + w > srcWidth || y + h > srcHeight) return null;
    const region = new Uint8ClampedArray(w * h * 4);
    for (let row = 0; row < h; row++) {
      const srcOffset = ((y + row) * srcWidth + x) * 4;
      const dstOffset = row * w * 4;
      region.set(srcData.subarray(srcOffset, srcOffset + w * 4), dstOffset);
    }
    return region;
  }

  // 滑动窗口扫描：将图像切分为重叠子区域分别扫描
  function decodeWithSlidingWindows(imageData, width, height) {
    const found = new Set();
    const data = new Uint8ClampedArray(imageData.data);

    // 固定像素窗口策略：从小到大扫描，小窗口更容易完整包含单个二维码
    const windowSizes = [150, 200, 300, 400, 600, 800];
    let totalWindows = 0;

    // 小截图（刚好放下两个码的场景）使用双偏移，确保任何位置的二维码
    // 都不会恰好落在窗口边界上被切开
    const useDoubleOffset = Math.min(width, height) <= 800;

    for (const winSize of windowSizes) {
      if (winSize > width || winSize > height) continue;

      const stride = Math.floor(winSize * 0.5);
      // 双偏移：第二轮扫描偏移半个步长，弥补第一轮网格未覆盖到的区域
      const offsets = (useDoubleOffset && winSize <= 400)
        ? [{ x: 0, y: 0 }, { x: Math.floor(stride / 2), y: Math.floor(stride / 2) }]
        : [{ x: 0, y: 0 }];

      let windowCount = 0;

      for (const offset of offsets) {
        for (let y = offset.y; y < height; y += stride) {
          for (let x = offset.x; x < width; x += stride) {
            const actualW = Math.min(winSize, width - x);
            const actualH = Math.min(winSize, height - y);
            if (actualW < 50 || actualH < 50) continue;

            const regionData = extractRegion(data, width, height, x, y, actualW, actualH);
            if (!regionData) continue;

            windowCount++;
            totalWindows++;
            const code = jsQR(regionData, actualW, actualH);
            if (code && code.data && !found.has(code.data)) {
              found.add(code.data);
              console.log(`[QR SCANNER] Sliding window (${actualW}x${actualH}@${x},${y}) found: ${code.data.substring(0, 60)}`);
            }
          }
        }
      }

      console.log(`[QR SCANNER] Window size ${winSize}: ${offsets.length} offset(s), scanned ${windowCount} windows, total found so far: ${found.size}`);
      if (found.size >= 2) break; // 已找到多个，提前退出
    }

    console.log(`[QR SCANNER] Sliding window total: ${totalWindows} windows scanned, ${found.size} QR(s) found`);
    return Array.from(found);
  }

  // 图像预处理：积分图加速的自适应阈值二值化（O(N) 复杂度）
  function fastAdaptiveThreshold(imageData, blockSize, C) {
    const width = imageData.width;
    const height = imageData.height;
    const src = imageData.data;
    const dst = new Uint8ClampedArray(src.length);

    // 1. 提取灰度并构建积分图（Summed Area Table）
    const gray = new Uint32Array(width * height);
    const integral = new Uint32Array((width + 1) * (height + 1));

    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const g = 0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2];
        gray[y * width + x] = g;
        rowSum += g;
        integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
      }
    }

    // 2. 遍历每个像素，用积分图 O(1) 计算局部均值
    const half = Math.floor(blockSize / 2);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x1 = Math.max(0, x - half);
        const y1 = Math.max(0, y - half);
        const x2 = Math.min(width - 1, x + half);
        const y2 = Math.min(height - 1, y + half);

        const w = width + 1;
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum = integral[(y2 + 1) * w + (x2 + 1)]
                  - integral[y1 * w + (x2 + 1)]
                  - integral[(y2 + 1) * w + x1]
                  + integral[y1 * w + x1];

        const threshold = (sum / count) - C;
        const val = gray[y * width + x] > threshold ? 255 : 0;

        const idx = (y * width + x) * 4;
        dst[idx] = dst[idx + 1] = dst[idx + 2] = val;
        dst[idx + 3] = 255;
      }
    }

    return new ImageData(dst, width, height);
  }

  // 保存扫描历史（Popup 上下文直接使用 storage）
  async function saveHistoryItem(qrData) {
    try {
      const MAX_HISTORY = 50;
      const result = await chrome.storage.local.get(['qr_scanner_history']);
      let history = result.qr_scanner_history || [];

      history = history.filter((item) => item.data !== qrData);

      const newItem = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        data: qrData,
        url: '剪贴板截图',
        title: '',
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

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
  }
});
