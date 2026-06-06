# QR SCANNER — Edge 浏览器二维码识别插件开发计划

> 状态：可用 MVP，已完成 zxing-wasm 重构、P1/P2 稳定性修复和设置页落地  
> 目标：在 Edge 浏览器中自动识别网页上的二维码，提供高亮、选中和跳转能力。

---

## 1. 项目概述

**名称**：QR SCANNER  
**平台**：Microsoft Edge（Chromium，Manifest V3）  
**核心功能**：
- 扫描当前网页可见区域中的二维码（通过视口截图识别，不依赖 DOM 图片读取）。
- 在二维码位置生成可交互的高亮覆盖层（Overlay）。
- 用户点击覆盖层后，可选择“打开链接”或“复制内容”；默认仅对 HTTP/HTTPS 显示打开入口。
- 支持网页内拖拽框选区域扫描。
- 支持剪贴板图片扫描（任意屏幕截图）。
- 支持可配置的 SPA 自动重扫、历史记录数量和链接打开策略。

---

## 2. 技术选型

| 层级 | 技术 / 库 |
|------|-----------|
| 扩展规范 | Manifest V3 |
| 二维码解析 | **zxing-wasm**（ZXing-C++ WASM，原生多码检测） |
| 二维码解析（Fallback） | `jsQR` + `qr-decoder.js`（纯 JS，贪心涂白 + 滑动窗口） |
| 解码封装 | `qr-engine.js`（统一接口，自动 fallback） |
| 共享工具 | `qr-utils.js`（设置合并、URL 判断、图片 URL 匹配、区域裁剪钳位） |
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
│   ├── options/               # 设置页（自动扫描、历史数量、安全打开）
│   │   ├── options.html
│   │   └── options.js
│   └── lib/
│       ├── zxing-wasm/        # ZXing-C++ WASM 构建
│       │   ├── zxing-wasm.iife.js
│       │   └── zxing_reader.wasm
│       ├── qr-utils.js        # 共享纯函数与配置默认值
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
| **Popup** | 快捷控制面板（扫描、框选区域、剪贴板识别、清除标记、最近记录）。 |
| **Options** | 用户偏好设置：自动扫描、历史记录数量、安全打开策略。 |
| **qr-utils.js** | 共享纯函数：设置合并、URL 安全判断、图片 URL 匹配、区域裁剪钳位。 |
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
                    弹出操作菜单（安全打开 / 复制 / 关闭）
