// The extension's pure logic: settings, key input, the handoff protocol, the server's environment
// rules and the server definition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSettings } from '../src/settings.ts';
import { checkKey, redact } from '../src/keyInput.ts';
import { encode, handoffAddress, LineReader, MAX_LINE, parseConfig, parseHello, tokensMatch, type HandoffConfig } from '../src/protocol.ts';
import { applyConfig, captureInherited, setKeyHelp } from '../src/server/env.ts';
import { forwardingProblems, serverLaunch } from '../src/definition.ts';
import { ENV_HANDOFF, ENV_TOKEN, PRODUCTION_BASE_URL, STAGING_BASE_URL } from '../src/constants.ts';

const KEY = 'fl_test_' + 'a1b2c3d4'.repeat(8);

test('settings: the API host is production unless it is the staging host; nothing else is accepted', () => {
  const read = (values: Record<string, unknown>) => readSettings((n) => values[n]);
  assert.equal(read({}).baseUrl, PRODUCTION_BASE_URL);
  assert.equal(read({ apiBaseUrl: STAGING_BASE_URL + '/' }).baseUrl, STAGING_BASE_URL);
  assert.equal(read({ apiBaseUrl: '  ' + STAGING_BASE_URL + '  ' }).baseUrl, STAGING_BASE_URL);
  const other = read({ apiBaseUrl: 'https://example.com/v1' });
  assert.equal(other.baseUrl, PRODUCTION_BASE_URL, 'the key is never sent to another host');
  assert.match(other.notes[0], /not a Learn API host/);
  assert.equal(read({ apiBaseUrl: 'http://developers-api.foreverlearning.ai/v1' }).baseUrl, PRODUCTION_BASE_URL);
});

test('settings: the assignment id is trimmed, and left out when empty or invalid', () => {
  const read = (v: unknown) => readSettings((n) => (n === 'assignmentId' ? v : undefined));
  assert.equal(read('').assignmentId, null);
  assert.equal(read('  asg_123 ').assignmentId, 'asg_123');
  assert.equal(read('two words').assignmentId, null);
  assert.match(read('two words').notes[0], /not a valid assignment id/);
  assert.equal(read(42).assignmentId, null);
});

test('key input: trimmed; empty, spaced, over-long or non-printing input refused', () => {
  assert.deepEqual(checkKey('  ' + KEY + '\n'), { ok: true, key: KEY });
  for (const bad of ['', '   ', 'fl_test_ab cd', 'x'.repeat(513), 'clé']) assert.equal(checkKey(bad).ok, false, JSON.stringify(bad));
});

test('redact: removes the exact key and anything shaped like a server key', () => {
  assert.equal(redact('key ' + KEY + ' refused', KEY), 'key <redacted-key> refused');
  assert.equal(redact('other fl_live_' + 'abcdef01'.repeat(4) + ' seen'), 'other <redacted-key> seen');
  assert.equal(redact('plain text', 'secret-value'), 'plain text');
  assert.equal(redact('secret-value here', 'secret-value'), '<redacted-key> here');
});

test('protocol: lines split across chunks, and an over-long line ends the read', () => {
  const r = new LineReader();
  assert.deepEqual(r.push('{"a":'), []);
  assert.deepEqual(r.push('1}\n{"b":2}\n\n{"c"'), ['{"a":1}', '{"b":2}']);
  assert.deepEqual(r.push(':3}\n'), ['{"c":3}']);
  assert.throws(() => new LineReader().push('x'.repeat(MAX_LINE + 1)), /too long/);
});

test('protocol: messages are checked before use', () => {
  const config: HandoffConfig = { key: KEY, baseUrl: PRODUCTION_BASE_URL, assignmentId: null, project: '/p' };
  assert.deepEqual(parseConfig(encode({ type: 'config', config }).trim()), config);
  assert.equal(parseConfig('{"type":"config","config":{"key":5,"baseUrl":"x","assignmentId":null,"project":null}}'), undefined);
  assert.equal(parseConfig('not json'), undefined);
  assert.equal(parseConfig('[1]'), undefined);
  assert.deepEqual(parseHello('{"type":"hello","token":"t"}'), { type: 'hello', token: 't' });
  assert.equal(parseHello('{"type":"hello"}'), undefined);
  assert.equal(tokensMatch('abc', 'abc'), true);
  assert.equal(tokensMatch('abd', 'abc'), false);
  assert.equal(tokensMatch('ab', 'abc'), false);
});

test('protocol: a named pipe on Windows, a short socket path elsewhere', () => {
  assert.equal(handoffAddress('0123', 'win32', 'C:\\Temp'), '\\\\.\\pipe\\learn-vscode-0123');
  const mac = handoffAddress('0123456789abcdef0123', 'darwin', '/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T');
  assert.ok(mac.endsWith('/learn-vscode-0123456789abcdef0123.sock'));
  assert.ok(Buffer.byteLength(mac) < 104, 'within the Unix socket path limit');
});

