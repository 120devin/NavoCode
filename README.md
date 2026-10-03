# NavoCode

**The human interface to an AI-maintained codebase.**

Design, understand, change, and review software through an interactive architecture workspace. Your coding assistant reads and modifies the code underneath. Humans work with responsibilities, contracts, decisions, and tradeoffs instead of raw diffs.

NavoCode **0.1.0** includes a working CLI, local browser UI, portable assistant skill, Claude Code plugin, and GitHub review proposals. It has no runtime npm dependencies, model API calls, account, or hosted database. Your existing assistant does the reasoning.

## Install

You need **Node.js 20+** and **Git**. Reviewing or publishing GitHub proposals also requires the [GitHub CLI](https://cli.github.com/) authenticated with access to the repository (`gh auth login`).

From a checkout of this repository, install the skill into the project you want to work on:

```sh
node bin/navocode.js install --host codex --project /path/to/your-project
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
node bin/navocode.js uninstall --host codex --project /path/to/your-project
```

### Native Claude Code plugin

Load this checkout directly as a plugin:

```sh
claude --plugin-dir /absolute/path/to/NavoCode
```

Then invoke `/navocode:navocode` with your authoring request or PR URL. The repository also contains a Claude marketplace manifest for distribution. No MCP server is required.

### Optional global CLI

From this checkout:

```sh
npm install -g .
navocode help
```

The skill installer also works without this step. NavoCode has not been published to the npm registry; do not assume `npm install -g navocode` installs this project.

## Author a change

Tell your assistant:

> Use NavoCode to design delegated billing ownership. Show responsibilities, contracts, and migration choices before implementing.

The agent inspects the project, generates structured specs, and opens a **local HTML/CSS/JavaScript workspace in your browser**. The workspace shows:

- A whole-change map grouped by architectural purpose.
- Before-and-after responsibility diagrams and connections.
- Decisions, alternatives, consequences, and acceptance criteria.
- Observed implementation, evidence, and unresolved questions.
- A feedback area connected to your active assistant.

Select a component or decision and suggest a change:

> Billing should own eligibility policy. Account management should only expose ownership facts. Explain the effect on the migration.

Your agent receives the feedback through the CLI, updates the specs, and explains the result in the same UI. You can ask questions, accept the design, and request implementation there.

The agent then updates source code, runs checks, and reconciles the observed implementation with the accepted architecture. Code and specs under `.navocode/changes/` are committed and pushed together through the assistant's existing Git tools and your authorization.

## Review a PR

In your assistant:

> Use NavoCode to review https://github.com/OWNER/REPO/pull/123.

The agent fetches the exact PR revision into a temporary checkout and opens the same workspace. You do not manually pull the branch or read the raw diff. If the PR has no specs, the agent creates a clearly labeled inferred draft.

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
node bin/navocode.js install --host codex --project /path/to/your-project --pr-mode always
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
node bin/navocode.js demo --open
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

# Fetch a PR for review without touching the user's working branch.
navocode review https://github.com/OWNER/REPO/pull/123
```

Run `navocode help` for proposal creation, publication, adoption, summaries, and session commands. `navocode schema` outputs the complete specification schema.

## What is verified and what is limited

Automated tests cover spec validation, source freshness, changed-file accounting, proposal conflicts, comment API behavior, self-contained installation for all four host layouts, browser feedback, and a complete author/reviewer/adoption lifecycle using a local Git remote. Claude's own validator checks the plugin and marketplace manifests.

The interactive loop requires an **active assistant turn** that runs the feedback command. A browser click cannot wake an idle assistant by itself. If the host stops, ask it to resume the NavoCode session; no manual copying of UI feedback is needed while the local process remains alive.

The current release uses an external local browser. Native embedded assistant panels and automatic GitHub cloud-agent interaction are not included. Host packaging tests do not establish end-to-end behavior in every assistant; see [testing and compatibility](docs/TESTING.md) for the exact verification scope.

Specs expose architectural intent and evidence; they cannot prove arbitrary code correctness. Source and test evidence are checked for freshness, and open questions remain visible. Source inspection stays available for exceptional investigation, while the normal human workflow stays in NavoCode.

Accepted specs live in Git. Published proposals live in GitHub. Browser sessions and uncommitted feedback are temporary; stopping the process discards that session's feedback queue.

## Development

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

The runtime uses Node built-ins and browser APIs. Playwright is a development-only dependency. This repository's GitHub workflow runs the automated suite on Linux.

## License

[Apache License 2.0](LICENSE).
