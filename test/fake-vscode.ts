// A fake of the parts of the VS Code API the extension uses, for tests that run without the editor.
import { startHandoff } from '../src/handoff.ts';
import type { Api } from '../src/activate.ts';

export class FakeDefinition {
  label: string; command: string; args: string[]; env: Record<string, string>; version?: string;
  constructor(label: string, command: string, args: string[], env: Record<string, string>, version?: string) {
    this.label = label; this.command = command; this.args = args; this.env = env; this.version = version;
  }
}

export type Listener = (e: any) => void;

export function fakes(options: { cursor?: boolean; env?: NodeJS.ProcessEnv; extensionPath?: string; version?: string; execPath?: string } = {}) {
  const seen = {
    providers: [] as { id: string; provider: any }[],
    cursor: [] as any[],
    commands: new Map<string, (...a: any[]) => any>(),
    info: [] as string[],
    errors: [] as string[],
    opened: [] as string[],
    clipboard: '',
    inputs: [] as any[],
    logs: [] as string[],
  };
  const answers = { input: undefined as string | undefined, pick: undefined as string | undefined };
  const settings: Record<string, unknown> = {};
  const on = { config: [] as Listener[], folders: [] as Listener[], secrets: [] as Listener[] };
  const disposable = { dispose() {} };
  const log = (level: string) => (m: string) => { seen.logs.push(level + ': ' + m); };

  const api = {
    lm: { registerMcpServerDefinitionProvider: (id: string, provider: any) => { seen.providers.push({ id, provider }); return disposable; } },
    commands: {
      registerCommand: (id: string, fn: (...a: any[]) => any) => { seen.commands.set(id, fn); return disposable; },
      executeCommand: async (id: string) => seen.commands.get(id)?.(),
    },
    window: {
      createOutputChannel: () => ({ info: log('info'), warn: log('warn'), error: log('error'), dispose() {} }),
      showInputBox: async (o: any) => { seen.inputs.push(o); return answers.input; },
      showInformationMessage: async (m: string) => { seen.info.push(m); return answers.pick; },
      showErrorMessage: async (m: string) => { seen.errors.push(m); return undefined; },
    },
    workspace: {
      getConfiguration: () => ({ get: (n: string) => settings[n] }),
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: 'C:\\work\\app' } }],
      onDidChangeConfiguration: (f: Listener) => { on.config.push(f); return disposable; },
      onDidChangeWorkspaceFolders: (f: Listener) => { on.folders.push(f); return disposable; },
    },
    env: {
      openExternal: async (u: { toString(): string }) => { seen.opened.push(u.toString()); return true; },
      clipboard: { writeText: async (t: string) => { seen.clipboard = t; } },
    },
    Uri: { parse: (s: string) => ({ toString: () => s }) },
    McpStdioServerDefinition: FakeDefinition,
    ...(options.cursor ? { cursor: { mcp: { registerServer: (c: any) => seen.cursor.push(c), unregisterServer: () => {} } } } : {}),
  } as unknown as Api;

  const secrets = new Map<string, string>();
  const global = new Map<string, unknown>();
  const changed = (key: string) => { for (const f of on.secrets) f({ key }); };
  const context = {
    secrets: {
      get: async (k: string) => secrets.get(k),
      store: async (k: string, v: string) => { secrets.set(k, v); changed(k); },
      delete: async (k: string) => { secrets.delete(k); changed(k); },
      onDidChange: (f: Listener) => { on.secrets.push(f); return disposable; },
      keys: async () => [...secrets.keys()],
    },
    globalState: { get: (k: string) => global.get(k), update: async (k: string, v: unknown) => { global.set(k, v); }, keys: () => [...global.keys()], setKeysForSync() {} },
    subscriptions: [] as { dispose(): unknown }[],
    extensionPath: options.extensionPath ?? '',
    extension: { packageJSON: { version: options.version ?? '0.0.0' } },
  };
  const deps = { execPath: options.execPath ?? 'C:\\Program Files\\VS Code\\Code.exe', startHandoff, env: options.env ?? {} };
  return { api, context: context as any, deps, seen, answers, settings, secrets, global, on };
}
