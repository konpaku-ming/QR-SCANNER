# QR SCANNER

> 在当前页面可见区域或剪贴板图片中识别二维码，并在本地完成解码。

QR SCANNER 是一个 Manifest V3 浏览器扩展，适用于 Microsoft Edge 和 Google Chrome。当前版本的二维码识别入口严格限定为两个：

- **扫描当前页面**
- **识别剪贴板**

除此之外，扩展只保留必要的辅助能力：清除页面标记、查看最近记录、复制结果、安全打开链接和基础设置。运行时只使用本地打包的 **zxing-wasm**，不会加载 `jsQR`、`qr-decoder` 或其他第二解码器。

---

## 功能

| 功能 | 当前实现 |
|------|----------|
| 扫描当前页面 | 截取当前标签页的可见视口，识别截图中的二维码，并在页面上绘制蓝色高亮框 |
| 识别剪贴板 | 读取剪贴板中的图片，识别二维码内容，并写入最近记录 |
| 清除标记 | 清除页面上的蓝色高亮框、菜单、提示和 Badge；同时取消旧扫描继续绘制 |
| 最近记录 | 结果保存在 `chrome.storage.local`，可打开、复制、删除或清空 |
| 安全打开 | 默认只对 HTTP/HTTPS 内容显示打开入口，其他内容只提供复制 |
| 设置 | 支持配置历史记录保留数量和是否仅打开 HTTP/HTTPS 链接 |

明确不包含：

- 框选页面区域识别
- 右键图片识别
- 自动扫描或 SPA 变更后自动重扫
- 非 zxing-wasm 的二维码解析回退路径

---

## 使用

### 扫描当前页面

1. 打开包含二维码的网页，并确保二维码位于当前可见视口内。
2. 点击扩展 Popup 中的 **扫描当前页面**，或使用快捷键 `Alt + Shift + Q`。
3. 扩展会截取当前可见视口并调用 zxing-wasm 解码。
4. 识别到带定位信息的二维码时，页面会出现蓝色高亮框。
5. 点击高亮框，可选择打开链接、复制内容或关闭菜单。

### 识别剪贴板

1. 使用系统截图工具把二维码截图放入剪贴板，例如 Windows 的 `Win + Shift + S`。
2. 点击 Popup 中的 **识别剪贴板**。
3. 识别结果会写入最近记录，可在 Popup 中打开或复制。

### 清除标记

点击 Popup 中的 **清除标记**。content script 会移除 `.qrhunt-overlay`、`.qrhunt-menu`、`.qrhunt-toast`，清空页面 Badge，并通过 `scanToken` 阻止仍在进行的旧扫描把蓝框重新画回页面。

---

## 解码实现

解码入口统一为 `QR_ENGINE.decodeImage()`，位于 `src/lib/qr-engine.js`。该模块只调用当前打包的 zxing-wasm API：

- `ZXingWASM.setZXingModuleOverrides()`
- `ZXingWASM.getZXingModule()`
- `ZXingWASM.readBarcodesFromImageData()`

WASM 文件通过 `chrome.runtime.getURL('src/lib/zxing-wasm/...')` 定位，随扩展离线打包。

### 多阶段策略

当前页面扫描和剪贴板扫描共享同一套 zxing-wasm-only 多阶段策略：

1. **快速整图扫描**：优先使用 `QRCode`、`tryHarder: false` 扫整张图；如果识别成功且有定位信息，立即返回。
2. **增强整图扫描**：快速失败后启用 `tryHarder`，并加入 `MicroQRCode`。
3. **尺寸自适应扫描**：对大图降采样，对极小图放大后再扫，坐标会映射回原图。
4. **局部窗口扫描**：把图像切成重叠窗口逐块交给 zxing，降低多个二维码互相干扰的概率。
5. **自适应阈值预处理**：对图像做局部二值化后，再执行整图与窗口扫描。

默认模式为 `balanced`：一旦拿到带定位信息的结果，就停止更重的阶段，以兼顾速度和准确率。如果某阶段只识别出内容但没有定位信息，后续阶段会继续尝试补出可绘制蓝框的位置。

---

## 架构

```
manifest.json
src/
  background.js            # 截图扫描调度、快捷键、Badge 更新
  content_script.js        # 截图解码、Overlay 渲染、菜单与清除标记
  popup/
    popup.html
    popup.js               # 两个识别入口、清除标记、历史记录
  options/
    options.html
    options.js             # 历史条数和安全打开设置
  lib/
    qr-engine.js           # zxing-wasm-only 多阶段解码
    qr-utils.js            # 设置、URL 安全、坐标映射、历史记录工具
    zxing-wasm/
      zxing-wasm.iife.js
      zxing_reader.wasm
styles/overlay.css
assets/icons/
tests/
  node-unit-test.js
  unit-test.html
  manual-test.html
```

### 当前页面扫描流程

```
Popup / Alt+Shift+Q
  -> background.js
  -> chrome.tabs.captureVisibleTab()
  -> content_script.js START_SCAN_SCREENSHOT
  -> QR_ENGINE.decodeImage()
  -> zxing-wasm 多阶段解码
  -> Overlay / 历史记录 / Badge
```

### 剪贴板扫描流程

```
Popup
  -> navigator.clipboard.read()
  -> 图片 Blob 转 Data URL
  -> Image
  -> QR_ENGINE.decodeImage()
  -> 最近记录
```

---

## 权限

```json
{
  "permissions": ["activeTab", "storage", "tabs", "clipboardRead"],
  "host_permissions": ["<all_urls>"]
}
```

- `activeTab` / `tabs`：获取当前标签页并截取可见视口。
- `storage`：保存设置和最近识别记录。
- `clipboardRead`：读取剪贴板图片。
- `<all_urls>`：在普通网页中注入 content script 并绘制 Overlay。

---

## 限制

- 当前页面扫描只覆盖当前可见视口；视口外二维码需要先滚动到可见区域。
- 浏览器内置页面如 `edge://`、`chrome://`、`about:` 无法注入 content script。
- 模糊、遮挡、过小、压缩严重或对比度极低的二维码仍可能无法识别。
- 剪贴板入口只处理图片，不会把剪贴板纯文本当作二维码内容处理。

---

## 开发与验证

运行 Node 单元测试：

```bash
node tests/node-unit-test.js
```

浏览器测试页面：

- `tests/unit-test.html`
- `tests/manual-test.html`

打包发布文件：

```bash
python3 scripts/build-release.py v0.2.0
```

输出文件为 `dist/qr-scanner-v0.2.0.zip`。

---

## 当前状态

当前代码已经实现可用 MVP：

- 两个识别入口完整可用。
- 页面蓝框和清除标记逻辑已实现。
- 解码链路为 zxing-wasm-only，并包含多阶段扫描策略。
- Node 单元测试覆盖工具函数、产品边界、zxing 多阶段策略和打包约束。