test('server environment: a key saved in VS Code wins, with the extension host and assignment', () => {
  const env: NodeJS.ProcessEnv = { FOREVERLEARNING_API_KEY: 'own-key', FOREVERLEARNING_BASE_URL: 'https://own.example/v1' };
  const inherited = captureInherited(env);
  applyConfig(env, inherited, { key: KEY, baseUrl: STAGING_BASE_URL, assignmentId: 'asg_1', project: '/work' });
  assert.equal(env.FOREVERLEARNING_API_KEY, KEY);
  assert.equal(env.FOREVERLEARNING_BASE_URL, STAGING_BASE_URL);
  assert.equal(env.FOREVERLEARNING_ASSIGNMENT_ID, 'asg_1');
  assert.equal(env.LEARN_MCP_PROJECT, '/work');
});

test("server environment: with no saved key, the developer's own setup is kept whole", () => {
  const env: NodeJS.ProcessEnv = { FOREVERLEARNING_API_KEY: 'own-key', FOREVERLEARNING_BASE_URL: 'https://own.example/v1', LEARN_MCP_PROJECT: '/mine' };
  const inherited = captureInherited(env);
  applyConfig(env, inherited, { key: KEY, baseUrl: PRODUCTION_BASE_URL, assignmentId: null, project: '/work' });
  applyConfig(env, inherited, { key: null, baseUrl: PRODUCTION_BASE_URL, assignmentId: 'asg_2', project: '/work' });
  assert.equal(env.FOREVERLEARNING_API_KEY, 'own-key', 'removing the saved key restores the own key');
  assert.equal(env.FOREVERLEARNING_BASE_URL, 'https://own.example/v1');
  assert.equal(env.FOREVERLEARNING_ASSIGNMENT_ID, 'asg_2');
  assert.equal(env.LEARN_MCP_PROJECT, '/mine', "the developer's own project setting is kept");
});

test('server environment: with no key anywhere, the key is absent, never empty', () => {
  const env: NodeJS.ProcessEnv = {};
  const inherited = captureInherited(env);
  applyConfig(env, inherited, { key: KEY, baseUrl: PRODUCTION_BASE_URL, assignmentId: 'a', project: null });
  applyConfig(env, inherited, { key: null, baseUrl: PRODUCTION_BASE_URL, assignmentId: null, project: null });
  assert.equal('FOREVERLEARNING_API_KEY' in env, false);
  assert.equal('FOREVERLEARNING_ASSIGNMENT_ID' in env, false);
  assert.equal('LEARN_MCP_PROJECT' in env, false);
  assert.equal(env.FOREVERLEARNING_BASE_URL, PRODUCTION_BASE_URL);
});

test('the no-key words: "Learn: Set API key", a restart only when VS Code could not be reached, and a developer\'s own words kept', () => {
  const connected: NodeJS.ProcessEnv = {};
  setKeyHelp(connected, 'connected');
  assert.match(connected.LEARN_MCP_KEY_HELP!, /runs "Learn: Set API key" from the Command Palette/);
  assert.match(connected.LEARN_MCP_KEY_HELP!, /picks it up at once, with no restart\.$/);
  const unreachable: NodeJS.ProcessEnv = {};
  setKeyHelp(unreachable, 'unreachable');
  assert.match(unreachable.LEARN_MCP_KEY_HELP!, /could not reach VS Code .* restart the Learn API server \(MCP: List Servers\)\.$/);
  const outside: NodeJS.ProcessEnv = {};
  setKeyHelp(outside, 'none');
  assert.equal('LEARN_MCP_KEY_HELP' in outside, false, "started outside the extension, learn-mcp's own words stand");
  const own: NodeJS.ProcessEnv = { LEARN_MCP_KEY_HELP: 'Mine.' };
  setKeyHelp(own, 'connected');
  assert.equal(own.LEARN_MCP_KEY_HELP, 'Mine.');
  for (const env of [connected, unreachable]) assert.ok(!env.LEARN_MCP_KEY_HELP!.includes('—') && env.LEARN_MCP_KEY_HELP!.length < 1000);
});

test('definition: the editor runtime, the bundled server, and only the handoff in its environment', () => {
  const launch = serverLaunch({ execPath: 'C:\\VS Code\\Code.exe', extensionPath: 'C:\\ext\\foreverlearning.learn-api-0.1.0', handoff: { address: '\\\\.\\pipe\\x', token: 't'.repeat(64) }, version: '0.1.0' });
  assert.equal(launch.label, 'Learn API');
  assert.equal(launch.command, 'C:\\VS Code\\Code.exe');
  assert.equal(launch.args.length, 1);
  assert.match(launch.args[0], /dist[\\/]server[\\/]learn-mcp\.mjs$/);
  assert.deepEqual(Object.keys(launch.env).sort(), ['ELECTRON_RUN_AS_NODE', ENV_HANDOFF, ENV_TOKEN].sort());
  assert.equal(launch.version, '0.1.0');
  assert.deepEqual(forwardingProblems(launch), [], 'the Copilot harness can take it as written');
  assert.deepEqual(forwardingProblems({ ...launch, env: { ...launch.env, X: '${input:key}' } }), ['a ${...} variable']);
});
