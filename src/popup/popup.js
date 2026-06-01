// Popup 逻辑
// 提供快捷扫描和清除功能

document.addEventListener('DOMContentLoaded', () => {
  const btnScan = document.getElementById('btn-scan');
  const btnClear = document.getElementById('btn-clear');
  const statusEl = document.getElementById('status');

  btnScan.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
      // 先注入 jsQR 库
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/lib/jsQR.js']
      });

      // 发送扫描指令
      await chrome.tabs.sendMessage(tab.id, { action: 'START_SCAN' });
      setStatus('扫描已启动...');
    } catch (err) {
      setStatus('扫描失败: ' + err.message);
    }
  });

  btnClear.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'CLEAR_OVERLAYS' });
      setStatus('标记已清除');
    } catch (err) {
      setStatus('清除失败');
    }
  });

  function setStatus(text) {
    statusEl.textContent = text;
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  }
});
