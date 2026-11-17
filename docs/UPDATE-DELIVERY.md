# Update delivery process

This document is the authoritative process for packaging, signing,
publishing, and verifying Textile ERP updates delivered through the
private `Sufi-09/ERP-Updates` repository.

> [!WARNING]
> **Production publishing is BLOCKED.** The ERP updater and its recovery
> flow are still incomplete (see [RECOVERY.md](RECOVERY.md)). Until that
> document's exit criteria are met and tested, only **draft** releases may
> be created. Do not press "Publish release" on anything.

## 1. Security model

| Role | GitHub access | Can do |
| --- | --- | --- |
| Maintainer (`Sufi-09`) | Admin | Everything, including publishing |
| Client (`ERP-FAHIM`) | **Read (pull-only)** | Clone/fetch, download published releases, verify |
| CI (Actions) | `contents: write` scoped to the job | Build, sign with secret key, create **draft** releases only |

Chain of trust for every release asset:

```
payload files ──sha256──▶ MANIFEST.json (inside zip)
zip asset ──sha256──▶ SHA256SUMS ──gpg detach-sign──▶ SHA256SUMS.sig
                                                    (key: 2BD17B48…271C43)
```

A client that verifies `SHA256SUMS.sig` with the pinned public key
(`keys/release-signing-public.asc`) and then `sha256sum -c SHA256SUMS`
knows the package is exactly what the maintainer released.

## 2. Prerequisites

| Item | Where | Notes |
| --- | --- | --- |
| `RELEASE_GPG_PRIVATE_KEY` | Actions **secret** | Armored private key; write-only |
| `RELEASE_GPG_PASSPHRASE` | Actions **secret** | Optional; only if the key is protected |
| `RELEASE_GPG_KEY_ID` | Actions **variable** | Fingerprint `2BD17B48306CBE9CD5935231B87FFCDCDA271C43` |
| Public key | `keys/release-signing-public.asc` | Committed; clients pin this |
| Private key backup | offline/vault | See §7 — never commit it |

The key is Ed25519 (sign-only). Verify locally with
`gpg --list-secret-keys` / `gpg --fingerprint <KEYID>` after importing.

## 3. Versioning & channels

- Version format: strict semver `MAJOR.MINOR.PATCH[-prerelease]`
  (e.g. `1.4.0`, `1.4.0-rc.1`).
- Channel: `stable` or `beta`. The channel is part of the artifact name
  (`erp-update-<version>-<channel>.zip`).
- Git tag on publish: `v<version>` (e.g. `v1.4.0`).
- Never reuse or move a version number. A bad build gets a new version
  (patch bump), not a re-release.

## 4. Packaging (CI — preferred)

1. Stage the update payload in `payload/` (see `payload/README.md`).
2. Open **Actions → “Package update & draft release” → Run workflow**.
   Inputs: `version` (semver), `channel`, `notes`.
3. The workflow:
   - imports `RELEASE_GPG_PRIVATE_KEY`,
   - runs `scripts/package-update.sh payload <version> <channel>`
     → `dist/erp-update-<version>-<channel>.zip`, `dist/MANIFEST.json`,
     `dist/SHA256SUMS`,
   - runs `scripts/sign-checksums.sh dist` → `dist/SHA256SUMS.sig`,
   - creates a **draft** release `v<version>` with the three assets and a
     banner stating it must not be published yet.
4. The workflow can never publish. Publishing is manual only.

> Note on tags (verified behavior): a **draft** release does not create its
> git tag while unpublished — the draft stays "untagged" and the `v<version>`
> tag is created from `--target` at publish time. If you abandon a draft,
> delete the draft release; if a tag was ever created manually, clean it with
> `git push origin :refs/tags/v<version>`.

## 5. Packaging (manual, offline maintainer machine)

On a trusted machine with `gpg` and the signing key imported:

```bash
scripts/package-update.sh payload 1.4.0 stable     # builds dist/
GPG_KEY_ID=2BD17B48306CBE9CD5935231B87FFCDCDA271C43 \
  scripts/sign-checksums.sh dist                    # signs dist/SHA256SUMS

gh release create v1.4.0 --draft \
  --title "[DRAFT] ERP update 1.4.0 (stable)" \
  --notes-file notes.md \
  dist/erp-update-1.4.0-stable.zip dist/SHA256SUMS dist/SHA256SUMS.sig
```

## 6. Pre-publish checklist (human-in-the-loop)

A draft release may be published **only** when every box is checked:

- [ ] `RECOVERY.md` exit criteria met (BLOCKING today — currently false).
- [ ] Updater applies the package on a clean install and on an upgrade
      from the previous stable version.
- [ ] Updater refuses the package when `SHA256SUMS.sig` fails verification.
- [ ] Recovery/rollback flow tested end-to-end for this version.
- [ ] `MANIFEST.json` contents match the intended payload.
- [ ] Release notes reviewed; channel correct (`stable` vs `beta`).
- [ ] `SHA256SUMS.sig` verifies against fingerprint
      `2BD17B48306CBE9CD5935231B87FFCDCDA271C43`.
- [ ] A second person (or, for now, the maintainer after a cooling-off
      pass over the diff of `MANIFEST.json`) has reviewed the draft.

Publish by editing the draft in the GitHub UI and clicking
**Publish release** — never by re-running CI.

## 7. Signing key management

- The private key lives in exactly two places: the Actions secret
  `RELEASE_GPG_PRIVATE_KEY`, and an offline backup in a password
  manager/vault. **Never** commit it, attach it to issues, or send it via chat.
- Rotation (planned, e.g. yearly): generate a new key, commit the new
  public key, update the secret/variable, revoke the old key by publishing
  the new fingerprint in release notes.
- Compromise response: follow [SECURITY.md](../SECURITY.md).

## 8. Client access & downloads

- Client accounts are collaborators with **Read (pull-only)** permission —
  exactly `permission=pull` in the GitHub API.
- Downloads of *published* releases require authentication (private repo):
  clients use a fine-grained PAT scoped to `Contents: Read` on this repo,
  or the `gh` CLI. Draft releases are **not visible** to read-only
  collaborators at all — which is why pipeline tests are safe to keep around.
- Full client instructions: [CLIENT-SETUP.md](CLIENT-SETUP.md).

## 9. Branch protection

`main` is protected: pull requests required (1 approving review,
stale reviews dismissed), conversation resolution required, force-pushes
and branch deletion blocked, administrators not exempt from force-push/
deletion rules where supported.

If the API is unavailable, configure manually:
**Settings → Branches → Branch protection rule → `main`** with the same
options.

## 10. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `sign-checksums.sh` fails with "secret key not available" | Signing key not imported; `GPG_KEY_ID` mismatch |
| Client sees no releases | They are looking at drafts (invisible to read-only) or are not authenticated |
| `verify-update.sh` "BAD signature" | Wrong public key, tampered file, or key rotation not yet pinned — stop and investigate |
| Workflow can't create release | `permissions: contents: write` removed, or running from a fork |
