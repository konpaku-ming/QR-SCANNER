# QR SCANNER — Edge 浏览器二维码识别插件开发计划

> 状态：已重构（Refactored with zxing-wasm）  
> 目标：在 Edge 浏览器中自动识别网页上的二维码，提供高亮、选中和跳转能力。

---

## 1. 项目概述

**名称**：QR SCANNER  
**平台**：Microsoft Edge（Chromium，Manifest V3）  
**核心功能**：
- 自动扫描当前网页中的二维码（包括 `<img>`、CSS 背景图、Canvas、SVG）。
- 在二维码位置生成可交互的高亮覆盖层（Overlay）。
- 用户点击覆盖层后，可选择“跳转链接”或“复制内容”。
- 支持手动截图扫描（针对跨域或动态加载的图片）。
- 支持剪贴板图片扫描（任意屏幕截图）。

---

## 2. 技术选型

| 层级 | 技术 / 库 |
|------|-----------|
| 扩展规范 | Manifest V3 |
| 二维码解析 | **zxing-wasm**（ZXing-C++ WASM，原生多码检测，~30ms） |
| 二维码解析（Fallback） | `jsQR` + `qr-decoder.js`（纯 JS，贪心涂白 + 滑动窗口） |
| 解码封装 | `qr-engine.js`（统一接口，自动 fallback） |
| 图像预处理 | zxing-wasm 内置（自适应阈值、去噪） |
| 前端框架 | 纯 Vanilla JS + CSS（减少打包体积） |
| 构建工具 | **无**（直接加载文件） |
| 状态管理 | `chrome.storage.local` |

**历史方案**：  
- 早期使用 `jsQR` 单码解码 + 贪心涂白滑动窗口实现多码。
- 2025-06 重构引入 `zxing-wasm`，大幅提升多码检测率与单码精度。

---

## 3. 架构设计

### 3.1 模块划分

```
qr-scanner/
├── manifest.json              # 扩展入口与权限声明
├── src/
│   ├── background.js          # Service Worker（后台逻辑）
│   ├── content_script.js      # 内容脚本（页面注入、扫描、Overlay 渲染）
│   ├── popup/                 # 插件图标点击弹窗
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── options/               # 设置页（占位）
│   │   ├── options.html
│   │   └── options.js
│   └── lib/
│       ├── zxing-wasm/        # ZXing-C++ WASM 构建
│       │   ├── zxing-wasm.iife.js
│       │   └── zxing_reader.wasm
│       ├── qr-engine.js       # 统一解码封装（zxing-wasm → fallback jsQR）
│       ├── qr-decoder.js      # 纯 JS 多码解码（fallback）
│       └── jsQR.js            # 单码解码库（fallback）
├── styles/
│   └── overlay.css            # 注入页面的覆盖层样式
├── assets/
│   └── icons/                 # 16x16, 32x32, 48x48, 128x128
├── tests/                     # 单元测试、手动测试、E2E 测试
├── docs/
│   └── zxing-wasm-migration-plan.md  # 改造方案（已实施）
└── Plan.md                    # 本文件
```

### 3.2 各模块职责

| 模块 | 职责 |
|------|------|
| **Background (Service Worker)** | 响应插件图标点击、快捷键命令；调度扫描任务；管理跨页面通信。不再动态注入脚本。 |
| **Content Script** | 注入目标网页，调用 `QR_ENGINE.decodeImage` 解码；创建/销毁 Overlay；监听 DOM 变化。 |
| **Popup** | 快捷控制面板（扫描、清除标记、剪贴板识别、最近记录）。 |
| **Options** | 用户偏好设置（占位）。 |
| **qr-engine.js** | 统一解码接口：优先 zxing-wasm，失败 fallback 到 qr-decoder.js。 |
| **qr-decoder.js** | 纯 JS 多码检测：贪心涂白 + 滑动窗口 + 积分图自适应阈值。 |

### 3.3 核心数据流

```
用户点击图标/快捷键
       │
       ▼
[Background] ──(消息)──> [Content Script]
                              │
                              ▼
                    调用 QR_ENGINE.decodeImage(screenshotImg)
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            [zxing-wasm]         [qr-decoder.js] (fallback)
                    │
                    ▼
          返回 {data, location}[]
                              │
                              ▼
                    渲染 Overlay（高亮框 + 点击事件）
                              │
                              ▼
                    用户点击 Overlay
                              │
                              ▼
                    弹出操作菜单（跳转 / 复制 / 关闭）
```

---

## 4. 功能规格

