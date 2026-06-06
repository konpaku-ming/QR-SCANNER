# QR SCANNER 项目计划与实现状态

> 当前状态：可用 MVP。产品只保留两个二维码识别入口：扫描当前页面、识别剪贴板。

---

## 1. 产品范围

QR SCANNER 是一个 Chromium 浏览器扩展，用于在浏览器本地识别二维码。

当前保留：

- 扫描当前页面可见视口。
- 识别剪贴板图片。
- 为页面扫描结果绘制蓝色 Overlay。
- 通过 Overlay 菜单打开链接、复制内容或关闭菜单。
- 清除页面标记、菜单、Toast 和 Badge。
- 保存最近识别历史。
- 配置历史记录数量和链接打开策略。

当前不做：

- 框选页面区域识别。
- 右键菜单识别图片。
- 自动扫描、页面变更监听或 SPA 自动重扫。
- 恢复 `jsQR`、`qr-decoder` 或其他第二解码器。

---

## 2. 当前架构

```
manifest.json
src/
  background.js
  content_script.js
  popup/
  options/
  lib/
    qr-utils.js
    qr-engine.js
    zxing-wasm/
styles/
assets/
tests/
```

| 模块 | 职责 |
|------|------|
| `manifest.json` | Manifest V3 配置、权限、content scripts、快捷键、CSP |
| `src/background.js` | 接收扫描请求、截图当前可见标签页、更新 Badge |
| `src/content_script.js` | 接收截图、调用解码引擎、渲染/清除 Overlay、写入历史 |
| `src/popup/popup.js` | 提供扫描当前页面、识别剪贴板、清除标记和最近记录 UI |
| `src/options/options.js` | 保存历史数量和安全打开策略 |
| `src/lib/qr-engine.js` | zxing-wasm-only 多阶段解码引擎 |
| `src/lib/qr-utils.js` | 设置合并、URL 安全、坐标转换、历史记录纯函数 |

---

## 3. 数据流

### 扫描当前页面

1. Popup 发送 `TRIGGER_SCAN`，或快捷键 `Alt + Shift + Q` 触发 `toggle-scan` command。
2. `background.js` 调用 `chrome.tabs.captureVisibleTab()` 截取当前可见视口。
3. `background.js` 向当前标签页发送 `START_SCAN_SCREENSHOT` 和截图 Data URL。
4. 顶层 `content_script.js` 加载截图并调用 `QR_ENGINE.decodeImage()`。
5. `qr-engine.js` 使用 zxing-wasm 多阶段解码。
6. `content_script.js` 将二维码角点按 DPR 映射为页面坐标。
7. 页面显示 `.qrhunt-overlay`，结果写入历史，并更新 Badge。

### 识别剪贴板

1. Popup 调用 `navigator.clipboard.read()`。
2. 取第一张图片 Blob，转为 Data URL 后加载为 `Image`。
3. 调用 `QR_ENGINE.decodeImage()`。
4. 将识别出的二维码内容写入最近记录。

### 清除标记

1. Popup 向当前标签页发送 `CLEAR_OVERLAYS`。
2. `content_script.js` 递增 `scanToken`，取消仍在进行的旧扫描。
3. 移除 `.qrhunt-overlay`、`.qrhunt-menu`、`.qrhunt-toast`。
4. 清空 Overlay 列表并更新 Badge。

---

## 4. 解码策略

解码实现集中在 `src/lib/qr-engine.js`，运行时只依赖本仓库打包的 zxing-wasm 文件：

- `src/lib/zxing-wasm/zxing-wasm.iife.js`
- `src/lib/zxing-wasm/zxing_reader.wasm`

当前使用的 API：

- `setZXingModuleOverrides`
- `getZXingModule`
- `readBarcodesFromImageData`

不要使用 `prepareZXingModule` 或 `readBarcodes`，当前打包文件不提供这两个 API。

### 多阶段流程

| 阶段 | 目的 |
|------|------|
| `full-fast` | 使用 `QRCode` 和 `tryHarder: false` 快速扫整图 |
| `full-try-harder` | 快速失败后启用更强检测，并加入 `MicroQRCode` |
| `scaled-*` | 对大图降采样、对极小图放大，提升速度或可读性 |
| `window-original` | 对原图进行重叠窗口扫描，处理多码或局部干扰 |
| `threshold-full` | 自适应阈值后整图扫描 |
| `threshold-window` | 自适应阈值后窗口扫描 |

默认 `scanMode` 为 `balanced`：拿到带定位信息的结果后停止后续重阶段。如果只有内容没有定位，后续阶段会继续尝试补定位，以便页面扫描能绘制蓝框。

---

## 5. 权限与安全

当前权限：

```json
{
  "permissions": ["activeTab", "storage", "tabs", "clipboardRead"],
  "host_permissions": ["<all_urls>"]
}
```

| 权限 | 用途 |
|------|------|
| `activeTab` / `tabs` | 获取当前标签页并截取可见视口 |
| `storage` | 保存设置和最近记录 |
| `clipboardRead` | 读取剪贴板图片 |
| `<all_urls>` | 注入 content script，渲染 Overlay |

安全边界：

- 解码在本地完成，不上传二维码图片。
- 默认只对 HTTP/HTTPS 内容显示打开入口。
- `javascript:`、`data:`、`vbscript:`、`file:` 等危险协议不会被打开。
- 浏览器内部页面无法注入 content script，这是平台限制。

---

## 6. 完成度

已完成：

- [x] 扫描当前页面可见区域。
- [x] 识别剪贴板图片。
- [x] zxing-wasm-only 解码。
- [x] 多阶段扫描策略。
- [x] 多二维码结果去重。
- [x] 缩放和窗口阶段的坐标回映射。
- [x] 页面 Overlay、菜单和 Badge。
- [x] 清除标记并取消旧扫描绘制。
- [x] 最近记录和设置页。
- [x] Node 单元测试覆盖产品边界和多阶段策略。
- [x] release 打包脚本。

后续可选：

- [ ] 增加浏览器自动化 E2E 测试。
- [ ] 增加真实二维码图片夹具，覆盖浏览器内 zxing 解码回归。
- [ ] 增强链接安全展示，例如域名高亮或短链接提示。
- [ ] 支持导出最近记录。

---

## 7. 测试与打包

Node 单元测试：

```bash
node tests/node-unit-test.js
```

浏览器辅助测试：

- `tests/unit-test.html`
- `tests/manual-test.html`

打包：

```bash
python3 scripts/build-release.py v0.2.0
```

打包结果：

- `dist/qr-scanner-v0.2.0.zip`

---

## 8. 维护原则

- 新增识别入口前必须先确认产品范围。
- 不恢复旧的 `jsQR` / `qr-decoder` 解码链路。
- 修改 zxing-wasm 初始化或解码参数时，必须同步更新单元测试。
- 修改功能边界时，同时更新 `README.md`、`Plan.md`、`CLAUDE.md`、`RELEASE_TEMPLATE.md` 和测试说明。
