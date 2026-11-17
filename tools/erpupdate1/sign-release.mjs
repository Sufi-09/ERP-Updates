#!/usr/bin/env node
/**
 * ERPUPDATE1 manifest builder + raw Ed25519 signer — EXPERIMENTAL draft/test
 * tooling. NOT production-ready. Kept separate from the GPG signing chain.
 *
 * Writes, into --out:
 *   manifest.json  — UTF-8 JSON (<= 32 KiB), key order:
 *                    format, product, version, publishedAt, notes, size, sha256
 *   manifest.sig   — EXACTLY 64 raw binary bytes: standard Ed25519 (PureEdDSA)
 *                    over the exact bytes written to manifest.json.
 *                    NOT a prehash, NOT GPG/OpenPGP, NOT re-serialized JSON.
 *   READY.txt      — local marker for the developer draft uploader flow;
 *                    never uploaded as a release asset.
 *
 * Private key: PKCS#8 PEM at --key (or env ERPUPDATE1_SIGNING_KEY_PATH).
 * Use ephemeral TEST keys only. Key material is never logged. No production
 * key is deployed here and no rotation policy is defined (see README).
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

export const MANIFEST_MAX_BYTES = 32 * 1024; // 32 KiB
export const NOTES_MAX_CHARS = 10_000; // JavaScript string characters
export const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const PUBLISHED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;

/** Canonical UTC timestamp: YYYY-MM-DDTHH:MM:SSZ (no fractional seconds). */
export function canonicalUtc(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Build the manifest object (canonical key order). */
export function makeManifest({ product, version, publishedAt, notes, packageBytes }) {
  return {
    format: 1,
    product,
    version,
    publishedAt,
    notes,
    size: packageBytes.length,
    sha256: crypto.createHash('sha256').update(packageBytes).digest('hex'),
  };
}

/**
 * Validate manifest schema against the ERPUPDATE1 rules. Throws on violation.
 * Signature verification is separate (verify-bundle.mjs).
 */
export function validateManifest(m) {
  const fail = (msg) => { throw new Error(`manifest: ${msg}`); };
  if (m === null || typeof m !== 'object' || Array.isArray(m)) fail('not an object');
  if (m.format !== 1) fail('format must be 1');
  if (typeof m.product !== 'string' || m.product.length === 0) fail('product must be a non-empty string');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) {
    fail(`version must be three numeric components with no leading zeroes: ${JSON.stringify(m.version)}`);
  }
  const [maj, min, pat] = m.version.split('.').map(Number);
  if (maj === 0 && min === 0 && pat === 0) fail('version must be greater than 0.0.0');
  if (typeof m.publishedAt !== 'string' || !PUBLISHED_AT_RE.test(m.publishedAt)) {
    fail(`publishedAt must be canonical UTC YYYY-MM-DDTHH:MM:SSZ: ${JSON.stringify(m.publishedAt)}`);
  }
  const d = new Date(m.publishedAt);
  if (Number.isNaN(d.getTime()) || canonicalUtc(d) !== m.publishedAt) fail('publishedAt is not a real date');
  if (typeof m.notes !== 'string') fail('notes must be a string');
  if (m.notes.length > NOTES_MAX_CHARS) fail(`notes exceed ${NOTES_MAX_CHARS} characters`);
  if (!Number.isInteger(m.size) || m.size <= 0) fail('size must be a positive integer (byte size of package.bin)');
  if (typeof m.sha256 !== 'string' || !SHA256_RE.test(m.sha256)) fail('sha256 must be 64 lowercase hex characters');
}

/** Serialize manifest bytes (UTF-8 compact JSON, canonical key order). */
export function manifestBytes(manifest) {
  return Buffer.from(JSON.stringify(manifest), 'utf8');
}

/** Standard Ed25519 (PureEdDSA) signature over exact bytes -> 64 raw bytes. */
export function signManifestExactBytes(exactManifestBytes, privateKeyPem) {
  const key = crypto.createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('signing key must be Ed25519 (PKCS#8 PEM)');
  const sig = crypto.sign(null, exactManifestBytes, key);
  if (sig.length !== 64) throw new Error(`unexpected Ed25519 signature length ${sig.length}`);
  return sig;
}

// ---------------------------------------------------------------------------
// CLI:
//   node sign-release.mjs --key <pkcs8.pem> --package <package.bin> \
//     --product <id> --version <x.y.z> [--notes <text>] \
//     [--published-at <YYYY-MM-DDTHH:MM:SSZ>] --out <dir>
// ---------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const keyPath = getArg('--key') ?? process.env.ERPUPDATE1_SIGNING_KEY_PATH;
  const pkgPath = getArg('--package');
  const product = getArg('--product');
  const version = getArg('--version');
  const notes = getArg('--notes') ?? '';
  const publishedAt = getArg('--published-at') ?? canonicalUtc();
  const outDir = getArg('--out');

  try {
    if (!keyPath || !pkgPath || !product || !version || !outDir) {
      throw new Error(
        'Usage: node sign-release.mjs --key <pkcs8.pem> --package <package.bin> ' +
        '--product <id> --version <x.y.z> [--notes <text>] [--published-at <ts>] --out <dir>',
      );
    }
    const privateKeyPem = fs.readFileSync(keyPath); // key material: never logged
    const packageBytes = fs.readFileSync(pkgPath);
    const manifest = makeManifest({ product, version, publishedAt, notes, packageBytes });
    validateManifest(manifest);
    const bytes = manifestBytes(manifest);
    if (bytes.length > MANIFEST_MAX_BYTES) {
      throw new Error(`manifest.json exceeds ${MANIFEST_MAX_BYTES} bytes (${bytes.length})`);
    }
    const sig = signManifestExactBytes(bytes, privateKeyPem);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'manifest.json'), bytes);
    fs.writeFileSync(path.join(outDir, 'manifest.sig'), sig);
    // Local-only marker expected by the developer draft uploader; never uploaded.
    fs.writeFileSync(path.join(outDir, 'READY.txt'), `READY ${version} ${publishedAt}\n`);
    console.log(`Wrote ${outDir}/manifest.json (${bytes.length} bytes)`);
    console.log(`Wrote ${outDir}/manifest.sig (64 raw Ed25519 bytes)`);
    console.log(`Wrote ${outDir}/READY.txt (local marker only — do not upload)`);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
