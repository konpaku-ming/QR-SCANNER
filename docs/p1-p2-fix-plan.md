# P1 / P2 修复计划

本文只覆盖当前代码中 P1、P2 级别的问题。P0 问题（设置链接错误、URL 打开安全校验、自动扫描默认行为与设置页不一致）应优先另行修复。

## 执行状态

- P1-1：已修复。Popup 已拆分“框选页面区域”和“识别剪贴板”两个入口。
- P1-2：已修复。区域截图裁剪已通过共享工具函数做边界钳位。
- P1-3：已修复。右键图片扫描已改用统一 URL 匹配辅助函数。
- P2-1：已修复。Options 页面已支持设置读取、保存和恢复默认。
- P2-2：已修复基础项。Node/browser 单测资产已更新，手动测试清单已同步；浏览器自动化测试仍作为后续增强目标。

## P1-1：网页选区扫描已有实现但没有可用入口

### 具体问题

`src/content_script.js` 已经实现 `START_REGION_SELECT` 消息处理和拖拽选区识别流程，但 `src/popup/popup.html` / `src/popup/popup.js` 中没有按钮触发这个消息。

当前 popup 的“识别剪贴板”按钮实际执行的是 `navigator.clipboard.read()`，会读取剪贴板图片，而不是启动网页内框选区域。结果是代码里存在一套用户无法正常使用的网页选区扫描功能，产品行为也容易被误解。

相关位置：

- `src/content_script.js`：`START_REGION_SELECT` 消息分支、`startRegionSelect()`
- `src/popup/popup.html`：当前只有“扫描当前页面”“识别剪贴板”“清除标记”
- `src/popup/popup.js`：`btnRegion` 当前绑定剪贴板读取逻辑

### 修复计划

1. 在 popup 中区分两个入口：
   - “框选页面区域”：向当前活动 tab 发送 `START_REGION_SELECT`
   - “识别剪贴板”：保留现有剪贴板图片识别逻辑
2. 给新按钮补充清晰的 DOM id，例如 `btn-select-region`。
3. 点击“框选页面区域”后关闭或最小化 popup 不是必须；但需要在状态栏提示“请在页面中拖拽选择区域”。
4. 发送消息失败时给出明确提示，例如当前页面不允许注入 content script、浏览器内部页面不可用等。
5. 更新手动测试页面或测试说明，让“网页框选”和“剪贴板截图”成为两个独立测试项。

### 预期效果

- 用户能从 popup 直接启动网页内拖拽框选。
- “识别剪贴板”和“框选页面区域”语义分离，避免误导。
- 已存在的选区识别代码变成真实可达功能，不再是悬空实现。

### 如何测试修复效果

手动测试：

1. 加载扩展，打开 `tests/manual-test.html`。
2. 点击 popup 中的“框选页面区域”。
3. 页面出现选区遮罩和提示。
4. 拖拽框选一个二维码，预期显示识别成功 toast，并出现结果菜单或历史记录新增。
5. 按 `Esc` 取消，预期遮罩消失并显示取消提示。
6. 在 `chrome://extensions` 等不可注入页面点击按钮，预期 popup 显示友好失败信息。

回归测试：

1. 点击“识别剪贴板”，确认仍读取剪贴板图片。
2. 点击“扫描当前页面”，确认整页截图扫描仍可用。
3. 运行 `node tests/node-unit-test.js`，确认现有纯函数测试仍通过。

## P1-2：区域截图裁剪缺少边界钳位

### 具体问题

`decodeRegion()` 根据选区和 DPR 直接计算截图裁剪参数：

- `sx = Math.round(rect.left * dpr)`
- `sy = Math.round(rect.top * dpr)`
- `sw = Math.round(rect.width * dpr)`
- `sh = Math.round(rect.height * dpr)`

随后直接调用 `ctx.drawImage(screenshotImg, sx, sy, sw, sh, 0, 0, sw, sh)`。如果选区靠近视口边缘、浏览器缩放、高 DPR、截图尺寸与视口尺寸不完全一致，或者参数超出截图边界，可能出现裁剪异常、空 canvas、识别失败但提示不准确等问题。

