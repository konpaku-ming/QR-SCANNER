# QR SCANNER 引入 zxing-wasm 改造方案

> 状态：草案（Draft）  
> 目标：以 zxing-wasm 替换 jsQR 作为主力解码引擎，解决同图多二维码漏检问题，提升单码识别率与扫描速度。

---

## 1. 背景与动机

### 1.1 当前方案的问题

当前项目使用 **jsQR**（纯 JavaScript 单二维码解码器）配合自研的贪心涂白 + 滑动窗口策略实现多码检测：

| 问题 | 表现 |
|------|------|
| **同图多码漏检** | 截图中含有多个二维码时，识别率不稳定，"有一定概率能识别到两个，但大多数时候不能成功识别" |
| **速度瓶颈** | 滑动窗口策略在整图扫描时需遍历数百个子区域，耗时 1–2 秒 |
| **维护成本高** | `qr-decoder.js` 中集成了贪心涂白、双偏移滑动窗口、积分图自适应阈值等复杂逻辑，调优困难 |
| **单码精度有限** | jsQR 对阴影、低对比度、轻微模糊的二维码识别率不如工业级解码器 |

### 1.2 为什么选 zxing-wasm

**zxing-wasm** 是 [ZXing-C++](https://github.com/zxing-cpp/zxing-cpp) 的 WebAssembly 浏览器封装：

| 维度 | jsQR + qr-decoder.js | zxing-wasm |
|------|----------------------|------------|
| 多码检测 | 贪心涂白+滑动窗口（自研，漏检率高） | **原生支持**，`readBarcodes` 直接返回全部二维码 |
| 单码精度 | 一般 | **高**（zxing-cpp 工业级实现） |
| 速度 | 慢（滑动窗口 >1s） | **快**（~14–30ms / 帧） |
| 包大小 | 小（~50KB jsQR + ~5KB qr-decoder） | 中（reader only ~966KB WASM + ~10KB JS） |
| 维护成本 | 高（自研算法需持续调优） | 低（社区维护） |
| 离线可用 | ✅ | ✅（WASM 文件打包进扩展） |

> **关键发现**：zxing-wasm 的 `readBarcodes` 返回 `ReadResult[]`，`maxNumberOfSymbols: 0` 表示不限制检测数量，天然支持同图多码。

---

## 2. 技术前提：无构建系统下的加载

本项目**无构建系统**（无 package.json / bundler），zxing-wasm 提供 **IIFE 构建**，可直接用 `<script>` 标签加载：

```html
<script src="../lib/zxing-wasm/zxing-wasm.iife.js"></script>
```

加载后全局注册 `ZXingWASM` 对象，包含 `readBarcodes` 和 `prepareZXingModule`。

### 2.1 WASM 离线加载方案

zxing-wasm 默认从 jsDelivr CDN 加载 `.wasm` 文件，但 Edge 扩展必须**离线可用**。通过 `prepareZXingModule` 覆盖 `locateFile`：

```javascript
await ZXingWASM.prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => {
      if (path.endsWith('.wasm')) {
        // 指向扩展本地文件
        return chrome.runtime.getURL(`src/lib/zxing-wasm/${path}`);
      }
      return prefix + path;
    }
  }
});
```

Manifest V3 需在 `web_accessible_resources` 中声明 WASM 文件，使 `chrome-extension://` 路径可被页面访问。

### 2.2 Manifest V3 CSP 要求

运行 WASM 需要声明 `'wasm-unsafe-eval'`：

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

Chrome 88+ / Edge 88+ 均支持此 CSP 指令。

---

## 3. 架构变更

### 3.1 改造前架构

```
Popup ──触发──┐
Background ───┼──注入──┬── jsQR.js ──┐
快捷键 ───────┘        │             ├── content_script.js / popup.js
右键菜单 ──────────────┤             │
                       └── qr-decoder.js ─┘
```

### 3.2 改造后架构

```
Popup ──触发──┐
Background ───┼──注入──┬── zxing-wasm.iife.js ──┐
快捷键 ───────┘        │                        ├── qr-engine.js（统一封装层）
右键菜单 ──────────────┤                        │
                       ├── qr-decoder.js ───────┤（fallback）
                       └── jsQR.js ─────────────┘（fallback）
```

**核心变化**：
- 新增 `qr-engine.js` 作为统一解码接口
- `qr-engine.js` 优先尝试 zxing-wasm，初始化失败时自动 fallback 到 `qr-decoder.js`
- 现有调用方（content_script.js / popup.js）只需把 `decodeImage(...)` 改为 `await QR_ENGINE.decodeImage(...)`

---

## 4. 文件结构变更

```
src/
  lib/
    jsQR.js                           # 保留（fallback）
    qr-decoder.js                     # 保留（fallback）
    zxing-wasm/
      zxing-wasm.iife.js              # IIFE 构建（从 npm 复制）
      zxing_reader.wasm               # WASM 文件（从 npm 复制）
    qr-engine.js                      # 新增：统一解码引擎封装
  content_script.js                   # 大改：接入 qr-engine.js
  popup/
    popup.html                        # 小改：增加 zxing-wasm / qr-engine script 标签
    popup.js                          # 中改：剪贴板扫描接入 qr-engine.js
  background.js                       # 小改：注入文件列表增加 zxing-wasm
manifest.json                         # 中改：web_accessible_resources + CSP
```

### 4.1 获取 zxing-wasm 文件（无需构建工具）

本项目无构建系统，建议直接从 GitHub Release 或 npm 下载预编译文件，放入 `src/lib/zxing-wasm/` 并直接提交到 git：

```bash
# 方式一：从 npm 下载后复制（推荐）
npm install zxing-wasm@1.2.12 --no-save
mkdir -p src/lib/zxing-wasm
cp node_modules/zxing-wasm/dist/iife/reader/index.js src/lib/zxing-wasm/zxing-wasm.iife.js
cp node_modules/zxing-wasm/dist/iife/reader/*.wasm src/lib/zxing-wasm/

# 方式二：直接从 GitHub Release 下载
# https://github.com/Sec-ant/zxing-wasm/releases
# 下载对应版本的 iife/reader 构建包，解压后复制到 src/lib/zxing-wasm/
```

> **版本锁定**：固定版本（如 `1.2.12`），升级时做回归测试。WASM 文件与 IIFE JS 必须来自同一版本，混用会导致运行时崩溃。
>
> **提交到 git**：`src/lib/zxing-wasm/` 目录应加入 git（不在 `.gitignore` 中），确保扩展包离线可用。

---

## 5. 核心模块设计

### 5.1 qr-engine.js — 统一解码封装层

```javascript
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
   *
   * ⚠️ zxing-wasm 的 position 字段结构需在实施前验证：
   *    在浏览器控制台执行：
   *    const r = await ZXingWASM.readBarcodes(imageData, { formats: ['QRCode'] });
   *    console.log(JSON.stringify(r[0].position, null, 2));
   *    确认字段名是 topLeft/topRight/bottomRight/bottomLeft 还是数组索引。
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
```

### 5.2 接口兼容性说明

`QR_ENGINE.decodeImage` 的返回格式与当前 `qr-decoder.js` 的 `decodeImage` **基本一致**，有两点需要注意：

```javascript
// 返回格式
[
  {
    data: "https://example.com",
    location: {
      topLeftCorner:     { x: 100, y: 100 },
      topRightCorner:    { x: 200, y: 100 },
      bottomRightCorner: { x: 200, y: 200 },
      bottomLeftCorner:  { x: 100, y: 200 }
    }
  }
]
```

**兼容性说明**：
1. `location` 字段在极少数情况下可能为 `null`（zxing-wasm 成功解码但无法返回角点坐标）。content_script.js 中已有处理逻辑：`if (result.location) { renderOverlayAtRect(...) } else { showFloatingResult(...) }`。
2. `data` 字段内容完全一致，消费代码无需修改。
3. 遍历逻辑完全兼容：`for (const result of results)` 无需调整。

---

## 6. 各模块具体改造

### 6.1 manifest.json

```json
{
  "manifest_version": 3,
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "contextMenus",
    "tabs",
    "clipboardRead"
  ],
  "host_permissions": ["<all_urls>"],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "src/lib/zxing-wasm/zxing-wasm.iife.js",
        "src/lib/qr-engine.js",
        "src/lib/qr-decoder.js",
        "src/lib/jsQR.js",
        "src/content_script.js"
      ],
      "css": ["styles/overlay.css"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  "web_accessible_resources": [
    {
      "resources": [
        "src/lib/zxing-wasm/zxing-wasm.iife.js",
        "src/lib/zxing-wasm/*.wasm"
      ],
      "matches": ["<all_urls>"]
    }
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

### 6.2 content_script.js

#### 6.2.1 截图整图扫描（startScreenshotScan）

**当前**：
```javascript
const results = decodeImage(screenshotImg);  // 同步调用 qr-decoder.js
```

**改造后**：
```javascript
const results = await QR_ENGINE.decodeImage(screenshotImg);  // 异步调用
```

> 唯一变化：添加 `await`。后续 `for (const result of results)` 遍历逻辑完全不变。

#### 6.2.2 WASM 预加载

在 content script 初始化时预加载 WASM，避免用户第一次点击扫描时的初始化延迟：

```javascript
// content_script.js 末尾（MutationObserver 启动之后）
if (window === window.top) {
  startMutationObserver();
  // 预加载 zxing-wasm，首次扫描时无需等待初始化
  QR_ENGINE.init().catch(() => {});
}
```

#### 6.2.3 右键单图扫描（decodeSingleImage）

**当前**：
```javascript
function decodeSingleImage(imgElement) {
  return new Promise((resolve) => {
    // ... drawImage + jsQR ...
    const code = jsQR(imageData.data, canvas.width, canvas.height);
    resolve(code ? code.data : null);
  });
}
```

**改造后**：
```javascript
async function decodeSingleImage(imgElement) {
  const results = await QR_ENGINE.decodeImage(imgElement);
  return results.length > 0 ? results[0].data : null;
}
```

#### 6.2.3 Data URL 解码（decodeDataUrl）

**当前**：先 load Image → canvas → getImageData → jsQR
**改造后**：直接 `await QR_ENGINE.decodeImage(dataUrl)`

```javascript
async function decodeDataUrl(dataUrl) {
  const results = await QR_ENGINE.decodeImage(dataUrl);
  return results.length > 0 ? results[0].data : null;
}
```

#### 6.2.4 区域扫描（decodeRegion）

**当前**：crop 截图 → jsQR
**改造后**：crop 截图 → QR_ENGINE.decodeImage(canvas/imageData)

```javascript
async function decodeRegion(screenshotUrl, rect) {
  // ... crop logic ...
  const imageData = ctx.getImageData(0, 0, sw, sh);
  const results = await QR_ENGINE.decodeImage(imageData);

  if (results.length > 0) {
    // 取第一个结果（区域扫描通常只有一个码）
    showScanToast(`识别成功：${truncate(results[0].data, 40)}`, 'success');
    showFloatingResult(results[0].data);
    saveHistory(results[0].data);
  } else {
    showScanToast('选区内未识别到二维码', 'warning');
  }
}
```

### 6.3 popup.js（剪贴板扫描）

**当前**：
```javascript
function decodeImageDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const results = decodeImage(img);  // qr-decoder.js
      resolve(results.map(r => r.data));
    };
    img.src = dataUrl;
  });
}
```

**改造后**：
```javascript
async function decodeImageDataUrl(dataUrl) {
  const img = await loadImage(dataUrl);
  const results = await QR_ENGINE.decodeImage(img);
  return results.map(r => r.data);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
```

**WASM 预加载**：在 popup 初始化时预加载 zxing-wasm：
```javascript
// popup.js DOMContentLoaded 中
QR_ENGINE.init().catch(() => {});
```

### 6.4 popup.html

在现有 script 标签前增加 zxing-wasm 和 qr-engine：

```html
<script src="../lib/zxing-wasm/zxing-wasm.iife.js"></script>
<script src="../lib/qr-engine.js"></script>
<script src="../lib/qr-decoder.js"></script>
<script src="../lib/jsQR.js"></script>
<script src="popup.js"></script>
```

### 6.5 background.js

**移除** `triggerScan` / `triggerAutoScan` 中的动态库注入逻辑。

原代码通过 `executeScript` 注入 jsQR 到 main world，但 content script 运行在 **isolated world**，main world 中的全局变量对 content script **不可见**。之前的动态注入实际上是冗余的（甚至是无效的），因为 `manifest.json` 的 `content_scripts` 数组已经保证这些库在 isolated world 中加载。

**改造后**：background.js 只负责截图和发消息，不再注入任何脚本。

```javascript
async function triggerScan(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png'
    });

    // 不再注入脚本，依赖 manifest content_scripts 自动加载
    await chrome.tabs.sendMessage(tabId, {
      action: 'START_SCAN_SCREENSHOT',
      screenshotUrl
    });
  } catch (err) {
    console.error('[QR SCANNER] Screenshot scan failed:', err);
  }
}
```

> **注意**：如果用户在安装扩展前已打开的页面上触发扫描，`content_scripts` 不会自动注入，此时发送消息会报错。这种情况需要提示用户刷新页面（所有扩展的通行做法），无需在 background.js 中做额外处理。

---

## 7. 实施路线图

| 步骤 | 文件 | 工作量 | 说明 |
|------|------|--------|------|
| 0 | — | 小 | **前置验证**：在浏览器控制台测试 zxing-wasm 的 `position` 输出格式，确认 `_decodeWithZxing` 中的映射正确 |
| 1 | — | 小 | 下载 zxing-wasm IIFE + WASM 到 `src/lib/zxing-wasm/`（固定版本，提交到 git） |
| 2 | `manifest.json` | 小 | 增加 `web_accessible_resources`、CSP、调整 `content_scripts.js` 加载顺序 |
| 3 | `src/lib/qr-engine.js` | 中 | 新建统一封装层，实现 `decodeImage` + `_decodeWithZxing` + fallback + 预加载 |
| 4 | `src/content_script.js` | 中 | `startScreenshotScan`、`decodeSingleImage`、`decodeDataUrl`、`decodeRegion` 添加 `await`；增加 `QR_ENGINE.init()` 预加载 |
| 5 | `src/popup/popup.html` | 小 | script 标签顺序调整 |
| 6 | `src/popup/popup.js` | 小 | 剪贴板扫描接入 `QR_ENGINE.decodeImage`；增加 `QR_ENGINE.init()` 预加载 |
| 7 | `src/background.js` | 小 | **移除** `executeScript` 动态注入逻辑，只保留截图和消息发送 |
| 8 | `tests/*` | 小 | 验证 node-unit-test.js 不受负面影响（qr-decoder.js 保留） |
| 9 | `README.md` | 小 | 更新功能说明，删除"多二维码识别率"已知限制 |
| 10 | — | 中 | 手动测试：单码、多码、剪贴板、右键菜单、区域扫描、离线、fallback |

---

## 8. 测试验证方案

### 8.1 单元测试

`node-unit-test.js` 测试的是 `qr-decoder.js` 纯函数，`qr-decoder.js` **保留不变**，因此现有测试**无需修改**即可通过。

### 8.2 浏览器手动测试清单

| 测试项 | 测试页面 | 预期结果 |
|--------|----------|----------|
| **position 格式验证** | 浏览器 DevTools | 加载扩展后执行 `await ZXingWASM.readBarcodes(imageData, {formats:['QRCode']}); console.log(r[0].position)`，确认字段结构 |
| **WASM 加载成功** | 任意页面 | Console 出现 `[QR SCANNER] zxing-wasm initialized` |
| **单码识别** | `tests/manual-test.html` Section 1 | 识别成功，overlay 位置准确 |
| **同图多码** | 自建含 2–4 个二维码的页面 | **全部识别**，badge 显示正确数量 |
| **剪贴板多码** | 截图含多个二维码 → 识别剪贴板 | 历史记录中出现全部结果 |
| **右键单图扫描** | `tests/manual-test.html` Section 4 | 正常识别，Toast 弹出 |
| **区域扫描** | 框选二维码区域 | 识别成功 |
| **离线工作** | 断开网络 → 重新加载扩展 → 扫描 | 正常识别（WASM 本地加载） |
| **Fallback 生效** | 故意删除/重命名 `.wasm` 文件 → 扫描 | 自动回退到 jsQR，仍能识别 |
| **SPA 自动扫描** | `tests/e2e-spa.html` | 动态内容变化后自动重扫，多码检测正常 |

---

## 9. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|------|------|------|
| **WASM 加载失败** | 中 | 高（无法使用 zxing-wasm） | `qr-engine.js` 内置 fallback，自动回退到 `qr-decoder.js` |
| **CSP 拦截** | 低 | 高 | Manifest 已声明 `'wasm-unsafe-eval'`，Chrome/Edge 88+ 均支持 |
| **position 格式不匹配** | 中 | 高 | 实施前必须在浏览器控制台验证 `r[0].position` 的实际结构，`_decodeWithZxing` 中已做防御性处理（`location: null` 时 fallback 到浮动结果框） |
| **包体积增加 ~1MB** | 确定 | 低 | 仅 reader 构建（~966KB），扩展包总体积 < 2MB，可接受 |
| **异步改造遗漏** | 中 | 高 | 全局搜索 `decodeImage(`、`jsQR(` 调用点，确保全部改为 `await QR_ENGINE.decodeImage(...)` |
| **MV3 Service Worker 限制** | 低 | 高 | WASM 运行在 content_script / popup 上下文，background.js 不直接运行 WASM |
| **iframe 中重复初始化** | 中 | 低 | `all_frames=true` 时每个 iframe 都会加载 WASM，但 `prepareZXingModule` 内部有缓存，多次调用无额外开销 |
| **zxing-wasm 版本兼容性** | 低 | 中 | 固定版本号（如 `1.2.12`），WASM 与 JS 文件必须同版本，升级时做回归测试 |
| **background.js 动态注入失效** | 中 | 中 | 已移除 background.js 中的 `executeScript` 注入逻辑，完全依赖 manifest `content_scripts` 加载。旧页面需刷新后扫描。 |

---

## 10. 预期收益

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 同图多码检测 | 贪心涂白 + 滑动窗口，漏检率高 | **原生多码，理论无上限** |
| 单码识别率 | 一般（阴影/低对比度易失败） | **提升**（zxing-cpp 工业级鲁棒性） |
| 扫描速度 | 1–2s（滑动窗口） | **~100ms**（截图 + 解码） |
| 代码维护 | qr-decoder.js ~300 行复杂逻辑 | 删除贪心涂白/滑动窗口/自适应阈值，仅保留 fallback |
| 离线可用 | ✅ | ✅ |

---

## 11. 参考资源

- [zxing-wasm GitHub](https://github.com/Sec-ant/zxing-wasm)
- [zxing-wasm NPM](https://www.npmjs.com/package/zxing-wasm)
- [zxing-cpp WASM Performance Discussion](https://github.com/zxing-cpp/zxing-cpp/discussions/511)
- [Chrome Extension CSP: wasm-unsafe-eval](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [zxing-wasm Issue #354: Allow to provide URL to zxing-wasm](https://github.com/gruhn/vue-qrcode-reader/issues/354)

---

*本方案随实现进展更新。*
