// QR 解码共享模块
// 纯函数，不依赖浏览器扩展 API，可在 content_script / popup / options 中复用
// 依赖全局变量 jsQR（需在使用前加载 src/lib/jsQR.js）

/**
 * 对 Image 元素进行整图多二维码解码
 * @param {HTMLImageElement} img
 * @returns {{data: string, location: object}[]}
 */
function decodeImage(img) {
  if (typeof jsQR !== 'function') {
    console.warn('[QR SCANNER] jsQR not available');
    return [];
  }

  const originalW = img.naturalWidth;
  const originalH = img.naturalHeight;
  console.log(`[QR SCANNER] Original image ${originalW}x${originalH}`);

  const allResults = [];

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

    const found = decodeMultipleQRs(imageData, w, h, scale);
    found.forEach((r) => allResults.push(r));

    if (allResults.length >= 5) break;
  }

  // 阶段 2：原始尺度滑动窗口（应对多二维码被 jsQR "压制"的情况）
  if (allResults.length <= 1) {
    console.log('[QR SCANNER] Running sliding window on original image');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = originalW;
    canvas.height = originalH;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, originalW, originalH);

    const found = decodeWithSlidingWindows(imageData, originalW, originalH, 1.0);
    found.forEach((r) => allResults.push(r));
  }

  // 阶段 3：自适应阈值预处理后，再次贪心 + 滑动窗口
  if (allResults.length <= 1) {
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

    const found = decodeMultipleQRs(processed, w, h, ratio);
    found.forEach((r) => allResults.push(r));

    if (allResults.length <= 1) {
      const slidingFound = decodeWithSlidingWindows(processed, w, h, ratio);
      slidingFound.forEach((r) => allResults.push(r));
    }
  }

  // 去重：按 data 去重，保留首次发现的 location
  const seen = new Map();
  const uniqueResults = [];
  for (const r of allResults) {
    if (!seen.has(r.data)) {
      seen.set(r.data, r.location);
      uniqueResults.push(r);
    }
  }

  console.log(`[QR SCANNER] Total found: ${uniqueResults.length}`);
  return uniqueResults;
}

// 贪心多二维码扫描：识别一个 → 根据角点坐标涂白 → 再找下一个
function decodeMultipleQRs(imageData, width, height, scale = 1) {
  const results = [];
  const foundData = new Set();
  const data = new Uint8ClampedArray(imageData.data);
  const MAX_ATTEMPTS = 20;
  let repeatCount = 0;

  for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
    const code = jsQR(data, width, height);
    if (!code || !code.data) break;

    // 已识别过 → 大幅扩大涂白再试（防止 finder pattern 残留）
    if (foundData.has(code.data)) {
      repeatCount++;
      if (repeatCount >= 3 || !code.location) break;
      const dx = code.location.topRightCorner.x - code.location.bottomLeftCorner.x;
      const dy = code.location.topRightCorner.y - code.location.bottomLeftCorner.y;
      const diagonal = Math.hypot(dx, dy);
      const bigPadding = Math.max(200, Math.floor(diagonal * 0.8));
      eraseQRRegion(data, code.location, width, height, bigPadding);
      continue;
    }

    repeatCount = 0;
    foundData.add(code.data);
    console.log(`[QR SCANNER] QR #${foundData.size}: ${code.data.substring(0, 60)}`);

    if (code.location) {
      // 动态 padding：对角线的 60% + 20px，确保覆盖 quiet zone
      const dx = code.location.topRightCorner.x - code.location.bottomLeftCorner.x;
      const dy = code.location.topRightCorner.y - code.location.bottomLeftCorner.y;
      const diagonal = Math.hypot(dx, dy);
      const padding = Math.max(60, Math.floor(diagonal * 0.6) + 20);
      eraseQRRegion(data, code.location, width, height, padding);

      // 转换为原始图像坐标
      const location = {
        topLeftCorner: { x: code.location.topLeftCorner.x / scale, y: code.location.topLeftCorner.y / scale },
        topRightCorner: { x: code.location.topRightCorner.x / scale, y: code.location.topRightCorner.y / scale },
        bottomRightCorner: { x: code.location.bottomRightCorner.x / scale, y: code.location.bottomRightCorner.y / scale },
        bottomLeftCorner: { x: code.location.bottomLeftCorner.x / scale, y: code.location.bottomLeftCorner.y / scale }
      };
      results.push({ data: code.data, location });
    } else {
      break;
    }
  }

  return results;
}

// 根据 jsQR 返回的角点坐标涂白区域
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
function decodeWithSlidingWindows(imageData, width, height, scale = 1) {
  const results = [];
  const foundData = new Set();
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
          if (code && code.data && !foundData.has(code.data)) {
            foundData.add(code.data);
            const location = code.location ? {
              topLeftCorner: { x: (code.location.topLeftCorner.x + x) / scale, y: (code.location.topLeftCorner.y + y) / scale },
              topRightCorner: { x: (code.location.topRightCorner.x + x) / scale, y: (code.location.topRightCorner.y + y) / scale },
              bottomRightCorner: { x: (code.location.bottomRightCorner.x + x) / scale, y: (code.location.bottomRightCorner.y + y) / scale },
              bottomLeftCorner: { x: (code.location.bottomLeftCorner.x + x) / scale, y: (code.location.bottomLeftCorner.y + y) / scale }
            } : null;
            results.push({ data: code.data, location });
            console.log(`[QR SCANNER] Sliding window (${actualW}x${actualH}@${x},${y}) found: ${code.data.substring(0, 60)}`);
          }
        }
      }
    }

    console.log(`[QR SCANNER] Window size ${winSize}: ${offsets.length} offset(s), scanned ${windowCount} windows, total found so far: ${results.length}`);
    if (results.length >= 2) break;
  }

  console.log(`[QR SCANNER] Sliding window total: ${totalWindows} windows scanned, ${results.length} QR(s) found`);
  return results;
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

// 字符串截断
function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}
