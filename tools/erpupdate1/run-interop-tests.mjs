#!/usr/bin/env node
/**
 * ERPUPDATE1 interop / compatibility test suite — EXPERIMENTAL draft/test tooling.
 * NOT production-ready.
 *
 * Required matrix (spec):
 *   - valid bundle round-trip
 *   - altered manifest        -> reject
 *   - altered signature       -> reject
 *   - altered package         -> reject
 *   - wrong key               -> reject
 *   - unsafe paths            -> reject (validator + hand-crafted container)
 *   - deterministic rebuild   -> byte-identical
 * Plus: signature-format strictness, schema negatives, container negatives,
 * exact-byte signing (re-serialized manifest rejected).
 *
 * Keys: ephemeral Ed25519 test keys are generated at runtime in a temp dir,
 * wiped afterwards, and NEVER printed or committed. No production key is used.
 *
 * Reference cross-checks (source of truth: Sufi-09/erp-system,
 * apps/desktop/windows/update/): run automatically when the reference is
 * reachable at $ERP_SYSTEM_REF or /tmp/erp-system-ref; otherwise SKIP.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import {
  buildContainerBuffer,
  buildPackage,
  parseContainer,
  validateEntryPath,
  validateFileList,
} from './build-package.mjs';
import {
  makeManifest,
  manifestBytes,
  signManifestExactBytes,
  validateManifest,
  canonicalUtc,
} from './sign-release.mjs';
import { verifyBundle, loadEd25519PublicKey } from './verify-bundle.mjs';

// ---------------------------------------------------------------- fixtures --
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'erpupdate1-tests-'));
const results = [];

function fixtureSourceDir() {
  const src = path.join(TMP_ROOT, 'src');
  const write = (rel, content) => {
    const p = path.join(src, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  write('app/main.js', 'console.log("hello");\n');
  write('app/lib/util.js', 'export const x = 1;\n');
  write('docs/read me.txt', 'spaces are fine\n');
  write('data/Ünïcode-ötö.txt', 'unicode name\n');
  write('a.b', 'dot in name\n');
  write('a/c.txt', 'nested alongside a.b\n');
  return src;
}

function bundleDir() {
  const out = path.join(TMP_ROOT, 'bundle');
  fs.mkdirSync(out, { recursive: true });
  return out;
}

function writeBundle({ srcDir, outDir, keyPem, product = 'textile-erp-windows', version = '1.0.1', notes = 'Release notes' }) {
  const pkgPath = path.join(outDir, 'package.bin');
  const packageBytes = buildPackage(srcDir, pkgPath);
  const manifest = makeManifest({
    product,
    version,
    publishedAt: canonicalUtc(new Date('2026-01-01T00:00:00Z')),
    notes,
    packageBytes,
  });
  validateManifest(manifest);
  const bytes = manifestBytes(manifest);
  const sig = signManifestExactBytes(bytes, keyPem);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), bytes);
  fs.writeFileSync(path.join(outDir, 'manifest.sig'), sig);
  return { manifest, manifestBytes: bytes, sig, packageBytes };
}

/** Ephemeral Ed25519 test keypair. Never logged; wiped with TMP_ROOT. */
function ephemeralKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

function expectReject(fn, needle, label) {
  try {
    fn();
  } catch (err) {
    if (needle && !String(err.message).includes(needle)) {
      throw new Error(`${label}: rejected, but for the wrong reason: ${err.message}`);
    }
    return err;
  }
  throw new Error(`${label}: expected rejection, but it passed`);
}

