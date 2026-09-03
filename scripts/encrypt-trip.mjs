#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';

const [, , inputArg, outputArg = 'trip/payload.json'] = process.argv;
const password = process.env.TRIP_DASHBOARD_PASSWORD;

if (!inputArg || !password) {
  console.error('Usage: TRIP_DASHBOARD_PASSWORD=... node scripts/encrypt-trip.mjs <trip.json> [trip/payload.json]');
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);
const plaintext = await readFile(inputPath, 'utf8');

// Refuse to encrypt malformed input so an automated update cannot publish a broken dashboard.
const trip = JSON.parse(plaintext);
if (!trip || typeof trip !== 'object' || !trip.zh || !trip.en) {
  throw new Error('Trip data must contain both "zh" and "en" sections.');
}

const salt = webcrypto.getRandomValues(new Uint8Array(16));
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const iterations = 250000;
const encoder = new TextEncoder();
const baseKey = await webcrypto.subtle.importKey(
  'raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']
);
const key = await webcrypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
  baseKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt']
);
const encrypted = await webcrypto.subtle.encrypt(
  { name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(trip))
);

const payload = {
  v: 1,
  kdf: 'PBKDF2-SHA256',
  iter: iterations,
  cipher: 'AES-GCM',
  salt: Buffer.from(salt).toString('base64'),
  iv: Buffer.from(iv).toString('base64'),
  data: Buffer.from(encrypted).toString('base64')
};

await writeFile(outputPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
console.log(`Encrypted dashboard data written to ${outputPath}`);
