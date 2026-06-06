/**
 * QR SCANNER Node.js 单元测试
 * 覆盖共享纯函数与当前产品边界约束。
 *
 * 运行方式：
 *   node tests/node-unit-test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const QR_UTILS = require('../src/lib/qr-utils.js');
const QR_ENGINE = require('../src/lib/qr-engine.js');

const projectRoot = path.resolve(__dirname, '..');
let passCount = 0;
let failCount = 0;
const asyncTests = [];

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

function testAsync(name, fn) {
  asyncTests.push({ name, fn });
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    passCount++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failCount++;
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
  }
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function makeImageData(width, height, fill = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill;
    data[i + 1] = fill;
    data[i + 2] = fill;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function makeLocation(x, y, size = 80) {
  return {
    topLeftCorner: { x, y },
    topRightCorner: { x: x + size, y },
    bottomRightCorner: { x: x + size, y: y + size },
    bottomLeftCorner: { x, y: y + size }
  };
}

/* ============================================================
   1. 字符串截断
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
   2. 设置合并
   ============================================================ */
console.log('\n设置合并');

test('mergeSettings 应补齐默认设置', () => {
  assert.deepStrictEqual(QR_UTILS.mergeSettings({}), {
    maxHistoryItems: 50,
    openOnlyHttpLinks: true
  });
});

test('mergeSettings 应钳位历史记录数量', () => {
  assert.strictEqual(QR_UTILS.mergeSettings({ maxHistoryItems: 999 }).maxHistoryItems, 200);
  assert.strictEqual(QR_UTILS.mergeSettings({ maxHistoryItems: -2 }).maxHistoryItems, 1);
  assert.strictEqual(QR_UTILS.mergeSettings({ maxHistoryItems: '12' }).maxHistoryItems, 12);
});

test('mergeSettings 应忽略已移除的自动扫描设置', () => {
  assert.deepStrictEqual(QR_UTILS.mergeSettings({ autoScanEnabled: true }), {
    maxHistoryItems: 50,
    openOnlyHttpLinks: true
  });
});

test('mergeSettings 应保留合法布尔设置', () => {
  const settings = QR_UTILS.mergeSettings({
    openOnlyHttpLinks: false,
    maxHistoryItems: 10
  });
  assert.deepStrictEqual(settings, {
    maxHistoryItems: 10,
    openOnlyHttpLinks: false
  });
});

/* ============================================================
   3. URL 安全
   ============================================================ */
console.log('\nURL 安全');

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

/* ============================================================
   4. Overlay 坐标映射
   ============================================================ */
console.log('\nOverlay 坐标映射');

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
   5. 历史记录纯函数
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

test('getBadgeText 应正确生成 badge 文本', () => {
  assert.strictEqual(QR_UTILS.getBadgeText(0), '');
  assert.strictEqual(QR_UTILS.getBadgeText(-1), '');
  assert.strictEqual(QR_UTILS.getBadgeText('3'), '3');
});

/* ============================================================
   6. zxing 多阶段解码策略
   ============================================================ */
console.log('\nzxing 多阶段解码策略');

test('qr-engine 应按图像尺寸生成降采样计划', () => {
  assert.deepStrictEqual(QR_ENGINE._getScalePlan(2400, 1200), [0.5, 0.33]);
  assert.deepStrictEqual(QR_ENGINE._getScalePlan(1200, 800), [0.75, 0.5]);
  assert.deepStrictEqual(QR_ENGINE._getScalePlan(180, 180), [2.0]);
  assert.deepStrictEqual(QR_ENGINE._getScalePlan(800, 600), []);
});

test('qr-engine 应把缩放和窗口偏移坐标映射回原图', () => {
  const mapped = QR_ENGINE._mapResult(
    { data: 'mapped', location: makeLocation(10, 20, 40) },
    { stageName: 'window', offsetX: 100, offsetY: 50, scale: 0.5 }
  );

  assert.deepStrictEqual(mapped.location.topLeftCorner, { x: 220, y: 140 });
  assert.deepStrictEqual(mapped.location.bottomRightCorner, { x: 300, y: 220 });
  assert.strictEqual(mapped.stage, 'window');
});

test('qr-engine 应按内容和位置去重，保留同内容不同位置的二维码', () => {
  const state = { results: [] };
  const first = { data: 'same', location: makeLocation(0, 0, 100) };
  const overlap = { data: 'same', location: makeLocation(8, 8, 100) };
  const farAway = { data: 'same', location: makeLocation(400, 400, 100) };

  assert.strictEqual(QR_ENGINE._addUniqueResults(state, [first, overlap], 10), 1);
  assert.strictEqual(state.results.length, 1);
  assert.strictEqual(QR_ENGINE._addUniqueResults(state, [farAway], 10), 1);
  assert.strictEqual(state.results.length, 2);
});

