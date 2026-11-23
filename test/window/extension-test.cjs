// Runs inside a real VS Code window, started by scripts/window-check.mjs with an isolated profile.
// It starts the Learn server through VS Code's own MCP client, invokes two of its tools as a
// chat would, and writes what it saw to LEARN_WINDOW_RESULTS. VS Code closes when it returns.
// Never run by `npm test`: it opens a window.
const vscode = require('vscode');
const { writeFileSync } = require('node:fs');

const SERVER_ID = 'foreverlearning.learn-api/Learn API';
const redact = (text) => String(text)
  .split(process.env.FOREVERLEARNING_API_KEY || '\u0000').join('<redacted-key>')
  .replace(/fl_(?:live|stag|test)_[0-9a-f]{16,}(?:_[0-9a-f]+)?/gi, '<redacted-key>');
const textOf = (result) => (result?.content ?? []).map((p) => p.value ?? p.text ?? '').join('\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.run = async function run() {
  const results = { vscode: vscode.version, steps: [] };
  const step = (name, ok, detail) => results.steps.push({ name, ok, detail: redact(detail ?? '') });
  try {
    const ext = vscode.extensions.getExtension('foreverlearning.learn-api');
    step('the extension is installed', Boolean(ext));
    await ext.activate();
    step('it activates', ext.isActive);

    const commands = await vscode.commands.getCommands(true);
    const ours = ['learn.setApiKey', 'learn.removeApiKey', 'learn.openQuickStart', 'learn.copyFirstTutorPrompt'];
    step('its four commands are registered', ours.every((c) => commands.includes(c)), ours.filter((c) => !commands.includes(c)).join(', '));

    // VS Code adds a provider's servers to its list on a 500 ms timer (McpService.updateCollectedServers),
    // so a start right after activation can find no server yet. Start again until the tools appear.
    const learnTools = () => vscode.lm.tools.filter((t) => /learn_(kits|kit|guide|contract|starter_file|test_turn|lookup_request)$/.test(t.name));
    let tools = [];
    const startedAt = Date.now();
    for (let attempt = 1; attempt <= 40 && tools.length < 7; attempt++) {
      await vscode.commands.executeCommand('workbench.mcp.startServer', SERVER_ID, { waitForLiveTools: true });
      tools = learnTools();
      if (tools.length < 7) await sleep(500);
    }
    step('VS Code started the server and lists its 7 tools', tools.length === 7,
      tools.length ? tools.map((t) => t.name).join(', ') + ' (after ' + ((Date.now() - startedAt) / 1000).toFixed(1) + ' s)'
        : 'none after ' + ((Date.now() - startedAt) / 1000).toFixed(0) + ' s; VS Code lists ' + vscode.lm.tools.length + ' tools: '
          + vscode.lm.tools.map((t) => t.name).filter((n) => /mcp|learn/i.test(n)).slice(0, 20).join(', '));
    if (tools.length < 7) throw new Error('the Learn tools never appeared');

    const kits = tools.find((t) => t.name.endsWith('learn_kits'));
    const kitsText = textOf(await vscode.lm.invokeTool(kits.name, { input: {}, toolInvocationToken: undefined }));
    step('learn_kits answers through VS Code', /01-first-tutor/.test(kitsText), kitsText.slice(0, 300));

    // Without confirm, learn_test_turn sends no turn: with no key it says so; with a key it makes
    // only the free catalog read and returns the cost preview.
    const turn = tools.find((t) => t.name.endsWith('learn_test_turn'));
    const turnText = textOf(await vscode.lm.invokeTool(turn.name, { input: { message: 'I am stuck on 3x + 5 = 20. Can you just tell me what x is?' }, toolInvocationToken: undefined }));
    step('learn_test_turn (no confirm: nothing sent)', /No Learn API key is set|Not sent/.test(turnText), turnText.slice(0, 400));
  } catch (error) {
    step('error', false, error && error.stack ? error.stack : String(error));
  }
  writeFileSync(process.env.LEARN_WINDOW_RESULTS, JSON.stringify(results, null, 2));
};
