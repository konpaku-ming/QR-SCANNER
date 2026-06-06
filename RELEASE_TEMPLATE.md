# Release Notes Template

> Copy this template when creating a new GitHub Release.

---

## QR SCANNER v{VERSION}

### 下载安装

**方式一：GitHub Releases（推荐）**
1. 下载附件 `qr-scanner-{VERSION}.zip`
2. 解压到任意文件夹
3. Edge 浏览器打开 `edge://extensions/`，开启**开发者模式**
4. 点击**加载解压缩的扩展**，选择解压后的文件夹

**方式二：Edge 加载项商店**
> 如已上架，可直接在商店搜索 "QR SCANNER" 安装。

### 更新日志

#### 新增
- 

#### 优化
- 

#### 修复
- 

### 系统要求

- **浏览器**：Microsoft Edge（Chromium 内核，88+）或 Google Chrome（88+）
- **平台**：Windows / macOS / Linux
- **权限**：`activeTab`, `scripting`, `storage`, `contextMenus`, `tabs`, `clipboardRead`

### 已知问题

- 浏览器内置页面（`edge://`、`chrome://`）无法扫描
- 视口外的二维码需先滚动到可见区域再扫描
- 自动扫描仅监听当前可见区域，不会扫描完整长页面

### 文件校验

| 文件 | 大小 | SHA-256 |
|------|------|---------|
| `qr-scanner-{VERSION}.zip` | {SIZE} | `{HASH}` |

---

*发布日期：{DATE}*
