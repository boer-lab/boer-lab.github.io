#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const payloadPath = resolve(process.argv[2] || 'trip/payload.json');
const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
const required = ['v', 'kdf', 'iter', 'cipher', 'salt', 'iv', 'data'];

for (const key of required) {
  if (!(key in payload)) throw new Error(`Missing encrypted payload field: ${key}`);
}
if (payload.v !== 1 || payload.kdf !== 'PBKDF2-SHA256' || payload.cipher !== 'AES-GCM') {
  throw new Error('Unsupported encrypted payload format.');
}
if (!Number.isInteger(payload.iter) || payload.iter < 250000) {
  throw new Error('PBKDF2 iteration count is below the dashboard minimum.');
}
for (const key of ['salt', 'iv', 'data']) Buffer.from(payload[key], 'base64');

console.log(`Encrypted trip payload is valid (${payload.data.length} base64 characters).`);
