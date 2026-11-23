// The key handoff over a real local pipe: only the holder of this activation's token gets the key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { existsSync } from 'node:fs';
import { startHandoff } from '../src/handoff.ts';
import { connectHandoff } from '../src/server/handoffClient.ts';
import { encode, MAX_LINE, type HandoffConfig } from '../src/protocol.ts';
import { PRODUCTION_BASE_URL } from '../src/constants.ts';

const KEY = 'fl_test_' + 'a1b2c3d4'.repeat(8);
const base: HandoffConfig = { key: KEY, baseUrl: PRODUCTION_BASE_URL, assignmentId: null, project: null };

// A raw client: sends what it is told and collects whatever comes back until the pipe closes.
function raw(address: string, send: string, waitMs = 300): Promise<{ received: string; closed: boolean }> {
  return new Promise((resolve) => {
    const socket = connect(address);
    let received = '';
    let closed = false;
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(send));
    socket.on('data', (d: string) => { received += d; });
    socket.on('error', () => { closed = true; });
    socket.on('close', () => { closed = true; });
    setTimeout(() => { socket.destroy(); resolve({ received, closed }); }, waitMs);
  });
}

test('the right token receives the config at once, and every update after', async () => {
  let current = base;
  let servers = 0;
  const h = await startHandoff({ getConfig: async () => current, onServer: () => { servers += 1; } });
  const seen: HandoffConfig[] = [];
  assert.equal(await connectHandoff(h.address, h.token, (c) => seen.push(c)), true);
  assert.deepEqual(seen, [base]);
  assert.equal(servers, 1);
  assert.equal(h.connected(), 1);
  current = { ...base, key: null };
  h.push(current);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(seen, [base, current]);
  await h.close();
});

test('a wrong token, a malformed hello or no hello gets nothing and is disconnected', async () => {
  const h = await startHandoff({ getConfig: async () => base, helloTimeoutMs: 150 });
  const wrong = await raw(h.address, encode({ type: 'hello', token: 'f'.repeat(64) }));
  assert.deepEqual(wrong, { received: '', closed: true });
  const garbage = await raw(h.address, 'not json\n');
  assert.deepEqual(garbage, { received: '', closed: true });
  const long = await raw(h.address, 'x'.repeat(MAX_LINE + 10));
  assert.deepEqual(long, { received: '', closed: true });
  const silent = await raw(h.address, '', 400);
  assert.deepEqual(silent, { received: '', closed: true });
  assert.equal(h.connected(), 0);
  assert.equal(await connectHandoff(h.address, 'f'.repeat(64), () => assert.fail('no config for a wrong token'), 500), false);
  await h.close();
});

test('each activation has its own address and token', async () => {
  const a = await startHandoff({ getConfig: async () => base });
  const b = await startHandoff({ getConfig: async () => base });
  assert.notEqual(a.address, b.address);
  assert.notEqual(a.token, b.token);
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.equal(await connectHandoff(a.address, b.token, () => {}, 500), false, "one window's token does not open another's pipe");
  await a.close();
  await b.close();
});

test('closing the handoff disconnects servers and frees the address', async () => {
  const h = await startHandoff({ getConfig: async () => base });
  assert.equal(await connectHandoff(h.address, h.token, () => {}), true);
  await h.close();
  assert.equal(h.connected(), 0);
  if (process.platform !== 'win32') assert.equal(existsSync(h.address), false);
  assert.equal(await connectHandoff(h.address, h.token, () => {}, 500), false);
});
