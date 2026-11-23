// The built server (dist/server/learn-mcp.mjs), started the way the editor starts it: the
// definition's command, arguments and environment, over stdio, with the extension's key handoff
// listening. Against a local mock of the Learn API: nothing leaves this computer.
//
// LEARN_TEST_RUNTIME picks the runtime: by default this Node.js; set it to the editor's own
// executable (Code.exe) to run the server exactly as VS Code does, with ELECTRON_RUN_AS_NODE.
// LEARN_TEST_EXTENSION_PATH runs an installed copy instead of this repository's build.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { serverLaunch, type ServerLaunch } from '../src/definition.ts';
import { startHandoff, type Handoff } from '../src/handoff.ts';
import { firstTutorKit, type SnapshotKits } from '../src/prompts.ts';
import type { HandoffConfig } from '../src/protocol.ts';
import { startMock, TEST_KEY, REPLY, type Mock } from './mock-learn.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = process.env.LEARN_TEST_RUNTIME || process.execPath;
const extensionPath = process.env.LEARN_TEST_EXTENSION_PATH || root;
const snapshot = JSON.parse(readFileSync(join(extensionPath, 'dist', 'snapshot', 'learn-docs.json'), 'utf8')) as SnapshotKits;
const TOOLS = ['learn_contract', 'learn_guide', 'learn_kit', 'learn_kits', 'learn_lookup_request', 'learn_starter_file', 'learn_test_turn'];

let mock: Mock;
let handoff: Handoff;
let config: HandoffConfig;
let stateDir: string;
const outputs: string[] = []; // every tool result and server log line, for the key checks

before(async () => {
  mock = await startMock();
  handoff = await startHandoff({ getConfig: async () => config });
});
after(async () => {
  await handoff.close();
  await mock.close();
  for (const text of outputs) assert.ok(!text.includes(TEST_KEY), 'the key never appears in a tool result or a log line');
});
beforeEach(() => {
  mock.reset();
  stateDir = mkdtempSync(join(tmpdir(), 'learn-vscode-e2e-'));
  config = { key: null, baseUrl: mock.url, assignmentId: null, project: join(stateDir, 'project') };
});

async function start(options: { launch?: ServerLaunch; env?: Record<string, string> } = {}) {
  const launch = options.launch ?? serverLaunch({ execPath: runtime, extensionPath, handoff, version: 'test' });
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    // The editor's own environment, then the definition's, as VS Code merges them.
    env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '', LEARN_MCP_STATE_DIR: stateDir, ...options.env, ...launch.env },
    stderr: 'pipe',
  });
  let stderr = '';
  const waiters: { pattern: RegExp; resolve: () => void }[] = [];
  transport.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
    for (const w of waiters.splice(0)) {
      if (w.pattern.test(stderr)) w.resolve();
      else waiters.push(w);
    }
  });
  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
    const text = r.content.map((c) => c.text).join('\n');
    outputs.push(text);
    return { text, isError: r.isError === true };
  };
  const logged = (pattern: RegExp) => new Promise<void>((resolve, reject) => {
    if (pattern.test(stderr)) return resolve();
    const timer = setTimeout(() => reject(new Error('the server did not log ' + pattern + '; it logged: ' + stderr)), 10_000);
    waiters.push({ pattern, resolve: () => { clearTimeout(timer); resolve(); } });
  });
  return {
    client, call, logged,
    stderr: () => stderr,
    close: async () => {
      await client.close();
      outputs.push(stderr);
    },
  };
}

test('the server runs with the editor runtime and serves the docs and prompts without a key', async () => {
  const s = await start();
  await s.logged(/settings from VS Code, no key: docs only/);
  assert.deepEqual((await s.client.listTools()).tools.map((t) => t.name).sort(), TOOLS);
  assert.deepEqual((await s.client.listPrompts()).prompts.map((p) => p.name).sort(), ['embed-learn', 'first-tutor']);

  const verified = firstTutorKit(snapshot)!.prompt;
  const kit = await s.call('learn_kit', { kit: '1' });
  assert.ok(kit.text.includes(verified.trim()), 'learn_kit serves the verified prompt word for word');
  const prompt = await s.client.getPrompt({ name: 'first-tutor' });
  assert.equal((prompt.messages[0].content as { text: string }).text, verified, 'the first-tutor prompt is the prompt the copy command copies');
  assert.match((await s.call('learn_guide', { topic: 'turn' })).text, /Send a turn/);

  const turn = await s.call('learn_test_turn', { message: 'I am stuck on 3x + 5 = 20.', confirm: true });
  assert.match(turn.text, /No Learn API key is set/);
  assert.equal(mock.requests.length, 0, 'nothing reached the API');
  assert.equal(handoff.connected(), 1);
  await s.close();
});

