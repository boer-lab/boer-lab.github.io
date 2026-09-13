import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';

// This test serves synthetic ciphertext-shaped records only. It never reads,
// decrypts, screenshots, or logs the real trip payload.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(new URL('..', import.meta.url).pathname);
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml'
};

let updateAvailable = true;
let updateCompatible = true;
let weatherShellAvailable = true;
let lastSynced = '2030-01-01T12:00:00.000Z';
const payload = {
  v: 2,
  cipher: 'AES-GCM',
  keyWrap: 'RSA-OAEP-SHA256',
  iv: 'c3ludGhldGljLWl2',
  data: 'c3ludGhldGljLWNpcGhlcnRleHQ=',
  wrappedKey: 'c3ludGhldGljLXdyYXBwZWQta2V5',
  privateKey: {
    salt: 'c3ludGhldGljLXNhbHQ=',
    iter: 1,
    iv: 'c3ludGhldGljLWtleS1pdg==',
    data: 'c3ludGhldGljLXByb3RlY3RlZC1rZXk='
  }
};
const update = {
  v: 2,
  cipher: 'AES-GCM',
  keyWrap: 'RSA-OAEP-SHA256',
  wrappedKey: 'c3ludGhldGljLXdyYXBwZWQta2V5',
  iv: 'c3ludGhldGljLWl2',
  data: 'c3ludGhldGljLWNpcGhlcnRleHQ='
};

function json(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/trip/payload.json') return json(response, payload);
    if (pathname === '/trip/sync.json') return json(response, {
      lastSynced,
      timeZone: 'UTC',
      source: 'Synthetic offline test'
    });
    if (pathname === '/trip/updates.json') return json(response, { updates: ['synthetic-update.json'] });
    if (pathname === '/trip/updates/synthetic-update.json') {
      if (!updateAvailable) return json(response, { error: 'Synthetic unavailable' }, 503);
      return json(response, updateCompatible ? update : { ...update, v: 1 });
    }
    if (pathname === '/trip/weather.js' && !weatherShellAvailable) return json(response, { error: 'Synthetic unavailable' }, 503);
    const file = resolve(root, `.${pathname === '/trip/' ? '/trip/index.html' : pathname}`);
    if (!file.startsWith(`${root}/trip/`)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch (_) {
    response.writeHead(404);
    response.end();
  }
});

