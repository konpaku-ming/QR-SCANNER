# QR Hunt — Edge 浏览器二维码识别插件开发计划

> 状态：草案（Draft）  
> 目标：在 Edge 浏览器中自动识别网页上的二维码，提供高亮、选中和跳转能力。

---

## 1. 项目概述

**名称**：QR Hunt（暂定）  
**平台**：Microsoft Edge（Chromium，Manifest V3）  
**核心功能**：
- 自动扫描当前网页中的二维码（包括 `<img>`、CSS 背景图、Canvas）。
- 在二维码位置生成可交互的高亮覆盖层（Overlay）。
- 用户点击覆盖层后，可选择“跳转链接”或“复制内容”。
- 支持手动截图扫描（针对跨域或动态加载的图片）。

---

## 2. 技术选型

| 层级 | 技术 / 库 |
|------|-----------|
| 扩展规范 | Manifest V3 |
| 二维码解析 | `jsQR`（轻量，纯 JS，无需 WASM） |
| 图像预处理 | 原生 Canvas API（灰度化、二值化） |
| 前端框架（可选） | 纯 Vanilla JS + CSS（减少打包体积） |
| 构建工具（可选） | Vite 或 Rollup（如需 TypeScript / 模块化） |
| 状态管理 | `chrome.storage.local` |

**备选方案**：  
- 若 `jsQR` 识别率不足，可迁移至 `@zxing-js/browser`（支持更多码制，但体积稍大）。

---

## 3. 架构设计

### 3.1 模块划分

```
qrhunt/
├── manifest.json              # 扩展入口与权限声明
├── background.js              # Service Worker（后台逻辑）
├── content_script.js          # 内容脚本（页面注入、扫描、Overlay 渲染）
├── popup/                     # 插件图标点击弹窗
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/                   # 设置页（可选）
│   ├── options.html
│   └── options.js
├── lib/
│   └── jsQR.js                # 二维码解码库（或 npm 依赖）
├── assets/
│   └── icons/                 # 16x16, 32x32, 48x48, 128x128
└── styles/
    └── overlay.css            # 注入页面的覆盖层样式
```

### 3.2 各模块职责

| 模块 | 职责 |
|------|------|
| **Background (Service Worker)** | 响应插件图标点击、快捷键命令；调度扫描任务；管理跨页面通信。 |
| **Content Script** | 注入目标网页，遍历 DOM 提取图像；调用解码库；创建/销毁 Overlay；监听 DOM 变化。 |
| **Popup** | 快捷控制面板（如“开始扫描”、“显示/隐藏标记”、“最近记录”）。 |
| **Options** | 用户偏好设置（快捷键、扫描灵敏度、是否自动跳转、主题色）。 |

### 3.3 核心数据流

```
用户点击图标/快捷键
       │
       ▼
[Background] ──(消息)──> [Content Script] 注入当前 Tab
                              │
                              ▼
                    遍历 <img> / 背景图 / Canvas
                              │
                              ▼
                    图像数据 ──> [jsQR] 解码
                              │
                              ▼
                    解码成功？───Yes───> 渲染 Overlay（高亮框 + 点击事件）
                              │
                              ▼
                    用户点击 Overlay
                              │
                              ▼
                    弹出操作菜单（跳转 / 复制 / 关闭）
```

---

## 4. 功能规格

### 4.1 MVP（第一阶段）
- [ ] 插件图标点击后，扫描当前页面可见区域内的所有 `<img>` 标签。
- [ ] 识别成功后，在二维码位置绘制半透明高亮框。
- [ ] 点击高亮框，在新标签页打开解码出的 URL。
- [ ] 扫描过程中显示简单的进度/状态提示（如右上角 Badge 数字）。

