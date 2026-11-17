# tools/erpupdate1 — ERPUPDATE1 compatibility tooling

> [!WARNING]
> **EXPERIMENTAL — NOT PRODUCTION-READY.** Draft/test tooling and
> interoperability tests only. This directory is completely separate from
> the GPG-signed ZIP pipeline (`scripts/`, `release.yml`), which remains
> untouched. No release may be published and no production assets uploaded
> from this tooling. The Windows disposable database test has not passed
> yet, so production release remains blocked anyway.

Implements the **ERPUPDATE1** update format expected by the Textile ERP
updater (reference implementation: `Sufi-09/erp-system`,
`apps/desktop/windows/update/` — `build-package.mjs`, `sign-release.mjs`,
`verify.mjs`, `extract.mjs`, `verify-candidate.mjs`, `create-release.mjs`).

## Format summary

| Artifact | Rule |
| --- | --- |
| `package.bin` | ASCII magic `ERPUPDATE1`; per file: uint32 BE header length + compact `JSON.stringify({path, size})` (UTF-8) + exactly `size` raw bytes; uint32 BE zero terminator; **no trailing bytes** |
| `manifest.json` | UTF-8 JSON, ≤ 32 KiB: `{"format":1,"product","version","publishedAt","notes","size","sha256"}` — `size`/`sha256` cover `package.bin` exactly |
| `manifest.sig` | **exactly 64 raw binary bytes**: standard Ed25519 (PureEdDSA) over the **exact bytes** of `manifest.json` — not base64, not hex, not OpenPGP, not a prehash, not a re-serialization |

Other rules enforced: deterministic recursive sorting (entries sorted by
name at each directory level, UTF-16 code-unit order), Windows-safe relative
paths (`/`, no links/special files/duplicates/case-collisions), ≤ 50,000
files, ≤ 4,096 bytes per entry header, ≤ 2 GiB package, version
`MAJOR.MINOR.PATCH` numeric with no leading zeroes and > `0.0.0`,
`publishedAt` canonical UTC `YYYY-MM-DDTHH:MM:SSZ`, `notes` ≤ 10,000
JavaScript string characters. Candidate verification rebuilds the container
and compares its hash, so the container must be byte-identical to what
`build-package.mjs` produces — extractability alone is not enough.
`READY.txt` is a local marker for the developer draft uploader
(`create-release.mjs`); it is never uploaded.

## Files

| File | Purpose |
| --- | --- |
| `build-package.mjs` | deterministic ERPUPDATE1 container builder + parser (`parseContainer`) |
| `sign-release.mjs` | manifest builder/schema + raw Ed25519 signer (PKCS#8 PEM key via `--key`) |
| `verify-bundle.mjs` | full bundle verification incl. deterministic-rebuild check |
| `run-interop-tests.mjs` | interop/compatibility test matrix (see below) |

## Usage (draft/test only)

```bash
node tools/erpupdate1/build-package.mjs payload dist-erpupdate1/package.bin
node tools/erpupdate1/sign-release.mjs \
  --key /path/to/EPHEMERAL-TEST-key.pem --package dist-erpupdate1/package.bin \
  --product textile-erp-windows --version 1.0.1 --notes "Release notes" \
  --out dist-erpupdate1
node tools/erpupdate1/verify-bundle.mjs \
  --bundle dist-erpupdate1 --pubkey /path/to/EPHEMERERAL-TEST-pub.pem
node tools/erpupdate1/run-interop-tests.mjs
```

## Trust & key rules

- Use **ephemeral test keys only**. No production key is deployed by this
  tooling, and **no key rotation policy is defined here** — key pinning and
  rotation are to be coordinated with the ERP-system side (rotation is not
  implemented in the reference either).
- The verification public key must arrive via a **separately trusted
  application/bootstrap path**. A key that merely accompanies a download is
  never trusted; `verify-bundle.mjs` only accepts an explicit `--pubkey`.
- Private keys never belong in the repository, packages, logs, or chat.
  `run-interop-tests.mjs` generates ephemeral keypairs at runtime in a temp
  dir and wipes them afterwards.

## Test matrix (`run-interop-tests.mjs`)

Valid bundle round-trip · altered manifest · re-serialized manifest
(exact-byte rule) · altered signature · signature format strictness (63/65
bytes, base64 text) · altered package · wrong key · unsafe paths (traversal,
absolute, backslash, reserved device names, bad chars, trailing dot/space,
duplicates, case-collisions, sensitive names/extensions, hand-crafted
malicious container) · deterministic rebuild (build-twice and
extract-rebuild hash equality, verify-candidate semantics) · container
negatives (magic, trailing bytes, truncated, empty, non-canonical headers) ·
manifest schema negatives (version/publishedAt/sha256/notes/size/format
bounds).

Reference cross-checks against `Sufi-09/erp-system` run automatically when
the reference is reachable at `$ERP_SYSTEM_REF` (repo root or the `update/`
dir) or `/tmp/erp-system-ref`; otherwise they report SKIP. **Byte-parity
against the reference builder is still to be confirmed** — this workspace
did not have read access to `erp-system` when this tooling was written.
Parity-sensitive points to confirm first: recursive sort order, sensitive
path/extension denylist, `publicationTimestamp` acceptance exactly, and
manifest unknown-key policy.
