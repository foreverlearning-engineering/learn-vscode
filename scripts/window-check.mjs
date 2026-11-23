// The end-to-end check in a real VS Code window. IT OPENS A WINDOW for about half a minute, so it
// runs only with the owner's OK. Nothing else in this repository opens one.
//
//   node scripts/window-check.mjs [--code <path to Code.exe>]
//
// It starts VS Code with a fresh, isolated profile (its own user data and extensions folders in
// the temp folder), this repository as the extension under development, and
// test/window/extension-test.cjs as the test. That test starts the Learn server through VS Code's
// own MCP client and invokes learn_kits and a no-confirm learn_test_turn. VS Code closes itself.
// Then this script reads the profile's storage to show what VS Code cached for the server: the
// handoff address and token, and no key.
//
// With a key in this script's environment (FOREVERLEARNING_API_KEY and FOREVERLEARNING_BASE_URL, or
// LEARN_API_KEY and LEARN_API_BASE as the staging key wrappers set them; unsealed into one process,
// never typed), VS Code gets it as FOREVERLEARNING_API_KEY, the server uses it ("own setup"), and the
// no-confirm learn_test_turn makes only the free catalog read. No turn is ever sent:
//   & 'C:\dev\foreverlearning-crm\Terry\Tools\run-with-learn-staging-kits-key.ps1' node scripts/window-check.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = process.argv.indexOf('--code');
const code = at > 0 ? process.argv[at + 1] : join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe');
if (!existsSync(code)) throw new Error('VS Code not found at ' + code);
if (!existsSync(join(root, 'dist', 'extension.cjs'))) throw new Error('Build first: npm run build');

const key = (process.env.FOREVERLEARNING_API_KEY || process.env.LEARN_API_KEY || '').trim();
const keyBase = (process.env.FOREVERLEARNING_BASE_URL || process.env.LEARN_API_BASE || '').trim();
const hide = (text) => (key ? String(text).split(key).join('<redacted-key>') : String(text));

const base = mkdtempSync(join(tmpdir(), 'learn-window-'));
const data = join(base, 'data');
const work = join(base, 'work');
mkdirSync(join(data, 'User'), { recursive: true });
mkdirSync(work, { recursive: true });
writeFileSync(join(data, 'User', 'settings.json'), JSON.stringify({
  'learn.apiBaseUrl': keyBase.includes('staging') ? 'https://developers-api-staging.foreverlearning.ai/v1' : 'https://developers-api.foreverlearning.ai/v1',
  'workbench.startupEditor': 'none',
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'security.workspace.trust.enabled': false,
}, null, 2));
const results = join(base, 'results.json');

const env = { ...process.env, LEARN_WINDOW_RESULTS: results };
delete env.ELECTRON_RUN_AS_NODE;
delete env.LEARN_API_KEY;
delete env.LEARN_API_BASE;
delete env.FOREVERLEARNING_API_KEY;
delete env.FOREVERLEARNING_BASE_URL;
if (key) {
  env.FOREVERLEARNING_API_KEY = key;
  if (keyBase) env.FOREVERLEARNING_BASE_URL = keyBase;
}
console.log('window-check: ' + (key ? 'a key is in the window\'s environment (not shown); the server makes only the free catalog read' : 'no key: the server serves the docs only'));
const started = Date.now();
const child = spawn(code, [
  '--user-data-dir', data,
  '--extensions-dir', join(base, 'extensions'),
  '--extensionDevelopmentPath=' + root,
  '--extensionTestsPath=' + join(root, 'test', 'window', 'extension-test.cjs'),
  '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--new-window',
  work,
], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
const timer = setTimeout(() => child.kill(), 180_000);
const exitCode = await new Promise((resolve) => child.on('exit', resolve));
clearTimeout(timer);

console.log('window-check: VS Code ran ' + ((Date.now() - started) / 1000).toFixed(0) + ' s and exited with ' + exitCode + '. Profile: ' + base);
if (!existsSync(results)) {
  console.log(hide(log.slice(-4000)));
  throw new Error('the test inside VS Code wrote no results');
}
const r = JSON.parse(readFileSync(results, 'utf8'));
console.log('VS Code ' + r.vscode);
for (const s of r.steps) console.log((s.ok ? 'PASS ' : 'FAIL ') + s.name + (s.detail ? '\n     ' + hide(s.detail).replace(/\n/g, '\n     ') : ''));

// What VS Code cached for the server, in the workspace's storage.
const storage = join(data, 'User', 'workspaceStorage');
let cached = 0;
for (const dir of existsSync(storage) ? readdirSync(storage) : []) {
  const file = join(storage, dir, 'state.vscdb');
  if (!existsSync(file)) continue;
  const db = new DatabaseSync(file, { readOnly: true });
  const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'mcp.extCachedServers'").get();
  db.close();
  if (!row) continue;
  const value = String(row.value);
  const ours = Object.entries(JSON.parse(value)).filter(([id]) => id.includes('foreverlearning.learn-api'));
  for (const [id, entry] of ours) {
    for (const server of entry.servers) {
      cached += 1;
      const envKeys = Object.keys(server.launch.env ?? {}).sort();
      console.log('cached definition ' + id + ' / ' + server.label + ': command ' + server.launch.command + ', env keys ' + envKeys.join(', '));
      const text = JSON.stringify(server);
      console.log((!/FOREVERLEARNING_API_KEY|fl_(live|stag|test)_[0-9a-f]{16,}/i.test(text) && !(key && text.includes(key)) ? 'PASS ' : 'FAIL ') + 'the cached definition holds no key');
    }
  }
}
if (!cached) console.log('note: no cached definition to read. VS Code keeps all storage in memory during extension tests ("no storage during extension tests!", storageMainService.ts), so this needs a normal window.');

// The server's own log in VS Code (its stderr and VS Code's notes on starting it), key-shaped text hidden.
const logs = join(data, 'logs');
const serverLogs = [];
const findLogs = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) findLogs(p); else if (/^mcpServer\..*learn-api/i.test(e.name)) serverLogs.push(p); } };
if (existsSync(logs)) findLogs(logs);
for (const file of serverLogs) {
  const lines = hide(readFileSync(file, 'utf8')).replace(/fl_(live|stag|test)_\w+/gi, '<key>').trim().split(/\r?\n/).filter(Boolean);
  console.log('server log (' + lines.length + ' lines), last lines:\n     ' + (lines.slice(-12).join('\n     ') || '(empty)'));
}

// The key, if one was in this environment, appears in no file of the profile.
if (key) {
  const files = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) (e.isDirectory() ? walk : (f) => files.push(f))(join(dir, e.name)); };
  walk(base);
  const found = files.filter((f) => readFileSync(f).includes(key));
  console.log((found.length ? 'FAIL ' : 'PASS ') + 'the key is in none of the profile\'s ' + files.length + ' files' + (found.length ? ': ' + found.join(', ') : ''));
}
