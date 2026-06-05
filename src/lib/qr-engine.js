// qr-engine.js — 解码引擎统一封装
// 自动检测 zxing-wasm 可用性，不可用时 fallback 到 qr-decoder.js
// 依赖全局变量：ZXingWASM（zxing-wasm.iife.js 加载后注入）
// 依赖全局变量：decodeImage（qr-decoder.js 提供 fallback）

const QR_ENGINE = {
  ready: false,
  wasmReady: false,

  /**
   * 初始化引擎
   * - 优先尝试加载 zxing-wasm
   * - 失败时静默 fallback 到 jsQR + qr-decoder.js
   */
  async init() {
    if (this.ready) return;

    if (typeof ZXingWASM !== 'undefined') {
      try {
        await ZXingWASM.prepareZXingModule({
          overrides: {
            locateFile: (path, prefix) => {
              if (path.endsWith('.wasm')) {
                return chrome.runtime.getURL(`src/lib/zxing-wasm/${path}`);
              }
              return prefix + path;
            }
          }
        });
        this.wasmReady = true;
        console.log('[QR SCANNER] zxing-wasm initialized');
      } catch (err) {
        console.warn('[QR SCANNER] zxing-wasm init failed, fallback to jsQR:', err);
      }
    } else {
      console.warn('[QR SCANNER] ZXingWASM not found, fallback to jsQR');
    }

    this.ready = true;
  },

  /**
   * 统一解码接口
   * @param {HTMLImageElement|HTMLCanvasElement|ImageData|string} source
   *   - Image: 二维码图片
   *   - Canvas: 含二维码的 canvas
   *   - ImageData: Canvas 像素数据
   *   - string: Data URL 或图片 URL
   * @param {Object} options
   * @param {boolean} options.tryHarder - 是否使用激进检测策略（默认 true）
   * @returns {Promise<{data: string, location: object}[]>}
   *   返回数组，每个元素包含 data（二维码内容）和 location（角点坐标）
   */
  async decodeImage(source, options = {}) {
    await this.init();

    const { tryHarder = true } = options;
    const imageData = await this._toImageData(source);

    if (this.wasmReady) {
      return this._decodeWithZxing(imageData, { tryHarder });
    }

    // Fallback: 使用 qr-decoder.js 的同步 decodeImage
    if (typeof decodeImage === 'function') {
      const img = await this._toImageElement(source);
      return decodeImage(img);
    }

    return [];
  },

  /**
   * 使用 zxing-wasm 解码
   * 将 zxing-wasm 返回格式转换为与 qr-decoder.js 兼容的格式
   */
  async _decodeWithZxing(imageData, options = {}) {
    const results = await ZXingWASM.readBarcodes(imageData, {
      formats: ['QRCode', 'MicroQRCode'],
      maxNumberOfSymbols: 0,    // 0 = 不限制数量，检测全部
      tryHarder: options.tryHarder,
    });

    // 格式转换：zxing-wasm position → qr-decoder.js location
    // 防御：position 可能为 null（极少数无法定位的情况）
    return results.map(r => {
      const pos = r.position;
      const hasPos = pos && typeof pos.topLeft === 'object';
      return {
        data: r.text,
        location: hasPos ? {
          topLeftCorner:     pos.topLeft,
          topRightCorner:    pos.topRight,
          bottomRightCorner: pos.bottomRight,
          bottomLeftCorner:  pos.bottomLeft
        } : null
      };
    });
  },

  /** 辅助：任意 source → ImageData */
  async _toImageData(source) {
    if (source instanceof ImageData) return source;

    // Canvas 直接读取像素
    if (source instanceof HTMLCanvasElement) {
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

  /** 辅助：任意 source → HTMLImageElement */
  _toImageElement(source) {
    if (source instanceof HTMLImageElement) return source;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = source;
    });
  }
};
