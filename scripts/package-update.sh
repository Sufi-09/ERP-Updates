#!/usr/bin/env bash
# package-update.sh — build a Textile ERP update package and its checksums.
#
# Usage: scripts/package-update.sh <payload-dir> <version> [channel]
#   payload-dir  directory containing the update payload files
#   version      semantic version, e.g. 1.4.0
#   channel      release channel: stable (default) or beta
#
# Env:
#   OUTPUT_DIR   output directory (default: dist)
#
# Produces (in OUTPUT_DIR):
#   erp-update-<version>-<channel>.zip   payload/ + MANIFEST.json
#   MANIFEST.json                        copy, for inspection/diffing
#   SHA256SUMS                           sha256 of the release assets
#
# Signing is a separate step: scripts/sign-checksums.sh

set -euo pipefail

usage() { echo "Usage: $0 <payload-dir> <version> [channel]" >&2; exit 2; }

PAYLOAD_DIR="${1:-}"
VERSION="${2:-}"
CHANNEL="${3:-stable}"

[[ -n "$PAYLOAD_DIR" && -n "$VERSION" ]] || usage
[[ -d "$PAYLOAD_DIR" ]] || { echo "error: payload dir not found: $PAYLOAD_DIR" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
  echo "error: version must be semver-like (e.g. 1.4.0 or 1.4.0-rc.1): $VERSION" >&2; exit 1; }
case "$CHANNEL" in
  stable|beta) ;;
  *) echo "error: channel must be 'stable' or 'beta', got: $CHANNEL" >&2; exit 1 ;;
esac

OUTPUT_DIR="${OUTPUT_DIR:-dist}"
PKG_NAME="erp-update-${VERSION}-${CHANNEL}"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$OUTPUT_DIR"
cp -R "$PAYLOAD_DIR" "$STAGE/payload"

# Per-file SHA-256 manifest of the staged payload.
FILES_JSON="$( cd "$STAGE" && find payload -type f | LC_ALL=C sort | while read -r f; do
  h="$(sha256sum "$f" | awk '{print $1}')"
  s="$(wc -c < "$f" | tr -d ' ')"
  printf '    {"path":"%s","sha256":"%s","size":%s},\n' "$f" "$h" "$s"
done )"
FILES_JSON="${FILES_JSON%,}"

CREATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$STAGE/MANIFEST.json" <<EOF
{
  "name": "erp-update",
  "version": "${VERSION}",
  "channel": "${CHANNEL}",
  "created_at": "${CREATED_AT}",
  "files": [
${FILES_JSON}
  ]
}
EOF

# Build the package zip (prefer zip(1), fall back to python3).
if command -v zip >/dev/null 2>&1; then
  ( cd "$STAGE" && zip -qr "$OLDPWD/$OUTPUT_DIR/$PKG_NAME.zip" payload MANIFEST.json )
else
  ( cd "$STAGE" && python3 -m zipfile -c "$OLDPWD/$OUTPUT_DIR/$PKG_NAME.zip" payload MANIFEST.json )
fi

cp "$STAGE/MANIFEST.json" "$OUTPUT_DIR/MANIFEST.json"

( cd "$OUTPUT_DIR" && sha256sum "$PKG_NAME.zip" > SHA256SUMS )

echo "Packaged:"
echo "  $OUTPUT_DIR/$PKG_NAME.zip"
echo "  $OUTPUT_DIR/MANIFEST.json"
echo "  $OUTPUT_DIR/SHA256SUMS"
echo "Next: GPG_KEY_ID=<fingerprint> scripts/sign-checksums.sh $OUTPUT_DIR"
