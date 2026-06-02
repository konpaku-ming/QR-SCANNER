// Popup 逻辑
// 纯 UI 层：按钮触发、历史记录、剪贴板扫描

document.addEventListener('DOMContentLoaded', async () => {
  const btnScan = document.getElementById('btn-scan');
  const btnRegion = document.getElementById('btn-region');
  const btnClear = document.getElementById('btn-clear');
  const btnClearHistory = document.getElementById('btn-clear-history');
  const statusEl = document.getElementById('status');
  const historyList = document.getElementById('history-list');

  // 初始化加载历史记录
  await loadHistory();

  btnScan.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'TRIGGER_SCAN' });
      setStatus('扫描已启动...');
    } catch (err) {
      setStatus('扫描失败: ' + err.message);
    }
  });

  btnRegion.addEventListener('click', async () => {
    try {
      const items = await navigator.clipboard.read();
      let imageBlob = null;

      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            imageBlob = await item.getType(type);
            break;
          }
        }
        if (imageBlob) break;
      }

      if (!imageBlob) {
        setStatus('剪贴板中没有图片，请先按 Win+Shift+S 截图');
        return;
      }

      setStatus('正在识别...');

      const dataUrl = await blobToDataUrl(imageBlob);
      const results = await decodeImageDataUrl(dataUrl);

      if (results && results.length > 0) {
        setStatus(`识别成功，共 ${results.length} 个二维码`);
        for (const qr of results) {
          await saveHistoryItem(qr);
        }
        await loadHistory();
      } else {
        setStatus('未能识别出二维码，请尝试截取单个、清晰的二维码');
      }
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setStatus('没有剪贴板读取权限');
      } else {
        setStatus('识别失败: ' + err.message);
      }
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

  // 将 Blob 转为 Data URL
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // 对 Data URL 图片进行二维码解码（复用 qr-decoder.js）
  async function decodeImageDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const results = decodeImage(img);
          // qr-decoder.js 返回 {data, location}[]，popup 剪贴板只需要 data
          resolve(results.length > 0 ? results.map((r) => r.data) : null);
        } catch (err) {
          console.error('[QR SCANNER] Decode error:', err);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  // 保存扫描历史（Popup 上下文直接使用 storage）
  async function saveHistoryItem(qrData) {
    try {
      const MAX_HISTORY = 50;
      const result = await chrome.storage.local.get(['qr_scanner_history']);
      let history = result.qr_scanner_history || [];

      history = history.filter((item) => item.data !== qrData);

      const newItem = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        data: qrData,
        url: '剪贴板截图',
        title: '',
        timestamp: Date.now()
      };
      history.unshift(newItem);

      if (history.length > MAX_HISTORY) {
        history = history.slice(0, MAX_HISTORY);
      }

      await chrome.storage.local.set({ qr_scanner_history: history });
    } catch (err) {
      console.error('[QR SCANNER] Save history failed:', err);
    }
  }
});
