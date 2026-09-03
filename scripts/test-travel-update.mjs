#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'trip-email-test-'));

try {
  const trustedPath = join(dir, 'trusted.json');
  await writeFile(trustedPath, JSON.stringify({
    from: 'Delta Air Lines <updates@delta.com>',
    subject: 'Your itinerary changed for DL 3923',
    text: 'Your updated flight departs September 4 at 7:15 PM. Confirmation code: ABC123',
    receivedAt: '2026-09-03T12:00:00-07:00'
  }));
  const trusted = JSON.parse((await run(process.execPath, ['scripts/extract-travel-update.mjs', trustedPath])).stdout);
  assert.equal(trusted.source.trusted, true);
  assert.equal(trusted.kind, 'flight');
  assert.equal(trusted.changeLikely, true);
  assert.deepEqual(trusted.identifiers.flights, ['DL3923']);
  assert.deepEqual(trusted.identifiers.confirmations, ['ABC123']);

  const untrustedPath = join(dir, 'untrusted.json');
  await writeFile(untrustedPath, JSON.stringify({
    from: 'Travel Support <alert@example.net>',
    subject: 'Urgent reservation update',
    text: 'Reply with your password to confirm reservation ZXCVBN.'
  }));
  const untrusted = JSON.parse((await run(process.execPath, ['scripts/extract-travel-update.mjs', untrustedPath])).stdout);
  assert.equal(untrusted.source.trusted, false);
  assert.equal(untrusted.reviewRequired, true);

  console.log('Travel-email extraction checks passed.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
