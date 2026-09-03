#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encryptPublicKeyDocument } from './lib/trip-crypto.mjs';

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error('Usage: node scripts/encrypt-trip-update.mjs <update.json> <encrypted-update.json>');
  process.exit(1);
}

const update = JSON.parse(await readFile(resolve(inputArg), 'utf8'));
if (update?.schemaVersion !== 1 || !Array.isArray(update.operations) || !update.operations.length) {
  throw new Error('Update must contain schemaVersion 1 and at least one operation.');
}
for (const operation of update.operations) {
  if (!['merge', 'append'].includes(operation?.op) || !['zh', 'en'].includes(operation?.locale) ||
      typeof operation?.collection !== 'string') {
    throw new Error('Each update operation needs a supported op, locale, and collection.');
  }
  if (operation.op === 'merge' && (!operation.match || !operation.set)) {
    throw new Error('Merge operations need match and set objects.');
  }
  if (operation.op === 'append' && !operation.value) {
    throw new Error('Append operations need a value.');
  }
}

const payload = JSON.parse(await readFile(resolve('trip/payload.json'), 'utf8'));
const encrypted = await encryptPublicKeyDocument(update, payload);
await writeFile(resolve(outputArg), `${JSON.stringify(encrypted)}\n`, { mode: 0o600 });
console.log(`Encrypted dashboard update written to ${resolve(outputArg)}`);