### 4.2 进阶功能（第二阶段）
- [ ] 支持 CSS `background-image` 扫描。
- [ ] 支持对整个视口截图扫描（解决 CORS 限制）。
- [ ] 右键菜单：右键图片直接解析。
- [ ] 历史记录：最近 20 条扫描结果（`chrome.storage.local`）。
- [ ] 快捷键支持（如 `Alt+Shift+Q` 触发扫描）。

### 4.3 优化与扩展（第三阶段）
- [ ] 动态页面监听（`MutationObserver`），SPA 路由切换后自动重新扫描。
- [ ] 图像预处理（对比度增强、去噪）以提高识别率。
- [ ] 扫描结果安全提示（短链接警告、域名高亮）。
- [ ] 导出历史记录（CSV / JSON）。

---

## 5. 关键技术难点与应对

| 难点 | 影响 | 应对策略 |
|------|------|----------|
| **CORS 限制** | 跨域图片无法直接读取 Canvas 像素 | 优先使用 `chrome.tabs.captureVisibleTab` 截图扫描；对于单图，尝试通过 `fetch(blob)` 绕过。 |
| **性能消耗** | 大图、多图页面扫描卡顿 | 仅扫描可见区域（`IntersectionObserver`）；限制并发解码数量；图片尺寸超过阈值先压缩。 |
| **动态内容** | SPA 页面内容异步加载，首次扫描易遗漏 | 注入 `MutationObserver`，监听 DOM 树变化，延迟/节流重新扫描。 |
| **低质量二维码** | 压缩、模糊、过曝导致识别失败 | Canvas 预处理：灰度化、自适应二值化、边缘锐化后再送入 `jsQR`。 |
| **Overlay 冲突** | 页面自身 z-index 极高或 pointer-events 设置导致覆盖层被遮挡 | 使用 Shadow DOM 注入 Overlay，隔离样式；使用最高层级 `z-index: 2147483647`。 |

---

## 6. 权限清单（Manifest V3）

```json
{
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "contextMenus",
    "tabs"
  ],
  "host_permissions": [
    "<all_urls>"
  ]
}
```

> 说明：`activeTab` 是核心权限，仅在用户激活插件时授予当前标签页临时权限，比 `<all_urls>` 更友好。`host_permissions` 中的 `<all_urls>` 是为了处理动态注入和截图，可在选项中解释给用户。

---

## 7. 开发路线图

| 阶段 | 时间（预估） | 产出 |
|------|-------------|------|
| **Week 1** | 3–5 天 | 项目脚手架搭建；Manifest V3 配置；Content Script 注入测试。 |
| **Week 2** | 5–7 天 | 集成 `jsQR`；实现 `<img>` 扫描与 Overlay 渲染；Popup 基础 UI。 |
| **Week 3** | 5–7 天 | 截图扫描（`captureVisibleTab`）；右键菜单；历史记录存储。 |
| **Week 4** | 3–5 天 | 性能优化；图像预处理；设置页（Options）；Edge 商店打包。 |

---

## 8. 待讨论事项

以下问题需要进一步确认，以便细化实现：

1. **是否使用 TypeScript？**  类型安全有助于维护，但会增加构建步骤。  
2. **是否使用前端框架（如 React/Vue）做 Popup？**  纯 JS 更轻量，但框架开发体验更好。  
3. **扫描触发方式**：默认“自动扫描所有页面”还是“仅用户点击后扫描”？前者便利但性能/隐私敏感。  
4. **识别范围**：仅处理 URL 类型的二维码，还是同时支持纯文本、Wi-Fi 配置、名片等？  
5. **视觉设计风格**：希望 Overlay 采用何种风格（简约线条、霓虹高亮、还是类似系统选框）？  

---

## 9. 参考资源

- [Chrome Extension Manifest V3 文档](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [jsQR GitHub](https://github.com/cozmo/jsQR)
- [ZXing JS Browser](https://github.com/zxing-js/browser)
- [Edge 插件发布指南](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/publish-extension)

---

*本计划随讨论进展更新。*
