# Trip dashboard update workflow

The public dashboard page contains presentation code only. Private itinerary and budget data live in `trip/payload.json` as AES-GCM ciphertext and are decrypted only in the visitor's browser after the password is entered.

Payload version 2 uses envelope encryption. A random AES key encrypts each trip-data revision, and the repository's RSA public key encrypts that AES key. The matching RSA private key is itself encrypted with the dashboard password. This lets a cloud task publish newly encrypted data using only public material; the password and private key never need to leave the visitor's browser.

## Safe update boundary

1. An email intake step extracts airline or lodging changes into a temporary, private JSON file.
2. A review step merges those changes into the bilingual trip record. Airline itinerary messages are authoritative; live flight sources may supplement but do not overwrite them without review.
3. `scripts/encrypt-trip.mjs` encrypts the reviewed record with the public key already in `trip/payload.json`. It does not accept or need the dashboard password.
4. `trip/sync.json` receives the successful update time and a short, non-sensitive source label.
5. Only `trip/payload.json` and `trip/sync.json` are published.

Example encryption command:

```sh
node scripts/encrypt-trip.mjs /private/path/trip.json
node scripts/verify-trip-payload.mjs
```

For cloud updates, prefer a narrowly scoped encrypted overlay instead of rewriting the full payload. Create a private update document with `schemaVersion: 1` and `operations`. Supported operations are `merge` and `append`; each names `zh` or `en` plus a top-level array collection. A merge can match normal item fields, `titleContains`, or `segmentFlight`, and may include both item-level `set` fields and `segmentSet` fields. Encrypt it with:

```bash
node scripts/encrypt-trip-update.mjs /private/path/update.json trip/updates/<unique-name>.json
```

Add only the encrypted filename to `trip/updates.json`. The browser decrypts and applies overlays in manifest order after the user unlocks the base payload. A cloud task therefore needs only the public key and the new source message; it never decrypts the existing itinerary.

Do not add plaintext trip JSON, raw emails, booking confirmations, tokens, passwords, or decrypted private keys to this repository. Use `scripts/migrate-trip-encryption.mjs` once, in an interactive local terminal, to convert a legacy version 1 payload. Its password prompt is hidden, and it does not write plaintext to disk.

## Email intake contract

`scripts/extract-travel-update.mjs` accepts a private JSON file with `from`, `subject`, `text`, and an optional `receivedAt`. It emits a normalized candidate containing sender trust, likely change type, flight numbers, dates, and times. Confirmation and reservation codes are deliberately omitted. Every candidate is marked `reviewRequired`; extraction alone can never publish a dashboard change.

```sh
node scripts/extract-travel-update.mjs /private/path/email.json
node scripts/test-travel-update.mjs
```

The trusted-domain list is deliberately narrow. Add a provider only after verifying the legitimate sender domain from a known booking message.

## Mobile guide and offline updates

The active research section uses the existing `yellowstone.sections` append
format. Its `dailyGuide.days` and `stops` retain their existing fields. Optional
stop presentation fields are `time`, `drive`, `duration`, `navigation`, `parking`, `restroom`,
`food`, `gas`, `awareness` (`green`, `yellow`, `orange`), `priority`, `decision`,
`fallback`, `next`, `reset`, `turnaround`, `whatToView`, `photo`, and `completed`. Optional guide fields are
`finalized`, `safety`, and `navigation`; a day may carry a `badge`. A finalized
guide leads both the guide and timeline tabs; the original timeline is collapsed
and explicitly marked as superseded for sightseeing. Earlier guide sections do
not compete with the finalized guide.

For narrow daily-guide revisions, a normal `merge` operation may also include
`dayMerges`, `stopMerges`, and `stopInserts`. These target an existing guide day
by `date` and a stop by `titleContains` or `navigationContains`, avoiding a full
replacement of the encrypted `dailyGuide`. Use `unlessMatch` on insertions so
replaying an update cannot duplicate a stop.

To avoid writing a plaintext input file, the update encryption command also
accepts `-` for stdin. Pipe an in-memory JSON document into that command; never
print the document or put private values in a saved generator or shell history.
Only the encrypted output belongs in Git.

Offline support lives in `trip/sw.js` and `trip/offline.js`. The worker scope is
`/trip/`. It caches a verified app-shell bundle (including pinned local runtime
assets) and complete encrypted data bundles. The browser captures a bundle ID
for each initialization so a refresh cannot mix base data and overlay revisions.
Weather, alerts, external maps and photos are not in the cache allowlist.
Decrypted data stays in page memory; reload requires the password again. Legacy
plaintext session entries are removed when the page starts.

Wait for **Offline ready ✓** while connected before leaving service. The status
includes the cached data's update timestamp; live checks require connectivity.
A failed data refresh retains the last complete encrypted bundle. The displayed
trip is not rewritten while unlocked: reload and unlock to view a refreshed
revision. Browser storage eviction can remove offline copies.

When changing any shell resource, increment `SHELL_VERSION` in `trip/sw.js`.
Complete prior encrypted revisions are retained for open pages that pinned them;
clearing site data removes all offline copies. Keep cache contents restricted to
public assets and encrypted envelopes.

`node scripts/test-trip-browser.mjs` exercises synthetic encrypted fixtures in a
local browser: unlocking, update ordering, responsive layouts, and offline
reload. Install Playwright locally or set `PLAYWRIGHT_MODULE` to its module path;
set `BROWSER_CHANNEL=chrome` to use installed Chrome. It does not unlock or save
the private production itinerary. `node scripts/test-trip-offline.mjs` separately
checks failed-refresh retention, immutable bundle selection, and cache exclusions
using the same browser environment options.
