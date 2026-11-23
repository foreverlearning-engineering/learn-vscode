// The extension's activation against a fake editor API: what it registers, what its commands do,
// and that the key goes only to SecretStorage and the handoff.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activateWith, type Activated } from '../src/activate.ts';
import { fakes, type FakeDefinition } from './fake-vscode.ts';
import { connectHandoff } from '../src/server/handoffClient.ts';
import { firstTutorKit, type SnapshotKits } from '../src/prompts.ts';
import type { HandoffConfig } from '../src/protocol.ts';
import { CONSOLE_URL, NOTICE_SHOWN, PRODUCTION_BASE_URL, PROVIDER_ID, QUICK_START_URL, SECRET_NAME, STAGING_BASE_URL } from '../src/constants.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const KEY = 'fl_test_' + 'a1b2c3d4'.repeat(8);
const opts = { extensionPath: root, version: manifest.version };

const running: { dispose(): unknown }[][] = [];
async function activate(f: ReturnType<typeof fakes>): Promise<Activated> {
  const a = await activateWith(f.api, f.context, f.deps);
  running.push(f.context.subscriptions);
  return a;
}
afterEach(async () => {
  for (const subs of running.splice(0)) for (const s of subs) await s.dispose();
});

// A stand-in for the running server: connects with the definition's address and token.
async function server(a: Activated) {
  const configs: HandoffConfig[] = [];
  const ok = await connectHandoff(a.launch.env.LEARN_VSCODE_HANDOFF, a.launch.env.LEARN_VSCODE_TOKEN, (c) => configs.push(c));
  assert.equal(ok, true);
  return configs;
}
const settle = () => new Promise((r) => setTimeout(r, 120));

