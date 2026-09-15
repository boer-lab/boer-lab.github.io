/* Trip dashboard offline worker.
 *
 * Cache contents are limited to the public app shell, public sync metadata, and
 * encrypted trip envelopes. Decrypted itinerary data never reaches this worker.
 */
'use strict';

const CACHE_NAMESPACE = 'trip-offline';
const SHELL_VERSION = '2026-09-15-1';
const SHELL_PREFIX = `${CACHE_NAMESPACE}-shell-${SHELL_VERSION}-`;
const DATA_PREFIX = `${CACHE_NAMESPACE}-data-v1-`;
const COMPLETE_MARKER = new URL('./__offline_complete__', self.registration.scope).href;

const SHELL_PATHS = [
  './',
  './index.html',
  './offline.js',
  './weather.js',
  './manifest.webmanifest',
  './icons/trip-icon.svg',
  './vendor/react-18.3.1.production.min.js',
  './vendor/react-dom-18.3.1.production.min.js',
  './vendor/babel-7.23.9.min.js',
  './vendor/tailwindcss-3.4.17.js'
];

const DATA_PATHS = ['./payload.json', './sync.json', './updates.json'];
let shellCacheName = null;
let dataCacheName = null;
let refreshPromise = null;

function scopedUrl(path) {
  return new URL(path, self.registration.scope).href;
}

function cacheName(prefix) {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function fetchRequired(url) {
  const response = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
  if (!response.ok || response.type === 'opaque') {
    throw new Error(`Required offline resource failed: ${new URL(url).pathname} (${response.status})`);
  }
  return response;
}

async function putRequired(cache, paths) {
  const urls = paths.map(scopedUrl);
  const responses = await Promise.all(urls.map(fetchRequired));
  await Promise.all(responses.map((response, index) => cache.put(urls[index], response)));
  return urls;
}

async function writeMarker(cache, metadata) {
  await cache.put(COMPLETE_MARKER, new Response(JSON.stringify(metadata), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  }));
}

async function fingerprint(responses) {
  const parts = await Promise.all(responses.map(async response => new Uint8Array(await response.clone().arrayBuffer())));
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  parts.forEach(part => {
    bytes.set(part, offset);
    offset += part.byteLength;
  });
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function markerFor(name) {
  if (!name) return null;
  const cache = await caches.open(name);
  const marker = await cache.match(COMPLETE_MARKER);
  if (!marker) return null;
  try {
    const metadata = await marker.json();
    if (!metadata || !Array.isArray(metadata.urls)) return null;
    const entries = await Promise.all(metadata.urls.map(url => cache.match(url)));
    return entries.every(Boolean) ? metadata : null;
  } catch (_) {
    return null;
  }
}

async function newestComplete(prefix) {
  const names = (await caches.keys()).filter(name => name.startsWith(prefix)).sort().reverse();
  for (const name of names) {
    if (await markerFor(name)) return name;
  }
  return null;
}

async function loadState() {
  const [shell, data] = await Promise.all([
    newestComplete(SHELL_PREFIX),
    newestComplete(DATA_PREFIX)
  ]);
  shellCacheName = shell;
  dataCacheName = data;
}

async function buildShellBundle() {
  const name = cacheName(SHELL_PREFIX);
  try {
    const cache = await caches.open(name);
    const urls = await putRequired(cache, SHELL_PATHS);
    await writeMarker(cache, { kind: 'shell', version: SHELL_VERSION, cachedAt: new Date().toISOString(), urls });
    return name;
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}

function validUpdateFilename(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]+\.json$/.test(value);
}

async function buildDataBundle() {
  const name = cacheName(DATA_PREFIX);
  try {
    const cache = await caches.open(name);
    const baseUrls = DATA_PATHS.map(scopedUrl);
    const baseResponses = await Promise.all(baseUrls.map(fetchRequired));
    const payload = await baseResponses[0].clone().json();
    const sync = await baseResponses[1].clone().json();
    const manifest = await baseResponses[2].clone().json();
    if (!payload || (payload.v !== 1 && payload.v !== 2)) throw new Error('Invalid encrypted payload envelope');
    if (!manifest || !Array.isArray(manifest.updates) || !manifest.updates.every(validUpdateFilename)) {
      throw new Error('Invalid encrypted update manifest');
    }

    const updateUrls = manifest.updates.map(filename => scopedUrl(`./updates/${filename}`));
    const updateResponses = await Promise.all(updateUrls.map(fetchRequired));
    await Promise.all(updateResponses.map(async response => {
      const envelope = await response.clone().json();
      if (!envelope || envelope.v !== 2 || envelope.cipher !== 'AES-GCM' ||
          envelope.keyWrap !== 'RSA-OAEP-SHA256' || !envelope.wrappedKey || !envelope.iv || !envelope.data) {
        throw new Error('Invalid encrypted update envelope');
      }
    }));

    const urls = baseUrls.concat(updateUrls);
    const contentFingerprint = await fingerprint(baseResponses.concat(updateResponses));
    const existingName = dataCacheName || await newestComplete(DATA_PREFIX);
    const existing = await markerFor(existingName);
    if (existing && existing.fingerprint === contentFingerprint) {
      await caches.delete(name);
      return existingName;
    }
    await Promise.all(baseResponses.map((response, index) => cache.put(baseUrls[index], response)));
    await Promise.all(updateResponses.map((response, index) => cache.put(updateUrls[index], response)));
    const metadata = {
      kind: 'encrypted-data',
      cachedAt: new Date().toISOString(),
      lastUpdated: typeof sync.lastSynced === 'string' ? sync.lastSynced : null,
      fingerprint: contentFingerprint,
      urls
    };
    await writeMarker(cache, metadata);
    return name;
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}

async function deleteSupersededBundles() {
  const names = await caches.keys();
  await Promise.all(names.map(async name => {
    if (!name.startsWith(`${CACHE_NAMESPACE}-`)) return false;
    if (name.startsWith(SHELL_PREFIX)) return name === shellCacheName ? false : caches.delete(name);
    if (name.startsWith(DATA_PREFIX)) {
      // Completed encrypted revisions remain available to tabs that pinned them
      // during initialization. Identical refreshes are deduplicated by hash.
      return await markerFor(name) ? false : caches.delete(name);
    }
    return caches.delete(name);
  }));
}

async function refreshDataBundle() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const next = await buildDataBundle();
    dataCacheName = next;
    await deleteSupersededBundles();
    return getOfflineStatus();
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function getOfflineStatus() {
  if (!shellCacheName || !dataCacheName) await loadState();
  const [shell, data] = await Promise.all([
    markerFor(shellCacheName),
    markerFor(dataCacheName)
  ]);
  const ready = Boolean(shell && data);
  return {
    type: 'OFFLINE_STATUS',
    ready,
    cachedAt: ready ? data.cachedAt : null,
    lastUpdated: ready ? data.lastUpdated : null,
    shellVersion: ready ? shell.version : null,
    bundleId: ready ? dataCacheName : null,
    refreshFailed: false
  };
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await loadState();
    const priorShell = shellCacheName;
    const priorData = dataCacheName;
    let nextShell = null;
    let nextData = null;
    try {
      nextShell = await buildShellBundle();
      nextData = await buildDataBundle();
      shellCacheName = nextShell;
      dataCacheName = nextData;
      self.skipWaiting();
    } catch (error) {
      if (nextShell && nextShell !== priorShell) await caches.delete(nextShell);
      if (nextData && nextData !== priorData) await caches.delete(nextData);
      shellCacheName = priorShell;
      dataCacheName = priorData;
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await loadState();
    await deleteSupersededBundles();
    await self.clients.claim();
  })());
});

