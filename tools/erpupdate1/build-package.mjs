#!/usr/bin/env node
/**
 * ERPUPDATE1 container builder — EXPERIMENTAL draft/test tooling.
 * NOT production-ready. Does not touch the GPG signing chain.
 *
 * Format (source of truth: Sufi-09/erp-system, apps/desktop/windows/update/):
 *   - ASCII magic "ERPUPDATE1"
 *   - for each regular file (deterministic recursive sorted order):
 *       uint32 BE header length, then that many UTF-8 bytes of compact
 *       JSON.stringify({path, size}) — exactly the keys path and size —
 *       then exactly `size` raw file bytes
 *   - uint32 BE zero terminator; NO trailing bytes
 *
 * Constraints enforced here:
 *   - relative paths, "/" separators, Windows-safe per extractor rules
 *   - no links / special files / duplicates / case-collisions / empty package
 *   - <= 50,000 files, <= 4,096 bytes per entry header, <= 2 GiB package
 *   - deterministic recursive sorting: entries at each directory level are
 *     sorted by name (UTF-16 code-unit order) before recursing
 *   - sensitive paths/extensions rejected (provisional list — confirm
 *     against build-package.mjs in erp-system when accessible)
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const MAGIC = Buffer.from('ERPUPDATE1', 'ascii');
export const MAX_FILES = 50_000;
export const MAX_HEADER_BYTES = 4_096;
export const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

const RESERVED_SEG = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const INVALID_CHARS = /[<>:"|?*\x00-\x1f\x7f]/;
const SENSITIVE_DIRS = new Set(['.git', '.svn', '.hg', '.ssh', '.aws', '.gnupg']);
const SENSITIVE_FILE_RE =
  /^\.env($|\.)|^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$|^credentials$|^\.netrc$|^\.npmrc$|^\.pgpass$|^secrets?\.(json|ya?ml|toml|ini)$/i;
const SENSITIVE_EXT = new Set([
  '.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.kdbx', '.ppk',
  '.der', '.gpg', '.asc', '.env',
]);

/** Validate one entry path against Windows-safe + sensitive rules. Throws on violation. */
export function validateEntryPath(p) {
  const fail = (m) => { throw new Error(`unsafe path ${JSON.stringify(p)}: ${m}`); };
  if (typeof p !== 'string' || p.length === 0) fail('empty path');
  if (Buffer.byteLength(p, 'utf8') > MAX_HEADER_BYTES) fail('path too long');
  if (p.includes('\\')) fail('backslash not allowed');
  if (p.startsWith('/')) fail('must be relative');
  if (p.endsWith('/')) fail('must name a file');
  if (INVALID_CHARS.test(p)) fail('invalid character');
  const segments = p.split('/');
  for (const seg of segments) {
    if (seg === '') fail('empty path segment');
    if (seg === '.' || seg === '..') fail('dot segment');
    if (seg.endsWith(' ') || seg.endsWith('.')) fail('segment ends with space or dot');
    if (Buffer.byteLength(seg, 'utf8') > 255) fail('path segment too long');
    const base = seg.split('.')[0];
    if (RESERVED_SEG.test(base)) fail('windows reserved device name');
    if (SENSITIVE_DIRS.has(seg.toLowerCase())) fail('sensitive directory');
  }
  const fileName = segments[segments.length - 1];
  if (SENSITIVE_FILE_RE.test(fileName)) fail('sensitive file name');
  const ext = path.posix.extname(fileName).toLowerCase();
  if (SENSITIVE_EXT.has(ext)) fail('sensitive extension');
}

/** Validate a full file list: safety, duplicates, case-collisions, count. Throws on violation. */
export function validateFileList(paths) {
  if (paths.length === 0) throw new Error('empty package: no files');
  if (paths.length > MAX_FILES) throw new Error(`too many files: ${paths.length} > ${MAX_FILES}`);
  const seen = new Set();
  const lower = new Map();
  for (const p of paths) {
    validateEntryPath(p);
    if (seen.has(p)) throw new Error(`duplicate path: ${JSON.stringify(p)}`);
    seen.add(p);
    const l = p.toLowerCase();
    if (lower.has(l)) {
      throw new Error(`case-colliding paths: ${JSON.stringify(lower.get(l))} vs ${JSON.stringify(p)}`);
    }
    lower.set(l, p);
  }
}

