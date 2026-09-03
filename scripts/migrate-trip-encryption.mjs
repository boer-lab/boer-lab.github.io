#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicKeyPayload, decryptLegacyPayload } from './lib/trip-crypto.mjs';

function readHiddenPassword(prompt) {
  if (!process.stdin.isTTY) {
    throw new Error('Run this migration in an interactive terminal.');
  }
  return new Promise((resolvePassword, reject) => {
    let password = '';
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    function finish(error) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolvePassword(password);
    }

    function onData(char) {
      if (char === '\u0003') return finish(new Error('Migration cancelled.'));
      if (char === '\r' || char === '\n') return finish();
      if (char === '\u007f' || char === '\b') {
        password = password.slice(0, -1);
        return;
      }
      password += char;
    }

    process.stdin.on('data', onData);
  });
}

const payloadPath = resolve(process.argv[2] || 'trip/payload.json');
const payload = JSON.parse(await readFile(payloadPath, 'utf8'));

if (payload.v === 2) {
  console.log('Dashboard encryption is already migrated.');
  process.exit(0);
}
if (payload.v !== 1) throw new Error('Unsupported dashboard payload version.');

const password = await readHiddenPassword('Dashboard password (input is hidden): ');
if (!password) throw new Error('Password cannot be empty.');

try {
  const trip = await decryptLegacyPayload(payload, password);
  const migrated = await createPublicKeyPayload(trip, password);
  await writeFile(payloadPath, `${JSON.stringify(migrated)}\n`, { mode: 0o600 });
  console.log('Dashboard encryption migrated successfully.');
} finally {
  // The password and plaintext are never written to disk by this script.
}
