// Background Service Worker
// 负责调度扫描任务、跨页面通信、上下文菜单和历史记录管理

chrome.runtime.onInstalled.addListener(() => {
  console.log('[QR Hunt] Extension installed');

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

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'scan-qr-image') {
    const imageUrl = info.srcUrl;
    console.log('[QR Hunt] Context menu scan:', imageUrl);
    // TODO: 发送消息给 Content Script 对指定图片进行解码
  }
});

// 触发扫描的核心逻辑
async function triggerScan(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/lib/jsQR.js']
    });

    await chrome.tabs.sendMessage(tabId, { action: 'START_SCAN' });
  } catch (err) {
    console.error('[QR Hunt] Scan failed:', err);
  }
}
