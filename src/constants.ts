// Facts the extension and its bundled server share, kept in one place.

// The provider id in package.json (contributes.mcpServerDefinitionProviders) and the label
// VS Code shows for the server.
export const PROVIDER_ID = 'learn';
export const SERVER_NAME = 'learn';
export const SERVER_LABEL = 'Learn API';

// The API hosts the learn.apiBaseUrl setting may name. The key is sent to this host, so no
// other host is accepted (and the setting is machine-scoped, so a workspace cannot change it).
export const PRODUCTION_BASE_URL = 'https://developers-api.foreverlearning.ai/v1';
export const STAGING_BASE_URL = 'https://developers-api-staging.foreverlearning.ai/v1';
export const ALLOWED_BASE_URLS: readonly string[] = [PRODUCTION_BASE_URL, STAGING_BASE_URL];

export const QUICK_START_URL = 'https://learn.foreverlearning.ai/build/quick-start/';
export const CONSOLE_URL = 'https://developers.foreverlearning.ai/console/';

// Where the key lives: VS Code's SecretStorage, under this name. Nowhere else.
export const SECRET_NAME = 'learn.apiKey';
// Set once the one-time "set your key" notice has been shown.
export const NOTICE_SHOWN = 'learn.keyNoticeShown';

// The built files, relative to the extension's folder.
export const SERVER_SCRIPT = ['dist', 'server', 'learn-mcp.mjs'] as const;
export const SNAPSHOT_FILE = ['dist', 'snapshot', 'learn-docs.json'] as const;

// The environment the server starts with: how to reach this window's key handoff, never the key.
export const ENV_HANDOFF = 'LEARN_VSCODE_HANDOFF';
export const ENV_TOKEN = 'LEARN_VSCODE_TOKEN';
