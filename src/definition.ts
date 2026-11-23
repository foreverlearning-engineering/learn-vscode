// The one server definition the extension provides. Pure, so the rules are tested:
// - It runs the bundled server with the editor's own runtime (process.execPath, as the VS Code
//   API documents for Node.js servers), so the developer needs no Node and no npm.
// - Its environment holds the handoff's address and token, never the key: VS Code caches this
//   definition on disk and forwards it to its Copilot harness as written.
// - It sets no working directory and uses no ${...} variables, which the Copilot harness would
//   flag or reject when the definition is forwarded.
import { join } from 'node:path';
import { ENV_HANDOFF, ENV_TOKEN, SERVER_LABEL, SERVER_SCRIPT } from './constants.ts';

export interface ServerLaunch {
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  version: string;
}

export function serverLaunch(options: { execPath: string; extensionPath: string; handoff: { address: string; token: string }; version: string }): ServerLaunch {
  return {
    label: SERVER_LABEL,
    command: options.execPath,
    args: [join(options.extensionPath, ...SERVER_SCRIPT)],
    env: {
      // The editor's executable acts as Node.js with this set. A plain Node.js runtime (as in a
      // remote extension host) ignores it.
      ELECTRON_RUN_AS_NODE: '1',
      [ENV_HANDOFF]: options.handoff.address,
      [ENV_TOKEN]: options.handoff.token,
    },
    version: options.version,
  };
}

// What would stop the Copilot harness from taking the definition as written.
export function forwardingProblems(launch: ServerLaunch): string[] {
  const problems: string[] = [];
  const values = [launch.command, ...launch.args, ...Object.values(launch.env)];
  if (values.some((v) => v.includes('${'))) problems.push('a ${...} variable');
  if ('cwd' in launch) problems.push('a working directory');
  return problems;
}