相关位置：

- `src/content_script.js`：`decodeRegion()`

### 修复计划

1. 读取 `screenshotImg.width` 和 `screenshotImg.height` 作为真实裁剪边界。
2. 对 `sx`、`sy` 做下限钳位：不得小于 `0`。
3. 对 `sw`、`sh` 做有效范围钳位：不得超过截图剩余宽高。
4. 如果钳位后宽高小于最小阈值（例如 20 CSS px 对应的物理像素，或直接小于 20 像素），提示“选区超出截图范围或过小”。
5. 抽出一个小的坐标转换辅助函数，方便单元测试，例如：
   - 输入：`rect`、`dpr`、`imageWidth`、`imageHeight`
   - 输出：`{ sx, sy, sw, sh }` 或 `null`
6. 给该辅助函数补充 Node 单元测试。

### 预期效果

- 区域识别在页面边缘、高 DPR、缩放场景下更稳定。
- 无效选区能得到明确提示，而不是静默失败或抛异常。
- 关键坐标计算可以被单元测试覆盖，后续改动更安全。

### 如何测试修复效果

单元测试：

1. 新增坐标钳位测试：
   - 正常选区不改变坐标。
   - `left/top` 为负数时钳位到 `0`。
   - 选区超出右边界/下边界时裁剪宽高被截断。
   - 完全在截图外时返回 `null`。
   - DPR 为 `1.5`、`2` 时坐标四舍五入符合预期。
2. 运行 `node tests/node-unit-test.js`。

手动测试：

1. 在 `tests/manual-test.html` 中框选完整二维码，预期识别成功。
2. 从视口最左上角开始拖拽框选，预期不报错。
3. 框选贴近视口右下角的二维码或部分区域，预期可识别或给出明确失败提示。
4. 在浏览器缩放 125%、150% 下重复测试。

## P1-3：右键单图扫描对图片 URL 做严格相等匹配

### 具体问题

`scanSingleImage(imageUrl)` 通过 `i.src === imageUrl` 查找页面上的图片元素。实际网页中常见情况包括：

- 页面使用相对路径，浏览器解析后的 `img.src` 与右键菜单传入的 URL 表示形式不同。
- 图片使用 `srcset`，真实展示资源在 `currentSrc`。
- URL 编码、重定向、查询参数顺序或尾部斜杠存在差异。

严格相等会导致找不到原始图片元素，只能走 background fetch fallback。fallback 能解码内容，但可能无法把 overlay 准确画到原图片位置。

相关位置：

- `src/content_script.js`：`scanSingleImage()`
- `src/content_script.js`：`scanSingleImageDataUrl()`

### 修复计划

1. 新增图片匹配辅助函数，例如 `findImageByUrl(imageUrl)`。
2. 匹配优先级：
   - `img.currentSrc === imageUrl`
   - `img.src === imageUrl`
   - `new URL(img.currentSrc || img.src, document.baseURI).href === new URL(imageUrl, document.baseURI).href`
3. 对 URL 解析失败做容错，不让单张图片扫描中断。
4. `scanSingleImage()` 和 `scanSingleImageDataUrl()` 共用同一匹配函数。
5. 如仍找不到 DOM 图片，继续保留现有 `showFloatingResult()` fallback。

### 预期效果

- 右键扫描更容易找到真实图片元素。
- 识别成功后 overlay 更可能画在图片上，而不是只显示浮动结果。
- 对 `srcset`、相对 URL、编码差异的兼容性更好。

### 如何测试修复效果

手动测试页面补充用例：

1. 普通绝对 URL 图片。
2. 相对路径图片。
3. 带 `srcset` 的图片。
4. URL 含编码字符或查询参数的图片。

测试步骤：

1. 对每类图片右键选择“扫描此图片中的二维码”。
2. 预期识别成功后 overlay 出现在被右键点击的图片上。
3. 如果图片无法定位但能解码，预期显示浮动结果，并不抛异常。
4. 运行 `node tests/node-unit-test.js`，确认基础测试不回退。