```

网页框选区域和剪贴板识别复用同一套 `QR_ENGINE.decodeImage` 解码入口；设置项统一存储在 `chrome.storage.local` 的 `qr_scanner_settings` 中。

---

## 4. 功能规格

### 4.1 MVP（第一阶段）— 已完成 ✅
- [x] 插件图标点击后，扫描当前页面可见区域内的所有二维码。
- [x] 识别成功后，在二维码位置绘制半透明高亮框。
- [x] 点击高亮框，在新标签页打开解码出的 URL。
- [x] 扫描过程中显示简单的进度/状态提示（右上角 Badge 数字）。

### 4.2 进阶功能（第二阶段）— 已完成 ✅
- [x] 支持当前视口截图扫描，可识别 `<img>`、背景图、Canvas、SVG 等可见像素中的二维码。
- [x] 支持对整个视口截图扫描（解决 CORS 限制）。
- [x] 右键菜单：右键图片直接解析。
- [x] 右键图片 URL 匹配：支持 `currentSrc`、`src`、相对 URL 标准化和部分 `srcset` 场景。
- [x] 历史记录：最近扫描结果（`chrome.storage.local`，数量可配置）。
- [x] 快捷键支持（`Alt+Shift+Q`）。
- [x] **剪贴板扫描**：读取剪贴板图片，识别任意屏幕截图中的二维码。
- [x] **网页框选区域扫描**：Popup 触发页面选区遮罩，裁剪当前截图后识别。

### 4.3 优化与扩展（第三阶段）— 已完成 ✅
- [x] 动态页面监听（`MutationObserver`），SPA 路由切换后自动重新扫描。
- [x] 图像预处理（zxing-wasm 内置自适应阈值）。
- [x] **引入 zxing-wasm**：替换 jsQR 为主力解码器，原生支持同图多码。
- [x] 整图多二维码检测（不再依赖 `<img>` 标签裁剪）。
- [x] 设置页（Options）持久化配置。
- [x] 扫描结果安全打开：默认仅允许 HTTP/HTTPS 链接显示打开入口。
- [x] 区域截图裁剪边界钳位，降低边缘选区和高 DPR 场景失败率。
- [ ] 扫描结果安全提示增强（短链接警告、域名高亮）。
- [ ] 导出历史记录（CSV / JSON）。
- [ ] 浏览器自动化 E2E 测试。

---

## 5. 关键技术难点与应对

| 难点 | 影响 | 应对策略 |
|------|------|----------|
| **CORS 限制** | 跨域图片无法直接读取 Canvas 像素 | 使用 `chrome.tabs.captureVisibleTab` 截图扫描；单图扫描 fallback 到后台 `fetch(blob)`。 |
| **同图多码漏检** | jsQR 单码设计，自研策略漏检率高 | **引入 zxing-wasm**，原生 `readBarcodes(..., maxNumberOfSymbols: 0)` 返回全部二维码。 |
| **性能消耗** | 大图、多图页面扫描卡顿 | 主路径使用 zxing-wasm 原生多码检测；高开销滑动窗口仅作为 fallback 保留。 |
| **动态内容** | SPA 页面内容异步加载，首次扫描易遗漏 | `MutationObserver` 监听 DOM 树变化，延迟/节流重新扫描。 |
| **自动扫描可控性** | 全站监听可能造成性能和用户预期问题 | 设置页提供 `autoScanEnabled` 开关，content script 监听配置变化后启停 Observer。 |
| **低质量二维码** | 压缩、模糊、过曝导致识别失败 | zxing-cpp 工业级鲁棒性，内置自适应阈值；极端情况 fallback 到 qr-decoder.js。 |
| **WASM 离线加载** | Edge 扩展需离线可用，不能依赖 CDN | WASM 文件打包进扩展，通过 `chrome.runtime.getURL()` + `web_accessible_resources` 加载。 |
| **WASM 初始化延迟** | 首次扫描需编译 ~1MB WASM | 在 content script / popup 初始化时预调用 `QR_ENGINE.init()`。 |
| **Overlay 冲突** | 页面自身 z-index 极高或 pointer-events 设置导致覆盖层被遮挡 | 使用最高层级 `z-index: 2147483647`。 |
| **非 URL 内容误打开** | 二维码可能是普通文本或危险协议 | `qr-utils.js` 默认仅允许 HTTP/HTTPS 显示打开入口，其余内容只提供复制。 |
| **区域边界裁剪** | 选区靠近视口边缘或高 DPR 时可能越界 | `clampRegionToImage()` 使用截图真实尺寸钳位裁剪区域。 |

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

> 说明：`activeTab` / `tabs` 用于当前窗口截图扫描，`storage` 用于设置和历史记录，`contextMenus` 用于右键图片扫描，`clipboardRead` 用于剪贴板图片识别。`host_permissions` 中的 `<all_urls>` 用于在普通网页中加载 content script。

---

## 7. 开发路线图

| 阶段 | 时间 | 产出 |
|------|-------------|------|
| **MVP** | 2025-05 | 基础扫描、Overlay、Popup |
| **进阶** | 2025-05 | 截图扫描、右键菜单、历史记录、快捷键 |
| **剪贴板** | 2025-06 | 剪贴板图片识别、多码检测增强 |
| **zxing-wasm 重构** | 2025-06 | 引入 zxing-wasm，替换 jsQR 为主力解码器，原生多码支持 |
| **稳定性修复** | 2026-06 | 框选入口、区域裁剪钳位、右键 URL 匹配、Options 设置页、测试补强 |
| **后续** | TBD | 域名安全提示、历史导出、浏览器自动化 E2E |

---

## 8. 参考资源

- [Chrome Extension Manifest V3 文档](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [zxing-wasm GitHub](https://github.com/Sec-ant/zxing-wasm)
- [zxing-cpp GitHub](https://github.com/zxing-cpp/zxing-cpp)
- [jsQR GitHub](https://github.com/cozmo/jsQR)
- [Edge 插件发布指南](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/publish-extension)

---

*本计划随项目进展更新。最新状态：P1/P2 修复已完成，项目处于可用 MVP 状态。*
