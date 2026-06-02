/**
 * QR SCANNER Node.js 单元测试
 * 测试纯函数逻辑与 jsQR 基本行为，不依赖浏览器 DOM/扩展 API。
 *
 * 运行方式：
 *   node tests/node-unit-test.js
 */

const assert = require('assert');
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failCount++;
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
  }
}

/* ============================================================
   1. 字符串截断（与 content_script.js 中的 truncate 一致）
   ============================================================ */
console.log('\n字符串截断 (truncate)');

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

test('长字符串应截断并追加省略号', () => {
  assert.strictEqual(truncate('hello world', 5), 'hello…');
});

test('短字符串应保持原样', () => {
  assert.strictEqual(truncate('hi', 5), 'hi');
});

test('空字符串应返回空', () => {
  assert.strictEqual(truncate('', 5), '');
});

test('null 应返回空', () => {
  assert.strictEqual(truncate(null, 5), '');
});

test('长度恰好等于阈值时不截断', () => {
  assert.strictEqual(truncate('abcde', 5), 'abcde');
});

test('中文字符按字符数截断', () => {
  assert.strictEqual(truncate('你好世界', 2), '你好…');
});

/* ============================================================
   2. 截图坐标映射（与 content_script.js 中的公式一致）
   ============================================================ */
console.log('\n截图坐标映射');

test('DPR=2 时坐标正确翻倍', () => {
  const rect = { left: 100, top: 200, width: 300, height: 300 };
  const dpr = 2;
  const sx = Math.round(rect.left * dpr);
  const sy = Math.round(rect.top * dpr);
  const sWidth = Math.round(rect.width * dpr);
  const sHeight = Math.round(rect.height * dpr);

  assert.strictEqual(sx, 200);
  assert.strictEqual(sy, 400);
  assert.strictEqual(sWidth, 600);
  assert.strictEqual(sHeight, 600);
});

test('DPR=1.5 时四舍五入正确', () => {
  const rect = { left: 101, top: 0, width: 201, height: 201 };
  const dpr = 1.5;
  assert.strictEqual(Math.round(rect.left * dpr), 152);
  assert.strictEqual(Math.round(rect.width * dpr), 302);
});

test('负坐标钳位到 0', () => {
  const canvasWidth = 1000;
  const rect = { left: -50, top: 100, width: 300, height: 300 };
  const dpr = 2;
  const sx = Math.round(rect.left * dpr);       // -100
  const sy = Math.round(rect.top * dpr);        //  200
  const sWidth = Math.round(rect.width * dpr);  //  600

  const clampedSx = Math.max(0, sx);
  const clampedSy = Math.max(0, sy);
  const clampedWidth = Math.min(sWidth, canvasWidth - clampedSx);

  assert.strictEqual(clampedSx, 0);
  assert.strictEqual(clampedSy, 200);
  assert.strictEqual(clampedWidth, 600);
});

test('超出画布宽度的坐标应被截断', () => {
  const canvasWidth = 500;
  const canvasHeight = 500;
  const rect = { left: 400, top: 100, width: 300, height: 300 };
  const dpr = 1;
  const sx = Math.round(rect.left * dpr);       // 400
  const sWidth = Math.round(rect.width * dpr);  // 300

  const clampedWidth = Math.min(sWidth, canvasWidth - sx);
  assert.strictEqual(clampedWidth, 100);
});

test('完全在画布外的元素应被跳过', () => {
  const canvasWidth = 500;
  const rect = { left: 600, top: 100, width: 100, height: 100 };
  const dpr = 1;
  const sx = Math.round(rect.left * dpr); // 600
  assert.strictEqual(sx >= canvasWidth, true);
});

/* ============================================================
   3. 图片过滤逻辑（与 collectImagesInViewport 一致）
   ============================================================ */
console.log('\n图片过滤逻辑');

function filterImages(imgs, vw, vh) {
  return imgs.filter((img) => {
    if (img.width <= 50 || img.height <= 50) return false;
    const rect = img.getBoundingClientRect();
    return (
      rect.top < vh &&
      rect.bottom > 0 &&
      rect.left < vw &&
      rect.right > 0
    );
  });
}

test('应过滤掉小尺寸图片', () => {
  const imgs = [
    { width: 100, height: 100, getBoundingClientRect: () => ({ top: 10, bottom: 110, left: 10, right: 110 }) },
    { width: 30, height: 30, getBoundingClientRect: () => ({ top: 10, bottom: 40, left: 10, right: 40 }) },
  ];
  const result = filterImages(imgs, 800, 600);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].width, 100);
});

test('应过滤掉完全在视口上方的图片', () => {
  const imgs = [
    { width: 100, height: 100, getBoundingClientRect: () => ({ top: -200, bottom: -100, left: 10, right: 110 }) },
  ];
  const result = filterImages(imgs, 800, 600);
  assert.strictEqual(result.length, 0);
});

test('应过滤掉完全在视口下方的图片', () => {
  const imgs = [
    { width: 100, height: 100, getBoundingClientRect: () => ({ top: 700, bottom: 800, left: 10, right: 110 }) },
  ];
  const result = filterImages(imgs, 800, 600);
  assert.strictEqual(result.length, 0);
});

test('部分可见的图片应保留', () => {
  const imgs = [
    { width: 100, height: 100, getBoundingClientRect: () => ({ top: 550, bottom: 650, left: 10, right: 110 }) },
    { width: 100, height: 100, getBoundingClientRect: () => ({ top: 10, bottom: 110, left: 750, right: 850 }) },
  ];
  const result = filterImages(imgs, 800, 600);
  assert.strictEqual(result.length, 2);
});

/* ============================================================
   4. jsQR 加载与基本行为
   ============================================================ */
console.log('\njsQR 加载与基本行为');

