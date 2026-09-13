/* Public offline-state controller. It never reads or stores decrypted trip data. */
(function (root) {
  'use strict';

  const state = {
    supported: 'serviceWorker' in navigator,
    online: navigator.onLine,
    ready: false,
    cachedAt: null,
    lastUpdated: null,
    bundleId: null,
    refreshFailed: false
  };
  const listeners = new Set();
  let registrationPromise = null;

  function snapshot() {
    return Object.freeze({ ...state });
  }

  function publish(patch) {
    Object.assign(state, patch, { online: navigator.onLine });
    const detail = snapshot();
    listeners.forEach(listener => listener(detail));
    root.dispatchEvent(new CustomEvent('trip-offline-status', { detail }));
    render(detail);
    return detail;
  }

  function bilingual(zh, en) {
    return `<span lang="zh">${zh}</span><span aria-hidden="true"> · </span><span lang="en">${en}</span>`;
  }

  function formatDate(value) {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return '';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(parsed));
  }

  function render(current) {
    if (!document.body) return;
    let node = document.getElementById('trip-offline-status');
    if (!node) {
      node = document.createElement('div');
      node.id = 'trip-offline-status';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.style.cssText = 'position:fixed;right:12px;bottom:max(12px,env(safe-area-inset-bottom));z-index:80;max-width:min(92vw,520px);padding:8px 12px;border:1px solid #cbd5e1;border-radius:999px;background:rgba(255,255,255,.96);box-shadow:0 2px 12px rgba(15,23,42,.14);color:#334155;font:600 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center';
      document.body.appendChild(node);
      const existingPadding = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
      document.body.style.paddingBottom = `${Math.max(existingPadding, 60)}px`;
    }
    const parts = [current.online ? bilingual('在线', 'Online') : bilingual('离线', 'Offline')];
    if (current.ready) parts.push(bilingual('可离线使用 ✓', 'Offline ready ✓'));
    if (!current.online || current.refreshFailed) parts.push(bilingual('实时信息可能已过期', 'Live info may be stale'));
    const updated = formatDate(current.lastUpdated);
    if (updated) parts.push(`${bilingual('最后更新', 'Last updated')} ${updated}`);
    node.innerHTML = parts.join('<span aria-hidden="true"> · </span>');
    node.style.borderColor = current.online ? '#cbd5e1' : '#f59e0b';
    node.style.background = current.online ? 'rgba(255,255,255,.96)' : 'rgba(255,251,235,.97)';
  }

  function register() {
    if (!state.supported) return Promise.resolve(null);
    if (!registrationPromise) {
      registrationPromise = navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(error => {
        publish({ ready: false, refreshFailed: true });
        throw error;
      });
    }
    return registrationPromise;
  }

  function request(worker, type, timeoutMs) {
    if (!worker) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => reject(new Error('Offline worker timed out')), timeoutMs || 12000);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        resolve(event.data || null);
      };
      worker.postMessage({ type }, [channel.port2]);
    });
  }

  async function refreshStatus(registration, refresh) {
    const worker = navigator.serviceWorker.controller || registration.active || registration.waiting;
    if (!worker) return snapshot();
    try {
      const result = await request(worker, refresh ? 'REFRESH_OFFLINE_DATA' : 'GET_OFFLINE_STATUS');
      if (result && result.type === 'OFFLINE_STATUS') publish({ ...result, refreshFailed: Boolean(result.refreshFailed) });
    } catch (_) {
      publish({ refreshFailed: true });
    }
    return snapshot();
  }

  async function prepareData() {
    const registration = await register();
    if (!registration) return snapshot();
    const controlled = Boolean(navigator.serviceWorker.controller || registration.active || registration.waiting);
    if (controlled) return refreshStatus(registration, navigator.onLine);
    return snapshot();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    return function unsubscribe() { listeners.delete(listener); };
  }

  function beginDataSession() {
    const bundleId = state.ready ? state.bundleId : null;
    return function fetchTripData(input, init) {
      if (!bundleId) return fetch(input, init);
      const request = new Request(input, init);
      const headers = new Headers(request.headers);
      headers.set('X-Trip-Offline-Bundle', bundleId);
      return fetch(new Request(request, { headers }));
    };
  }

  root.TripOffline = { prepareData, beginDataSession, getStatus: snapshot, subscribe };

  root.addEventListener('online', async () => {
    publish({ online: true, refreshFailed: false });
    const registration = await register().catch(() => null);
    if (registration) await refreshStatus(registration, true);
  });
  root.addEventListener('offline', () => publish({ online: false }));

  function start() {
    render(snapshot());
    register().then(registration => {
      if (!registration) return;
      refreshStatus(registration, false);
      const worker = registration.installing;
      if (worker) worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') refreshStatus(registration, false);
      });
    }).catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})(window);