/** Deterministic recursive walk: entries sorted by name (code units) at each level. */
export function collectFiles(rootDir) {
  const out = [];
  const walk = (relDir) => {
    const absDir = relDir ? path.join(rootDir, ...relDir.split('/')) : rootDir;
    const entries = fs
      .readdirSync(absDir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isSymbolicLink()) throw new Error(`links are not allowed: ${JSON.stringify(rel)}`);
      if (e.isDirectory()) walk(rel);
      else if (e.isFile()) out.push(rel);
      else throw new Error(`special files are not allowed: ${JSON.stringify(rel)}`);
    }
  };
  walk('');
  return out;
}

/** Build the ERPUPDATE1 container bytes from a source directory. */
export function buildContainerBuffer(rootDir) {
  const files = collectFiles(rootDir);
  validateFileList(files);
  const chunks = [MAGIC];
  let total = MAGIC.length;
  for (const rel of files) {
    const abs = path.join(rootDir, ...rel.split('/'));
    const data = fs.readFileSync(abs);
    const header = Buffer.from(JSON.stringify({ path: rel, size: data.length }), 'utf8');
    if (header.length > MAX_HEADER_BYTES) throw new Error(`entry header too large: ${JSON.stringify(rel)}`);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(header.length);
    chunks.push(lenBuf, header, data);
    total += 4 + header.length + data.length;
    if (total + 4 > MAX_PACKAGE_BYTES) throw new Error('package exceeds 2 GiB limit');
  }
  const terminator = Buffer.alloc(4);
  chunks.push(terminator);
  total += 4;
  if (total > MAX_PACKAGE_BYTES) throw new Error('package exceeds 2 GiB limit');
  return Buffer.concat(chunks);
}

/** Build and write package.bin. Returns the container buffer. */
export function buildPackage(rootDir, outFile) {
  const buf = buildContainerBuffer(rootDir);
  fs.writeFileSync(outFile, buf);
  return buf;
}

/**
 * Parse and fully validate an ERPUPDATE1 container.
 * Enforces: magic, canonical compact {path,size} headers, exact byte counts,
 * terminator with no trailing bytes, path safety, duplicates, limits.
 * Returns [{path, size, dataStart}] with offsets into `buf`.
 */
export function parseContainer(buf) {
  const fail = (m) => { throw new Error(`container: ${m}`); };
  if (buf.length < MAGIC.length + 4) fail('too short');
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) fail('bad magic');
  let off = MAGIC.length;
  const entries = [];
  const paths = [];
  for (;;) {
    if (off + 4 > buf.length) fail('truncated header length');
    const hlen = buf.readUInt32BE(off);
    off += 4;
    if (hlen === 0) break; // terminator
    if (hlen > MAX_HEADER_BYTES) fail('entry header too large');
    if (off + hlen > buf.length) fail('truncated entry header');
    const headerBytes = buf.subarray(off, off + hlen);
    off += hlen;
    let header;
    try {
      header = JSON.parse(headerBytes.toString('utf8'));
    } catch {
      fail('entry header is not valid JSON');
    }
    if (header === null || typeof header !== 'object' || Array.isArray(header)) fail('entry header is not an object');
    const keys = Object.keys(header);
    if (keys.length !== 2 || !('path' in header) || !('size' in header)) {
      fail('entry header must have exactly the keys path and size');
    }
    if (typeof header.path !== 'string' || !Number.isInteger(header.size) || header.size < 0) {
      fail('entry header has invalid path/size values');
    }
    const canonical = Buffer.from(JSON.stringify({ path: header.path, size: header.size }), 'utf8');
    if (!canonical.equals(headerBytes)) fail('entry header is not compact canonical JSON.stringify({path, size})');
    if (off + header.size > buf.length) fail(`truncated file bytes for ${JSON.stringify(header.path)}`);
    entries.push({ path: header.path, size: header.size, dataStart: off });
    paths.push(header.path);
    off += header.size;
    if (entries.length > MAX_FILES) fail('too many files');
  }
  if (off !== buf.length) fail('trailing bytes after terminator');
  if (entries.length === 0) fail('empty package');
  validateFileList(paths);
  return entries;
}

// ---------------------------------------------------------------------------
// CLI: node build-package.mjs <src-dir> <out-package.bin>
// ---------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [srcDir, outFile] = process.argv.slice(2);
  if (!srcDir || !outFile) {
    console.error('Usage: node build-package.mjs <src-dir> <out-package.bin>');
    process.exit(2);
  }
  try {
    const buf = buildPackage(srcDir, outFile);
    console.log(`Wrote ${outFile} (${buf.length} bytes)`);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
