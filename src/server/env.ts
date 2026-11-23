// How the bundled server applies what the extension hands it. Pure: it changes the env object
// it is given (the server process's own process.env), which learn-mcp reads at each tool call.
//
// The rules:
// - A key saved in VS Code ("Learn: Set API key") wins. With it go the host and assignment from
//   the extension's settings.
// - With no key saved in VS Code, a developer who set FOREVERLEARNING_API_KEY in their own
//   environment keeps their whole setup: their key, and their host and assignment if they set them.
// - The project the test learner belongs to is the first workspace folder, unless the developer
//   set LEARN_MCP_PROJECT themselves.
import type { HandoffConfig } from '../protocol.ts';

export interface Inherited {
  key: string;
  baseUrl: string;
  assignmentId: string;
  project: string;
}

const read = (env: NodeJS.ProcessEnv, name: string) => (env[name] ?? '').trim();

export function captureInherited(env: NodeJS.ProcessEnv): Inherited {
  return {
    key: read(env, 'FOREVERLEARNING_API_KEY'),
    baseUrl: read(env, 'FOREVERLEARNING_BASE_URL'),
    assignmentId: read(env, 'FOREVERLEARNING_ASSIGNMENT_ID'),
    project: read(env, 'LEARN_MCP_PROJECT'),
  };
}

function put(env: NodeJS.ProcessEnv, name: string, value: string | null): void {
  if (value) env[name] = value;
  else delete env[name];
}

export function applyConfig(env: NodeJS.ProcessEnv, inherited: Inherited, config: HandoffConfig): void {
  const ownSetup = !config.key && inherited.key !== '';
  if (ownSetup) {
    put(env, 'FOREVERLEARNING_API_KEY', inherited.key);
    put(env, 'FOREVERLEARNING_BASE_URL', inherited.baseUrl || config.baseUrl);
    put(env, 'FOREVERLEARNING_ASSIGNMENT_ID', inherited.assignmentId || config.assignmentId);
  } else {
    put(env, 'FOREVERLEARNING_API_KEY', config.key);
    put(env, 'FOREVERLEARNING_BASE_URL', config.baseUrl);
    put(env, 'FOREVERLEARNING_ASSIGNMENT_ID', config.assignmentId);
  }
  put(env, 'LEARN_MCP_PROJECT', inherited.project || config.project);
}
