// Background Service Worker
// 负责调度当前页面截图扫描与跨页面通信

importScripts('lib/qr-utils.js');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[QR SCANNER] Extension installed');
});

// 监听插件图标点击
chrome.action.onClicked.addListener(async (tab) => {
  // 如果没有 Popup，点击图标会触发这里
  // 目前配置了 default_popup，所以此事件不会触发
  // 如需后台触发扫描，可取消 popup 或在此处理
});

// 监听快捷键
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'toggle-scan' && tab && tab.id) {
    await triggerScan(tab.id);
  }
});

// 监听来自 Content Script / Popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'UPDATE_BADGE') {
    const details = { text: QR_UTILS.getBadgeText(request.count) };
    if (sender.tab && sender.tab.id) {
      details.tabId = sender.tab.id;
    }
    chrome.action.setBadgeText(details);
    chrome.action.setBadgeBackgroundColor({ color: '#0078d4' });
    return false;
  }

  if (request.action === 'TRIGGER_SCAN') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          sendResponse({ status: 'error', error: 'No active tab' });
          return;
        }
        await triggerScan(tab.id);
        sendResponse({ status: 'scanning' });
      } catch (err) {
        console.error('[QR SCANNER] Trigger scan failed:', err);
        sendResponse({ status: 'error', error: err.message });
      }
    })();
    return true;
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

    // 2. 发送截图与扫描指令
    // 库文件（zxing-wasm, qr-utils, qr-engine）已由 manifest content_scripts 自动加载
    await chrome.tabs.sendMessage(tabId, {
      action: 'START_SCAN_SCREENSHOT',
      screenshotUrl
    });
  } catch (err) {
    console.error('[QR SCANNER] Screenshot scan failed:', err);
  }
}
