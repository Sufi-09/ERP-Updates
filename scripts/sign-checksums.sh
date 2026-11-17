#!/usr/bin/env bash
# sign-checksums.sh — create a detached armored GPG signature for SHA256SUMS.
#
# Usage: scripts/sign-checksums.sh [dist-dir]     (default: dist)
#
# Env:
#   GPG_KEY_ID      (required) fingerprint/keyid of the release signing key
#   GPG_PASSPHRASE  (optional) key passphrase, if the key is protected
#
# Produces: <dist-dir>/SHA256SUMS.sig

set -euo pipefail

DIST="${1:-dist}"

[[ -f "$DIST/SHA256SUMS" ]] || {
  echo "error: $DIST/SHA256SUMS not found — run scripts/package-update.sh first" >&2; exit 1; }
: "${GPG_KEY_ID:?GPG_KEY_ID is required (release signing key fingerprint)}"

args=(--batch --yes --local-user "$GPG_KEY_ID" --detach-sign --armor --output "$DIST/SHA256SUMS.sig")
if [[ -n "${GPG_PASSPHRASE:-}" ]]; then
  args+=(--pinentry-mode loopback --passphrase "$GPG_PASSPHRASE")
fi

gpg "${args[@]}" "$DIST/SHA256SUMS"

echo "Signed: $DIST/SHA256SUMS.sig (key $GPG_KEY_ID)"