## P2-1：Options 页面仍是空壳

### 具体问题

`src/options/options.js` 只有 TODO，`src/options/options.html` 也只是静态说明。当前没有真实用户偏好设置，也没有持久化逻辑。

这不是核心扫描链路的直接阻塞，但会影响后续功能治理，尤其是自动扫描、历史记录保留数量、默认打开行为等配置。

相关位置：

- `src/options/options.html`
- `src/options/options.js`

### 修复计划

1. 定义统一配置对象和默认值，例如：
   - `autoScanEnabled`
   - `maxHistoryItems`
   - `openOnlyHttpLinks`
2. 在 options 页面读取 `chrome.storage.local` 或 `chrome.storage.sync`。
3. 保存用户修改，并在保存后显示短状态提示。
4. content script / popup 读取同一份配置，避免设置页与实际行为脱节。
5. 增加“恢复默认设置”按钮。

### 预期效果

- 设置页从占位变成真实可用功能。
- 后续 P0 自动扫描行为可以通过配置统一管理。
- 用户能理解并控制扩展行为。

### 如何测试修复效果

手动测试：

1. 打开 options 页面。
2. 修改每个设置项并保存。
3. 关闭后重新打开 options，预期值保持不变。
4. 恢复默认设置，预期所有字段回到默认值。
5. 在 popup/content script 中验证设置被实际读取。

回归测试：

1. 清空 storage 后加载扩展，预期使用默认配置。
2. storage 中存在旧数据或缺字段时，预期能自动补默认值。
3. 运行 `node tests/node-unit-test.js`。

## P2-2：测试资产不可靠，缺少扩展端到端覆盖

### 具体问题

当前 `tests/node-unit-test.js` 可以验证部分纯函数和 jsQR 基础行为，但不覆盖真实扩展环境。`tests/unit-test.html` 中还存在明显错误断言：mock 图片对象没有 `.top` 属性，却断言 `filtered[0].top === 10`。

另外，popup 点击、background 消息、content script overlay、截图扫描、右键菜单、选区扫描、剪贴板识别都缺少自动化覆盖。

相关位置：

- `tests/node-unit-test.js`
- `tests/unit-test.html`
- `tests/manual-test.html`
- `tests/e2e-spa.html`

### 修复计划

1. 修正 `tests/unit-test.html` 中错误断言，改为检查 `getBoundingClientRect()` 返回值或只检查数组长度与对象身份。
2. 把通用纯函数从 content script 中拆出，便于 Node 测试：
   - URL 安全判断
   - 图片 URL 标准化/匹配
   - 区域截图坐标钳位
   - 配置 merge/defaults
3. 扩展 `tests/node-unit-test.js` 覆盖上述纯函数。
4. 评估引入浏览器自动化测试：
   - 使用 Chromium/Edge 加载 unpacked extension。
   - 打开本地测试页。
   - 触发 popup 或快捷键。
   - 检查 `.qrhunt-overlay` 数量和历史记录。
5. 暂时无法自动化的能力保留手动测试清单，但要保证清单和实际 UI 一致。

### 预期效果

- 现有测试不再给出错误信号。
- 关键逻辑能在 Node 环境快速回归。
- 后续修复 P1/P2/P0 时有更可靠的保护网。

### 如何测试修复效果

单元测试：

1. 运行 `node tests/node-unit-test.js`，预期全部通过。
2. 打开 `tests/unit-test.html`，预期浏览器页面测试全部通过。

手动测试：

1. 打开 `tests/manual-test.html`，逐项验证页面扫描、右键扫描、菜单、清除标记、框选区域。
2. 打开 `tests/e2e-spa.html`，验证动态插入二维码后的行为与当前设置一致。

自动化测试（后续目标）：

1. 启动浏览器加载 unpacked extension。
2. 打开本地测试页。
3. 触发扫描。
4. 断言页面存在预期数量的 `.qrhunt-overlay`。
5. 读取 `chrome.storage.local`，断言历史记录被写入。