await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {})
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const external = [];
  page.on('request', request => {
    if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) external.push(request.url());
  });

  await page.goto(`${origin}/trip/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.TripOffline?.getStatus().ready === true, {}, { timeout: 30000 });

  const initial = await page.evaluate(async () => {
    const names = await caches.keys();
    const cachesWithUrls = await Promise.all(names.map(async name => ({
      name,
      urls: (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname).sort()
    })));
    return {
      status: window.TripOffline.getStatus(),
      badge: document.querySelector('#trip-offline-status')?.innerText,
      caches: cachesWithUrls
    };
  });
  assert.equal(initial.status.ready, true);
  assert.ok(initial.status.bundleId);
  assert.match(initial.badge, /Offline ready ✓/);
  assert.match(initial.badge, /Last updated/);

  const allowed = new Set([
    '/trip/',
    '/trip/index.html',
    '/trip/offline.js',
    '/trip/weather.js',
    '/trip/manifest.webmanifest',
    '/trip/icons/trip-icon.svg',
    '/trip/vendor/react-18.3.1.production.min.js',
    '/trip/vendor/react-dom-18.3.1.production.min.js',
    '/trip/vendor/babel-7.23.9.min.js',
    '/trip/vendor/tailwindcss-3.4.17.js',
    '/trip/payload.json',
    '/trip/sync.json',
    '/trip/updates.json',
    '/trip/updates/synthetic-update.json',
    '/trip/__offline_complete__'
  ]);
  const cachedPaths = initial.caches.flatMap(cache => cache.urls);
  assert.ok(cachedPaths.every(pathname => allowed.has(pathname)), `Unexpected cached path: ${cachedPaths.find(pathname => !allowed.has(pathname))}`);
  for (const required of allowed) assert.ok(cachedPaths.includes(required), `Missing cached path: ${required}`);
  assert.equal(initial.caches.filter(cache => cache.name.includes('-shell-')).length, 1);
  assert.equal(initial.caches.filter(cache => cache.name.includes('-data-')).length, 1);
  assert.deepEqual(external, [], 'The locked app shell must not request external runtime assets');

  // Reload once under service-worker control, then prove a network-free app-shell load.
  await page.reload({ waitUntil: 'networkidle' });
  weatherShellAvailable = false;
  const shellFallback = await page.evaluate(() => fetch('./weather.js').then(response => ({
    ok: response.ok,
    body: response.text()
  })).then(async result => ({ ok: result.ok, body: await result.body })));
  assert.equal(shellFallback.ok, true);
  assert.match(shellFallback.body, /TripWeather/);
  weatherShellAvailable = true;
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#gate-btn')?.disabled === false);
  await page.waitForFunction(() => document.querySelector('#trip-offline-status')?.innerText.includes('Offline ready ✓'));
  const offline = await page.evaluate(() => ({
    reactVersion: React.version,
    status: window.TripOffline.getStatus(),
    badge: document.querySelector('#trip-offline-status')?.innerText
  }));
  assert.equal(offline.reactVersion, '18.3.1');
  assert.equal(offline.status.online, false);
  assert.match(offline.badge, /Live info may be stale/);

  // A partial refresh must retain the old complete bundle and advertise staleness.
  updateAvailable = false;
  await context.setOffline(false);
  const retained = await page.evaluate(async () => {
    const before = window.TripOffline.getStatus().bundleId;
    const status = await window.TripOffline.prepareData();
    return { before, status, badge: document.querySelector('#trip-offline-status')?.innerText };
  });
  assert.equal(retained.status.ready, true);
  assert.equal(retained.status.refreshFailed, true);
  assert.equal(retained.status.bundleId, retained.before);
  assert.match(retained.badge, /Live info may be stale/);

  // An HTTP-successful but incompatible overlay envelope is also rejected.
  updateAvailable = true;
  updateCompatible = false;
  const incompatible = await page.evaluate(async () => {
    const before = window.TripOffline.getStatus().bundleId;
    const status = await window.TripOffline.prepareData();
    return { before, status };
  });
  assert.equal(incompatible.status.ready, true);
  assert.equal(incompatible.status.refreshFailed, true);
  assert.equal(incompatible.status.bundleId, incompatible.before);

  // Capture one transaction, publish a new synthetic revision, and prove the
  // captured transaction remains pinned while a new transaction sees new data.
  const oldBundle = await page.evaluate(() => {
    window.__oldTripFetch = window.TripOffline.beginDataSession();
    return window.TripOffline.getStatus().bundleId;
  });
  updateCompatible = true;
  lastSynced = '2030-01-01T13:00:00.000Z';
  const pinned = await page.evaluate(async () => {
    const refreshed = await window.TripOffline.prepareData();
    const newFetch = window.TripOffline.beginDataSession();
    const [oldSync, newSync] = await Promise.all([
      window.__oldTripFetch('./sync.json', { cache: 'no-store' }).then(response => response.json()),
      newFetch('./sync.json', { cache: 'no-store' }).then(response => response.json())
    ]);
    const beforeDuplicate = (await caches.keys()).filter(name => name.includes('-data-')).length;
    const duplicate = await window.TripOffline.prepareData();
    const afterDuplicate = (await caches.keys()).filter(name => name.includes('-data-')).length;
    return {
      refreshed,
      duplicate,
      oldSync,
      newSync,
      beforeDuplicate,
      afterDuplicate,
      badge: document.querySelector('#trip-offline-status')?.innerText
    };
  });
  assert.notEqual(pinned.refreshed.bundleId, oldBundle);
  assert.equal(pinned.oldSync.lastSynced, '2030-01-01T12:00:00.000Z');
  assert.equal(pinned.newSync.lastSynced, '2030-01-01T13:00:00.000Z');
  assert.equal(pinned.refreshed.refreshFailed, false);
  assert.doesNotMatch(pinned.badge, /may be stale/);
  assert.equal(pinned.duplicate.bundleId, pinned.refreshed.bundleId);
  assert.equal(pinned.afterDuplicate, pinned.beforeDuplicate, 'Identical refresh should not create another data cache');

  console.log('Offline gates passed: complete-cache proof, local runtimes, offline reload, live-data exclusion, failed-refresh retention, immutable bundle pinning, and content-hash deduplication.');
  await context.close();
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