test('qr-engine 快速命中但没有定位信息时应继续后续阶段', () => {
  const settings = QR_ENGINE._mergeDecodeOptions({});
  assert.strictEqual(
    QR_ENGINE._shouldContinueStages({ results: [{ data: 'text-only', location: null }] }, settings),
    true
  );
  assert.strictEqual(
    QR_ENGINE._shouldContinueStages({ results: [{ data: 'located', location: makeLocation(0, 0, 80) }] }, settings),
    false
  );
});

test('qr-engine 自适应阈值预处理应输出二值图像', () => {
  const imageData = makeImageData(4, 2, 0);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const value = i < imageData.data.length / 2 ? 32 : 224;
    imageData.data[i] = value;
    imageData.data[i + 1] = value;
    imageData.data[i + 2] = value;
  }

  const thresholded = QR_ENGINE._adaptiveThreshold(imageData, 3, 2);
  const values = new Set();
  for (let i = 0; i < thresholded.data.length; i += 4) {
    values.add(thresholded.data[i]);
    assert.strictEqual(thresholded.data[i], thresholded.data[i + 1]);
    assert.strictEqual(thresholded.data[i], thresholded.data[i + 2]);
    assert.strictEqual(thresholded.data[i + 3], 255);
  }
  values.forEach((value) => assert.strictEqual(value === 0 || value === 255, true));
});

testAsync('qr-engine balanced 模式快速整图命中后应停止后续阶段', async () => {
  const engine = Object.create(QR_ENGINE);
  const calls = [];
  engine._logStage = () => {};
  engine._decodeSingleStage = async (stageImageData, options) => {
    calls.push({ width: stageImageData.width, height: stageImageData.height, options });
    return [{ data: 'fast', location: makeLocation(10, 10, 60) }];
  };

  const results = await engine._decodeWithZxing(makeImageData(800, 600));
  assert.deepStrictEqual(results.map((result) => result.data), ['fast']);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].options.tryHarder, false);
  assert.deepStrictEqual(calls[0].options.formats, ['QRCode']);
});

testAsync('qr-engine 整图失败后应进入降采样和局部窗口阶段', async () => {
  const engine = Object.create(QR_ENGINE);
  const calls = [];
  engine._logStage = () => {};
  engine._resizeImageData = (imageData, scale) => makeImageData(
    Math.round(imageData.width * scale),
    Math.round(imageData.height * scale)
  );
  engine._decodeSingleStage = async (stageImageData, options) => {
    calls.push({ width: stageImageData.width, height: stageImageData.height, options });
    if (stageImageData.width === 150 && stageImageData.height === 150) {
      return [{ data: 'window-hit', location: makeLocation(10, 10, 80) }];
    }
    return [];
  };

  const results = await engine._decodeWithZxing(makeImageData(1200, 800), { maxWindowScans: 5 });
  assert.deepStrictEqual(results.map((result) => result.data), ['window-hit']);
  assert.strictEqual(calls.some((call) => call.width === 900 && call.height === 600), true);
  assert.strictEqual(calls.some((call) => call.width === 600 && call.height === 400), true);
  assert.strictEqual(calls.some((call) => call.width === 150 && call.height === 150), true);
  assert.deepStrictEqual(results[0].location.topLeftCorner, { x: 10, y: 10 });
});

testAsync('qr-engine 前置阶段失败后应对阈值图继续交给 zxing', async () => {
  const engine = Object.create(QR_ENGINE);
  const calls = [];
  engine._logStage = () => {};
  engine._decodeSingleStage = async (stageImageData, options) => {
    calls.push({ width: stageImageData.width, height: stageImageData.height, options });
    if (options.binarizer === 'BoolCast') {
      return [{ data: 'threshold-hit', location: makeLocation(20, 20, 50) }];
    }
    return [];
  };

  const results = await engine._decodeWithZxing(makeImageData(400, 300), { maxWindowScans: 0 });
  assert.deepStrictEqual(results.map((result) => result.data), ['threshold-hit']);
  assert.strictEqual(calls.some((call) => call.options.binarizer === 'BoolCast'), true);
  assert.deepStrictEqual(results[0].location.topLeftCorner, { x: 20, y: 20 });
});

