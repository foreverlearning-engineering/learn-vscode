// The key handoff between the extension and the server it registers.
//
// VS Code caches every server definition an extension provides, environment included, in its
// workspace storage on disk, and its Copilot harness starts servers from that definition without
// asking the extension again. So the key cannot travel in the definition. Instead the extension
// listens on a private local pipe (a named pipe on Windows, a socket only this user can open
// elsewhere), with a fresh random address and token each time it activates. The definition
// carries only that address and token. The server connects, proves the token, and receives the
// key into its own process environment, and again whenever the developer changes it.
//
// Messages are single lines of JSON.
import { timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';

export interface HandoffConfig {
  key: string | null;
  baseUrl: string;
  assignmentId: string | null;
  project: string | null;
}

export interface Hello { type: 'hello'; token: string }
export interface ConfigMessage { type: 'config'; config: HandoffConfig }

// No message needs more than this; a longer line ends the connection.
export const MAX_LINE = 16_384;

export function encode(message: Hello | ConfigMessage): string {
  return JSON.stringify(message) + '\n';
}

export class LineReader {
  private buffer = '';
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    if (this.buffer.length > MAX_LINE || lines.some((l) => l.length > MAX_LINE)) throw new Error('line too long');
    return lines.filter((l) => l.trim() !== '');
  }
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const stringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

export function parseHello(line: string): Hello | undefined {
  const m = parse(line);
  return m && m.type === 'hello' && typeof m.token === 'string' ? { type: 'hello', token: m.token } : undefined;
}

export function parseConfig(line: string): HandoffConfig | undefined {
  const m = parse(line);
  const c = m?.type === 'config' ? (m.config as Record<string, unknown> | undefined) : undefined;
  if (!c || typeof c !== 'object') return undefined;
  if (!stringOrNull(c.key) || typeof c.baseUrl !== 'string' || !stringOrNull(c.assignmentId) || !stringOrNull(c.project)) return undefined;
  return { key: c.key, baseUrl: c.baseUrl, assignmentId: c.assignmentId, project: c.project };
}

export function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// A fresh address for each activation. Unix socket paths are limited to about 104 bytes, so the
// name stays short.
export function handoffAddress(id: string, platform: NodeJS.Platform, tmp: string): string {
  return platform === 'win32' ? '\\\\.\\pipe\\learn-vscode-' + id : posix.join(tmp, 'learn-vscode-' + id + '.sock');
}