test('registers one Learn server through VS Code, under the provider id package.json declares', async () => {
  const f = fakes(opts);
  const a = await activate(f);
  assert.equal(a.registeredWith, 'vscode');
  assert.deepEqual(f.seen.providers.map((p) => p.id), [PROVIDER_ID]);
  assert.deepEqual(manifest.contributes.mcpServerDefinitionProviders.map((p: { id: string }) => p.id), [PROVIDER_ID]);
  const provider = f.seen.providers[0].provider;
  assert.equal(provider.resolveMcpServerDefinition, undefined, 'no interactive step: the Copilot harness never calls one');
  const [def] = provider.provideMcpServerDefinitions() as FakeDefinition[];
  assert.equal(def.label, 'Learn API');
  assert.equal(def.command, 'C:\\Program Files\\VS Code\\Code.exe');
  assert.equal(def.args[0], join(root, 'dist', 'server', 'learn-mcp.mjs'));
  assert.equal(def.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(def.version, manifest.version);
});

test('registers through Cursor\'s own API in Cursor, and not twice', async () => {
  const f = fakes({ ...opts, cursor: true });
  const a = await activate(f);
  assert.equal(a.registeredWith, 'cursor');
  assert.equal(f.seen.providers.length, 0);
  assert.equal(f.seen.cursor.length, 1);
  assert.equal(f.seen.cursor[0].name, 'learn');
  assert.deepEqual(f.seen.cursor[0].server.env, a.launch.env);
});

test('every command package.json contributes is registered, and no other', async () => {
  const f = fakes(opts);
  await activate(f);
  assert.deepEqual([...f.seen.commands.keys()].sort(), manifest.contributes.commands.map((c: { command: string }) => c.command).sort());
});

test('Set API key: checked, kept in SecretStorage only, sent to the running server, never in the definition or a log', async () => {
  const f = fakes(opts);
  const a = await activate(f);
  const configs = await server(a);
  assert.equal(configs[0].key, null);

  f.answers.input = '  ' + KEY + '  ';
  await f.seen.commands.get('learn.setApiKey')!();
  const box = f.seen.inputs[0];
  assert.equal(box.password, true);
  assert.equal(box.ignoreFocusOut, true);
  assert.equal(typeof box.validateInput('a b'), 'string');
  assert.equal(typeof box.validateInput(''), 'string');
  assert.equal(box.validateInput(KEY), undefined);

  assert.deepEqual([...f.secrets.entries()], [[SECRET_NAME, KEY]]);
  await settle();
  assert.equal(configs.at(-1)!.key, KEY, 'the running server has the key without a restart');
  assert.equal(configs.at(-1)!.project, 'C:\\work\\app');

  const [def] = f.seen.providers[0].provider.provideMcpServerDefinitions() as FakeDefinition[];
  assert.ok(!JSON.stringify(def).includes(KEY), 'the definition VS Code caches carries no key');
  for (const text of [...f.seen.info, ...f.seen.logs, ...f.seen.errors]) assert.ok(!text.includes(KEY));
  assert.deepEqual([...f.global.keys()].filter((k) => k !== NOTICE_SHOWN), [], 'nothing else is stored');
});

test('Set API key: cancelling or an invalid key stores nothing', async () => {
  const f = fakes(opts);
  await activate(f);
  f.answers.input = undefined;
  await f.seen.commands.get('learn.setApiKey')!();
  f.answers.input = 'has a space';
  await f.seen.commands.get('learn.setApiKey')!();
  assert.equal(f.secrets.size, 0);
});

test('Remove API key: removes it and tells the running server at once', async () => {
  const f = fakes(opts);
  f.secrets.set(SECRET_NAME, KEY);
  const a = await activate(f);
  const configs = await server(a);
  assert.equal(configs[0].key, KEY);
  await f.seen.commands.get('learn.removeApiKey')!();
  await settle();
  assert.equal(f.secrets.size, 0);
  assert.equal(configs.at(-1)!.key, null);
  await f.seen.commands.get('learn.removeApiKey')!();
  assert.match(f.seen.info.at(-1)!, /No Learn API key is saved/);
});

test('settings: the host follows learn.apiBaseUrl, and a host that is not Learn is refused', async () => {
  const f = fakes(opts);
  const a = await activate(f);
  const configs = await server(a);
  assert.equal(configs[0].baseUrl, PRODUCTION_BASE_URL);
  f.settings.apiBaseUrl = STAGING_BASE_URL;
  f.settings.assignmentId = 'asg_7';
  for (const l of f.on.config) l({ affectsConfiguration: (s: string) => s === 'learn' });
  await settle();
  assert.equal(configs.at(-1)!.baseUrl, STAGING_BASE_URL);
  assert.equal(configs.at(-1)!.assignmentId, 'asg_7');
  f.settings.apiBaseUrl = 'https://collector.example/v1';
  for (const l of f.on.config) l({ affectsConfiguration: (s: string) => s === 'learn' });
  await settle();
  assert.equal(configs.at(-1)!.baseUrl, PRODUCTION_BASE_URL);
  assert.ok(f.seen.logs.some((l) => /^warn: .*not a Learn API host/.test(l)));
  const settingsSchema = manifest.contributes.configuration.properties;
  assert.equal(settingsSchema['learn.apiBaseUrl'].scope, 'machine', 'a workspace cannot point the key at another host');
  assert.deepEqual(settingsSchema['learn.apiBaseUrl'].enum, [PRODUCTION_BASE_URL, STAGING_BASE_URL]);
  assert.equal(settingsSchema['learn.apiBaseUrl'].default, PRODUCTION_BASE_URL);
});

test('Copy the first-tutor prompt: the verified prompt, word for word', async () => {
  const f = fakes(opts);
  await activate(f);
  await f.seen.commands.get('learn.copyFirstTutorPrompt')!();
  const snapshot = JSON.parse(readFileSync(join(root, 'dist', 'snapshot', 'learn-docs.json'), 'utf8')) as SnapshotKits;
  assert.equal(f.seen.clipboard, firstTutorKit(snapshot)!.prompt);
  assert.match(f.seen.info.at(-1)!, /^Copied the first-tutor prompt/);
});

test('Open the quick start opens the quick start', async () => {
  const f = fakes(opts);
  await activate(f);
  await f.seen.commands.get('learn.openQuickStart')!();
  assert.deepEqual(f.seen.opened, [QUICK_START_URL]);
});

test('the key notice: once, when a server first starts with no key anywhere', async () => {
  const f = fakes(opts);
  f.answers.pick = 'Get a key';
  const a = await activate(f);
  await server(a);
  await settle();
  await server(a);
  await settle();
  const notices = f.seen.info.filter((m) => /To send a test turn, set your API key/.test(m));
  assert.equal(notices.length, 1);
  assert.deepEqual(f.seen.opened, [CONSOLE_URL]);
  assert.equal(f.global.get(NOTICE_SHOWN), true);
});

test('the key notice: not shown with a saved key, or a key in the environment', async () => {
  const saved = fakes(opts);
  saved.secrets.set(SECRET_NAME, KEY);
  await server(await activate(saved));
  const own = fakes({ ...opts, env: { FOREVERLEARNING_API_KEY: 'own-key' } });
  await server(await activate(own));
  await settle();
  for (const f of [saved, own]) assert.equal(f.seen.info.length, 0);
});

test('deactivating closes the handoff', async () => {
  const f = fakes(opts);
  const a = await activate(f);
  for (const s of running.pop()!) await s.dispose();
  await settle();
  assert.equal(await connectHandoff(a.launch.env.LEARN_VSCODE_HANDOFF, a.launch.env.LEARN_VSCODE_TOKEN, () => {}, 500), false);
});
