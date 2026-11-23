// The Learn MCP server as the extension starts it: learn-mcp, bundled, over stdio, in full mode.
// Before it serves, it takes the key and settings from the extension over the private handoff,
// into this process's own environment. Logs go to stderr only; stdout carries the protocol.
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createLearnServer } from '@foreverlearning/learn-mcp';
import { ENV_HANDOFF, ENV_TOKEN } from '../constants.ts';
import { redact } from '../keyInput.ts';
import { applyConfig, captureInherited, setKeyHelp } from './env.ts';
import { connectHandoff } from './handoffClient.ts';

declare const __LEARN_MCP_VERSION__: string;

const log = (line: string) => process.stderr.write(redact(line, process.env.FOREVERLEARNING_API_KEY) + '\n');

const address = process.env[ENV_HANDOFF] ?? '';
const token = process.env[ENV_TOKEN] ?? '';
delete process.env[ENV_HANDOFF];
delete process.env[ENV_TOKEN];

const inherited = captureInherited(process.env);
let updates = 0;
const connected = address && token
  ? await connectHandoff(address, token, (config) => {
    applyConfig(process.env, inherited, config);
    if (updates++ > 0) log('learn-vscode: settings updated from VS Code; ' + (process.env.FOREVERLEARNING_API_KEY ? 'key set' : 'no key: docs only'));
  })
  : false;
setKeyHelp(process.env, connected ? 'connected' : address ? 'unreachable' : 'none');

serveStdio(() => createLearnServer({ mode: 'full', env: process.env }), {
  onerror: (error) => log('learn-mcp: ' + String((error as Error)?.message ?? error)),
});

log('learn-mcp ' + __LEARN_MCP_VERSION__ + ' in VS Code: stdio, '
  + (connected ? 'settings from VS Code' : address ? 'VS Code could not be reached, so its saved key is not used' : 'started outside the extension')
  + ', ' + (process.env.FOREVERLEARNING_API_KEY ? 'key set: test turns on' : 'no key: docs only'));
