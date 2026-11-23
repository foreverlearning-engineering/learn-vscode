// What VS Code caches for the Learn server, read from a real profile. IT OPENS A WINDOW for about
// 15 seconds, so it runs only with the owner's OK.
//
//   node scripts/cache-check.mjs --code <path to Code.exe> [--vsix learn-api-<version>.vsix]
//
// It installs the .vsix into a fresh, isolated profile (no window), opens VS Code on an empty
// folder normally (no test runner, so VS Code keeps real storage), waits for the extension to
// register its server, and closes the window the way its X button does, so VS Code writes its
// storage. Then it reads `mcp.extCachedServers` from the workspace's state.vscdb, and checks that
// the cached definition's environment holds only ELECTRON_RUN_AS_NODE and the handoff address and
// token. With a key in this script's environment (as the staging key wrappers set it; never
// typed), it also checks that the key is in none of the profile's files, in UTF-8 or UTF-16.
// The key is never printed.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };
const code = arg('code') ?? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe');
const vsix = arg('vsix') ?? join(root, manifest.name + '-' + manifest.version + '.vsix');
for (const f of [code, vsix]) if (!existsSync(f)) throw new Error('not found: ' + f);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const key = (process.env.FOREVERLEARNING_API_KEY || process.env.LEARN_API_KEY || '').trim();
const keyBase = (process.env.FOREVERLEARNING_BASE_URL || process.env.LEARN_API_BASE || '').trim();
const hide = (text) => String(text).split(key || '\u0000').join('<redacted-key>').replace(/fl_(live|stag|test)_\w+/gi, 'fl_$1_<hidden>');
let failures = 0;
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) failures += 1; };

// The CLI script of this copy of VS Code (<install>/<commit>/resources/app/out/cli.js).
const install = dirname(code);
const cli = readdirSync(install).map((d) => join(install, d, 'resources', 'app', 'out', 'cli.js')).find(existsSync);
if (!cli) throw new Error('no cli.js under ' + install);

const base = mkdtempSync(join(tmpdir(), 'learn-cache-'));
const data = join(base, 'data');
const extensions = join(base, 'extensions');
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
console.log('cache-check: profile ' + base + '; ' + (key ? 'a key is in the window\'s environment (not shown)' : 'no key in the environment'));
console.log('cache-check: installing ' + vsix.split(/[\\/]/).pop() + ' (sha256 ' + createHash('sha256').update(readFileSync(vsix)).digest('hex') + ')');

// 1. Install into the isolated profile: the CLI, in Node mode, opens no window.
const installed = spawnSync(code, [cli, '--install-extension', vsix, '--extensions-dir', extensions, '--user-data-dir', data],
  { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LEARN_API_KEY: '', FOREVERLEARNING_API_KEY: '' }, windowsHide: true, encoding: 'utf8' });
check(installed.status === 0 && /successfully installed/.test(installed.stdout), 'installed into the isolated profile');

// 2. A normal window.
const env = { ...process.env };
for (const name of ['ELECTRON_RUN_AS_NODE', 'LEARN_API_KEY', 'LEARN_API_BASE', 'FOREVERLEARNING_API_KEY', 'FOREVERLEARNING_BASE_URL']) delete env[name];
if (key) {
  env.FOREVERLEARNING_API_KEY = key;
  if (keyBase) env.FOREVERLEARNING_BASE_URL = keyBase;
}
const started = Date.now();
const child = spawn(code, ['--user-data-dir', data, '--extensions-dir', extensions, '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--new-window', work],
  { env, stdio: 'ignore' });
const exited = new Promise((resolve) => child.on('exit', resolve));

// Wait for the extension to say it registered its server (its own log), up to 30 s, then 3 s more.
const logs = join(data, 'logs');
const findFiles = (dir, test, out = []) => { if (existsSync(dir)) for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) findFiles(p, test, out); else if (test(p)) out.push(p); } return out; };
let registered = false;
for (let i = 0; i < 60 && !registered; i++) {
  await sleep(500);
  registered = findFiles(logs, (p) => p.endsWith('Learn API.log') && p.includes('exthost')).some((p) => readFileSync(p, 'utf8').includes('Learn server registered (vscode)'));
}
check(registered, 'the extension activated and registered the Learn server (' + ((Date.now() - started) / 1000).toFixed(0) + ' s)');
await sleep(3000);

