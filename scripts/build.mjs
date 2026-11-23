// Builds what the extension ships, into dist/:
//   dist/extension.cjs              the extension (CommonJS, loaded by the editor; vscode is external)
//   dist/server/learn-mcp.mjs       the Learn MCP server, bundled whole with its dependencies
//   dist/snapshot/learn-docs.json   the server's dated docs snapshot, where the bundle looks for it
//   dist/THIRD_PARTY_NOTICES.txt    the licenses of everything bundled
// No source maps and no minification: what ships is readable.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const fail = (message) => {
  console.error('build: ' + message);
  process.exit(1);
};

// The vendored server package must be the one recorded (until it is published on npm).
const source = join(root, 'vendor', 'learn-mcp.source.json');
if (existsSync(source)) {
  const record = JSON.parse(readFileSync(source, 'utf8'));
  const sha = createHash('sha256').update(readFileSync(join(root, 'vendor', record.file))).digest('hex');
  if (sha !== record.sha256) fail('vendor/' + record.file + ' does not match vendor/learn-mcp.source.json');
}
const serverPackage = JSON.parse(readFileSync(join(root, 'node_modules', '@foreverlearning', 'learn-mcp', 'package.json'), 'utf8'));

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = { bundle: true, platform: 'node', target: 'node22', sourcemap: false, minify: false, legalComments: 'none', metafile: true, logLevel: 'warning', absWorkingDir: root };

const extension = await build({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  format: 'cjs',
  external: ['vscode'],
});

const server = await build({
  ...common,
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server/learn-mcp.mjs',
  format: 'esm',
  define: { __LEARN_MCP_VERSION__: JSON.stringify(serverPackage.version) },
  // Bundled CommonJS code may require Node's built-in modules.
  banner: { js: "import { createRequire as __learnCreateRequire } from 'node:module';\nconst require = __learnCreateRequire(import.meta.url);" },
});

// learn-mcp finds its snapshot at ../snapshot/learn-docs.json from its own file.
mkdirSync(join(dist, 'snapshot'), { recursive: true });
cpSync(join(root, 'node_modules', '@foreverlearning', 'learn-mcp', 'snapshot', 'learn-docs.json'), join(dist, 'snapshot', 'learn-docs.json'));

// Licenses of every package bundled into either file.
const packages = new Map();
for (const input of [...Object.keys(extension.metafile.inputs), ...Object.keys(server.metafile.inputs)]) {
  const parts = input.split(/[\\/]/);
  const at = parts.lastIndexOf('node_modules');
  if (at < 0) continue;
  const depth = parts[at + 1].startsWith('@') ? 3 : 2;
  const dir = join(root, ...parts.slice(0, at + depth));
  if (packages.has(dir)) continue;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const licenseFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'].map((f) => join(dir, f)).find(existsSync);
  packages.set(dir, { name: pkg.name, version: pkg.version, license: pkg.license ?? 'see package', text: licenseFile ? readFileSync(licenseFile, 'utf8').trim() : '' });
}
const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
const missing = sorted.filter((p) => !p.text).map((p) => p.name);
if (missing.length) fail('no license text found for ' + missing.join(', '));
writeFileSync(join(dist, 'THIRD_PARTY_NOTICES.txt'),
  'The Learn API extension bundles the following packages.\n\n'
  + sorted.map((p) => '='.repeat(72) + '\n' + p.name + ' ' + p.version + ' (' + p.license + ')\n' + '='.repeat(72) + '\n\n' + p.text + '\n').join('\n'));

const size = (file) => (readFileSync(join(root, file)).length / 1024).toFixed(0) + ' KB';
console.log('build: dist/extension.cjs ' + size('dist/extension.cjs') + ', dist/server/learn-mcp.mjs ' + size('dist/server/learn-mcp.mjs')
  + ' (learn-mcp ' + serverPackage.version + '), snapshot ' + size('dist/snapshot/learn-docs.json') + ', notices for ' + sorted.length + ' packages: '
  + sorted.map((p) => p.name).join(', '));
