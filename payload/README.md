# Update payload

This directory holds the **update payload** that gets packaged into the
release zip by `scripts/package-update.sh` (it is copied as `payload/`
inside `erp-update-<version>-<channel>.zip` alongside `MANIFEST.json`).

## Status

The ERP updater and its recovery flow are still incomplete, so this
directory currently contains only placeholder documentation. **No production
release may be published from this payload.**

## What belongs here (once the updater is ready)

- `bin/` / `app/` — the versioned application files the updater applies
- `migrations/` — any schema/data migrations, in execution order
- `APPLY` / `ROLLBACK` entry points — scripts the updater invokes
  (exact contract to be defined by the updater team; see docs/RECOVERY.md)

## Rules

- Never put secrets, license keys, or customer data in the payload.
- The payload is integrity-protected by `MANIFEST.json` (per-file SHA-256),
  `SHA256SUMS`, and the GPG signature over `SHA256SUMS` — but those only
  help if the packaging step (`scripts/package-update.sh`) runs on a
  trusted machine or CI with the signing key in secrets.
