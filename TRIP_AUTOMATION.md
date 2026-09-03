# Trip dashboard update workflow

The public dashboard page contains presentation code only. Private itinerary and budget data live in `trip/payload.json` as AES-GCM ciphertext and are decrypted only in the visitor's browser after the password is entered.

## Safe update boundary

1. An email intake step extracts airline or lodging changes into a temporary, private JSON file.
2. A review step merges those changes into the bilingual trip record. Airline itinerary messages are authoritative; live flight sources may supplement but do not overwrite them without review.
3. `scripts/encrypt-trip.mjs` encrypts the reviewed record locally. The password is supplied only through `TRIP_DASHBOARD_PASSWORD` and is never written to the repository.
4. `trip/sync.json` receives the successful update time and a short, non-sensitive source label.
5. Only `trip/payload.json` and `trip/sync.json` are published.

Example encryption command:

```sh
TRIP_DASHBOARD_PASSWORD='your password' node scripts/encrypt-trip.mjs /private/path/trip.json
node scripts/verify-trip-payload.mjs
```

Do not add plaintext trip JSON, raw emails, booking confirmations, tokens, or passwords to this repository. The remaining email-intake step needs a selected mail provider and explicit account authorization before it can be connected.

## Email intake contract

`scripts/extract-travel-update.mjs` accepts a private JSON file with `from`, `subject`, `text`, and an optional `receivedAt`. It emits a normalized candidate containing sender trust, likely change type, flight numbers, confirmation identifiers, dates, and times. Every candidate is marked `reviewRequired`; extraction alone can never publish a dashboard change.

```sh
node scripts/extract-travel-update.mjs /private/path/email.json
node scripts/test-travel-update.mjs
```

The trusted-domain list is deliberately narrow. Add a provider only after verifying the legitimate sender domain from a known booking message.
