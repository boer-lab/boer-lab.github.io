import { webcrypto } from 'node:crypto';

const crypto = webcrypto;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64(value) {
  return Buffer.from(value).toString('base64');
}

export function base64ToBytes(value) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function assertTrip(trip) {
  if (!trip || typeof trip !== 'object' || !trip.zh || !trip.en) {
    throw new Error('Trip data must contain both "zh" and "en" sections.');
  }
}

async function derivePasswordKey(password, salt, iterations) {
  const baseKey = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function decryptLegacyPayload(payload, password) {
  if (payload.v !== 1) throw new Error('Expected a version 1 payload.');
  const key = await derivePasswordKey(password, base64ToBytes(payload.salt), payload.iter);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.data)
  );
  const trip = JSON.parse(decoder.decode(plaintext));
  assertTrip(trip);
  return trip;
}

async function encryptWithPublicKey(trip, publicKey, keyMaterial) {
  assertTrip(trip);
  const dataKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
  const rawDataKey = await crypto.subtle.exportKey('raw', dataKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, dataKey, encoder.encode(JSON.stringify(trip))
  );
  const wrappedKey = await crypto.subtle.encrypt(
    { name: 'RSA-OAEP' }, publicKey, rawDataKey
  );

  return {
    v: 2,
    cipher: 'AES-GCM',
    keyWrap: 'RSA-OAEP-SHA256',
    publicKey: keyMaterial.publicKey,
    privateKey: keyMaterial.privateKey,
    wrappedKey: bytesToBase64(wrappedKey),
    iv: bytesToBase64(iv),
    data: bytesToBase64(data)
  };
}

export async function createPublicKeyPayload(trip, password) {
  assertTrip(trip);
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['encrypt', 'decrypt']
  );
  const publicKeyBytes = await crypto.subtle.exportKey('spki', pair.publicKey);
  const privateKeyBytes = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 250000;
  const passwordKey = await derivePasswordKey(password, salt, iterations);
  const encryptedPrivateKey = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, passwordKey, privateKeyBytes
  );
  const keyMaterial = {
    publicKey: bytesToBase64(publicKeyBytes),
    privateKey: {
      kdf: 'PBKDF2-SHA256',
      iter: iterations,
      cipher: 'AES-GCM',
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      data: bytesToBase64(encryptedPrivateKey)
    }
  };
  return encryptWithPublicKey(trip, pair.publicKey, keyMaterial);
}

export async function encryptPublicKeyPayload(trip, existingPayload) {
  if (existingPayload.v !== 2 || existingPayload.keyWrap !== 'RSA-OAEP-SHA256') {
    throw new Error('Dashboard must be migrated to version 2 before passwordless updates.');
  }
  const publicKey = await crypto.subtle.importKey(
    'spki',
    base64ToBytes(existingPayload.publicKey),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );
  return encryptWithPublicKey(trip, publicKey, {
    publicKey: existingPayload.publicKey,
    privateKey: existingPayload.privateKey
  });
}

export async function decryptPublicKeyPayload(payload, password) {
  if (payload.v !== 2) throw new Error('Expected a version 2 payload.');
  const passwordKey = await derivePasswordKey(
    password,
    base64ToBytes(payload.privateKey.salt),
    payload.privateKey.iter
  );
  const privateKeyBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.privateKey.iv) },
    passwordKey,
    base64ToBytes(payload.privateKey.data)
  );
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['decrypt']
  );
  const rawDataKey = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' }, privateKey, base64ToBytes(payload.wrappedKey)
  );
  const dataKey = await crypto.subtle.importKey(
    'raw', rawDataKey, { name: 'AES-GCM' }, false, ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    dataKey,
    base64ToBytes(payload.data)
  );
  const trip = JSON.parse(decoder.decode(plaintext));
  assertTrip(trip);
  return trip;
}
