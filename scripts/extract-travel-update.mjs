#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/extract-travel-update.mjs /private/path/email.json');
  process.exit(1);
}

const email = JSON.parse(await readFile(inputPath, 'utf8'));
const sender = String(email.from || '').trim().toLowerCase();
const subject = String(email.subject || '').trim();
const text = String(email.text || '').replace(/\r/g, '').trim();

if (!sender || !subject || !text) {
  throw new Error('Email input requires from, subject, and text fields.');
}

const trustedDomains = new Set([
  'delta.com',
  'airbnb.com',
  'united.com',
  'aa.com',
  'alaskaair.com',
  'southwest.com',
  'booking.com',
  'hotels.com',
  'marriott.com',
  'hilton.com'
]);

const addressMatch = sender.match(/<([^>]+)>/) || sender.match(/([^\s]+@[^\s]+)/);
const address = (addressMatch?.[1] || sender).replace(/[<>]/g, '');
const domain = address.split('@').pop();
const trustedSender = trustedDomains.has(domain);

const combined = `${subject}\n${text}`;
const flightMatches = [...combined.matchAll(/\b([A-Z]{2})\s?(\d{1,4})\b/g)]
  .map((match) => `${match[1]}${match[2]}`);
const dateMatches = [...combined.matchAll(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s+\d{4})?\b/gi)]
  .map((match) => match[0]);
const timeMatches = [...combined.matchAll(/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/gi)]
  .map((match) => match[0].toUpperCase());

const changeWords = /\b(changed?|updated?|cancel(?:led|ed|lation)?|delayed?|rebooked?|new (?:time|date)|check-in|checkout|itinerary)\b/i;
const kind = /airbnb|hotel|lodging|check-in|checkout/i.test(combined)
  ? 'lodging'
  : flightMatches.length
    ? 'flight'
    : 'other';

const candidate = {
  schemaVersion: 1,
  receivedAt: email.receivedAt || null,
  source: {
    address,
    domain,
    trusted: trustedSender
  },
  kind,
  changeLikely: changeWords.test(combined),
  identifiers: {
    flights: [...new Set(flightMatches)]
  },
  observed: {
    dates: [...new Set(dateMatches)],
    times: [...new Set(timeMatches)]
  },
  reviewRequired: true,
  recommendation: trustedSender
    ? 'Compare with the current trip record before encrypting and publishing.'
    : 'Reject or manually verify: sender domain is not on the trusted travel-provider list.'
};

process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
