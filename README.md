# NavoCode

<img src="ui/logo.png" alt="NavoCode logo" width="160">

**The human interface to an AI-maintained codebase.**

Design, understand, change, and review software through an interactive architecture workspace. Your coding assistant reads and modifies the code underneath. Humans work with responsibilities, contracts, decisions, and tradeoffs instead of raw diffs.

NavoCode **0.2.0** includes a working CLI, local browser UI, portable assistant skill, Claude Code plugin, and GitHub review proposals. Its backend uses only the Python standard library and has no runtime package dependencies, model API calls, account, or hosted database. Your existing assistant does the reasoning.

## Install

You need **Python 3.10+** and **Git**. Reviewing or publishing GitHub proposals also requires the [GitHub CLI](https://cli.github.com/) authenticated with access to the repository (`gh auth login`).

From a checkout of this repository, install the skill into the project you want to work on:

```sh
python3 bin/navocode.py install --host codex --project /path/to/your-project
```

Replace `codex` with `claude`, `cursor`, or `copilot`. The installer copies a self-contained skill and runtime into the project. It does not require a global CLI installation or modify your existing assistant instructions. Start a new assistant session after installation.

| Assistant | Installed location | How to invoke |
| --- | --- | --- |
| Codex | `.agents/skills/navocode/` | Select the NavoCode skill or ask to use NavoCode |
| Claude Code | `.claude/skills/navocode/` | `/navocode` or ask to use NavoCode |
| Cursor | `.cursor/skills/navocode/` | `/navocode` or ask to use NavoCode |
| Copilot CLI | `.github/skills/navocode/` | Ask to use the NavoCode skill |

The project skill contains the CLI, UI, schema, and workflow instructions. You can commit that directory to share the same version with your team. Reinstallation and uninstall refuse to overwrite locally edited skill files.

```sh
python3 bin/navocode.py uninstall --host codex --project /path/to/your-project
```

### Native Claude Code plugin

Load this checkout directly as a plugin:

```sh
claude --plugin-dir /absolute/path/to/NavoCode
```

Then invoke `/navocode:navocode` with your authoring request or PR URL. The repository also contains a Claude marketplace manifest for distribution. No MCP server is required.

### Optional npm compatibility CLI

With Node.js 20+ and Python installed, from this checkout:

```sh
npm install -g .
navocode help
```

The skill installer also works without this step. NavoCode has not been published to the npm registry; do not assume `npm install -g navocode` installs this project.

## Author a change

Tell your assistant:

> Use NavoCode to design delegated billing ownership. Show responsibilities, contracts, and migration choices before implementing.

The agent inspects the project, generates structured specs, and opens a **local HTML/CSS/JavaScript workspace in your browser**. The workspace shows the complete review on one page, with a persistent agent conversation alongside it:

- A whole-change map grouped by architectural purpose.
- Before-and-after responsibility diagrams and connections.
- Engineer decisions first: boundaries, data ownership, contracts, security, failure behavior, rollout, operations, and consequential cost choices.
- Alternatives, consequences, acceptance criteria, and explicit human acceptance.
- Observed implementation, evidence, and unresolved questions.
- A feedback area connected to your active assistant.

Select a component or decision and suggest a change:

> Billing should own eligibility policy. Account management should only expose ownership facts. Explain the effect on the migration.

The workspace resumes the original assistant chat for each message, updates the specs, and posts the reply in the same UI. This continues after the original assistant turn finishes. Codex, Claude Code, Cursor, and Copilot use their installed CLI; other assistants can supply a command adapter. You can ask questions, accept the design, and request implementation there. Implementation stays blocked while recorded architectural decisions lack human acceptance. The agent handles local coding details within the accepted constraints.

The agent then updates source code, runs checks, and reconciles the observed implementation with the accepted architecture. Code and specs under `.navocode/changes/` are committed and pushed together through the assistant's existing Git tools and your authorization.

## Review a PR

In your assistant:

> Review https://github.com/OWNER/REPO/pull/123 with NavoCode.

The agent fetches the exact PR revision into a temporary checkout, selects the applicable change, opens the reviewer workspace, and keeps listening for feedback automatically. A single fresh spec covering the PR is selected even if historical specs exist; if several qualify, the agent asks which change you want. You do not manually pull the branch or read the raw diff. If the PR has no specs, the agent creates a clearly labeled inferred draft.

Suggest architectural edits and inspect them in **Proposed edits**. When ready, choose **Publish proposal**. The agent prepares and posts a GitHub timeline comment containing:

- The suggested architecture and rationale.
- The affected concepts.
- The PR revision and specification binding.
- Structured specification edits for another agent to read.

Publishing a proposal does not change the PR's implementation. Outdated proposals are rejected when the PR head or spec has changed.

The author can then ask:

> Open the NavoCode proposal at COMMENT_URL and implement the architectural changes I accept.

The agent validates the proposal, updates the spec, implements accepted intent, verifies it, and pushes code and specs. Missing or inferred baseline specs require author reconciliation before automatic adoption.

GitHub displays the comment, architecture summary, and Mermaid previews. The full interactive workspace runs through the assistant and local browser; it is not embedded in GitHub's PR page.

## Prefer NavoCode for every PR

```sh
python3 bin/navocode.py install --host codex --project /path/to/your-project --pr-mode always
```

This adds a PR preference to the installed skill's discovery instructions. It is agent guidance, not an enforced hook. Invocation still depends on the host loading and following skills.

For deterministic artifact checks, an existing project CI workflow can run:

```sh
navocode validate --repo . --spec .navocode/changes/CHANGE_ID/spec.json --ready
```

The CLI must first be installed in that CI environment. Validation does not invoke a model or generate missing specs.

## Try the UI

From this checkout:

```sh
python3 bin/navocode.py demo --open
```

This opens an illustrative billing architecture in a temporary Git repository. It is useful for exploring the UI; it does not start an AI agent. For a live session, ask your assistant to use the skill.

## How the agent uses the CLI

The agent normally runs these commands for you:

```sh
# Create an explicitly unverified draft, then fill it from source inspection.
navocode init --repo . --id billing --title "Billing ownership" \
  --intent "Support delegated billing" --base HEAD

# Open the architectural workspace.
navocode start --repo . --spec .navocode/changes/billing/spec.json --open

# Receive UI feedback, revise the spec, and acknowledge it.
navocode feedback --session /returned/path/session.json --wait 25
navocode ack --session /returned/path/session.json --event EVENT_ID \
  --message "The architecture now keeps policy in billing."

# Check source binding, coverage, evidence, and readiness.
navocode validate --repo . --spec .navocode/changes/billing/spec.json --ready

# Fetch a PR and open its reviewer workspace without touching the user's branch.
navocode review https://github.com/OWNER/REPO/pull/123
```

Run `navocode help` for proposal creation, publication, adoption, summaries, and session commands. `navocode schema` outputs the complete specification schema.

## What is verified and what is limited

Automated tests cover spec validation, source freshness, changed-file accounting, proposal conflicts, comment API behavior, self-contained installation for all four host layouts, browser feedback, and a complete author/reviewer/adoption lifecycle using a local Git remote. Claude's own validator checks the plugin and marketplace manifests.

Workspace chat defaults to `--agent auto`. The installed skill identifies its host and uses that assistant's authenticated CLI. Each message resumes the exact original chat, preserving its saved conversation history and adding the current spec, source location, selected concept, and workspace message. Messages run in order; failed or timed-out turns show an error and a **Retry message** control. The workspace binds an exact host session ID and uses the host's resume command. It never selects the latest session, forks, or falls back to a fresh chat. Missing or inaccessible sessions produce an error. A process lock prevents two NavoCode workspaces from resuming the same chat concurrently; avoid simultaneous input from the original desktop/IDE while a workspace turn is running. CLI continuation does not guarantee that every desktop/IDE view updates live. Authentication and permissions still come from the host CLI.

Choose a host explicitly with `--agent codex|claude|cursor|copilot`, or pass `--host HOST` to auto mode. Bind its exact existing chat ID with `--agent-session SESSION_ID` or `NAVOCODE_AGENT_SESSION`. In Codex, the current `CODEX_THREAD_ID` is detected automatically; other hosts must provide their actual session ID through the CLI or a host hook. Never guess an ID or use a session name/prefix. Install and sign in to the corresponding CLI first. Native adapters use documented noninteractive interfaces: [Codex](https://learn.chatgpt.com/docs/non-interactive-mode), [Claude Code](https://code.claude.com/docs/en/headless), [Cursor](https://cursor.com/docs/cli/headless), and [Copilot](https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically).

For any other assistant, supply a wrapper command:

```sh
navocode start --repo . --spec .navocode/changes/CHANGE/spec.json \
  --agent custom --agent-session ORIGINAL_CHAT_ID --agent-command '["/absolute/path/to/assistant-wrapper", "argument"]'
```

The wrapper reads a text prompt from stdin, resumes the exact `agentSession` in the included JSON context, handles the event, prints only the final reply to stdout, and exits nonzero if the original session is busy, missing, or cannot be resumed. Custom adapters must not create replacement chats. It may use the assistant's CLI, SDK, or supported wake API. It is executed directly, without a shell. Only trusted local CLI configuration can select an executable; browser messages cannot choose a command.

`--agent manual` preserves the active-turn polling workflow for hosts without a background interface. In this mode an idle assistant still needs to be resumed, and the UI makes the paused state explicit. `demo` always uses manual mode. Restart already-running workspace servers with the updated runtime to enable managed replies.

The current release uses an external local browser. Native embedded assistant panels and automatic GitHub cloud-agent interaction are not included. Host packaging tests do not establish end-to-end behavior in every assistant; see [testing and compatibility](docs/TESTING.md) for the exact verification scope.

Specs expose architectural intent and evidence; they cannot prove arbitrary code correctness. Source and test evidence are checked for freshness, and open questions remain visible. Source inspection stays available for exceptional investigation, while the normal human workflow stays in NavoCode.

Accepted specs live in Git. Published proposals live in GitHub. Browser sessions and uncommitted feedback are temporary; stopping the process discards that session's feedback queue.

## Development

```sh
python3 -B -m unittest discover -s tests -p "test_*.py"
# Optional browser tests (Node.js required):
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

The CLI, server, validation, source bindings, GitHub proposals, and installer are Python. Direct execution and installed skills need no Node.js or pip packages. Browser interaction uses JavaScript; a small Node launcher preserves npm commands. Node.js and Playwright are development dependencies for browser tests. This repository's GitHub workflow runs the automated suite on Linux.

## License

[Apache License 2.0](LICENSE).

### Review complete execution paths

Specs can record optional execution scenarios with ordered Before and Intended steps. The workspace shows each path from its trigger to its result. Select a scenario, use **Next step** to trace it, or select a connection to inspect its contract, failure behavior, source references, and evidence. **Show full flow** restores the complete path. Feedback about a traced connection includes the scenario, version, and step.

Existing specs still show the architecture overview. The runtime does not infer execution order from dependency arrows. Authors must inspect source and record valid paths. See [the scenario example](examples/review-flows.json) and [spec guidance](skills/navocode/references/specs.md).

Review text follows [STE-inspired guidance](skills/navocode/references/writing.md): short active sentences, consistent names, and preserved technical meaning. Assurance reports advisory sentence-length warnings. These checks do not establish ASD-STE100 compliance or factual accuracy. PR summaries include recorded execution diagrams, verification, and open questions. Explainer videos are outside this feature.