function isShellRequest(url, request) {
  if (request.mode === 'navigate') {
    return url.origin === self.location.origin &&
      (url.pathname === new URL('./', self.registration.scope).pathname ||
       url.pathname === new URL('./index.html', self.registration.scope).pathname);
  }
  return SHELL_PATHS.map(scopedUrl).includes(url.href);
}

function isEncryptedDataRequest(url) {
  if (url.origin !== self.location.origin) return false;
  if (DATA_PATHS.map(scopedUrl).includes(url.href)) return true;
  const updatesPath = new URL('./updates/', self.registration.scope).pathname;
  if (!url.pathname.startsWith(updatesPath)) return false;
  const filename = url.pathname.slice(updatesPath.length);
  return validUpdateFilename(filename) && !url.search && !url.hash;
}

async function shellResponse(request, url) {
  let networkResponse = null;
  let networkError = null;
  try {
    networkResponse = await fetch(request);
    if (networkResponse.ok) return networkResponse;
  } catch (error) {
    networkError = error;
  }
  if (!shellCacheName) await loadState();
  const cache = shellCacheName && await caches.open(shellCacheName);
  if (cache) {
    const key = request.mode === 'navigate' ? scopedUrl('./index.html') : url.href;
    const cached = await cache.match(key) || (request.mode === 'navigate' && await cache.match(scopedUrl('./')));
    if (cached) return cached;
  }
  if (networkResponse) return networkResponse;
  throw networkError;
}

async function encryptedDataResponse(request, url) {
  if (!dataCacheName) await loadState();
  const requestedBundle = request.headers.get('X-Trip-Offline-Bundle');
  let bundle = dataCacheName;
  if (requestedBundle) {
    const validPin = requestedBundle.startsWith(DATA_PREFIX) && await markerFor(requestedBundle);
    if (!validPin) return new Response('Pinned encrypted bundle unavailable', { status: 503 });
    bundle = requestedBundle;
  }
  if (bundle) {
    const cache = await caches.open(bundle);
    const cached = await cache.match(url.href);
    if (cached) return cached;
    if (requestedBundle) return new Response('Pinned encrypted resource unavailable', { status: 503 });
  }
  return fetch(request);
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (isEncryptedDataRequest(url)) {
    event.respondWith(encryptedDataResponse(event.request, url));
  } else if (isShellRequest(url, event.request)) {
    event.respondWith(shellResponse(event.request, url));
  }
});

self.addEventListener('message', event => {
  const message = event.data || {};
  if (message.type !== 'GET_OFFLINE_STATUS' && message.type !== 'REFRESH_OFFLINE_DATA') return;
  const reply = async () => {
    if (message.type === 'REFRESH_OFFLINE_DATA') await refreshDataBundle();
    return getOfflineStatus();
  };
  event.waitUntil(reply().then(
    status => event.ports[0] && event.ports[0].postMessage(status),
    error => getOfflineStatus().then(status => {
      if (event.ports[0]) event.ports[0].postMessage({
        ...status,
        refreshFailed: true,
        error: error && error.message ? error.message : 'Offline refresh failed'
      });
    })
  ));
});
