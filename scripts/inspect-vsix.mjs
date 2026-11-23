// Inspects a packaged .vsix before anyone sees it:
// - the files that must be there are there (the extension, the bundled server, its docs snapshot,
//   the icon, the listing, the licenses), and nothing else;
// - no .env file, source, test, vendored tarball or source map;
// - no text that looks like a Learn server key, and no path from the machine that built it.
// It reads the .vsix (a zip) itself, with no other tool.
// Usage: node scripts/inspect-vsix.mjs [file.vsix]   (default: <name>-<version>.vsix)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const vsix = process.argv[2] ?? join(root, manifest.name + '-' + manifest.version + '.vsix');
const zip = readFileSync(vsix);

// The zip's central directory lists every entry; each entry's data follows its local header.
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString('utf8').split('\\').join('/');
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + compressed);
    if (!name.endsWith('/')) {
      if (method === 0) entries.set(name, Buffer.from(raw));
      else if (method === 8) entries.set(name, inflateRawSync(raw));
      else throw new Error('unsupported compression in ' + name);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const entries = readZip(zip);
const files = [...entries.keys()].sort();
const problems = [];

const required = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/package.json',
  'extension/readme.md',
  'extension/changelog.md',
  'extension/LICENSE.txt',
  'extension/media/icon.png',
  'extension/dist/extension.cjs',
  'extension/dist/server/learn-mcp.mjs',
  'extension/dist/snapshot/learn-docs.json',
  'extension/dist/THIRD_PARTY_NOTICES.txt',
];
const isRequired = (f) => required.some((r) => r.toLowerCase() === f.toLowerCase());
for (const r of required) if (!files.some((f) => f.toLowerCase() === r.toLowerCase())) problems.push('missing: ' + r);
for (const f of files) {
  if (!isRequired(f)) problems.push('unexpected file: ' + f);
  if (/(^|\/)\.env/i.test(f)) problems.push('.env file: ' + f);
  if (/(^|\/)(src|test|vendor|node_modules)\//.test(f) || /\.(map|ts|tgz|vsix)$/.test(f)) problems.push('should not ship: ' + f);
}

// Text that must never ship.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anySlash = (path) => escape(path).replace(/\\\\/g, '[\\\\/]+');
// Key hits are reported without context, so no part of a key is ever printed.
const keyLike = [
  [/fl_(?:live|stag|test)_[0-9a-f]{16,}/i, 'a Learn server key'],
  [/FOREVERLEARNING_API_KEY\s*[=:]\s*["']?[A-Za-z0-9_]{12,}/, 'a key assigned in text'],
];
const forbidden = [
  [new RegExp(anySlash(homedir()), 'i'), "this computer's home folder"],
  [new RegExp(anySlash(root), 'i'), "this repository's path"],
  [/[A-Za-z]:[\\/]+(?:dev|Users)[\\/]/i, 'a Windows local path'],
  [/foreverlearning-(?:development|crm)|Outreach-Tracking|_codex_worktrees/i, 'a local folder name'],
  [new RegExp('[\\\\/]' + escape(userInfo().username) + '[\\\\/]', 'i'), "this computer's user name in a path"],
];
for (const f of files) {
  if (f.endsWith('.png')) continue;
  const text = entries.get(f).toString('utf8');
  for (const [pattern, what] of keyLike) if (pattern.test(text)) problems.push('found ' + what + ' in ' + f);
  const safe = text.replace(/fl_(live|stag|test)_\w+/gi, 'fl_$1_<hidden>').replace(/(FOREVERLEARNING_API_KEY\s*[=:]\s*["']?)\w+/g, '$1<hidden>');
  for (const [pattern, what] of forbidden) {
    const m = pattern.exec(safe);
    if (m) problems.push('found ' + what + ' in ' + f + ' (near: ' + safe.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ') + ')');
  }
}

// The shipped package.json runs nothing on install.
const shippedFile = entries.get('extension/package.json');
const shipped = shippedFile ? JSON.parse(shippedFile.toString('utf8').replace(/^﻿/, '')) : {};
for (const hook of ['preinstall', 'install', 'postinstall']) if (shipped.scripts?.[hook]) problems.push('a ' + hook + ' script in the shipped package.json');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
console.log('inspect: ' + basename(vsix) + ' (' + (zip.length / 1024).toFixed(0) + ' KB, sha256 ' + sha(zip) + ')');
for (const f of files) console.log('  ' + f.padEnd(44) + String(entries.get(f).length).padStart(9) + ' bytes');
const server = entries.get('extension/dist/server/learn-mcp.mjs');
if (server) console.log('  bundled server sha256 ' + sha(server));
const snapshot = entries.get('extension/dist/snapshot/learn-docs.json');
if (snapshot) console.log('  docs snapshot taken ' + JSON.parse(snapshot.toString('utf8')).taken_at);
if (problems.length) {
  console.error('inspect: ' + problems.length + ' problem' + (problems.length === 1 ? '' : 's') + ':\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('inspect: every required file present, nothing else; no .env, key or local path.');