test('a key saved in VS Code reaches the running server through the handoff, and a confirmed turn uses it', async () => {
  const s = await start();
  await s.logged(/no key: docs only/);
  config = { ...config, key: TEST_KEY };
  handoff.push(config);
  await s.logged(/settings updated from VS Code; key set/);

  const preview = await s.call('learn_test_turn', { message: 'I am stuck on 3x + 5 = 20. Can you just tell me what x is?' });
  assert.match(preview.text, /^Not sent yet/);
  assert.deepEqual(mock.requests.map((r) => r.method + ' ' + r.path), ['GET /quest/catalog'], 'the preview reads the free catalog only');
  assert.equal(mock.requests[0].headers.authorization, 'Bearer ' + TEST_KEY);

  const turn = await s.call('learn_test_turn', { message: 'I am stuck on 3x + 5 = 20. Can you just tell me what x is?', confirm: true });
  assert.equal(turn.isError, false);
  assert.ok(turn.text.includes(REPLY.conversation) && turn.text.includes(REPLY.display), 'the reply, word for word');
  assert.deepEqual(mock.requests.map((r) => r.method + ' ' + r.path), ['GET /quest/catalog', 'GET /quest/catalog', 'POST /quest/sessions', 'POST /chat']);
  for (const r of mock.requests) assert.equal(r.headers.authorization, 'Bearer ' + TEST_KEY);
  const state = readdirSync(stateDir).map((f) => f.endsWith('.json') ? readFileSync(join(stateDir, f), 'utf8') : '').join('');
  assert.ok(!state.includes(TEST_KEY), 'the key is not in the state file');

  config = { ...config, key: null };
  handoff.push(config);
  await s.logged(/settings updated from VS Code; no key: docs only/);
  assert.match((await s.call('learn_test_turn', { message: 'hi', confirm: true })).text, /No Learn API key is set/, 'a removed key is gone at once');
  await s.close();
});

test('the definition the editor caches and forwards carries no key', async () => {
  config = { ...config, key: TEST_KEY };
  const launch = serverLaunch({ execPath: runtime, extensionPath, handoff, version: 'test' });
  assert.ok(!JSON.stringify(launch).includes(TEST_KEY));
  const s = await start({ launch });
  await s.logged(/key set: test turns on/);
  await s.close();
});

test('a server with the wrong token gets nothing, and still serves the docs', async () => {
  config = { ...config, key: TEST_KEY };
  const launch = serverLaunch({ execPath: runtime, extensionPath, handoff: { address: handoff.address, token: 'f'.repeat(64) }, version: 'test' });
  const s = await start({ launch });
  await s.logged(/VS Code could not be reached, so its saved key is not used, no key: docs only/);
  assert.equal(handoff.connected(), 0);
  assert.match((await s.call('learn_test_turn', { message: 'hi', confirm: true })).text, /No Learn API key is set/);
  assert.match((await s.call('learn_kits')).text, /01-first-tutor/);
  assert.equal(mock.requests.length, 0);
  await s.close();
});

test('a server started from a stale cached definition (no handoff listening) still serves the docs', async () => {
  const gone = await startHandoff({ getConfig: async () => ({ ...config, key: TEST_KEY }) });
  const launch = serverLaunch({ execPath: runtime, extensionPath, handoff: gone, version: 'test' });
  await gone.close();
  const s = await start({ launch });
  await s.logged(/could not be reached/);
  assert.match((await s.call('learn_kits')).text, /01-first-tutor/);
  assert.match((await s.call('learn_test_turn', { message: 'hi', confirm: true })).text, /No Learn API key is set/);
  await s.close();
});

test("with no key saved in VS Code, the developer's own environment key and host are used", async () => {
  const own = 'fl_test_' + '0f1e2d3c'.repeat(8);
  mock.keys = [own];
  config = { ...config, baseUrl: 'https://developers-api.foreverlearning.ai/v1' };
  const s = await start({ env: { FOREVERLEARNING_API_KEY: own, FOREVERLEARNING_BASE_URL: mock.url } });
  await s.logged(/settings from VS Code, key set/);
  assert.match((await s.call('learn_test_turn', { message: 'hi' })).text, /^Not sent yet/);
  assert.equal(mock.requests[0].headers.authorization, 'Bearer ' + own);
  await s.close();
  outputs.push(s.stderr());
  for (const text of outputs) assert.ok(!text.includes(own));
});