### 4.1 MVP（第一阶段）— 已完成 ✅
- [x] 插件图标点击后，扫描当前页面可见区域内的所有二维码。
- [x] 识别成功后，在二维码位置绘制半透明高亮框。
- [x] 点击高亮框，在新标签页打开解码出的 URL。
- [x] 扫描过程中显示简单的进度/状态提示（右上角 Badge 数字）。

### 4.2 进阶功能（第二阶段）— 已完成 ✅
- [x] 支持 CSS `background-image` 扫描。
- [x] 支持对整个视口截图扫描（解决 CORS 限制）。
- [x] 右键菜单：右键图片直接解析。
- [x] 历史记录：最近 50 条扫描结果（`chrome.storage.local`）。
- [x] 快捷键支持（`Alt+Shift+Q`）。
- [x] **剪贴板扫描**：读取剪贴板图片，识别任意屏幕截图中的二维码。

### 4.3 优化与扩展（第三阶段）— 已完成 ✅
- [x] 动态页面监听（`MutationObserver`），SPA 路由切换后自动重新扫描。
- [x] 图像预处理（zxing-wasm 内置自适应阈值）。
- [x] **引入 zxing-wasm**：替换 jsQR 为主力解码器，原生支持同图多码。
- [x] 整图多二维码检测（不再依赖 `<img>` 标签裁剪）。
- [ ] 扫描结果安全提示（短链接警告、域名高亮）。
- [ ] 导出历史记录（CSV / JSON）。
- [ ] 设置页（Options）持久化配置。

---

## 5. 关键技术难点与应对

| 难点 | 影响 | 应对策略 |
|------|------|----------|
| **CORS 限制** | 跨域图片无法直接读取 Canvas 像素 | 使用 `chrome.tabs.captureVisibleTab` 截图扫描；单图扫描 fallback 到后台 `fetch(blob)`。 |
| **同图多码漏检** | jsQR 单码设计，自研策略漏检率高 | **引入 zxing-wasm**，原生 `readBarcodes(..., maxNumberOfSymbols: 0)` 返回全部二维码。 |
| **性能消耗** | 大图、多图页面扫描卡顿 | zxing-wasm 解码仅需 ~30ms；废除滑动窗口（原 ~1–2s）。 |
| **动态内容** | SPA 页面内容异步加载，首次扫描易遗漏 | `MutationObserver` 监听 DOM 树变化，延迟/节流重新扫描。 |
| **低质量二维码** | 压缩、模糊、过曝导致识别失败 | zxing-cpp 工业级鲁棒性，内置自适应阈值；极端情况 fallback 到 qr-decoder.js。 |
| **WASM 离线加载** | Edge 扩展需离线可用，不能依赖 CDN | WASM 文件打包进扩展，通过 `chrome.runtime.getURL()` + `web_accessible_resources` 加载。 |
| **WASM 初始化延迟** | 首次扫描需编译 ~1MB WASM | 在 content script / popup 初始化时预调用 `QR_ENGINE.init()`。 |
| **Overlay 冲突** | 页面自身 z-index 极高或 pointer-events 设置导致覆盖层被遮挡 | 使用最高层级 `z-index: 2147483647`。 |

---

## 6. 权限清单（Manifest V3）

```json
{
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "contextMenus",
    "tabs",
    "clipboardRead"
  ],
  "host_permissions": [
    "<all_urls>"
  ]
}
```

> 说明：`activeTab` 是核心权限，仅在用户激活插件时授予当前标签页临时权限。`host_permissions` 中的 `<all_urls>` 是为了处理动态注入和截图。`clipboardRead` 用于剪贴板图片扫描。

---

## 7. 开发路线图

| 阶段 | 时间 | 产出 |
|------|-------------|------|
| **MVP** | 2025-05 | 基础扫描、Overlay、Popup |
| **进阶** | 2025-05 | 截图扫描、右键菜单、历史记录、快捷键 |
| **剪贴板** | 2025-06 | 剪贴板图片识别、多码检测增强 |
| **zxing-wasm 重构** | 2025-06 | 引入 zxing-wasm，替换 jsQR 为主力解码器，原生多码支持 |
| **后续** | TBD | 设置页、安全提示、历史导出 |

---

## 8. 参考资源

- [Chrome Extension Manifest V3 文档](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [zxing-wasm GitHub](https://github.com/Sec-ant/zxing-wasm)
- [zxing-cpp GitHub](https://github.com/zxing-cpp/zxing-cpp)
- [jsQR GitHub](https://github.com/cozmo/jsQR)
- [Edge 插件发布指南](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/publish-extension)

---

*本计划随项目进展更新。最新状态：zxing-wasm 重构已完成。*
