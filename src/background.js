// Background Service Worker
// 负责调度扫描任务、跨页面通信、上下文菜单和历史记录管理

chrome.runtime.onInstalled.addListener(() => {
  console.log('[QR SCANNER] Extension installed');

  // 创建右键菜单
  chrome.contextMenus.create({
    id: 'scan-qr-image',
    title: '扫描此图片中的二维码',
    contexts: ['image']
  });
});

// 监听插件图标点击
chrome.action.onClicked.addListener(async (tab) => {
  // 如果没有 Popup，点击图标会触发这里
  // 目前配置了 default_popup，所以此事件不会触发
  // 如需后台触发扫描，可取消 popup 或在此处理
});

// 监听快捷键
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'toggle-scan') {
    await triggerScan(tab.id);
  }
});

// 监听来自 Content Script / Popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'FETCH_IMAGE') {
    fetchImageAsDataUrl(request.imageUrl)
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((err) => {
        console.error('[QR SCANNER] Fetch image failed:', err);
        sendResponse({ error: err.message });
      });
    return true; // 保持消息通道开启，等待异步响应
  }

  if (request.action === 'UPDATE_BADGE') {
    chrome.action.setBadgeText({
      text: request.count > 0 ? String(request.count) : '',
      tabId: sender.tab.id
    });
    chrome.action.setBadgeBackgroundColor({ color: '#0078d4' });
  }

  if (request.action === 'TRIGGER_AUTO_SCAN') {
    if (sender.tab && sender.tab.id) {
      triggerAutoScan(sender.tab.id);
    }
  }

  if (request.action === 'CAPTURE_REGION') {
    (async () => {
      try {
        const tab = await chrome.tabs.get(sender.tab.id);
        await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          files: ['src/lib/jsQR.js']
        });
        const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'png'
        });
        sendResponse({ screenshotUrl });
      } catch (err) {
        console.error('[QR SCANNER] Capture region failed:', err);
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }
});

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'scan-qr-image') {
    const imageUrl = info.srcUrl;
    console.log('[QR SCANNER] Context menu scan:', imageUrl);

    try {
      // 注入 jsQR 库
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/lib/jsQR.js']
      });

      // 发送单图扫描指令给 Content Script
      await chrome.tabs.sendMessage(tab.id, {
        action: 'SCAN_SINGLE_IMAGE',
        imageUrl
      });
    } catch (err) {
      console.error('[QR SCANNER] Context menu scan failed:', err);
    }
  }
});

// 触发扫描的核心逻辑（截图扫描方案，解决 CORS 限制）
async function triggerScan(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);

    // 1. 截取当前可见视口
    const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png'
    });

    // 2. 注入 jsQR 库
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/lib/jsQR.js']
    });

    // 3. 发送截图与扫描指令
    await chrome.tabs.sendMessage(tabId, {
      action: 'START_SCAN_SCREENSHOT',
      screenshotUrl
    });
  } catch (err) {
    console.error('[QR SCANNER] Screenshot scan failed:', err);
  }
}

async function fetchImageAsDataUrl(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 触发自动扫描（SPA 动态内容变化后由 Content Script 请求）
async function triggerAutoScan(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);

    const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png'
    });

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/lib/jsQR.js']
    });

    await chrome.tabs.sendMessage(tabId, {
      action: 'START_AUTO_SCAN_SCREENSHOT',
      screenshotUrl
    });
  } catch (err) {
    console.error('[QR SCANNER] Auto scan failed:', err);
  }
}
