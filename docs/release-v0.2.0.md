# QR SCANNER v0.2.0 Release Notes

发布日期：2026-06-07

## 概述

QR SCANNER v0.2.0 是一次产品边界和解码链路收敛版本。当前版本只保留两个二维码识别入口：

- 扫描当前页面
- 识别剪贴板

运行时只使用本地打包的 zxing-wasm，不再包含 `jsQR`、`qr-decoder` 或其他第二解码器。

## 主要变化

### 新增

- zxing-wasm-only 多阶段解码策略：
  - 快速整图扫描；
  - 增强整图扫描；
  - 大图降采样或小图放大；
  - 局部窗口扫描；
  - 自适应阈值预处理后再扫描。
- 针对多阶段扫描补充 Node 单元测试，覆盖阶段顺序、坐标回映射、去重和阈值预处理。

### 优化

- 扫描当前页面的速度和准确率相比单次 zxing 调用更稳定。
- 快速扫描命中并带定位信息时立即停止后续重阶段，减少不必要计算。
- 快速扫描只识别出内容但没有定位时，继续后续阶段尝试补出可绘制蓝框的位置。
- 清除标记会立即移除 Overlay、菜单、Toast 和 Badge，并取消旧扫描结果继续绘制。
- 文档已按当前实现重写，明确产品范围和 zxing-wasm-only 解码方式。

### 移除

- 移除框选页面区域识别入口和相关说明。
- 移除右键图片识别入口和相关权限。
- 移除自动扫描、SPA MutationObserver 自动重扫相关实现和测试页。
- 移除 `jsQR.js` 与 `qr-decoder.js`。

### 修复

- 修正 zxing-wasm 初始化与解码 API，使用当前打包文件实际提供的 `getZXingModule` 和 `readBarcodesFromImageData`。
- 修正快捷键描述为“扫描当前页面”。
- 修正过时手动测试说明。

## 权限

- `activeTab` / `tabs`：截取当前标签页可见视口。
- `storage`：保存设置和最近记录。
- `clipboardRead`：读取剪贴板图片。
- `<all_urls>`：在普通网页中注入 content script 并绘制 Overlay。

## 已知限制

- 当前页面扫描只覆盖当前可见视口；视口外二维码需要先滚动到可见区域。
- 浏览器内置页面如 `edge://`、`chrome://`、`about:` 无法注入 content script。
- 模糊、过小、遮挡、压缩严重或低对比度二维码仍可能无法识别。
- 剪贴板入口只处理图片，不处理剪贴板纯文本。

## 文件校验

| 文件 | 大小 | SHA-256 |
|------|------|---------|
| `qr-scanner-v0.2.0.zip` | 414470 bytes / 404.8 KB | `ebbc44dce191a96eb75333d843448fa1e79564e59e8cf772ba0117501ccb5d85` |

## 发布前验证

- [x] `node tests/node-unit-test.js`
- [x] `python3 -m json.tool manifest.json`
- [x] `python3 scripts/build-release.py v0.2.0`
- [x] `git diff --check`
- [ ] 手动加载扩展并验证扫描当前页面、识别剪贴板、清除标记、历史记录和设置页