/* ============================================================
   7. 产品边界约束
   ============================================================ */
console.log('\n产品边界约束');

test('manifest 不应声明右键菜单和动态脚本权限', () => {
  const manifest = JSON.parse(readText('manifest.json'));
  assert.strictEqual(manifest.permissions.includes('contextMenus'), false);
  assert.strictEqual(manifest.permissions.includes('scripting'), false);
});

test('manifest content scripts 只加载 zxing-wasm 解码链路', () => {
  const manifest = JSON.parse(readText('manifest.json'));
  const scripts = manifest.content_scripts[0].js;
  assert.deepStrictEqual(scripts, [
    'src/lib/zxing-wasm/zxing-wasm.iife.js',
    'src/lib/qr-utils.js',
    'src/lib/qr-engine.js',
    'src/content_script.js'
  ]);
});

test('popup 不应暴露框选区域入口或加载旧解码器', () => {
  const popupHtml = readText('src/popup/popup.html');
  assert.strictEqual(popupHtml.includes('btn-select-region'), false);
  assert.strictEqual(popupHtml.includes('框选页面区域'), false);
  assert.strictEqual(popupHtml.includes('jsQR.js'), false);
  assert.strictEqual(popupHtml.includes('qr-decoder.js'), false);
});

test('background 不应保留额外扫描入口消息', () => {
  const background = readText('src/background.js');
  [
    'contextMenus',
    'FETCH_IMAGE',
    'TRIGGER_AUTO_SCAN',
    'CAPTURE_REGION',
    'SCAN_SINGLE_IMAGE'
  ].forEach((token) => {
    assert.strictEqual(background.includes(token), false, token);
  });
});

test('content script 不应保留框选、右键或自动扫描消息入口', () => {
  const content = readText('src/content_script.js');
  [
    'START_REGION_SELECT',
    'CAPTURE_REGION',
    'SCAN_SINGLE_IMAGE',
    'SCAN_IMAGE_DATA_URL',
    'START_AUTO_SCAN_SCREENSHOT',
    'TRIGGER_AUTO_SCAN'
  ].forEach((token) => {
    assert.strictEqual(content.includes(token), false, token);
  });
});

test('清除标记逻辑应取消进行中的扫描并清理页面残留元素', () => {
  const content = readText('src/content_script.js');
  assert.strictEqual(content.includes('cancelActiveScan'), true);
  assert.strictEqual(content.includes('scanToken++'), true);
  assert.strictEqual(content.includes('.qrhunt-overlay'), true);
  assert.strictEqual(content.includes('.qrhunt-menu'), true);
});

test('旧 jsQR / qr-decoder 文件不应继续存在', () => {
  assert.strictEqual(fs.existsSync(path.join(projectRoot, 'src/lib/jsQR.js')), false);
  assert.strictEqual(fs.existsSync(path.join(projectRoot, 'src/lib/qr-decoder.js')), false);
});

test('qr-engine 应使用当前打包的 zxing-wasm API', () => {
  const engine = readText('src/lib/qr-engine.js');
  const bundle = readText('src/lib/zxing-wasm/zxing-wasm.iife.js');
  assert.strictEqual(bundle.includes('readBarcodesFromImageData'), true);
  assert.strictEqual(bundle.includes('getZXingModule'), true);
  assert.strictEqual(engine.includes('readBarcodesFromImageData'), true);
  assert.strictEqual(engine.includes('getZXingModule'), true);
  assert.strictEqual(engine.includes('prepareZXingModule'), false);
  assert.strictEqual(/ZXingWASM\.readBarcodes\s*\(/.test(engine), false);
});

test('qr-engine 不应依赖第二解码器', () => {
  const engine = readText('src/lib/qr-engine.js');
  assert.strictEqual(engine.includes('jsQR'), false);
  assert.strictEqual(engine.includes('qr-decoder'), false);
  assert.strictEqual(engine.includes('fallback'), false);
});

/* ============================================================
   汇总
   ============================================================ */
async function finish() {
  for (const item of asyncTests) {
    await runAsyncTest(item.name, item.fn);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`测试汇总：通过 ${passCount} 项，失败 ${failCount} 项`);
  if (failCount === 0) {
    console.log('🎉 所有测试通过！');
    process.exit(0);
  } else {
    console.log('⚠️ 存在失败的测试，请检查上方详情。');
    process.exit(1);
  }
}

finish().catch((err) => {
  failCount++;
  console.error('测试运行异常');
  console.error(err);
  process.exit(1);
});
