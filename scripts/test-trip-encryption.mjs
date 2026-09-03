#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  createPublicKeyPayload,
  decryptPublicKeyDocument,
  decryptPublicKeyPayload,
  encryptPublicKeyDocument,
  encryptPublicKeyPayload,
  unlockPayloadPrivateKey
} from './lib/trip-crypto.mjs';

const password = 'test-password-only';
const original = { zh: { title: '测试' }, en: { title: 'Test' } };
const first = await createPublicKeyPayload(original, password);

assert.equal(first.v, 2);
assert.equal(first.keyWrap, 'RSA-OAEP-SHA256');
assert.deepEqual(await decryptPublicKeyPayload(first, password), original);

const updated = { zh: { title: '已更新' }, en: { title: 'Updated' } };
const second = await encryptPublicKeyPayload(updated, first);
assert.deepEqual(await decryptPublicKeyPayload(second, password), updated);
assert.equal(second.publicKey, first.publicKey);
assert.deepEqual(second.privateKey, first.privateKey);
assert.notEqual(second.wrappedKey, first.wrappedKey);

await assert.rejects(() => decryptPublicKeyPayload(second, 'wrong-password'));

const update = {
  schemaVersion: 1,
  operations: [{ op: 'merge', locale: 'en', collection: 'itinerary', match: { segmentFlight: 'DL280' }, set: { status: 'Updated' } }]
};
const encryptedUpdate = await encryptPublicKeyDocument(update, second);
const privateKey = await unlockPayloadPrivateKey(second, password);
assert.deepEqual(await decryptPublicKeyDocument(encryptedUpdate, privateKey), update);
console.log('Public-key trip encryption checks passed.');