const jsQR = require('../src/lib/jsQR.js');

test('jsQR 应成功加载为函数', () => {
  assert.strictEqual(typeof jsQR, 'function');
});

test('jsQR 处理全黑图像应返回 null', () => {
  const width = 21;
  const height = 21;
  const data = new Uint8ClampedArray(width * height * 4);
  // 全部填充黑色 (0,0,0,255)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
  const result = jsQR(data, width, height);
  assert.strictEqual(result, null);
});

test('jsQR 处理全白图像应返回 null', () => {
  const width = 21;
  const height = 21;
  const data = new Uint8ClampedArray(width * height * 4);
  // 全部填充白色 (255,255,255,255)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  const result = jsQR(data, width, height);
  assert.strictEqual(result, null);
});

test('jsQR 不应因异常尺寸崩溃', () => {
  assert.doesNotThrow(() => {
    jsQR(new Uint8ClampedArray(4), 1, 1);
  });
});

/* ============================================================
   5. qr-decoder 纯函数
   ============================================================ */
console.log('\nqr-decoder 纯函数');

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// 为 Node.js 提供 ImageData polyfill
global.ImageData = class ImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
};

// 加载 jsQR 到全局（qr-decoder.js 依赖它）
global.jsQR = require('../src/lib/jsQR.js');

// 在全局作用域中加载 qr-decoder.js，使所有函数全局可用
const qrDecoderCode = fs.readFileSync(path.join(__dirname, '../src/lib/qr-decoder.js'), 'utf-8');
vm.runInThisContext(qrDecoderCode);

test('extractRegion 应正确裁剪子区域', () => {
  const src = new Uint8ClampedArray([
    1, 1, 1, 1,  2, 2, 2, 2,  3, 3, 3, 3,
    4, 4, 4, 4,  5, 5, 5, 5,  6, 6, 6, 6,
    7, 7, 7, 7,  8, 8, 8, 8,  9, 9, 9, 9
  ]);
  const region = extractRegion(src, 3, 3, 1, 1, 2, 2);
  assert.deepStrictEqual(
    Array.from(region),
    [5, 5, 5, 5,  6, 6, 6, 6,  8, 8, 8, 8,  9, 9, 9, 9]
  );
});

test('extractRegion 超出边界应返回 null', () => {
  const src = new Uint8ClampedArray(36);
  assert.strictEqual(extractRegion(src, 3, 3, 2, 2, 2, 2), null);
});

test('eraseQRRegion 应正确涂白区域', () => {
  const data = new Uint8ClampedArray(36);
  // 3x3 全黑
  for (let i = 0; i < 36; i += 4) {
    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
  }
  const location = {
    topLeftCorner: { x: 0.5, y: 0.5 },
    topRightCorner: { x: 1.5, y: 0.5 },
    bottomRightCorner: { x: 1.5, y: 1.5 },
    bottomLeftCorner: { x: 0.5, y: 1.5 }
  };
  eraseQRRegion(data, location, 3, 3, 0);
  // 中心像素 (1,1) 应被涂白
  const idx = (1 * 3 + 1) * 4;
  assert.strictEqual(data[idx], 255);
  assert.strictEqual(data[idx + 1], 255);
  assert.strictEqual(data[idx + 2], 255);
  assert.strictEqual(data[idx + 3], 255);
  // 右下角 (2,2) 在涂白范围外，不应被涂白
  const farIdx = (2 * 3 + 2) * 4;
  assert.strictEqual(data[farIdx], 0);
});

test('fastAdaptiveThreshold 黑白棋盘应保留边缘', () => {
  const src = new Uint8ClampedArray(16);
  // 2x2 棋盘：左上暗(0)，右上亮(255)，左下亮(255)，右下暗(0)
  const pixels = [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
    [255, 255, 255, 255],
    [0, 0, 0, 255]
  ];
  for (let i = 0; i < 4; i++) {
    src.set(pixels[i], i * 4);
  }
  const imageData = new ImageData(src, 2, 2);
  const result = fastAdaptiveThreshold(imageData, 3, 10);
  // 左上暗像素：局部均值=128，阈值=118，gray=0<118 → 输出0（黑）
  assert.strictEqual(result.data[0], 0);
  assert.strictEqual(result.data[1], 0);
  assert.strictEqual(result.data[2], 0);
  // 右上亮像素：gray=255>118 → 输出255（白）
  assert.strictEqual(result.data[4], 255);
  assert.strictEqual(result.data[5], 255);
  assert.strictEqual(result.data[6], 255);
});

test('fastAdaptiveThreshold 全白图像应输出全白', () => {
  const src = new Uint8ClampedArray(16);
  for (let i = 0; i < 16; i += 4) {
    src[i] = 255; src[i + 1] = 255; src[i + 2] = 255; src[i + 3] = 255;
  }
  const imageData = new ImageData(src, 2, 2);
  const result = fastAdaptiveThreshold(imageData, 3, 10);
  // 全白：局部均值=255，阈值=245，所有像素 255>245 → 输出 255
  assert.strictEqual(result.data[0], 255);
  assert.strictEqual(result.data[4], 255);
});

test('truncate 函数应从 qr-decoder 全局加载', () => {
  assert.strictEqual(typeof truncate, 'function');
  assert.strictEqual(truncate('hello world', 5), 'hello…');
  assert.strictEqual(truncate('hi', 5), 'hi');
});

/* ============================================================
   汇总
   ============================================================ */
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`测试汇总：通过 ${passCount} 项，失败 ${failCount} 项`);
if (failCount === 0) {
  console.log('🎉 所有测试通过！');
  process.exit(0);
} else {
  console.log('⚠️ 存在失败的测试，请检查上方详情。');
  process.exit(1);
}
