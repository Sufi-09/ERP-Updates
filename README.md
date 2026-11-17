# ERP-Updates

Private distribution channel for **Textile ERP update packages**.
This repository exists to deliver signed, versioned updates to authorized
client installations — it is not a source repository and must stay private.

> [!WARNING]
> **Not ready for production.** The ERP updater and its recovery flow are
> still incomplete. **No production release may be published yet.** Any
> draft release present in this repository is a pipeline test placeholder
> and must not be distributed.

## How delivery stays secure

- **Private repository** — only invited accounts can see anything here.
- **Read-only clients** — client accounts (e.g. `ERP-FAHIM`) have
  pull-only access; they cannot push, release, or alter history.
- **Signed checksums** — every release ships `SHA256SUMS` plus a detached
  GPG signature `SHA256SUMS.sig`.
- **Draft-only CI** — the release workflow can only create *draft*
  releases; publishing is a manual action gated by a checklist.
- **Protected `main`** — force-pushes and branch deletion are blocked.

Signing key fingerprint (verify against `keys/release-signing-fingerprint.txt`):

```
2BD17B48306CBE9CD5935231B87FFCDCDA271C43
```

## Repository layout

```
├── README.md                     ← you are here
├── SECURITY.md                   ← security policy & key-compromise response
├── docs/
│   ├── UPDATE-DELIVERY.md        ← maintainer release process (checklist-gated)
│   ├── CLIENT-SETUP.md           ← client: access, download, verify
│   └── RECOVERY.md               ← rollback/recovery flow (INCOMPLETE)
├── scripts/
│   ├── package-update.sh         ← build update zip + MANIFEST + SHA256SUMS
│   ├── sign-checksums.sh         ← GPG-detach-sign SHA256SUMS
│   └── verify-update.sh          ← verify a downloaded release
├── keys/
│   ├── release-signing-public.asc
│   └── release-signing-fingerprint.txt
├── payload/                      ← update payload (placeholder for now)
├── tools/
│   └── erpupdate1/               ← EXPERIMENTAL ERPUPDATE1 tooling (draft/test only)
└── .github/workflows/release.yml ← manual dispatch → draft release
```

## Client quickstart

1. Accept the read-only collaborator invitation.
2. Download the release assets (see [docs/CLIENT-SETUP.md](docs/CLIENT-SETUP.md)).
3. Verify before installing:

```bash
gpg --import keys/release-signing-public.asc
scripts/verify-update.sh path/to/downloaded/release
```

## Maintainer quickstart

1. Stage the update payload in `payload/`.
2. Run the **“Package update & draft release”** workflow (manual dispatch)
   — it builds, signs, and opens a *draft* release.
3. Work through the pre-publish checklist in
   [docs/UPDATE-DELIVERY.md](docs/UPDATE-DELIVERY.md).
4. Publishing is **currently blocked by policy** until the updater and
   recovery flow ([docs/RECOVERY.md](docs/RECOVERY.md)) are complete.

## Releases

See the [Releases](../../releases) page for published and draft releases.
Nothing has been published yet.
