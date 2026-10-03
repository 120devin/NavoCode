# Testing and compatibility

## Automated verification

Run `python3 -B -m unittest discover -s tests -p "test_*.py"` for the Python runtime. With Node.js installed, run `npm run check` and `npm run test:browser` from the repository root. Browser tests require `npx playwright install chromium`. Runtime commands do not require npm dependencies.

The test suite exercises:

- Valid and malformed specs, IDs, references, file paths, source digests, and semantic hashes.
- Changed and untracked files, renamed/deleted files, and source bindings that survive committing specs with code.
- Readiness with explicit human acceptance of decisions, observed behavior, open questions, coverage, and current evidence.
- UI feedback waking a waiting agent tool, redelivery before acknowledgement, responses, and spec refresh.
- Origin/token protection, stale feedback, invalid artifacts, timeout behavior, and reviewer action restrictions.
- Proposal serialization, revision checks, semantic preconditions, duplicate targets, and safe comment payloads.
- GitHub comment publication, verification, identity checks, retries, permissions, and changed heads using controlled API responses.
- Self-contained skill installation, invocation, reinstall/uninstall, and preservation of edited user files for four host layouts.
- Real Chromium author/reviewer interactions, architectural edits, proposal comparison, text escaping, and mobile layout.
- A complete Git lifecycle using a local bare remote: author pushes code/specs; reviewer fetches the exact head; a revision-bound proposal is adopted; author executes billing behavior checks, and pushes a new code/spec revision.

The GitHub API tests do not post comments to a live repository. The local lifecycle fixture's agent actions are implemented in the test harness; it does not use a model to generate the design. These tests validate the transport and contracts, not model judgment.

Before the Python migration, the active Codex agent also completed two real feedback rounds against a disposable project. Automated browser input requested a contract change and a compatibility explanation; the agent consumed both events through the CLI, inspected source, revised the spec, and returned responses that were verified in Chromium. This exercises the live agent bridge, but does not test automatic skill discovery in a newly started host session.

## Assistant compatibility

| Integration | Packaging verified | What remains host-dependent |
| --- | --- | --- |
| Claude Code | Native plugin and marketplace pass `claude plugin validate`; copied skill runner tested | Skill invocation, tool permissions, browser opening, and sustained live feedback in a user's session |
| Codex | Project skill runner and complete local feedback transport tested | Skill discovery after restart and the host's active-turn lifecycle |
| Cursor | Project skill runner tested | Skill discovery, active-turn behavior, and browser opening in Cursor |
| Copilot CLI | Project skill runner tested | Skill discovery, active-turn behavior, and browser opening in Copilot CLI |
| GitHub cloud agent | Not integrated in this release | No live local browser bridge from a GitHub PR comment |

The adapter is a portable skill plus a bundled Python CLI. It does not claim access to private host APIs. It can keep the conversation interactive while the assistant repeatedly consumes feedback; it cannot force an idle host to start another turn.

## Manual acceptance exercise

Use a disposable project and install the skill for the assistant under test. Start a new host session, then:

1. Ask the agent to use NavoCode for an architectural change spanning at least two responsibilities.
2. Confirm it inspects the project and replaces the initial skeleton with meaningful specs.
3. In the browser, ask one question and suggest one architectural change. Confirm both reach the active agent and the same page displays its responses and revised design.
4. Accept the design and request implementation. Confirm actual behavior changes and evidence is updated, then verify code/specs reach the authorized PR.
5. From another assistant session, open that PR in NavoCode without manually pulling it.
6. Suggest an alternative, publish its proposal, and verify the comment's payload and original-branch preservation.
7. Adopt it as the author. Verify updated behavior and specs, then repeat adoption after a head change to confirm stale proposals are rejected.

Only claim a host is fully end-to-end verified after completing this exercise in that host. Preserve authorization boundaries when testing live publication.

## Operational limits

- Python 3.10+ and Git are required; Node.js 20+ is needed only for npm compatibility commands and browser development tests; GitHub operations need an authenticated `gh`.
- GitHub.com PR URLs are supported. Enterprise URLs need a future host-aware adapter.
- Specs are limited to 2 MiB; comment proposal payloads to 24 KiB. Split large proposals into focused revisions.
- Git submodules are rejected during source binding rather than silently omitted.
- Local sessions bind to loopback and use a random token. Share specs, not session URLs/tokens.
- The source binding excludes `.navocode/` to avoid commit self-reference. Existing Git ignore rules determine which untracked source files are considered.
- The source/schema validators do not establish semantic conformance for arbitrary code. Human-readable gaps and agent reasoning remain necessary.
