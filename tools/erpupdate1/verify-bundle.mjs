#!/usr/bin/env node
/**
 * ERPUPDATE1 bundle verifier — EXPERIMENTAL draft/test tooling.
 * NOT production-ready. Independent of the GPG chain.
 *
 * Verifies a directory containing package.bin, manifest.json, manifest.sig:
 *   1. manifest.sig is exactly 64 raw binary bytes
 *   2. manifest.json is valid UTF-8 JSON, <= 32 KiB, schema-valid
 *   3. package.bin matches manifest size and sha256
 *   4. manifest.sig is a valid standard Ed25519 signature over the EXACT
 *      bytes of manifest.json, under the explicitly supplied public key
 *   5. package.bin is a valid, canonical ERPUPDATE1 container (full parse,
 *      Windows-safe paths, canonical headers, no trailing bytes)
 *   6. deterministic rebuild: re-building the container from the extracted
 *      files reproduces the identical sha256 (verify-candidate semantics)
 *
 * TRUST MODEL: the verification public key must come from a separately
 * trusted bootstrap path (--pubkey). A key that merely accompanies a download
 * is NEVER trusted — this tool refuses to read keys from the bundle directory.
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';

import {
  parseContainer,
  buildContainerBuffer,
} from './build-package.mjs';
import {
  MANIFEST_MAX_BYTES,
  validateManifest,
} from './sign-release.mjs';

export function loadEd25519PublicKey(pem) {
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('public key must be Ed25519 (SPKI PEM)');
  return key;
}

/** Verify one bundle directory. Throws with a descriptive message on failure. */
export function verifyBundle({ bundleDir, publicKeyPem }) {
  const pub = loadEd25519PublicKey(publicKeyPem);

  const manifestPath = path.join(bundleDir, 'manifest.json');
  const sigPath = path.join(bundleDir, 'manifest.sig');
  const pkgPath = path.join(bundleDir, 'package.bin');

  // 1. signature file: exactly 64 raw binary bytes
  if (!fs.existsSync(sigPath)) throw new Error('verify: manifest.sig missing');
  const sig = fs.readFileSync(sigPath);
  if (sig.length !== 64) {
    throw new Error(`verify: manifest.sig must be exactly 64 raw binary bytes (got ${sig.length})`);
  }

  // 2. manifest bytes: exact bytes are what is signed; strict UTF-8; <= 32 KiB
  if (!fs.existsSync(manifestPath)) throw new Error('verify: manifest.json missing');
  const manifestBytes = fs.readFileSync(manifestPath);
  if (manifestBytes.length > MANIFEST_MAX_BYTES) {
    throw new Error(`verify: manifest.json exceeds ${MANIFEST_MAX_BYTES} bytes`);
  }
  let manifestText;
  try {
    manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
  } catch {
    throw new Error('verify: manifest.json is not valid UTF-8');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error('verify: manifest.json is not valid JSON');
  }
  validateManifest(manifest); // throws with "manifest: ..." on schema violations

  // 3. package.bin matches manifest
  if (!fs.existsSync(pkgPath)) throw new Error('verify: package.bin missing');
  const packageBytes = fs.readFileSync(pkgPath);
  if (packageBytes.length !== manifest.size) {
    throw new Error(`verify: package.bin size ${packageBytes.length} != manifest.size ${manifest.size}`);
  }
  const sha = crypto.createHash('sha256').update(packageBytes).digest('hex');
  if (sha !== manifest.sha256) {
    throw new Error('verify: package.bin sha256 does not match manifest.sha256');
  }

  // 4. signature over EXACT manifest bytes
  if (!crypto.verify(null, manifestBytes, pub, sig)) {
    throw new Error('verify: Ed25519 signature verification failed (manifest.sig vs manifest.json)');
  }

  // 5. full container validation
  const entries = parseContainer(packageBytes);

  // 6. deterministic rebuild equals shipped container (verify-candidate semantics)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'erpupdate1-verify-'));
  try {
    for (const e of entries) {
      const dest = path.join(tmp, ...e.path.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, packageBytes.subarray(e.dataStart, e.dataStart + e.size));
    }
    const rebuilt = buildContainerBuffer(tmp);
    const rebuiltSha = crypto.createHash('sha256').update(rebuilt).digest('hex');
    if (rebuiltSha !== manifest.sha256) {
      throw new Error('verify: deterministic rebuild produced different bytes (non-canonical container)');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return { manifest, files: entries.length };
}

// ---------------------------------------------------------------------------
// CLI: node verify-bundle.mjs --bundle <dir> --pubkey <spki.pem>
// ---------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const bundleDir = getArg('--bundle');
  const pubkeyPath = getArg('--pubkey');
  try {
    if (!bundleDir || !pubkeyPath) {
      throw new Error('Usage: node verify-bundle.mjs --bundle <dir> --pubkey <spki.pem>');
    }
    // Trust model: only the explicitly supplied key path is read. Never a key
    // that happens to sit next to the downloaded files.
    const publicKeyPem = fs.readFileSync(pubkeyPath);
    const result = verifyBundle({ bundleDir, publicKeyPem });
    console.log(`PASS: bundle verified (${result.files} files, version ${result.manifest.version})`);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
