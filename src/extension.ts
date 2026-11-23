// The extension's entry point. Its only job: register the Learn MCP server with the editor, and
// keep the developer's key in VS Code's secret storage. Everything else is in the server.
import * as vscode from 'vscode';
import { activateWith } from './activate.ts';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await activateWith(vscode, context);
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
