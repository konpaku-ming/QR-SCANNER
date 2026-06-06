// Options 页面逻辑
// 负责用户偏好设置的持久化

(function init() {
  const maxHistoryItems = document.getElementById('max-history-items');
  const openOnlyHttpLinks = document.getElementById('open-only-http-links');
  const btnSave = document.getElementById('btn-save');
  const btnReset = document.getElementById('btn-reset');
  const statusEl = document.getElementById('status');

  document.addEventListener('DOMContentLoaded', loadSettings);
  btnSave.addEventListener('click', saveSettings);
  btnReset.addEventListener('click', resetSettings);

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get([QR_UTILS.SETTINGS_KEY]);
      applySettings(QR_UTILS.mergeSettings(result[QR_UTILS.SETTINGS_KEY]));
    } catch (err) {
      applySettings(QR_UTILS.mergeSettings());
      showStatus('设置加载失败，已使用默认值');
    }
  }

  async function saveSettings() {
    const settings = readSettingsFromForm();
    try {
      await chrome.storage.local.set({ [QR_UTILS.SETTINGS_KEY]: settings });
      applySettings(settings);
      showStatus('设置已保存');
    } catch (err) {
      showStatus('保存失败');
    }
  }

  async function resetSettings() {
    const defaults = QR_UTILS.mergeSettings();
    try {
      await chrome.storage.local.set({ [QR_UTILS.SETTINGS_KEY]: defaults });
      applySettings(defaults);
      showStatus('已恢复默认设置');
    } catch (err) {
      showStatus('恢复默认失败');
    }
  }

  function readSettingsFromForm() {
    return QR_UTILS.mergeSettings({
      maxHistoryItems: maxHistoryItems.value,
      openOnlyHttpLinks: openOnlyHttpLinks.checked
    });
  }

  function applySettings(settings) {
    maxHistoryItems.value = String(settings.maxHistoryItems);
    openOnlyHttpLinks.checked = settings.openOnlyHttpLinks;
  }

  function showStatus(message) {
    statusEl.textContent = message;
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  }
})();
