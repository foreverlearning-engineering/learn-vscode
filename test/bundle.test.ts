// The shipped extension (dist/extension.cjs), loaded the way the editor loads it (require, with a
// `vscode` module), activated, and its provided server started from the definition it gives.
// The closest check to running it in VS Code that needs no window.
//
// LEARN_TEST_EXTENSION_PATH points at an installed copy (for example one installed from the .vsix
// into an isolated profile); by default the repository's own build.
//
// This test never sends a turn: the extension only accepts the real Learn API hosts, so the key is
// shown to arrive in the server by its log line, and no tool that would use it is called.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fakes, type FakeDefinition } from './fake-vscode.ts';
import { PROVIDER_ID } from '../src/constants.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = process.env.LEARN_TEST_EXTENSION_PATH || root;
const manifest = JSON.parse(readFileSync(join(extensionPath, 'package.json'), 'utf8'));
const KEY = 'fl_test_' + 'a1b2c3d4'.repeat(8);
const require = createRequire(import.meta.url);

// Load the bundle with the fake standing in for the editor's `vscode` module.
function loadExtension(fakeVscode: unknown): { activate(context: unknown): Promise<void>; deactivate(): void } {
  const Module = require('node:module') as { _load: (request: string, ...rest: unknown[]) => unknown };
  const original = Module._load;
  Module._load = function (request: string, ...rest: unknown[]) {
    return request === 'vscode' ? fakeVscode : original.call(this, request, ...rest);
  };
  try {
    return require(join(extensionPath, manifest.main));
  } finally {
    Module._load = original;
  }
}

const f = fakes({ extensionPath, version: manifest.version });
after(async () => {
  for (const s of f.context.subscriptions) await s.dispose();
});

test('the shipped extension activates, registers its provider and serves the Learn tools', async () => {
  assert.equal(manifest.main, './dist/extension.cjs');
  const ext = loadExtension(f.api);
  await ext.activate(f.context);

  assert.deepEqual(f.seen.providers.map((p) => p.id), [PROVIDER_ID]);
  assert.deepEqual([...f.seen.commands.keys()].sort(), manifest.contributes.commands.map((c: { command: string }) => c.command).sort());
  const [def] = f.seen.providers[0].provider.provideMcpServerDefinitions() as FakeDefinition[];
  assert.equal(def.command, process.execPath, 'the runtime the editor itself runs on');
  assert.equal(def.args[0], join(extensionPath, 'dist', 'server', 'learn-mcp.mjs'));
  assert.equal(def.version, manifest.version);

  const transport = new StdioClientTransport({
    command: def.command,
    args: def.args,
    env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '', ...def.env },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
  const client = new Client({ name: 'bundle', version: '0' });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(tools.includes('learn_kit') && tools.includes('learn_test_turn'));
    const kits = await client.callTool({ name: 'learn_kits', arguments: {} }) as { content: { text: string }[] };
    assert.match(kits.content[0].text, /01-first-tutor/);
    assert.match(stderr, /settings from VS Code, no key: docs only/);

    f.answers.input = KEY;
    await f.seen.commands.get('learn.setApiKey')!();
    const deadline = Date.now() + 5000;
    while (!/settings updated from VS Code; key set/.test(stderr) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.match(stderr, /settings updated from VS Code; key set/, 'the key reached the running server');
    assert.ok(!JSON.stringify(f.seen.providers[0].provider.provideMcpServerDefinitions()).includes(KEY));
    for (const text of [stderr, ...f.seen.info, ...f.seen.logs]) assert.ok(!text.includes(KEY));
  } finally {
    await client.close();
  }
});
