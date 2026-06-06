# Release Notes Template

> Copy this template when creating a GitHub Release.

---

## QR SCANNER v{VERSION}

QR SCANNER 是一个本地二维码识别浏览器扩展。当前版本只提供两个二维码识别入口：

- 扫描当前页面
- 识别剪贴板

运行时只使用本地打包的 zxing-wasm，不包含 `jsQR`、`qr-decoder` 或其他第二解码器。

### 下载安装

1. 下载附件 `qr-scanner-{VERSION}.zip`
2. 解压到任意文件夹
3. 打开 `edge://extensions/` 或 `chrome://extensions/`
4. 开启开发者模式
5. 点击加载解压缩的扩展，选择解压后的文件夹

### 本版本包含

- 扫描当前页面可见视口，并在识别到定位信息时绘制蓝色高亮框。
- 识别剪贴板图片中的二维码。
- zxing-wasm-only 多阶段解码策略：
  - 快速整图扫描；
  - 增强整图扫描；
  - 大图降采样或小图放大；
  - 局部窗口扫描；
  - 自适应阈值预处理后再扫描。
- 清除标记：快速移除 Overlay、菜单、Toast 和 Badge，并取消旧扫描结果继续绘制。
- 最近记录：支持打开、复制、删除和清空。
- 设置页：支持历史记录数量和 HTTP/HTTPS 安全打开策略。

### 权限

- `activeTab` / `tabs`：截取当前标签页可见视口。
- `storage`：保存设置和最近记录。
- `clipboardRead`：读取剪贴板图片。
- `<all_urls>`：在普通网页中注入 content script 并绘制 Overlay。

### 已知限制

- 当前页面扫描只覆盖当前可见视口；视口外二维码需要先滚动到可见区域。
- 浏览器内置页面如 `edge://`、`chrome://`、`about:` 无法注入 content script。
- 模糊、过小、遮挡、压缩严重或低对比度二维码仍可能无法识别。
- 剪贴板入口只处理图片，不处理剪贴板纯文本。
- 当前版本不提供框选区域识别、右键图片识别或自动扫描。

### 文件校验

| 文件 | 大小 | SHA-256 |
|------|------|---------|
| `qr-scanner-{VERSION}.zip` | {SIZE} | `{HASH}` |

---

*发布日期：{DATE}*
