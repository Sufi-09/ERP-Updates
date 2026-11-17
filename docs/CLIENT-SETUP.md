# Client setup: access, download, verify

This guide is for client installations (e.g. the `ERP-FAHIM` account)
receiving Textile ERP updates from the private `Sufi-09/ERP-Updates`
repository. Your access is **read-only** by design: you can download and
verify updates, nothing else.

> [!NOTE]
> There are **no production releases yet** — the ERP updater and its
> recovery flow are still incomplete. This document prepares you for the
> first release.

## 1. Accept the invitation

You will receive a GitHub collaborator invitation for
`Sufi-09/ERP-Updates` with **Read** permission. Accept it while logged
into your GitHub account. If the invitation expired, ask the maintainer
to re-send it.

## 2. Authenticate for downloads

Because the repository is private, release downloads require
authentication. Pick one option:

**Option A — `gh` CLI (recommended):**

```bash
gh auth login
gh release download <TAG> -R Sufi-09/ERP-Updates -D ./update-download
```

**Option B — fine-grained personal access token:**

1. GitHub → Settings → Developer settings → **Fine-grained tokens**.
2. Repository access: only `Sufi-09/ERP-Updates`.
3. Permissions → **Contents: Read-only**. Nothing else.
4. Download assets via `curl`:

```bash
curl -H "Authorization: Bearer $TOKEN" -L -o SHA256SUMS \
  https://api.github.com/repos/Sufi-09/ERP-Updates/releases/assets/<ASSET_ID>
```

(Browser download links also work when logged into GitHub.)

## 3. Verify before installing

Every release contains three assets:

| Asset | Purpose |
| --- | --- |
| `erp-update-<version>-<channel>.zip` | the update package (contains `MANIFEST.json` + `payload/`) |
| `SHA256SUMS` | SHA-256 checksums of the package |
| `SHA256SUMS.sig` | detached GPG signature over `SHA256SUMS` |

Get the maintainer's public key **out of band** (from the repo
`keys/release-signing-public.asc`) and confirm the fingerprint:

```
2BD17B48306CBE9CD5935231B87FFCDCDA271C43
```

Then run the bundled verification script (requires `gpg` and `sha256sum`):

```bash
scripts/verify-update.sh ./update-download
```

Manual equivalent:

```bash
gpg --import keys/release-signing-public.asc
gpg --verify ./update-download/SHA256SUMS.sig ./update-download/SHA256SUMS
# → must say "Good signature" with the fingerprint above
cd ./update-download && sha256sum -c SHA256SUMS
```

**Stop and contact the maintainer if:**

- the signature is not "Good", or
- the fingerprint differs from the one above, or
- any checksum fails.

## 4. What you can and cannot do

| Action | Allowed |
| --- | --- |
| Browse/download published releases | ✅ |
| Clone/fetch the repository | ✅ |
| Push changes, create releases, edit settings | ❌ |
| See draft releases | ❌ (invisible to read-only accounts) |
| Invite other users | ❌ |

## 5. When the first production release ships

The maintainer will notify you out-of-band with the version and tag. Then:

```bash
gh release download v<version> -R Sufi-09/ERP-Updates -D ./update-download
scripts/verify-update.sh ./update-download
# then hand ./update-download to the ERP updater (details TBD — updater
# team is still finalizing the apply/rollback contract; see docs/RECOVERY.md)
```
