/**
 * QR SCANNER Node.js 单元测试
 * 测试纯函数逻辑与 jsQR 基本行为，不依赖浏览器 DOM/扩展 API。
 *
 * 运行方式：
 *   node tests/node-unit-test.js
 */

const assert = require('assert');
const QR_UTILS = require('../src/lib/qr-utils.js');
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

test('长字符串应截断并追加省略号', () => {
  assert.strictEqual(QR_UTILS.truncate('hello world', 5), 'hello…');
});

test('短字符串应保持原样', () => {
  assert.strictEqual(QR_UTILS.truncate('hi', 5), 'hi');
});

test('空字符串应返回空', () => {
  assert.strictEqual(QR_UTILS.truncate('', 5), '');
});

test('null 应返回空', () => {
  assert.strictEqual(QR_UTILS.truncate(null, 5), '');
});

test('长度恰好等于阈值时不截断', () => {
  assert.strictEqual(QR_UTILS.truncate('abcde', 5), 'abcde');
});

test('中文字符按字符数截断', () => {
  assert.strictEqual(QR_UTILS.truncate('你好世界', 2), '你好…');
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

test('overlayRectFromElementRect 应加上页面滚动量', () => {
  const rect = QR_UTILS.overlayRectFromElementRect(
    { left: 10, top: 20, width: 80, height: 60 },
    100,
    200
  );
  assert.deepStrictEqual(rect, { x: 110, y: 220, width: 80, height: 60 });
});

test('overlayRectFromQrLocation 应按 DPR 转换截图坐标', () => {
  const location = {
    topLeftCorner: { x: 20, y: 40 },
    topRightCorner: { x: 120, y: 40 },
    bottomRightCorner: { x: 120, y: 140 },
    bottomLeftCorner: { x: 20, y: 140 }
  };
  assert.deepStrictEqual(
    QR_UTILS.overlayRectFromQrLocation(location, 2),
    { x: 10, y: 20, width: 50, height: 50 }
  );
});

test('overlayRectFromQrLocation 坐标不完整时应返回 null', () => {
  const location = {
    topLeftCorner: { x: 20, y: 40 },
    topRightCorner: { x: 120, y: 40 },
    bottomRightCorner: { x: 120, y: 140 },
    bottomLeftCorner: { x: NaN, y: 140 }
  };
  assert.strictEqual(QR_UTILS.overlayRectFromQrLocation(location, 2), null);
});

/* ============================================================
   3. 共享工具函数（qr-utils）
   ============================================================ */
console.log('\n共享工具函数 (qr-utils)');

test('mergeSettings 应补齐默认设置', () => {
  assert.deepStrictEqual(QR_UTILS.mergeSettings({}), {
    autoScanEnabled: true,
    maxHistoryItems: 50,
    openOnlyHttpLinks: true
  });
});

test('mergeSettings 应钳位历史记录数量', () => {
  assert.strictEqual(QR_UTILS.mergeSettings({ maxHistoryItems: 999 }).maxHistoryItems, 200);
  assert.strictEqual(QR_UTILS.mergeSettings({ maxHistoryItems: -2 }).maxHistoryItems, 1);
  assert.strictEqual(QR_UTILS.mergeSettings({ maxHistoryItems: '12' }).maxHistoryItems, 12);
});

test('mergeSettings 应保留合法布尔设置', () => {
  const settings = QR_UTILS.mergeSettings({
    autoScanEnabled: false,
    openOnlyHttpLinks: false,
    maxHistoryItems: 10
  });
  assert.deepStrictEqual(settings, {
    autoScanEnabled: false,
    maxHistoryItems: 10,
    openOnlyHttpLinks: false
  });
});

test('normalizeUrl 应支持相对 URL 并拒绝空字符串', () => {
  assert.strictEqual(
    QR_UTILS.normalizeUrl('./qr.png', 'https://example.com/pages/index.html'),
    'https://example.com/pages/qr.png'
  );
  assert.strictEqual(QR_UTILS.normalizeUrl(''), null);
});

test('isHttpUrl 应只接受 HTTP/HTTPS', () => {
  assert.strictEqual(QR_UTILS.isHttpUrl('http://example.com'), true);
  assert.strictEqual(QR_UTILS.isHttpUrl('https://example.com'), true);
  assert.strictEqual(QR_UTILS.isHttpUrl('mailto:test@example.com'), false);
  assert.strictEqual(QR_UTILS.isHttpUrl('plain text'), false);
});

test('clampRegionToImage 正常选区应保持坐标', () => {
  const crop = QR_UTILS.clampRegionToImage(
    { left: 10, top: 20, width: 100, height: 80 },
    1,
    300,
    300
  );
  assert.deepStrictEqual(crop, { sx: 10, sy: 20, sw: 100, sh: 80 });
});

test('clampRegionToImage 负坐标应钳位到 0', () => {
  const crop = QR_UTILS.clampRegionToImage(
    { left: -10, top: -20, width: 100, height: 100 },
    2,
    500,
    500
  );
  assert.deepStrictEqual(crop, { sx: 0, sy: 0, sw: 180, sh: 160 });
});

test('clampRegionToImage 超出右下边界应截断宽高', () => {
  const crop = QR_UTILS.clampRegionToImage(
    { left: 450, top: 450, width: 100, height: 100 },
    1,
    500,
    500
  );
  assert.deepStrictEqual(crop, { sx: 450, sy: 450, sw: 50, sh: 50 });
});

test('clampRegionToImage 完全在截图外应返回 null', () => {
  const crop = QR_UTILS.clampRegionToImage(
    { left: 600, top: 100, width: 100, height: 100 },
    1,
    500,
    500
  );
  assert.strictEqual(crop, null);
});

test('clampRegionToImage DPR=1.5 时应四舍五入', () => {
  const crop = QR_UTILS.clampRegionToImage(
    { left: 101, top: 0, width: 201, height: 40 },
    1.5,
    1000,
    1000
  );
  assert.deepStrictEqual(crop, { sx: 152, sy: 0, sw: 301, sh: 60 });
});

test('findImageElementByUrl 应优先匹配 currentSrc', () => {
  const img = { currentSrc: 'https://example.com/large.png', src: 'https://example.com/small.png' };
  assert.strictEqual(QR_UTILS.findImageElementByUrl([img], 'https://example.com/large.png'), img);
});

test('findImageElementByUrl 应匹配相对路径标准化后的 URL', () => {
  const img = {
    src: 'https://example.com/assets/qr.png',
    getAttribute: (name) => name === 'src' ? './assets/qr.png' : null
  };
  const found = QR_UTILS.findImageElementByUrl(
    [img],
    'https://example.com/assets/qr.png',
    'https://example.com/page/index.html'
  );
  assert.strictEqual(found, img);
});

test('findImageElementByUrl 应匹配 src 属性原始值', () => {
  const img = {
    src: 'https://example.com/assets/qr.png',
    getAttribute: (name) => name === 'src' ? '../assets/qr.png' : null
  };
  const found = QR_UTILS.findImageElementByUrl(
    [img],
    'https://example.com/assets/qr.png',
    'https://example.com/pages/index.html'
  );
  assert.strictEqual(found, img);
});

test('findImageElementByUrl 空 URL 应返回 null', () => {
  assert.strictEqual(QR_UTILS.findImageElementByUrl([{ src: 'https://example.com/a.png' }], ''), null);
});

test('getOpenableUrl 默认只允许 HTTP/HTTPS', () => {
  assert.strictEqual(QR_UTILS.getOpenableUrl('https://example.com/a'), 'https://example.com/a');
  assert.strictEqual(QR_UTILS.getOpenableUrl('hello world'), null);
  assert.strictEqual(QR_UTILS.getOpenableUrl('javascript:alert(1)'), null);
});

test('getOpenableUrl 关闭 HTTP 限制后仍应阻止危险协议', () => {
  const settings = QR_UTILS.mergeSettings({ openOnlyHttpLinks: false });
  assert.strictEqual(QR_UTILS.getOpenableUrl('mailto:test@example.com', settings), 'mailto:test@example.com');
  assert.strictEqual(QR_UTILS.getOpenableUrl('data:text/plain,hello', settings), null);
});

test('getOpenableUrl 应阻止 file 和 vbscript 协议', () => {
  const settings = QR_UTILS.mergeSettings({ openOnlyHttpLinks: false });
  assert.strictEqual(QR_UTILS.getOpenableUrl('file:///tmp/a.txt', settings), null);
  assert.strictEqual(QR_UTILS.getOpenableUrl('vbscript:msgbox(1)', settings), null);
});

test('getBadgeText 应正确生成 badge 文本', () => {
  assert.strictEqual(QR_UTILS.getBadgeText(0), '');
  assert.strictEqual(QR_UTILS.getBadgeText(-1), '');
  assert.strictEqual(QR_UTILS.getBadgeText('3'), '3');
});

/* ============================================================
   4. 图片过滤逻辑（与 collectImagesInViewport 一致）
   ============================================================ */
console.log('\n图片过滤逻辑');

test('应过滤掉小尺寸图片', () => {
  const imgs = [
    { width: 100, height: 100, getBoundingClientRect: () => ({ top: 10, bottom: 110, left: 10, right: 110 }) },
    { width: 30, height: 30, getBoundingClientRect: () => ({ top: 10, bottom: 40, left: 10, right: 40 }) },
  ];
  const result = QR_UTILS.filterImagesInViewport(imgs, 800, 600);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].width, 100);
});