// 3. Close the window as its X button does, so VS Code shuts down normally and writes its storage.
const close = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process -Id ' + child.pid + ').CloseMainWindow()'], { windowsHide: true, encoding: 'utf8' });
const closedNormally = await Promise.race([exited.then(() => true), sleep(30_000).then(() => false)]);
if (!closedNormally) child.kill();
check(closedNormally && /True/.test(close.stdout), 'the window closed normally (open ' + ((Date.now() - started) / 1000).toFixed(0) + ' s)');

// 4. What VS Code cached for the server.
let found = 0;
for (const file of findFiles(join(data, 'User', 'workspaceStorage'), (p) => p.endsWith('state.vscdb'))) {
  const db = new DatabaseSync(file, { readOnly: true });
  const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'mcp.extCachedServers'").get();
  db.close();
  if (!row) continue;
  const value = String(row.value);
  for (const [id, entry] of Object.entries(JSON.parse(value))) {
    if (!id.includes('foreverlearning.learn-api')) continue;
    for (const server of entry.servers) {
      found += 1;
      const launch = server.launch ?? {};
      const envKeys = Object.keys(launch.env ?? {}).sort();
      console.log('cached: collection ' + id + ', server "' + server.label + '", cacheNonce ' + server.cacheNonce + ', command ' + launch.command
        + ', args ' + JSON.stringify(launch.args) + ', cwd ' + (launch.cwd ?? 'none') + ', env keys ' + envKeys.join(', '));
      check(JSON.stringify(envKeys) === JSON.stringify(['ELECTRON_RUN_AS_NODE', 'LEARN_VSCODE_HANDOFF', 'LEARN_VSCODE_TOKEN']), 'the cached environment holds only ELECTRON_RUN_AS_NODE and the handoff address and token');
      check(launch.env?.ELECTRON_RUN_AS_NODE === '1' && /^\\\\\.\\pipe\\learn-vscode-[0-9a-f]+$|learn-vscode-[0-9a-f]+\.sock$/.test(launch.env?.LEARN_VSCODE_HANDOFF ?? '') && /^[0-9a-f]{64}$/.test(launch.env?.LEARN_VSCODE_TOKEN ?? ''), 'their values are "1", a handoff pipe and a 64-hex token');
      const text = JSON.stringify(server);
      check(!/FOREVERLEARNING_API_KEY|fl_(live|stag|test)_[0-9a-f]{16,}/i.test(text) && !(key && text.includes(key)), 'the cached definition holds no key');
    }
  }
  console.log('cache-check: ' + hide(value).length + ' characters cached under mcp.extCachedServers in ' + file.slice(base.length));
}
check(found === 1, 'VS Code cached the Learn server definition (' + found + ' found)');

// 5. The key, in none of the profile's files.
if (key) {
  const files = findFiles(base, () => true);
  const forms = [Buffer.from(key, 'utf8'), Buffer.from(key, 'utf16le')];
  const hits = files.filter((f) => { const b = readFileSync(f); return forms.some((k) => b.includes(k)); });
  check(hits.length === 0, 'the key is in none of the profile\'s ' + files.length + ' files (UTF-8 and UTF-16)' + (hits.length ? ': ' + hits.map((f) => f.slice(base.length)).join(', ') : ''));
}

// 6. Nothing left running from this profile.
const left = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "(Get-CimInstance Win32_Process -Filter \"Name = 'Code.exe'\" | Where-Object { $_.CommandLine -like '*" + base.replace(/'/g, "''") + "*' }).Count"], { windowsHide: true, encoding: 'utf8' });
check(left.stdout.trim() === '0', 'no VS Code process of this profile is left running');

console.log('cache-check: ' + (failures ? failures + ' failed' : 'all passed') + '. Profile kept for the record: ' + base);
process.exitCode = failures ? 1 : 0;
