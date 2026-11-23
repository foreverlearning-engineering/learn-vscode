// Everything the extension does, written against an injected VS Code API so tests can run it
// without the editor. extension.ts passes the real one.
import type * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSOLE_URL, NOTICE_SHOWN, PROVIDER_ID, QUICK_START_URL, SECRET_NAME, SERVER_NAME, SNAPSHOT_FILE } from './constants.ts';
import { serverLaunch, type ServerLaunch } from './definition.ts';
import { startHandoff, type Handoff, type HandoffOptions } from './handoff.ts';
import { checkKey } from './keyInput.ts';
import { firstTutorKit, type SnapshotKits } from './prompts.ts';
import type { HandoffConfig } from './protocol.ts';
import { readSettings } from './settings.ts';

export type Api = Pick<typeof vscode, 'lm' | 'commands' | 'window' | 'workspace' | 'env' | 'Uri' | 'McpStdioServerDefinition'>;

// Cursor registers extension servers through its own API (vscode.cursor.mcp).
interface CursorMcp {
  registerServer(config: { name: string; server: { command: string; args: string[]; env: Record<string, string> } }): void;
  unregisterServer(name: string): void;
}

export interface Deps {
  execPath: string;
  startHandoff: (options: HandoffOptions) => Promise<Handoff>;
  // The developer's own environment, read only to decide whether to offer the key notice.
  env: NodeJS.ProcessEnv;
}

export interface Activated {
  handoff: Handoff;
  launch: ServerLaunch;
  registeredWith: 'vscode' | 'cursor' | 'none';
}

type Context = Pick<vscode.ExtensionContext, 'secrets' | 'globalState' | 'subscriptions' | 'extensionPath'> & { extension: { packageJSON: { version: string } } };

export async function activateWith(api: Api, context: Context, deps: Deps = { execPath: process.execPath, startHandoff, env: process.env }): Promise<Activated> {
  const log = api.window.createOutputChannel('Learn API', { log: true });
  context.subscriptions.push(log);

  const getConfig = async (): Promise<HandoffConfig> => {
    const key = (await context.secrets.get(SECRET_NAME)) ?? null;
    const settings = readSettings((name) => api.workspace.getConfiguration('learn').get(name));
    for (const note of settings.notes) log.warn(note);
    const folder = api.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'file');
    return { key, baseUrl: settings.baseUrl, assignmentId: settings.assignmentId, project: folder ? folder.uri.fsPath : null };
  };

  let noticePending = false;
  const offerKey = async () => {
    if (noticePending || context.globalState.get<boolean>(NOTICE_SHOWN)) return;
    if (await context.secrets.get(SECRET_NAME)) return;
    if ((deps.env.FOREVERLEARNING_API_KEY ?? '').trim() !== '') return;
    noticePending = true;
    await context.globalState.update(NOTICE_SHOWN, true);
    const pick = await api.window.showInformationMessage(
      'The Learn API is in your chat tools. Its guide, contract and kits work now. To send a test turn, set your API key.',
      'Set API key', 'Get a key');
    if (pick === 'Set API key') await api.commands.executeCommand('learn.setApiKey');
    else if (pick === 'Get a key') await api.env.openExternal(api.Uri.parse(CONSOLE_URL));
  };

  const handoff = await deps.startHandoff({
    getConfig,
    onServer: () => {
      log.info('The Learn server connected.');
      void offerKey();
    },
  });
  context.subscriptions.push({ dispose: () => void handoff.close() });

  const update = async (why: string) => {
    handoff.push(await getConfig());
    log.info(why + ' Sent to ' + handoff.connected() + ' running Learn server' + (handoff.connected() === 1 ? '' : 's') + '.');
  };
  context.subscriptions.push(
    context.secrets.onDidChange((e) => { if (e.key === SECRET_NAME) void update('The saved key changed.'); }),
    api.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('learn')) void update('The Learn settings changed.'); }),
    api.workspace.onDidChangeWorkspaceFolders(() => void update('The workspace folders changed.')),
  );

  const launch = serverLaunch({ execPath: deps.execPath, extensionPath: context.extensionPath, handoff, version: context.extension.packageJSON.version });

  let registeredWith: Activated['registeredWith'] = 'none';
  const cursorMcp = (api as unknown as { cursor?: { mcp?: Partial<CursorMcp> } }).cursor?.mcp;
  if (typeof cursorMcp?.registerServer === 'function') {
    cursorMcp.registerServer({ name: SERVER_NAME, server: { command: launch.command, args: launch.args, env: launch.env } });
    context.subscriptions.push({ dispose: () => cursorMcp.unregisterServer?.(SERVER_NAME) });
    registeredWith = 'cursor';
  } else if (typeof api.lm?.registerMcpServerDefinitionProvider === 'function') {
    context.subscriptions.push(api.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      provideMcpServerDefinitions: () => [new api.McpStdioServerDefinition(launch.label, launch.command, launch.args, launch.env, launch.version)],
    }));
    registeredWith = 'vscode';
  } else {
    log.error('This editor has no API for registering MCP servers, so the Learn server is not available here.');
  }
  log.info('Learn server registered (' + registeredWith + ').');

  context.subscriptions.push(
    api.commands.registerCommand('learn.setApiKey', async () => {
      const value = await api.window.showInputBox({
        title: 'Learn: Set API key',
        prompt: 'Your Learn API server key, from My APIs in the developer console. VS Code keeps it in its secret storage, never in your settings or files.',
        placeHolder: 'Paste your server key',
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => {
          const r = checkKey(v);
          return r.ok ? undefined : r.message;
        },
      });
      if (value === undefined) return;
      const r = checkKey(value);
      if (!r.ok) return;
      await context.secrets.store(SECRET_NAME, r.key);
      await update('A key was saved.');
      void api.window.showInformationMessage('Learn API key saved. The Learn test-turn tool uses it from now on.');
    }),

    api.commands.registerCommand('learn.removeApiKey', async () => {
      if (!(await context.secrets.get(SECRET_NAME))) {
        void api.window.showInformationMessage('No Learn API key is saved in VS Code.');
        return;
      }
      await context.secrets.delete(SECRET_NAME);
      await update('The saved key was removed.');
      void api.window.showInformationMessage('Learn API key removed from VS Code. The guide, contract and kits still work.');
    }),

    api.commands.registerCommand('learn.openQuickStart', () => api.env.openExternal(api.Uri.parse(QUICK_START_URL))),

    api.commands.registerCommand('learn.copyFirstTutorPrompt', async () => {
      let kit: ReturnType<typeof firstTutorKit>;
      try {
        kit = firstTutorKit(JSON.parse(readFileSync(join(context.extensionPath, ...SNAPSHOT_FILE), 'utf8')) as SnapshotKits);
      } catch (error) {
        log.error('Could not read the bundled docs: ' + String((error as Error).message));
      }
      if (!kit) {
        void api.window.showErrorMessage('The first-tutor prompt is missing from this install of the Learn extension.');
        return;
      }
      await api.env.clipboard.writeText(kit.prompt);
      void api.window.showInformationMessage(
        'Copied the first-tutor prompt. Open a new, empty folder and paste it into chat in agent mode. The app it builds reads your key from FOREVERLEARNING_API_KEY in its own environment.',
        'Open the quick start',
      ).then((pick) => { if (pick) void api.env.openExternal(api.Uri.parse(QUICK_START_URL)); });
    }),
  );

  return { handoff, launch, registeredWith };
}
