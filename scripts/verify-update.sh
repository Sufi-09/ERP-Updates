#!/usr/bin/env bash
# verify-update.sh — verify a downloaded Textile ERP update release.
#
# Usage: scripts/verify-update.sh <release-dir> [public-key]
#   release-dir  folder with the downloaded assets:
#                erp-update-*.zip, SHA256SUMS, SHA256SUMS.sig
#   public-key   armored public key file
#                (default: keys/release-signing-public.asc next to this repo)
#
# Checks, in order:
#   1. GPG signature on SHA256SUMS is valid and made by the pinned key
#   2. SHA-256 of every asset listed in SHA256SUMS matches
#
# Requires: gpg, sha256sum.

set -euo pipefail

REL="${1:-}"
[[ -n "$REL" && -d "$REL" ]] || { echo "Usage: $0 <release-dir> [public-key]" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY="${2:-$SCRIPT_DIR/../keys/release-signing-public.asc}"

[[ -f "$KEY" ]] || { echo "error: public key not found: $KEY" >&2; exit 1; }
[[ -f "$REL/SHA256SUMS" && -f "$REL/SHA256SUMS.sig" ]] || {
  echo "error: SHA256SUMS / SHA256SUMS.sig missing in $REL" >&2; exit 1; }

# Use a throwaway keyring so verification is self-contained.
GNUPGHOME_TMP="$(mktemp -d)"
trap 'rm -rf "$GNUPGHOME_TMP"' EXIT
chmod 700 "$GNUPGHOME_TMP"
export GNUPGHOME="$GNUPGHOME_TMP"

gpg --batch --quiet --import "$KEY"

echo "==> [1/2] Verifying GPG signature on SHA256SUMS..."
gpg --batch --verify "$REL/SHA256SUMS.sig" "$REL/SHA256SUMS"
echo
echo "==> [2/2] Verifying SHA-256 checksums of release assets..."
( cd "$REL" && sha256sum -c SHA256SUMS )
echo
echo "ALL VERIFICATIONS PASSED"
