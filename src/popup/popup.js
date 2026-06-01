// Popup 逻辑
// 提供快捷扫描、清除功能与最近识别记录

document.addEventListener('DOMContentLoaded', async () => {
  const btnScan = document.getElementById('btn-scan');
  const btnClear = document.getElementById('btn-clear');
  const btnClearHistory = document.getElementById('btn-clear-history');
  const statusEl = document.getElementById('status');
  const historyList = document.getElementById('history-list');

  // 初始化加载历史记录
  await loadHistory();

  btnScan.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
      // 1. 截取当前可见视口（解决 CORS 跨域限制）
      const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'png'
      });

      // 2. 注入 jsQR 库
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/lib/jsQR.js']
      });

      // 3. 发送截图扫描指令
      await chrome.tabs.sendMessage(tab.id, {
        action: 'START_SCAN_SCREENSHOT',
        screenshotUrl
      });
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

  btnClearHistory.addEventListener('click', async () => {
    if (!confirm('确定清空所有历史记录吗？')) return;
    try {
      await chrome.storage.local.remove('qr_scanner_history');
      renderHistory([]);
      setStatus('历史记录已清空');
    } catch (err) {
      setStatus('清空失败');
    }
  });

  async function loadHistory() {
    try {
      const result = await chrome.storage.local.get(['qr_scanner_history']);
      renderHistory(result.qr_scanner_history || []);
    } catch (err) {
      console.error('[QR SCANNER] Load history failed:', err);
      historyList.innerHTML = '<div class="history-empty">加载失败</div>';
    }
  }

  function renderHistory(history) {
    historyList.innerHTML = '';
    if (history.length === 0) {
      historyList.innerHTML = '<div class="history-empty">暂无记录</div>';
      return;
    }

    // 只展示最近 5 条
    history.slice(0, 5).forEach((item) => {
      const el = document.createElement('div');
      el.className = 'history-item';

      const content = document.createElement('div');
      content.className = 'history-content';
      content.textContent = item.data;
      content.title = item.data;

      const meta = document.createElement('div');
      meta.className = 'history-meta';

      const time = document.createElement('span');
      time.className = 'history-time';
      time.textContent = formatTime(item.timestamp);

      const actions = document.createElement('div');
      actions.className = 'history-actions';

      const btnOpen = document.createElement('button');
      btnOpen.className = 'btn-text';
      btnOpen.textContent = '打开';
      btnOpen.addEventListener('click', () => {
        window.open(item.data, '_blank');
      });

      const btnCopy = document.createElement('button');
      btnCopy.className = 'btn-text';
      btnCopy.textContent = '复制';
      btnCopy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.data);
          setStatus('已复制');
        } catch (err) {
          setStatus('复制失败');
        }
      });

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn-text';
      btnDelete.textContent = '删除';
      btnDelete.addEventListener('click', async () => {
        await deleteHistoryItem(item.id);
        await loadHistory();
      });

      actions.appendChild(btnOpen);
      actions.appendChild(btnCopy);
      actions.appendChild(btnDelete);

      meta.appendChild(time);
      meta.appendChild(actions);

      el.appendChild(content);
      el.appendChild(meta);
      historyList.appendChild(el);
    });
  }

  async function deleteHistoryItem(id) {
    try {
      const result = await chrome.storage.local.get(['qr_scanner_history']);
      let history = result.qr_scanner_history || [];
      history = history.filter((item) => item.id !== id);
      await chrome.storage.local.set({ qr_scanner_history: history });
    } catch (err) {
      console.error('[QR SCANNER] Delete history item failed:', err);
    }
  }

  function formatTime(timestamp) {
    const d = new Date(timestamp);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function setStatus(text) {
    statusEl.textContent = text;
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  }
});
