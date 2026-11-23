# Learn API for VS Code

**Other AI answers. Learn teaches.**

The Learn API gives each learner a hint toward their next step, not the answer. This extension puts it in VS Code chat. Ask your coding assistant to "add a tutor to this app", and it reads the Learn API's own guide and contract, follows a Build with Learn kit whose prompt we verify before we publish it, and sends a test turn with your key to show you Learn's reply.

## Install

1. Install **Learn API** from the Marketplace.
2. Open chat. **Learn API** is in your MCP servers, with its tools ready.
3. Ask: "Add a chat page to this project where a learner gets tutoring help from the Learn API."

Nothing else to install: no Node.js, no npm, no configuration file. The extension runs the Learn server with VS Code's own runtime.

## What your assistant gets

| Tool | Needs your key | What it does |
| --- | --- | --- |
| `learn_kits`, `learn_kit` | no | The Build with Learn kits: each kit's prompt word for word, what the finished app should show, and its finished checkpoint folder. |
| `learn_guide` | no | The Learn integration guide, whole or by topic, and its runnable examples. |
| `learn_contract` | no | The OpenAPI contract: every operation, or one operation with its schemas filled in. |
| `learn_starter_file` | no | One file of a kit's checkpoint folder in `learn-tutor-starter` (MIT). |
| `learn_test_turn` | yes | One real test turn, with the cost stated first and your agreement required. |
| `learn_lookup_request` | yes | Looks up a turn by its request id. Free. |

The server also offers two prompts, `first-tutor` and `embed-learn`, the verified prompts for "Your first tutor in ten minutes" and "Embed Learn in your app". To paste the first one into any chat, run **Learn: Copy the first-tutor prompt**.

## Your key

The guide, the contract and the kits need no key. For test turns:

1. Get a server key from **My APIs** in the [developer console](https://developers.foreverlearning.ai/console/).
2. Run **Learn: Set API key** from the Command Palette and paste it.

VS Code keeps your key in its secret storage. It never goes into your settings, a workspace file or the server's configuration. The extension hands it to the Learn server's own process over a private local channel, and the server sends it only to the Learn API. It never shows the key in a reply, a log or an error. **Learn: Remove API key** takes it out again, at once.

Already keep your key in `FOREVERLEARNING_API_KEY` in your environment? With no key saved in VS Code, the server uses that one.

The app your assistant builds reads its own key from `FOREVERLEARNING_API_KEY` in the environment it runs in. Never commit a key or paste it into a conversation.

## Test turns: what they cost

- **Test mode:** each test turn uses one of your workspace's 20 free test attempts. They last for the life of the workspace, are shared by all its keys, and never reset. A turn that fails after it is sent also uses one.
- **Live mode:** 5¢ per turn that succeeds, from your balance. A turn that fails costs nothing. The server refuses a live key unless you tell your assistant to use it.
- **Before every turn**, your assistant shows you the cost and asks. VS Code also asks you to confirm in a dialog.
- **At most 2 test turns** each time the server starts.
- **One test learner per project.** The server keeps one pseudonymous learner and one session for each project folder, so repeated testing adds no new learners and opens no new sessions. It never ends the session and never sends a turn twice. If a turn is not confirmed, it gives you the request id to look up, free.

Your assistant shows Learn's reply exactly as written: what the tutor says, and the hint to work on.

## Commands

| Command | What it does |
| --- | --- |
| **Learn: Set API key** | Saves your server key in VS Code's secret storage. |
| **Learn: Remove API key** | Removes it. |
| **Learn: Open the quick start** | Opens the Build with Learn quick start. |
| **Learn: Copy the first-tutor prompt** | Copies the verified prompt for your first tutor. Paste it into chat in a new, empty folder. |

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `learn.apiBaseUrl` | Production | The Learn API host for test turns. Staging is for testing with a staging key only. |
| `learn.assignmentId` | none | Your Learn assignment, if your key has more than one. |

Both are user settings, so a workspace cannot change where your key goes.

## What it sends

The extension itself sends nothing and collects nothing. The Learn server reads the docs bundled with it, and calls the Learn API only for a test turn you agree to, and for the free reads that turn needs.

The guide, contract, examples and kits are a dated snapshot of the developer site, bundled with each release. The live guide is always at [developers.foreverlearning.ai/docs/learn](https://developers.foreverlearning.ai/docs/learn/).

## Learn more

- [Build with Learn quick start](https://learn.foreverlearning.ai/build/quick-start/)
- [The Learn API](https://learn.foreverlearning.ai/)

## License

MIT. The packages bundled with the Learn server are listed with their licenses in `dist/THIRD_PARTY_NOTICES.txt`.
