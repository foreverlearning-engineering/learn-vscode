// Copied from learn-mcp (test/mock-learn.ts at commit 93b8e2c, MIT), with one change: the keys it
// accepts are a list (mock.keys), so a test can use a second key.
// A local stand-in for the Learn API, for the unit tests. It speaks the shapes the guide and the
// contract describe (catalog, session preparation, the /chat event stream, request lookup) and
// records every request it receives. It never calls anything outside this process.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const TEST_KEY = 'fl_test_' + 'a1b2c3d4'.repeat(8);

export type ChatScenario =
  | 'ok'
  | 'error-event'
  | 'no-done'
  | 'mismatch'
  | 'refused-429'
  | 'refused-403-workload'
  | 'refused-401-echo-key'
  | 'policy-blocked';

export interface Recorded { method: string; path: string; body: any; headers: Record<string, string | string[] | undefined> }

export const REPLY = {
  conversation: 'You’re working with a linear equation and want the value of x. Let’s keep the solving step yours — no shortcuts.',
  display: 'In `3x + 5 = 20`, what operation undoes the added 5?\n\n- Name it\n- Apply it to both sides: \\(3x + 5 - 5 = 20 - 5\\)\n\n\\[\n3x = ?\n\\]',
};

export interface Mock {
  url: string;
  requests: Recorded[];
  mode: 'test' | 'live';
  chat: ChatScenario[];
  lookup: 'committed' | 'in_progress' | '401';
  keys: string[];
  reset(): void;
  close(): Promise<void>;
}

function sse(res: ServerResponse, events: object[]) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Request-Id': 'req_mock_1' });
  for (const e of events) res.write('data: ' + JSON.stringify(e) + '\n\n');
  res.end();
}

function refuse(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify({ error: true, ...body }));
}

export async function startMock(): Promise<Mock> {
  let turn = 0;
  const mock: Mock = {
    url: '', requests: [], mode: 'test', chat: [], lookup: 'committed', keys: [TEST_KEY], close: async () => {},
    reset() { turn = 0; this.requests.length = 0; this.chat = []; this.mode = 'test'; this.lookup = 'committed'; this.keys = [TEST_KEY]; },
  };
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const path = (req.url ?? '').replace(/^\/v1/, '');
    const body = raw ? JSON.parse(raw) : undefined;
    mock.requests.push({ method: req.method ?? '', path, body, headers: req.headers });
    if (!mock.keys.some((k) => req.headers.authorization === 'Bearer ' + k)) return refuse(res, 401, { code: 'DEVELOPER_AUTHENTICATION_REQUIRED', message: 'Authentication required.', request_id: 'req_auth' });

    if (req.method === 'GET' && path === '/quest/catalog') {
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        schema: 'fl.quest.catalog.v1', interface_version: '2026-12-01', postures: ['guided', 'feedback', 'explain', 'diagnostic'],
        mode: mock.mode, price: { amount_micro_usd: 50000, currency: 'USD', unit: 'governed_turn' }, release_id: 'rel_mock', content_release: 'mock', rate_id: 'rate', limits: {}, write_policy: { profile: true, long_term: true },
      }));
    }
    if (req.method === 'POST' && path === '/quest/sessions') {
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ session_id: 'sess_mock_1' }));
    }
    if (req.method === 'POST' && path === '/chat') {
      turn += 1;
      const scenario = mock.chat.shift() ?? 'ok';
      const requestId = 'req_mock_' + turn;
      const session = body.session_id;
      const head = [
        { type: 'metadata', sessionId: session, request_id: requestId },
        { type: 'content', part: 'conversation', text: REPLY.conversation },
        { type: 'content', part: 'display', text: REPLY.display },
        { type: 'display_complete' },
      ];
      const tail = [
        { type: 'safety_status', schema_version: 1, evaluated: true, level: 'clear', response_action: 'none', source: 'governed_turn' },
        { type: 'quest_receipt', receipt: { mode: 'mock', posture: body.posture ?? 'guided', composition_hash: 'f'.repeat(64), turn_index: turn, team_dialog: false, repairs: [], validation_failures: [] } },
      ];
      const done = { type: 'done', sessionId: session, stopReason: 'end_turn', commercial: { billable_units: 1, charge: { amount_micro_usd: 50000, currency: 'USD' }, settlement: 'settled', request_id: requestId, listing: 'learn', band: 'b', rate_version: 'r' } };
      switch (scenario) {
        case 'ok': return sse(res, [...head, ...tail, done]);
        case 'error-event': return sse(res, [head[0], { type: 'error', error: true, code: 'GENERATION_FAILED', message: 'The turn failed.', request_id: requestId }]);
        case 'no-done': return sse(res, [...head, ...tail]);
        case 'mismatch': return sse(res, [...head, ...tail, { ...done, commercial: { ...done.commercial, request_id: 'req_other' } }]);
        case 'refused-429': return refuse(res, 429, { code: 'DEVELOPER_CAPACITY_LIMIT', message: 'Rate limit.', request_id: requestId, reason: 'requests_per_minute', retry_after_seconds: 60 }, { 'Retry-After': '60' });
        case 'refused-403-workload': return refuse(res, 403, { code: 'DEVELOPER_WORKLOAD_REVIEW_REQUIRED', message: 'Workload review required.', request_id: requestId });
        case 'refused-401-echo-key': return refuse(res, 401, { code: 'DEVELOPER_AUTHENTICATION_REQUIRED', message: 'Key ' + TEST_KEY + ' was not accepted.', request_id: requestId });
        case 'policy-blocked': return refuse(res, 403, { code: 'DEVELOPER_POLICY_BLOCKED', message: 'Blocked by policy.', request_id: requestId });
      }
    }
    const lookup = /^\/requests\/(.+)$/.exec(path);
    if (req.method === 'GET' && lookup) {
      if (mock.lookup === '401') return refuse(res, 401, { code: 'DEVELOPER_AUTHENTICATION_REQUIRED', message: 'Authentication required.', request_id: 'req_x' });
      if (mock.lookup === 'in_progress') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'in_progress', request_id: lookup[1], session_id: 'sess_mock_1' }));
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        status: 'committed', request_id: lookup[1], session_id: 'sess_mock_1',
        result: {
          parts: [{ part: 'conversation', text: REPLY.conversation }, { part: 'display', text: REPLY.display }],
          safety_status: { type: 'safety_status', schema_version: 1, evaluated: true, level: 'clear', response_action: 'none', source: 'governed_turn' },
          stop_reason: 'end_turn', session_ended: false,
          commercial: { listing: 'learn', band: 'b', rate_version: 'r', billable_units: 1, charge: { amount_micro_usd: 50000, currency: 'USD' }, settlement: 'settled' },
          quest: { mode: 'mock', posture: 'guided', composition_hash: 'f'.repeat(64), turn_index: 1, team_dialog: false, repairs: [], validation_failures: [] },
        },
      }));
    }
    refuse(res, 404, { code: 'NOT_FOUND', message: 'No route.', request_id: 'req_404' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  mock.url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1';
  mock.close = () => new Promise<void>((r) => server.close(() => r()));
  return mock;
}