test('应过滤掉完全在视口上方的图片', () => {
  const imgs = [
    { width: 100, height: 100, getBoundingClientRect: () => ({ top: -200, bottom: -100, left: 10, right: 110 }) },
  ];
  const result = QR_UTILS.filterImagesInViewport(imgs, 800, 600);
  assert.strictEqual(result.length, 0);
});

test('应过滤掉完全在视口下方的图片', () => {
  const imgs = [
    { width: 100, height: 100, getBoundingClientRect: () => ({ top: 700, bottom: 800, left: 10, right: 110 }) },
  ];
  const result = QR_UTILS.filterImagesInViewport(imgs, 800, 600);
  assert.strictEqual(result.length, 0);
});

test('部分可见的图片应保留', () => {
  const imgs = [
    { width: 100, height: 100, getBoundingClientRect: () => ({ top: 550, bottom: 650, left: 10, right: 110 }) },
    { width: 100, height: 100, getBoundingClientRect: () => ({ top: 10, bottom: 110, left: 750, right: 850 }) },
  ];
  const result = QR_UTILS.filterImagesInViewport(imgs, 800, 600);
  assert.strictEqual(result.length, 2);
});

test('filterImagesBySize 应使用严格大于最小尺寸', () => {
  const imgs = [
    { width: 51, height: 51 },
    { width: 50, height: 100 },
    { width: 100, height: 50 }
  ];
  const result = QR_UTILS.filterImagesBySize(imgs, 50);
  assert.deepStrictEqual(result, [imgs[0]]);
});

