// The public copy rules, on every text the extension ships: the listing, the changelog, the
// manifest's words, and the messages the extension shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const manifest = JSON.parse(read('package.json'));

// The string literals in a source file (the messages it can show).
const literals = (source: string) => [...source.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]).join('\n');

const texts: Record<string, string> = {
  'README.md': read('README.md'),
  'CHANGELOG.md': read('CHANGELOG.md'),
  'package.json': JSON.stringify(manifest),
  'src/activate.ts messages': literals(read('src/activate.ts')),
  'src/settings.ts messages': literals(read('src/settings.ts')),
  'src/keyInput.ts messages': literals(read('src/keyInput.ts')),
  'src/server/main.ts messages': literals(read('src/server/main.ts')),
};

test('no em dashes in our own copy', () => {
  for (const [name, text] of Object.entries(texts)) assert.ok(!text.includes('—'), name);
});

test('the Learn API by its name; no retired product names', () => {
  for (const [name, text] of Object.entries(texts)) {
    assert.ok(!/\bQuest\b/.test(text), name + ': never "Quest"');
    assert.ok(!/TutorPrep|MathBridge/i.test(text), name);
  }
});

test('the price as the public copy says it', () => {
  for (const [name, text] of Object.entries(texts)) {
    assert.ok(!/five cents a turn|5¢ (a|per) turn(?! that succeeds)/i.test(text), name);
  }
  assert.match(texts['README.md'], /5¢ per turn that succeeds/);
  assert.match(texts['README.md'], /20 free test attempts/);
});

test('the manifest is what the Marketplace needs', () => {
  assert.equal(manifest.publisher, 'foreverlearning');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.icon, 'media/icon.png');
  assert.equal(manifest.main, './dist/extension.cjs');
  assert.equal(manifest.engines.vscode, '^1.101.0', 'the first release with the MCP server API');
  assert.equal(manifest.devDependencies['@types/vscode'], '1.101.0', 'typed against the oldest release it accepts');
  for (const word of ['AI tutor', 'education', 'edtech', 'tutoring', 'MCP', 'learning']) assert.ok(manifest.keywords.includes(word), word);
  assert.ok(manifest.keywords.length <= 30);
  assert.deepEqual(manifest.dependencies ?? {}, {}, 'everything is bundled');
  for (const c of manifest.contributes.commands) assert.equal(c.category, 'Learn');
});

test('the icon is a 256 by 256 PNG', () => {
  const png = readFileSync(join(root, 'media', 'icon.png'));
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
});
