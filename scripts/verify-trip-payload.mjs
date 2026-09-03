#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const payloadPath = resolve(process.argv[2] || 'trip/payload.json');
const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
if (payload.v === 1) {
  for (const key of ['kdf', 'iter', 'cipher', 'salt', 'iv', 'data']) {
    if (!(key in payload)) throw new Error(`Missing encrypted payload field: ${key}`);
  }
  if (payload.kdf !== 'PBKDF2-SHA256' || payload.cipher !== 'AES-GCM') {
    throw new Error('Unsupported legacy encrypted payload format.');
  }
  if (!Number.isInteger(payload.iter) || payload.iter < 250000) {
    throw new Error('PBKDF2 iteration count is below the dashboard minimum.');
  }
  for (const key of ['salt', 'iv', 'data']) Buffer.from(payload[key], 'base64');
} else if (payload.v === 2) {
  for (const key of ['cipher', 'keyWrap', 'publicKey', 'privateKey', 'wrappedKey', 'iv', 'data']) {
    if (!(key in payload)) throw new Error(`Missing encrypted payload field: ${key}`);
  }
  if (payload.cipher !== 'AES-GCM' || payload.keyWrap !== 'RSA-OAEP-SHA256') {
    throw new Error('Unsupported public-key encrypted payload format.');
  }
  if (!payload.privateKey || payload.privateKey.kdf !== 'PBKDF2-SHA256' ||
      payload.privateKey.cipher !== 'AES-GCM' ||
      !Number.isInteger(payload.privateKey.iter) || payload.privateKey.iter < 250000) {
    throw new Error('Invalid password-protected private key.');
  }
  for (const key of ['publicKey', 'wrappedKey', 'iv', 'data']) Buffer.from(payload[key], 'base64');
  for (const key of ['salt', 'iv', 'data']) Buffer.from(payload.privateKey[key], 'base64');
} else {
  throw new Error('Unsupported encrypted payload version.');
}

console.log(`Encrypted trip payload v${payload.v} is valid (${payload.data.length} base64 characters).`);
