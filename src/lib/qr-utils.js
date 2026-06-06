// Shared pure helpers for QR SCANNER.
// Exposes QR_UTILS in extension pages/content scripts and module.exports in Node tests.

(function (root, factory) {
  const utils = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = utils;
  }
  root.QR_UTILS = utils;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SETTINGS_KEY = 'qr_scanner_settings';
  const HISTORY_KEY = 'qr_scanner_history';
  const DEFAULT_SETTINGS = Object.freeze({
    maxHistoryItems: 50,
    openOnlyHttpLinks: true
  });

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function mergeSettings(rawSettings) {
    const raw = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
    return {
      maxHistoryItems: clampNumber(
        raw.maxHistoryItems,
        1,
        200,
        DEFAULT_SETTINGS.maxHistoryItems
      ),
      openOnlyHttpLinks: typeof raw.openOnlyHttpLinks === 'boolean'
        ? raw.openOnlyHttpLinks
        : DEFAULT_SETTINGS.openOnlyHttpLinks
    };
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '…' : str;
  }

  function normalizeUrl(value, baseURI) {
    if (typeof value !== 'string' || value.trim() === '') return null;
    try {
      return new URL(value, baseURI || undefined).href;
    } catch (err) {
      return null;
    }
  }

  function isHttpUrl(value) {
    const normalized = normalizeUrl(value);
    if (!normalized) return false;
    const url = new URL(normalized);
    return url.protocol === 'http:' || url.protocol === 'https:';
  }

  function getOpenableUrl(value, settings) {
    const normalized = normalizeUrl(value);
    if (!normalized) return null;

    const url = new URL(normalized);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }

    const mergedSettings = mergeSettings(settings);
    if (mergedSettings.openOnlyHttpLinks) return null;

    const blockedProtocols = new Set(['javascript:', 'data:', 'vbscript:', 'file:']);
    if (blockedProtocols.has(url.protocol)) return null;

    return url.href;
  }

  function overlayRectFromElementRect(rect, scrollX = 0, scrollY = 0) {
    if (!rect) return null;
    const left = Number(rect.left);
    const top = Number(rect.top);
    const width = Number(rect.width);
    const height = Number(rect.height);
    const sx = Number(scrollX) || 0;
    const sy = Number(scrollY) || 0;

    if (![left, top, width, height].every(Number.isFinite) || width < 0 || height < 0) {
      return null;
    }

    return {
      x: sx + left,
      y: sy + top,
      width,
      height
    };
  }

  function overlayRectFromQrLocation(location, dpr = 1) {
    if (!location) return null;
    const corners = [
      location.topLeftCorner,
      location.topRightCorner,
      location.bottomRightCorner,
      location.bottomLeftCorner
    ];

    if (!corners.every((point) => point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)))) {
      return null;
    }

    const scale = Number.isFinite(Number(dpr)) && Number(dpr) > 0 ? Number(dpr) : 1;
    const xs = corners.map((point) => Number(point.x));
    const ys = corners.map((point) => Number(point.y));
    const minX = Math.min(...xs) / scale;
    const maxX = Math.max(...xs) / scale;
    const minY = Math.min(...ys) / scale;
    const maxY = Math.max(...ys) / scale;

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  function createHistoryItem(qrData, context = {}) {
    return {
      id: context.id || generateHistoryId(context.now),
      data: qrData,
      url: context.url || '',
      title: context.title || '',
      timestamp: Number.isFinite(Number(context.now)) ? Number(context.now) : Date.now()
    };
  }

  function generateHistoryId(now) {
    const time = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    return time.toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function upsertHistoryItem(history, qrData, context = {}, settings) {
    const maxHistoryItems = mergeSettings(settings || context.settings).maxHistoryItems;
    const list = Array.isArray(history) ? history : [];
    const nextHistory = list.filter((item) => item && item.data !== qrData);
    nextHistory.unshift(createHistoryItem(qrData, context));
    return nextHistory.slice(0, maxHistoryItems);
  }

  function deleteHistoryItem(history, id) {
    if (!Array.isArray(history)) return [];
    return history.filter((item) => item && item.id !== id);
  }

  function getRecentHistory(history, limit = 5) {
    if (!Array.isArray(history)) return [];
    const count = clampNumber(limit, 0, 200, 5);
    return history.slice(0, count);
  }

  function formatRelativeTime(timestamp, nowValue) {
    const time = Number(timestamp);
    const now = Number.isFinite(Number(nowValue)) ? Number(nowValue) : Date.now();
    if (!Number.isFinite(time)) return '';

    const diff = now - time;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

    const d = new Date(time);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function getBadgeText(count) {
    const number = Number(count);
    return Number.isFinite(number) && number > 0 ? String(number) : '';
  }

  return {
    SETTINGS_KEY,
    HISTORY_KEY,
    DEFAULT_SETTINGS,
    mergeSettings,
    truncate,
    normalizeUrl,
    isHttpUrl,
    getOpenableUrl,
    overlayRectFromElementRect,
    overlayRectFromQrLocation,
    createHistoryItem,
    upsertHistoryItem,
    deleteHistoryItem,
    getRecentHistory,
    formatRelativeTime,
    getBadgeText
  };
});
