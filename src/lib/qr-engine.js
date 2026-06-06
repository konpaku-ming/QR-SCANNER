// qr-engine.js — zxing-wasm-only QR decoder facade.
// 依赖全局变量：ZXingWASM（zxing-wasm.iife.js 加载后注入）

const QR_ENGINE = {
  ready: false,
  wasmReady: false,
  moduleOverrides: null,
  initPromise: null,
  defaultDecodeOptions: Object.freeze({
    formats: ['QRCode', 'MicroQRCode'],
    fastFormats: ['QRCode'],
    maxResults: 64,
    maxWindowScans: 120,
    minWindowSize: 150,
    thresholdMaxSize: 2000,
    thresholdBlockSize: 31,
    thresholdC: 10,
    scanMode: 'balanced'
  }),

  /**
   * 初始化 zxing-wasm。
   * 本项目只使用 zxing-wasm；WASM 不可用时直接抛错。
   */
  async init() {
    if (this.ready && this.wasmReady) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initWasm();
    try {
      await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  },

  async _initWasm() {
    if (this.ready && this.wasmReady) return;

    if (typeof ZXingWASM === 'undefined') {
      this.ready = false;
      this.wasmReady = false;
      throw new Error('zxing-wasm is not loaded');
    }

    const hasModuleApi = typeof ZXingWASM.getZXingModule === 'function';
    const hasDecodeApi = typeof ZXingWASM.readBarcodesFromImageData === 'function';
    if (!hasModuleApi || !hasDecodeApi) {
      this.ready = false;
      this.wasmReady = false;
      throw new Error('zxing-wasm API is not compatible with this extension');
    }

    try {
      if (!this.moduleOverrides) {
        this.moduleOverrides = {
          locateFile: (filePath, prefix) => {
            if (filePath.endsWith('.wasm')) {
              return chrome.runtime.getURL(`src/lib/zxing-wasm/${filePath}`);
            }
            return prefix + filePath;
          }
        };
      }

      if (typeof ZXingWASM.setZXingModuleOverrides === 'function') {
        ZXingWASM.setZXingModuleOverrides(this.moduleOverrides);
      }

      await ZXingWASM.getZXingModule(this.moduleOverrides);
      this.ready = true;
      this.wasmReady = true;
      console.log('[QR SCANNER] zxing-wasm initialized');
    } catch (err) {
      this.ready = false;
      this.wasmReady = false;
      console.error('[QR SCANNER] zxing-wasm init failed:', err);
      throw err;
    }
  },

  /**
   * 统一解码接口。
   * @param {HTMLImageElement|HTMLCanvasElement|ImageData|string} source
   * @param {Object} options
   * @param {boolean} options.tryHarder - 是否使用激进检测策略（默认 true）
   * @returns {Promise<{data: string, location: object | null}[]>}
   */
  async decodeImage(source, options = {}) {
    await this.init();

    const imageData = await this._toImageData(source);
    return this._decodeWithZxing(imageData, options);
  },

  /**
   * 多阶段 zxing 解码。先做低成本整图扫描；只有没有命中时，才逐步进入
   * 降采样、局部窗口和阈值预处理阶段。
   */
  async _decodeWithZxing(imageData, options = {}) {
    const settings = this._mergeDecodeOptions(options);
    const state = { results: [] };

    await this._runFullImageStage('full-fast', imageData, state, settings, {
      formats: settings.fastFormats,
      tryHarder: false,
      maxNumberOfSymbols: Math.min(settings.maxResults, 64)
    });
    if (!this._shouldContinueStages(state, settings)) return state.results;

    await this._runFullImageStage('full-try-harder', imageData, state, settings, {
      formats: settings.formats,
      tryHarder: true
    });
    if (!this._shouldContinueStages(state, settings)) return state.results;

    const scales = this._getScalePlan(imageData.width, imageData.height);
    for (const scale of scales) {
      const scaled = this._resizeImageData(imageData, scale);
      await this._runFullImageStage(`scaled-${scale}`, scaled, state, settings, {
        formats: settings.formats,
        tryHarder: true
      }, { scale });
      if (!this._shouldContinueStages(state, settings)) return state.results;
    }

    await this._runWindowStages('window-original', imageData, state, settings, {
      scale: 1,
      binarizer: 'LocalAverage'
    });
    if (!this._shouldContinueStages(state, settings)) return state.results;

    const thresholdSource = this._prepareThresholdSource(imageData, settings);
    const thresholded = this._adaptiveThreshold(
      thresholdSource.imageData,
      settings.thresholdBlockSize,
      settings.thresholdC
    );

    await this._runFullImageStage('threshold-full', thresholded, state, settings, {
      formats: settings.formats,
      tryHarder: true,
      tryInvert: false,
      binarizer: 'BoolCast'
    }, { scale: thresholdSource.scale });
    if (!this._shouldContinueStages(state, settings)) return state.results;

    await this._runWindowStages('threshold-window', thresholded, state, settings, {
      scale: thresholdSource.scale,
      binarizer: 'BoolCast'
    });

    return state.results;
  },

  async _runFullImageStage(stageName, imageData, state, settings, zxingOptions = {}, transform = {}) {
    const results = await this._decodeSingleStage(imageData, {
      ...settings,
      ...zxingOptions
    });
    const mapped = results.map((result) => this._mapResult(result, {
      stageName,
      scale: transform.scale || 1,
      offsetX: transform.offsetX || 0,
      offsetY: transform.offsetY || 0
    }));
    const added = this._addUniqueResults(state, mapped, settings.maxResults);
    this._logStage(stageName, imageData.width, imageData.height, added, state.results.length);
  },

  async _runWindowStages(stageName, imageData, state, settings, transform = {}) {
    const width = imageData.width;
    const height = imageData.height;
    const windowSizes = this._getWindowSizes(width, height, settings);
    const useDoubleOffset = Math.min(width, height) <= 800;
    let scanned = 0;

    if (settings.maxWindowScans <= 0) return;

    for (const winSize of windowSizes) {
      if (!this._shouldContinueStages(state, settings)) break;

      const stride = Math.max(64, Math.floor(winSize * 0.5));
      const offsets = (useDoubleOffset && winSize <= 400)
        ? [{ x: 0, y: 0 }, { x: Math.floor(stride / 2), y: Math.floor(stride / 2) }]
        : [{ x: 0, y: 0 }];

      for (const offset of offsets) {
        for (let y = offset.y; y < height; y += stride) {
          for (let x = offset.x; x < width; x += stride) {
            if (!this._shouldContinueStages(state, settings)) break;
            if (scanned >= settings.maxWindowScans) break;

            const actualW = Math.min(winSize, width - x);
            const actualH = Math.min(winSize, height - y);
            if (actualW < 50 || actualH < 50) continue;

            const regionData = this._extractRegion(imageData.data, width, height, x, y, actualW, actualH);
            if (!regionData) continue;

            scanned++;
            const regionImageData = this._createImageData(regionData, actualW, actualH);
            const results = await this._decodeSingleStage(regionImageData, {
              ...settings,
              formats: settings.fastFormats,
              tryHarder: false,
              maxNumberOfSymbols: 4,
              binarizer: transform.binarizer || 'LocalAverage'
            });

            const mapped = results.map((result) => this._mapResult(result, {
              stageName,
              scale: transform.scale || 1,
              offsetX: x,
              offsetY: y
            }));
            this._addUniqueResults(state, mapped, settings.maxResults);
          }
          if (!this._shouldContinueStages(state, settings)) break;
          if (scanned >= settings.maxWindowScans) break;
        }
        if (!this._shouldContinueStages(state, settings)) break;
        if (scanned >= settings.maxWindowScans) break;
      }
      if (!this._shouldContinueStages(state, settings)) break;
      if (scanned >= settings.maxWindowScans) break;
    }

    console.log(`[QR SCANNER] ${stageName}: scanned ${scanned} windows, total ${state.results.length}`);
  },

  /**
   * 单次 zxing-wasm 调用，并把 position 转为 content script 使用的 location 格式。
   */
  async _decodeSingleStage(imageData, options = {}) {
    const zxingOptions = this._buildZxingOptions(options);
    const results = await ZXingWASM.readBarcodesFromImageData(imageData, zxingOptions);

    return results.map((result) => {
      const pos = result.position || result.location;
      const topLeft = normalizePoint(pos && (pos.topLeft || pos.topLeftCorner));
      const topRight = normalizePoint(pos && (pos.topRight || pos.topRightCorner));
      const bottomRight = normalizePoint(pos && (pos.bottomRight || pos.bottomRightCorner));
      const bottomLeft = normalizePoint(pos && (pos.bottomLeft || pos.bottomLeftCorner));
      const hasPosition = topLeft && topRight && bottomRight && bottomLeft;

      return {
        data: result.text || result.rawValue || result.data || '',
        location: hasPosition ? {
          topLeftCorner: topLeft,
          topRightCorner: topRight,
          bottomRightCorner: bottomRight,
          bottomLeftCorner: bottomLeft
        } : null
      };
    });
  },

  _buildZxingOptions(options = {}) {
    return {
      formats: options.formats || this.defaultDecodeOptions.formats,
      maxNumberOfSymbols: options.maxNumberOfSymbols || options.maxResults || this.defaultDecodeOptions.maxResults,
      tryHarder: options.tryHarder !== false,
      tryRotate: options.tryRotate !== false,
      tryInvert: options.tryInvert !== false,
      tryDownscale: options.tryDownscale !== false,
      downscaleFactor: options.downscaleFactor || 3,
      downscaleThreshold: options.downscaleThreshold || 500,
      binarizer: options.binarizer || 'LocalAverage'
    };
  },

  _mergeDecodeOptions(options = {}) {
    const maxResults = clampInteger(options.maxResults, 1, 255, this.defaultDecodeOptions.maxResults);
    const maxWindowScans = clampInteger(options.maxWindowScans, 0, 400, this.defaultDecodeOptions.maxWindowScans);
    const thresholdMaxSize = clampInteger(options.thresholdMaxSize, 400, 3000, this.defaultDecodeOptions.thresholdMaxSize);
    const thresholdBlockSize = ensureOddInteger(
      clampInteger(options.thresholdBlockSize, 9, 99, this.defaultDecodeOptions.thresholdBlockSize)
    );
    const thresholdC = clampInteger(options.thresholdC, 0, 40, this.defaultDecodeOptions.thresholdC);
    const scanMode = options.scanMode === 'exhaustive' ? 'exhaustive' : 'balanced';

    return {
      ...this.defaultDecodeOptions,
      ...options,
      formats: normalizeFormats(options.formats, this.defaultDecodeOptions.formats),
      fastFormats: normalizeFormats(options.fastFormats, this.defaultDecodeOptions.fastFormats),
      maxResults,
      maxWindowScans,
      thresholdMaxSize,
      thresholdBlockSize,
      thresholdC,
      scanMode
    };
  },

  _shouldContinueStages(state, settings) {
    if (state.results.length === 0) return true;
    if (!state.results.some((result) => result.location)) return true;
    return settings.scanMode === 'exhaustive' && state.results.length < settings.maxResults;
  },

  _addUniqueResults(state, results, maxResults) {
    let added = 0;
    for (const result of results) {
      const normalized = {
        data: typeof result.data === 'string' ? result.data : String(result.data || ''),
        location: result.location || null,
        stage: result.stage || ''
      };
      if (!normalized.data) continue;

      const duplicate = state.results.find((existing) => this._isDuplicateResult(existing, normalized));
      if (duplicate) {
        if (!duplicate.location && normalized.location) {
          duplicate.location = normalized.location;
        }
        continue;
      }

      state.results.push(normalized);
      added++;
      if (state.results.length >= maxResults) break;
    }
    return added;
  },

  _isDuplicateResult(a, b) {
    if (!a || !b || a.data !== b.data) return false;

    const rectA = this._locationBounds(a.location);
    const rectB = this._locationBounds(b.location);
    if (!rectA || !rectB) return true;

    const intersectionX = Math.max(0, Math.min(rectA.maxX, rectB.maxX) - Math.max(rectA.minX, rectB.minX));
    const intersectionY = Math.max(0, Math.min(rectA.maxY, rectB.maxY) - Math.max(rectA.minY, rectB.minY));
    const intersection = intersectionX * intersectionY;
    const minArea = Math.min(rectA.area, rectB.area);
    if (minArea > 0 && intersection / minArea >= 0.55) return true;

    const centerDistance = Math.hypot(rectA.centerX - rectB.centerX, rectA.centerY - rectB.centerY);
    const maxSize = Math.max(rectA.width, rectA.height, rectB.width, rectB.height);
    return centerDistance <= Math.max(24, maxSize * 0.25);
  },

  _locationBounds(location) {
    if (!location) return null;
    const corners = [
      location.topLeftCorner,
      location.topRightCorner,
      location.bottomRightCorner,
      location.bottomLeftCorner
    ].map(normalizePoint);

    if (!corners.every(Boolean)) return null;

    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX;
    const height = maxY - minY;

    return {
      minX,
      maxX,
      minY,
      maxY,
      width,
      height,
      area: width * height,
      centerX: minX + width / 2,
      centerY: minY + height / 2
    };
  },

  _mapResult(result, transform = {}) {
    const scale = Number(transform.scale) > 0 ? Number(transform.scale) : 1;
    const offsetX = Number(transform.offsetX) || 0;
    const offsetY = Number(transform.offsetY) || 0;

    return {
      data: result.data,
      stage: transform.stageName || '',
      location: result.location ? {
        topLeftCorner: mapPoint(result.location.topLeftCorner, offsetX, offsetY, scale),
        topRightCorner: mapPoint(result.location.topRightCorner, offsetX, offsetY, scale),
        bottomRightCorner: mapPoint(result.location.bottomRightCorner, offsetX, offsetY, scale),
        bottomLeftCorner: mapPoint(result.location.bottomLeftCorner, offsetX, offsetY, scale)
      } : null
    };
  },

  _getScalePlan(width, height) {
    const maxSide = Math.max(Number(width) || 0, Number(height) || 0);
    const minSide = Math.min(Number(width) || 0, Number(height) || 0);
    if (maxSide > 2000) return [0.5, 0.33];
    if (maxSide > 1000) return [0.75, 0.5];
    if (minSide > 0 && minSide < 200) return [2.0];
    return [];
  },

  _getWindowSizes(width, height, settings) {
    const minSide = Math.min(width, height);
    const sizes = [150, 200, 300, 400, 600, 800]
      .filter((size) => size >= settings.minWindowSize && size <= minSide);
    if (sizes.length > 0) return sizes;
    return minSide >= 50 ? [minSide] : [];
  },

  _prepareThresholdSource(imageData, settings) {
    const ratio = Math.min(
      1,
      settings.thresholdMaxSize / imageData.width,
      settings.thresholdMaxSize / imageData.height
    );

    if (ratio >= 0.999) {
      return { imageData, scale: 1 };
    }

    return {
      imageData: this._resizeImageData(imageData, ratio),
      scale: ratio
    };
  },

  _resizeImageData(imageData, scale) {
    const targetWidth = Math.max(1, Math.round(imageData.width * scale));
    const targetHeight = Math.max(1, Math.round(imageData.height * scale));

    if (targetWidth === imageData.width && targetHeight === imageData.height) {
      return imageData;
    }

    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = imageData.width;
      srcCanvas.height = imageData.height;
      const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
      srcCtx.putImageData(imageData, 0, 0);

      const dstCanvas = document.createElement('canvas');
      dstCanvas.width = targetWidth;
      dstCanvas.height = targetHeight;
      const dstCtx = dstCanvas.getContext('2d', { willReadFrequently: true });
      dstCtx.imageSmoothingEnabled = true;
      dstCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight);
      return dstCtx.getImageData(0, 0, targetWidth, targetHeight);
    }

    return this._resizeImageDataNearest(imageData, targetWidth, targetHeight);
  },

  _resizeImageDataNearest(imageData, targetWidth, targetHeight) {
    const src = imageData.data;
    const dst = new Uint8ClampedArray(targetWidth * targetHeight * 4);
    const xRatio = imageData.width / targetWidth;
    const yRatio = imageData.height / targetHeight;

    for (let y = 0; y < targetHeight; y++) {
      const srcY = Math.min(imageData.height - 1, Math.floor(y * yRatio));
      for (let x = 0; x < targetWidth; x++) {
        const srcX = Math.min(imageData.width - 1, Math.floor(x * xRatio));
        const srcIdx = (srcY * imageData.width + srcX) * 4;
        const dstIdx = (y * targetWidth + x) * 4;
        dst[dstIdx] = src[srcIdx];
        dst[dstIdx + 1] = src[srcIdx + 1];
        dst[dstIdx + 2] = src[srcIdx + 2];
        dst[dstIdx + 3] = src[srcIdx + 3];
      }
    }

    return this._createImageData(dst, targetWidth, targetHeight);
  },

  _extractRegion(srcData, srcWidth, srcHeight, x, y, width, height) {
    if (x < 0 || y < 0 || x + width > srcWidth || y + height > srcHeight) return null;

    const region = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      const srcOffset = ((y + row) * srcWidth + x) * 4;
      const dstOffset = row * width * 4;
      region.set(srcData.subarray(srcOffset, srcOffset + width * 4), dstOffset);
    }
    return region;
  },

  _adaptiveThreshold(imageData, blockSize, c) {
    const width = imageData.width;
    const height = imageData.height;
    const src = imageData.data;
    const dst = new Uint8ClampedArray(src.length);
    const gray = new Uint32Array(width * height);
    const integral = new Uint32Array((width + 1) * (height + 1));

    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const g = Math.round(0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2]);
        gray[y * width + x] = g;
        rowSum += g;
        integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
      }
    }

    const half = Math.floor(blockSize / 2);
    const integralWidth = width + 1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x1 = Math.max(0, x - half);
        const y1 = Math.max(0, y - half);
        const x2 = Math.min(width - 1, x + half);
        const y2 = Math.min(height - 1, y + half);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum = integral[(y2 + 1) * integralWidth + (x2 + 1)]
          - integral[y1 * integralWidth + (x2 + 1)]
          - integral[(y2 + 1) * integralWidth + x1]
          + integral[y1 * integralWidth + x1];
        const threshold = (sum / count) - c;
        const value = gray[y * width + x] > threshold ? 255 : 0;
        const idx = (y * width + x) * 4;
        dst[idx] = value;
        dst[idx + 1] = value;
        dst[idx + 2] = value;
        dst[idx + 3] = 255;
      }
    }

    return this._createImageData(dst, width, height);
  },

  _createImageData(data, width, height) {
    if (typeof ImageData === 'function') {
      return new ImageData(data, width, height);
    }
    return { data, width, height };
  },

  _logStage(stageName, width, height, added, total) {
    console.log(`[QR SCANNER] ${stageName} (${width}x${height}) added ${added}, total ${total}`);
  },

  async _toImageData(source) {
    if (typeof ImageData !== 'undefined' && source instanceof ImageData) return source;

    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      const ctx = source.getContext('2d', { willReadFrequently: true });
      return ctx.getImageData(0, 0, source.width, source.height);
    }

    const img = await this._toImageElement(source);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  },

  _toImageElement(source) {
    if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) return source;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = source;
    });
  }
};

function normalizePoint(point) {
  if (!point) return null;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function mapPoint(point, offsetX, offsetY, scale) {
  const normalized = normalizePoint(point);
  if (!normalized) return null;
  return {
    x: (normalized.x + offsetX) / scale,
    y: (normalized.y + offsetY) / scale
  };
}

function clampInteger(value, min, max, defaultValue) {
  const number = Number(value);
  if (!Number.isFinite(number)) return defaultValue;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function ensureOddInteger(value) {
  return value % 2 === 0 ? value + 1 : value;
}

function normalizeFormats(value, defaultFormats) {
  if (!Array.isArray(value) || value.length === 0) return defaultFormats.slice();
  const formats = value.filter((format) => typeof format === 'string' && format.trim() !== '');
  return formats.length > 0 ? formats : defaultFormats.slice();
}

if (typeof globalThis !== 'undefined') {
  globalThis.QR_ENGINE = QR_ENGINE;
}

if (typeof module === 'object' && module.exports) {
  module.exports = QR_ENGINE;
}