async function test(name, fn) {
  try {
    const r = await fn();
    if (r === 'SKIP') {
      results.push({ name, ok: true, skipped: true });
      console.log(`SKIP  ${name}`);
      return;
    }
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
}

// ------------------------------------------------------------------- tests --
const keyA = ephemeralKeypair();
const keyB = ephemeralKeypair(); // "wrong key" material
const srcDir = fixtureSourceDir();

await test('valid bundle: build -> sign -> verify passes', () => {
  const out = bundleDir();
  const { manifest, manifestBytes: bytes } = writeBundle({ srcDir, outDir: out, keyPem: keyA.privatePem });
  const r = verifyBundle({ bundleDir: out, publicKeyPem: keyA.publicPem });
  assert.equal(r.manifest.version, manifest.version);
  assert.equal(r.files, 6);
  assert.equal(manifestBytes(manifest).equals(bytes), true);
});

await test('valid bundle: extracted content equals source', () => {
  const out = bundleDir();
  const { packageBytes } = writeBundle({ srcDir, outDir: out, keyPem: keyA.privatePem });
  const entries = parseContainer(packageBytes);
  for (const e of entries) {
    const src = fs.readFileSync(path.join(srcDir, ...e.path.split('/')));
    const inPkg = packageBytes.subarray(e.dataStart, e.dataStart + e.size);
    assert.ok(src.equals(inPkg), `content mismatch for ${e.path}`);
  }
});

await test('deterministic rebuild: building twice is byte-identical', () => {
  const a = buildContainerBuffer(srcDir);
  const b = buildContainerBuffer(srcDir);
  assert.ok(a.equals(b));
});

await test('deterministic rebuild: extract -> rebuild reproduces package hash (verify-candidate)', () => {
  const out = bundleDir();
  const { packageBytes, manifest } = writeBundle({ srcDir, outDir: out, keyPem: keyA.privatePem });
  const entries = parseContainer(packageBytes);
  const cand = path.join(TMP_ROOT, 'candidate');
  fs.rmSync(cand, { recursive: true, force: true });
  for (const e of entries) {
    const dest = path.join(cand, ...e.path.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, packageBytes.subarray(e.dataStart, e.dataStart + e.size));
  }
  const rebuilt = buildContainerBuffer(cand);
  const sha = crypto.createHash('sha256').update(rebuilt).digest('hex');
  assert.equal(sha, manifest.sha256);
});

await test('altered manifest: post-sign edit is rejected (signature)', () => {
  const out = bundleDir();
  writeBundle({ srcDir, outDir: out, keyPem: keyA.privatePem });
  const p = path.join(out, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  m.notes = 'tampered notes';
  fs.writeFileSync(p, JSON.stringify(m));
  expectReject(() => verifyBundle({ bundleDir: out, publicKeyPem: keyA.publicPem }), 'signature', 'altered manifest');
});

await test('exact-byte signing: re-serialized manifest (pretty JSON) is rejected', () => {
  const out = bundleDir();
  writeBundle({ srcDir, outDir: out, keyPem: keyA.privatePem });
  const p = path.join(out, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  fs.writeFileSync(p, JSON.stringify(m, null, 2)); // same data, different bytes
  expectReject(() => verifyBundle({ bundleDir: out, publicKeyPem: keyA.publicPem }), 'signature', 'reserialized manifest');
});

await test('altered signature: flipped byte is rejected', () => {
  const out = bundleDir();
  writeBundle({ srcDir, outDir: out, keyPem: keyA.privatePem });
  const p = path.join(out, 'manifest.sig');
  const sig = fs.readFileSync(p);
  sig[10] ^= 0x01;
  fs.writeFileSync(p, sig);
  expectReject(() => verifyBundle({ bundleDir: out, publicKeyPem: keyA.publicPem }), 'signature', 'altered signature');
});

await test('signature format: 63, 65 bytes and base64-text forms are rejected', () => {
  const out = bundleDir();
  const { sig, manifestBytes: bytes } = writeBundle({ srcDir, outDir: out, keyPem: keyA.privatePem });
  const p = path.join(out, 'manifest.sig');
  for (const bad of [sig.subarray(0, 63), Buffer.concat([sig, Buffer.from([0])]), Buffer.from(sig.toString('base64'))]) {
    fs.writeFileSync(p, bad);
    expectReject(() => verifyBundle({ bundleDir: out, publicKeyPem: keyA.publicPem }), null, `sig length/format ${bad.length}`);
  }
  fs.writeFileSync(p, sig);
  // sanity: restored good signature verifies
  verifyBundle({ bundleDir: out, publicKeyPem: keyA.publicPem });
  assert.equal(bytes.length > 0, true);
});

await test('altered package: flipped byte is rejected (sha256)', () => {
  const out = bundleDir();
  writeBundle({ srcDir, outDir: out, keyPem: keyA.privatePem });
  const p = path.join(out, 'package.bin');
  const pkg = fs.readFileSync(p);
  pkg[pkg.length - 20] ^= 0x01; // inside a file's data region
  fs.writeFileSync(p, pkg);
  expectReject(() => verifyBundle({ bundleDir: out, publicKeyPem: keyA.publicPem }), 'sha256', 'altered package');
});

await test('wrong key: valid signature under another key is rejected', () => {
  const out = bundleDir();
  writeBundle({ srcDir, outDir: out, keyPem: keyA.privatePem });
  expectReject(() => verifyBundle({ bundleDir: out, publicKeyPem: keyB.publicPem }), 'signature', 'wrong key');
});

await test('unsafe paths: validator rejects traversal, absolute, reserved, bad chars, trailing dots/spaces', () => {
  const bad = [
    '../evil.txt', 'a/../b', 'a/./b', './a', '/abs.txt', 'C:/x', 'c:\\x',
    'a\\b', 'a//b', 'a/', '', 'x.', 'x ', 'a/x.', 'CON', 'con.txt', 'NUL',
    'COM1', 'com9.log', 'LPT1', 'lpt9.dat', 'a<b', 'a>b', 'a:b', 'a?b',
    'a*b', 'a|b', 'a\x01b', 'a\x7fb', 'CON.txt', 'nul.tar.gz',
  ];
  for (const p of bad) {
    expectReject(() => validateEntryPath(p), null, `validateEntryPath(${JSON.stringify(p)})`);
  }
});

await test('unsafe paths: sensitive names/extensions rejected (provisional list)', () => {
  const bad = ['.env', 'app/.env.local', 'id_rsa', 'id_ed25519.pub', 'secrets.json', 'server.pem', 'tls.key', 'store.p12', '.git/config', 'a/b/.ssh/id_rsa'];
  for (const p of bad) {
    expectReject(() => validateEntryPath(p), null, `validateEntryPath(${JSON.stringify(p)})`);
  }
});

await test('unsafe paths: duplicates and case-collisions rejected', () => {
  expectReject(() => validateFileList(['a.txt', 'a.txt']), 'duplicate', 'duplicate');
  expectReject(() => validateFileList(['A.txt', 'a.txt']), 'case-colliding', 'case collision');
  expectReject(() => validateFileList([]), 'empty package', 'empty list');
});

await test('unsafe paths: hand-crafted container with ../ is rejected by parser', () => {
  const header = Buffer.from(JSON.stringify({ path: '../evil.txt', size: 3 }), 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(header.length);
  const crafted = Buffer.concat([
    Buffer.from('ERPUPDATE1', 'ascii'), lenBuf, header, Buffer.from('bad'), Buffer.alloc(4),
  ]);
  expectReject(() => parseContainer(crafted), 'unsafe path', 'crafted traversal container');
});

await test('container negatives: bad magic, trailing bytes, truncated, empty, non-canonical header', () => {
  const good = buildContainerBuffer(srcDir);
  // bad magic
  const badMagic = Buffer.from(good);
  badMagic[3] ^= 0x01;
  expectReject(() => parseContainer(badMagic), 'bad magic', 'bad magic');
  // trailing bytes
  expectReject(() => parseContainer(Buffer.concat([good, Buffer.from([0])])), 'trailing bytes', 'trailing bytes');
  // truncated
  expectReject(() => parseContainer(good.subarray(0, good.length - 5)), null, 'truncated');
  // empty package (magic + terminator only)
  expectReject(() => parseContainer(Buffer.concat([Buffer.from('ERPUPDATE1', 'ascii'), Buffer.alloc(4)])), 'empty package', 'empty');
  // non-canonical header (pretty JSON with same data)
  const pretty = Buffer.from(JSON.stringify({ path: 'a.txt', size: 3 }, null, 2), 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(pretty.length);
  const nonCanon = Buffer.concat([
    Buffer.from('ERPUPDATE1', 'ascii'), lenBuf, pretty, Buffer.from('abc'), Buffer.alloc(4),
  ]);
  expectReject(() => parseContainer(nonCanon), 'canonical', 'non-canonical header');
  // extra header key
  const extra = Buffer.from(JSON.stringify({ path: 'a.txt', size: 3, z: 1 }), 'utf8');
  const len2 = Buffer.alloc(4);
  len2.writeUInt32BE(extra.length);
  expectReject(
    () => parseContainer(Buffer.concat([Buffer.from('ERPUPDATE1', 'ascii'), len2, extra, Buffer.from('abc'), Buffer.alloc(4)])),
    'exactly the keys', 'extra header key',
  );
});

await test('manifest schema negatives: version, publishedAt, sha256, notes, size, format', () => {
  const base = {
    format: 1, product: 'textile-erp-windows', version: '1.0.1',
    publishedAt: '2026-01-01T00:00:00Z', notes: 'ok',
    size: 123, sha256: 'a'.repeat(64),
  };
  const bads = [
    [{ ...base, version: '1.0' }, 'version'],
    [{ ...base, version: '1.2.3-rc.1' }, 'version'],
    [{ ...base, version: '01.2.3' }, 'version'],
    [{ ...base, version: '1.02.3' }, 'version'],
    [{ ...base, version: '0.0.0' }, '0.0.0'],
    [{ ...base, publishedAt: '2026-1-1T00:00:00Z' }, 'publishedAt'],
    [{ ...base, publishedAt: '2026-01-01T00:00:00+00:00' }, 'publishedAt'],
    [{ ...base, publishedAt: '2026-01-01T00:00:00.000Z' }, 'publishedAt'],
    [{ ...base, publishedAt: '2026-02-30T00:00:00Z' }, 'publishedAt'],
    [{ ...base, sha256: 'A'.repeat(64) }, 'sha256'],
    [{ ...base, sha256: 'z'.repeat(64) }, 'sha256'],
    [{ ...base, notes: 'x'.repeat(10_001) }, 'notes'],
    [{ ...base, size: 0 }, 'size'],
    [{ ...base, size: 1.5 }, 'size'],
    [{ ...base, format: 2 }, 'format'],
  ];
  for (const [m, needle] of bads) {
    expectReject(() => validateManifest(m), needle, `manifest ${JSON.stringify(m.version ?? m.publishedAt ?? m.sha256 ?? needle)}`);
  }
  // boundary: 10,000-char notes is valid; 0.0.1 is valid
  validateManifest({ ...base, notes: 'x'.repeat(10_000) });
  validateManifest({ ...base, version: '0.0.1' });
});

await test('manifest schema: canonical timestamp accepted, byte cap enforced', () => {
  const base = {
    format: 1, product: 'textile-erp-windows', version: '1.0.1',
    publishedAt: '2026-01-01T00:00:00Z', notes: '',
    size: 1, sha256: 'b'.repeat(64),
  };
  validateManifest(base);
  assert.equal(canonicalUtc(new Date('2026-01-01T00:00:00Z')), '2026-01-01T00:00:00Z');
  const out = bundleDir();
  writeBundle({ srcDir, outDir: out, keyPem: keyA.privatePem });
  const p = path.join(out, 'manifest.json');
  const big = Buffer.from(JSON.stringify({ ...JSON.parse(fs.readFileSync(p, 'utf8')), notes: 'x'.repeat(40_000) }), 'utf8');
  fs.writeFileSync(p, big);
  // oversized manifest is rejected before schema/signature
  const keyPath = path.join(TMP_ROOT, 'pub-a.pem'); // public only — safe to write
  fs.writeFileSync(keyPath, keyA.publicPem);
  const rc = (() => {
    try {
      verifyBundle({ bundleDir: out, publicKeyPem: keyA.publicPem });
      return 0;
    } catch (err) {
      return String(err.message).includes('32768') || String(err.message).includes('32 KiB') ? 1 : 2;
    }
  })();
  assert.equal(rc, 1, 'oversized manifest must be rejected by byte cap');
});

await test('signature covers manifest bytes only (not the package)', () => {
  const out = bundleDir();
  const { packageBytes } = writeBundle({ srcDir, outDir: out, keyPem: keyA.privatePem });
  const pub = loadEd25519PublicKey(keyA.publicPem);
  const sig = fs.readFileSync(path.join(out, 'manifest.sig'));
  assert.equal(crypto.verify(null, packageBytes, pub, sig), false);
});

// ----------------------------------------------- reference cross-checks --
function findRefUpdateDir() {
  const root = process.env.ERP_SYSTEM_REF || '/tmp/erp-system-ref';
  const candidates = [
    root,
    path.join(root, 'apps', 'desktop', 'windows', 'update'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'build-package.mjs'))) return c;
  }
  return null;
}

// Pre-stage artifacts for the reference cross-check (kept out of git; temp only)
if (findRefUpdateDir()) {
  const out = path.join(TMP_ROOT, 'ours-bundle');
  fs.mkdirSync(out, { recursive: true });
  const pkgPath = path.join(TMP_ROOT, 'ours-package.bin');
  const packageBytes = buildPackage(srcDir, pkgPath);
  const manifest = makeManifest({
    product: 'textile-erp-windows',
    version: '1.0.1',
    publishedAt: canonicalUtc(new Date('2026-01-01T00:00:00Z')),
    notes: 'Release notes',
    packageBytes,
  });
  const bytes = manifestBytes(manifest);
  fs.writeFileSync(path.join(out, 'manifest.json'), bytes);
  fs.writeFileSync(path.join(out, 'manifest.sig'), signManifestExactBytes(bytes, keyA.privatePem));
  fs.writeFileSync(path.join(out, 'package.bin'), packageBytes);
  fs.writeFileSync(path.join(TMP_ROOT, 'pub-a.pem'), keyA.publicPem);
}

await test('reference cross-checks (source of truth: Sufi-09/erp-system)', () => {
  const refDir = findRefUpdateDir();
  if (!refDir) {
    console.log('      (reference not reachable — set ERP_SYSTEM_REF to an erp-system checkout)');
    return 'SKIP';
  }
  // 1) reference builder on the same fixture -> byte-identical to our builder
  const refOut = path.join(TMP_ROOT, 'ref-package.bin');
  try {
    execFileSync('node', [path.join(refDir, 'build-package.mjs'), srcDir, refOut], { stdio: 'pipe' });
  } catch (err) {
    throw new Error(
      `reference build-package.mjs did not accept CLI "<src> <out>" — adapt run-interop-tests.mjs once ` +
      `the reference is readable. stderr: ${String(err.stderr ?? err.message).slice(0, 300)}`,
    );
  }
  const ours = fs.readFileSync(path.join(TMP_ROOT, 'ours-package.bin'));
  const theirs = fs.readFileSync(refOut);
  assert.ok(ours.equals(theirs), 'reference builder produced different bytes (sort/encoding parity gap)');

  // 2) reference verify/verify-candidate/extract accept our bundle
  for (const [script, argv] of [
    ['verify.mjs', [path.join(TMP_ROOT, 'ours-bundle', 'manifest.json'), path.join(TMP_ROOT, 'ours-bundle', 'manifest.sig'), path.join(TMP_ROOT, 'ours-bundle', 'package.bin'), path.join(TMP_ROOT, 'pub-a.pem')]],
    ['verify-candidate.mjs', [path.join(TMP_ROOT, 'ours-bundle'), path.join(TMP_ROOT, 'pub-a.pem')]],
    ['extract.mjs', [path.join(TMP_ROOT, 'ours-bundle', 'package.bin'), path.join(TMP_ROOT, 'ref-extract')]],
  ]) {
    try {
      execFileSync('node', [path.join(refDir, script), ...argv], { stdio: 'pipe' });
    } catch (err) {
      throw new Error(
        `reference ${script} rejected our output or needs a CLI adapter: ` +
        `${String(err.stderr ?? err.message).slice(0, 300)}`,
      );
    }
  }
});

// ------------------------------------------------------------------ report --
const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.skipped).length;
console.log(`\n${results.length - failed.length}/${results.length} checks passed${skipped ? ` (${skipped} skipped)` : ''}`);
fs.rmSync(TMP_ROOT, { recursive: true, force: true }); // wipes ephemeral keys
process.exit(failed.length === 0 ? 0 : 1);