test('filterImagesInViewport 视口参数无效时应返回空', () => {
  const imgs = [
    { width: 100, height: 100, getBoundingClientRect: () => ({ top: 10, bottom: 110, left: 10, right: 110 }) },
  ];
  assert.deepStrictEqual(QR_UTILS.filterImagesInViewport(imgs, 0, 600), []);
});

/* ============================================================
   5. SPA 自动扫描判定
   ============================================================ */
console.log('\nSPA 自动扫描判定');

test('shouldScanForMutations 新增 IMG 时应触发扫描', () => {
  const mutations = [
    { addedNodes: [{ nodeType: 1, tagName: 'IMG' }] }
  ];
  assert.strictEqual(QR_UTILS.shouldScanForMutations(mutations), true);
});

test('shouldScanForMutations 新增包含 img 的容器时应触发扫描', () => {
  const mutations = [
    { addedNodes: [{ nodeType: 1, tagName: 'DIV', querySelector: (selector) => selector === 'img' ? {} : null }] }
  ];
  assert.strictEqual(QR_UTILS.shouldScanForMutations(mutations), true);
});

test('shouldScanForMutations 文本节点或非图片变更不应触发扫描', () => {
  const mutations = [
    { addedNodes: [{ nodeType: 3, tagName: undefined }] },
    { addedNodes: [{ nodeType: 1, tagName: 'DIV', querySelector: () => null }] }
  ];
  assert.strictEqual(QR_UTILS.shouldScanForMutations(mutations), false);
});

test('getAutoScanDecision 页面隐藏时应跳过', () => {
  const decision = QR_UTILS.getAutoScanDecision({
    documentHidden: true,
    settings: { autoScanEnabled: true },
    now: 5000,
    lastScanTime: 0,
    minInterval: 3000
  });
  assert.deepStrictEqual(decision, { shouldScan: false, reason: 'hidden' });
});

