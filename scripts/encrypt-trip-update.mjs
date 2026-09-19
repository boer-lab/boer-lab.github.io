#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encryptPublicKeyDocument } from './lib/trip-crypto.mjs';

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error('Usage: node scripts/encrypt-trip-update.mjs <update.json|-> <encrypted-update.json>');
  process.exit(1);
}

// stdin allows private updates to stay in memory instead of a plaintext file.
let source;
if (inputArg === '-') {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  source = Buffer.concat(chunks).toString('utf8');
} else {
  source = await readFile(resolve(inputArg), 'utf8');
}
let update;
try { update = JSON.parse(source); }
catch { throw new Error('Update input is not valid JSON.'); }
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
  if (operation.itemMerges !== undefined) {
    if (operation.op !== 'merge' || operation.collection !== 'phases' ||
        !Array.isArray(operation.itemMerges) || !operation.itemMerges.length) {
      throw new Error('Nested item merges require a nonempty phases merge operation.');
    }
    const allowedFields = new Set(['date', 'time', 'desc', 'status', 'warn', 'check_in', 'check_out']);
    for (const edit of operation.itemMerges) {
      const matchKeys = Object.keys(edit?.match || {});
      const setKeys = Object.keys(edit?.set || {});
      const hasStableSelector = matchKeys.includes('type') &&
        matchKeys.some((key) => ['titleContains', 'date', 'check_in', 'check_out'].includes(key));
      if (matchKeys.length < 2 || !hasStableSelector || !setKeys.length ||
          setKeys.some((key) => !allowedFields.has(key))) {
        throw new Error('Each nested item merge needs a stable selector and allowlisted fields.');
      }
    }
  }
}

const payload = JSON.parse(await readFile(resolve('trip/payload.json'), 'utf8'));
const encrypted = await encryptPublicKeyDocument(update, payload);
await writeFile(resolve(outputArg), `${JSON.stringify(encrypted)}\n`, { mode: 0o600 });
console.log(`Encrypted dashboard update written to ${resolve(outputArg)}`);
