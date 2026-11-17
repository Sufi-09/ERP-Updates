# Security Policy

This repository (`Sufi-09/ERP-Updates`) is the **private distribution
channel for Textile ERP update packages**. It is not a source-code
repository and must never be made public.

## Current status

⚠️ **No production releases exist yet.** The ERP updater and its recovery
flow are still incomplete. Draft releases may exist for pipeline testing
only and are never distributed to clients.

## Security model

| Control | Mechanism |
| --- | --- |
| Confidentiality | Repository is private; access is invite-only |
| Least privilege (client) | Client accounts get **Read (pull-only)** permission |
| Integrity | SHA-256 checksums (`SHA256SUMS`) for every asset |
| Authenticity | Detached GPG signature (`SHA256SUMS.sig`) from the release signing key |
| Human-in-the-loop | CI can only create **draft** releases; publishing is manual and checklist-gated |
| History protection | `main` blocks force-pushes and branch deletion |

Signing key fingerprint:

```
2BD17B48306CBE9CD5935231B87FFCDCDA271C43
```

(see `keys/release-signing-fingerprint.txt` and `keys/release-signing-public.asc`)

## Supported versions

| Version | Supported |
| --- | --- |
| any production release | — none published yet — |
| draft / test releases | not supported, not distributable |

## Reporting a vulnerability

Prefer **GitHub private vulnerability reporting** on this repository
(Security → Advisories → Report a vulnerability), so reports stay
off public channels. If that is unavailable, contact the repository owner
(`Sufi-09`) directly via GitHub and do not open public issues.

Please include: affected version/channel, the release tag, whether
signature verification passed or failed, and reproduction details.

## Signing key compromise

If the release signing key is ever suspected compromised:

1. Stop publishing immediately.
2. Generate a new key and replace `keys/release-signing-public.asc`.
3. Rotate the `RELEASE_GPG_PRIVATE_KEY` secret and `RELEASE_GPG_KEY_ID` variable.
4. Re-sign any unpublished drafts; do not re-sign already-published
   packages without a documented explanation.
5. Notify all clients out-of-band and treat any package signed by the old
   key after the compromise time as untrusted.

Details: [docs/UPDATE-DELIVERY.md](docs/UPDATE-DELIVERY.md).