test('getAutoScanDecision 设置关闭时应跳过', () => {
  const decision = QR_UTILS.getAutoScanDecision({
    documentHidden: false,
    settings: { autoScanEnabled: false },
    now: 5000,
    lastScanTime: 0,
    minInterval: 3000
  });
  assert.deepStrictEqual(decision, { shouldScan: false, reason: 'disabled' });
});

test('getAutoScanDecision 间隔太短时应跳过', () => {
  const decision = QR_UTILS.getAutoScanDecision({
    documentHidden: false,
    settings: { autoScanEnabled: true },
    now: 5000,
    lastScanTime: 3000,
    minInterval: 3000
  });
  assert.deepStrictEqual(decision, { shouldScan: false, reason: 'too-frequent' });
});

test('getAutoScanDecision 条件满足时应允许扫描', () => {
  const decision = QR_UTILS.getAutoScanDecision({
    documentHidden: false,
    settings: { autoScanEnabled: true },
    now: 7000,
    lastScanTime: 3000,
    minInterval: 3000
  });
  assert.deepStrictEqual(decision, { shouldScan: true, reason: 'ready' });
});

/* ============================================================
   6. 历史记录纯函数
   ============================================================ */
console.log('\n历史记录纯函数');

test('createHistoryItem 应生成完整历史记录', () => {
  const item = QR_UTILS.createHistoryItem('data-1', {
    id: 'fixed-id',
    url: 'https://example.com',
    title: 'Example',
    now: 1000
  });
  assert.deepStrictEqual(item, {
    id: 'fixed-id',
    data: 'data-1',
    url: 'https://example.com',
    title: 'Example',
    timestamp: 1000
  });
});

test('upsertHistoryItem 应去重并把新记录放到顶部', () => {
  const history = [
    { id: 'a', data: 'old', timestamp: 1 },
    { id: 'b', data: 'same', timestamp: 2 }
  ];
  const result = QR_UTILS.upsertHistoryItem(
    history,
    'same',
    { id: 'new', url: '剪贴板截图', now: 3000 },
    { maxHistoryItems: 10 }
  );
  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result[0], {
    id: 'new',
    data: 'same',
    url: '剪贴板截图',
    title: '',
    timestamp: 3000
  });
  assert.strictEqual(result[1].data, 'old');
});

test('upsertHistoryItem 应按设置截断历史记录', () => {
  const history = [
    { id: 'a', data: 'a' },
    { id: 'b', data: 'b' },
    { id: 'c', data: 'c' }
  ];
  const result = QR_UTILS.upsertHistoryItem(
    history,
    'd',
    { id: 'd', now: 4000 },
    { maxHistoryItems: 2 }
  );
  assert.deepStrictEqual(result.map((item) => item.data), ['d', 'a']);
});

test('deleteHistoryItem 应删除指定 id', () => {
  const result = QR_UTILS.deleteHistoryItem(
    [{ id: 'a', data: 'a' }, { id: 'b', data: 'b' }],
    'a'
  );
  assert.deepStrictEqual(result, [{ id: 'b', data: 'b' }]);
});

test('getRecentHistory 应返回前 N 条', () => {
  const history = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepStrictEqual(QR_UTILS.getRecentHistory(history, 2), [{ id: 'a' }, { id: 'b' }]);
});

test('formatRelativeTime 应格式化相对时间', () => {
  const now = new Date(2026, 0, 2, 12, 0, 0).getTime();
  assert.strictEqual(QR_UTILS.formatRelativeTime(now - 30 * 1000, now), '刚刚');
  assert.strictEqual(QR_UTILS.formatRelativeTime(now - 5 * 60 * 1000, now), '5 分钟前');
  assert.strictEqual(QR_UTILS.formatRelativeTime(now - 3 * 60 * 60 * 1000, now), '3 小时前');
});

test('formatRelativeTime 超过一天时应输出日期时间', () => {
  const now = new Date(2026, 0, 3, 12, 0, 0).getTime();
  const old = new Date(2026, 0, 1, 8, 5, 0).getTime();
  assert.strictEqual(QR_UTILS.formatRelativeTime(old, now), '1月1日 8:05');
});

/* ============================================================
   7. jsQR 加载与基本行为
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
   8. qr-decoder 纯函数
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
