#!/usr/bin/env node

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicKeyPayload, decryptLegacyPayload } from './lib/trip-crypto.mjs';

const payloadPath = resolve(process.argv[2] || 'trip/payload.json');
const token = randomBytes(24).toString('hex');

function page(message = '',) {
  const alert = message
    ? `<div class="alert" role="alert">${message}</div>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Trip Dashboard Encryption Upgrade</title>
  <style>
    *{box-sizing:border-box} body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0f172a;color:#0f172a;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(440px,100%);background:white;border-radius:18px;padding:30px;box-shadow:0 24px 70px #02061799} h1{margin:0 0 8px;font-size:24px} p{color:#475569;margin:0 0 20px}.badge{display:inline-block;margin-bottom:16px;padding:5px 9px;border-radius:999px;background:#e0f2fe;color:#0369a1;font-size:13px;font-weight:700}
    label{display:block;margin-bottom:7px;font-weight:650} input,button{width:100%;border-radius:10px;padding:12px 14px;font:inherit} input{border:1px solid #94a3b8} input:focus{outline:3px solid #bae6fd;border-color:#0284c7} button{margin-top:12px;border:0;background:#0f172a;color:white;font-weight:700;cursor:pointer}.note{margin-top:18px;font-size:13px;color:#64748b}.alert{margin-bottom:18px;padding:12px;border-radius:10px;background:#fef2f2;color:#991b1b}
  </style>
</head>
<body><main>
  <div class="badge">Runs only on this Mac</div>
  <h1>Trip Dashboard Encryption Upgrade</h1>
  <p>Enter the same password you normally use to unlock the trip dashboard.</p>
  ${alert}
  <form method="post" action="/migrate?token=${token}" autocomplete="off">
    <label for="password">Dashboard password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Upgrade encryption</button>
  </form>
  <div class="note">Your password is sent only to a temporary server on this computer. It is not logged, uploaded, or saved.</div>
</main></body></html>`;
}

function successPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Upgrade complete</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:440px;margin:24px;background:white;border-radius:18px;padding:32px;text-align:center}h1{color:#166534}p{color:#475569}</style></head><body><main><h1>✓ Encryption upgrade complete</h1><p>You can close this page and return to ChatGPT. Your dashboard password has not changed.</p></main></body></html>`;
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.searchParams.get('token') !== token) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return response.end('This migration link is invalid or expired.');
  }
  if (request.method === 'GET' && url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return response.end(page());
  }
  if (request.method !== 'POST' || url.pathname !== '/migrate') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return response.end('Not found');
  }

  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) {
      response.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end('Request too large');
    }
  }
  const password = new URLSearchParams(body).get('password') || '';
  try {
    const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
    if (payload.v === 2) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(successPage());
      return setTimeout(() => server.close(), 500);
    }
    const trip = await decryptLegacyPayload(payload, password);
    const migrated = await createPublicKeyPayload(trip, password);
    await writeFile(payloadPath, `${JSON.stringify(migrated)}\n`, { mode: 0o600 });
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(successPage());
    setTimeout(() => server.close(), 500);
  } catch {
    response.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(page('That password did not unlock the current dashboard. Please try again.'));
  }
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  console.log(`MIGRATION_URL=http://127.0.0.1:${address.port}/?token=${token}`);
});
