#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encryptPublicKeyPayload } from './lib/trip-crypto.mjs';

const [, , inputArg, outputArg = 'trip/payload.json'] = process.argv;

if (!inputArg) {
  console.error('Usage: node scripts/encrypt-trip.mjs <trip.json> [trip/payload.json]');
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);
const plaintext = await readFile(inputPath, 'utf8');
const existingPayload = JSON.parse(await readFile(outputPath, 'utf8'));

// Refuse to encrypt malformed input so an automated update cannot publish a broken dashboard.
const trip = JSON.parse(plaintext);
if (!trip || typeof trip !== 'object' || !trip.zh || !trip.en) {
  throw new Error('Trip data must contain both "zh" and "en" sections.');
}

const payload = await encryptPublicKeyPayload(trip, existingPayload);

await writeFile(outputPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
console.log(`Public-key encrypted dashboard data written to ${outputPath}`);
