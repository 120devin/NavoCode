# NavoCode launch kit

Prepared October 2, 2026. Channel requirements were checked on this date; check the latest thread and rules before submitting. These are drafts, not published posts. No user adoption or productivity claims are implied.

## Audience and message

Start with developers using coding agents to make changes that cross component boundaries, plus engineers reviewing those changes. Ask them to try one real change and report what was useful or missing.

Core message: **Understand and steer AI-generated changes through an interactive architecture workspace.**

Support it with responsibilities, contracts, decisions, alternatives, and visible evidence. NavoCode uses the existing assistant for reasoning, runs a local browser workspace, and stores accepted specs in Git. Avoid claiming that specs prove correctness or that every host has been tested end to end.

Repository: https://github.com/120devin/NavoCode

## Assets

- [Workspace screenshot](assets/workspace.png): actual illustrative billing demo, with pending decisions and no running agent.
- [Architecture screenshot](assets/architecture.png): current workspace's intended architecture view.
- [Silent walkthrough](assets/workspace-walkthrough.mp4): 40 seconds of the real UI. A persistent label states that no AI agent is running. It shows decisions, the map, Before/Intended switching, selecting billing, and drafting a question. It does not show implementation or an assistant response.
- [Capture script](capture-demo.mjs): rerun from the repository root with `node docs/promotion/capture-demo.mjs`. Requires the development Playwright dependency and Chromium, plus FFmpeg with drawtext and the macOS Arial font. These are capture dependencies, not product runtime dependencies.

Upload the MP4 natively to a social post where supported. Attach a screenshot to the Reddit comment if supported; otherwise use the repository link. Add descriptive alt text to images.

## Reddit: weekly self-promotion comment

Find the newest weekly thread in [r/ChatGPTCoding](https://www.reddit.com/r/ChatGPTCoding/). The [thread checked during research](https://www.reddit.com/r/ChatGPTCoding/comments/1ws8gju/weekly_self_promotion_thread/) requests context, affiliation, tools used, and a concrete feedback request. Do not repost unchanged every week.

Draft:

> I'm the creator of NavoCode, an open-source architecture workspace for developers working with coding agents.
>
> The problem it addresses: a change can touch many files while the important review questions are about responsibility, data ownership, contracts, and migration. NavoCode puts those decisions in a local browser workspace, where you can inspect alternatives and send feedback to your active assistant.
>
> It includes skill installers for Codex, Claude Code, Cursor, and Copilot CLI, plus a Claude Code plugin. NavoCode itself makes no model API calls; your existing assistant does the reasoning. Host packaging is tested, but end-to-end behavior is not verified in every assistant.
>
> You can explore the illustrative UI with Python 3.10+ and Git:
>
> `git clone https://github.com/120devin/NavoCode.git`
>
> `cd NavoCode`
>
> `python3 bin/navocode.py demo --open`
>
> The demo doesn't start an AI agent. A live workflow requires installing the skill and invoking it in your assistant.
>
> I'd value feedback from people reviewing agent-generated changes: which responsibility or contract would you want this workspace to make explicit before accepting a change?
>
> https://github.com/120devin/NavoCode

## LinkedIn post

Draft; attach the labeled walkthrough:

> Who owns policy after an AI-generated change? Which contracts stay compatible? What remains unverified?
>
> I'm building NavoCode to make those questions visible in an interactive architecture workspace. Your existing coding assistant maps responsibilities and decisions, receives your feedback, and implements the choices you accept.
>
> It's open source, runs locally, and makes no model API calls of its own. Skills are packaged for Codex, Claude Code, Cursor, and Copilot CLI; compatibility details are in the README.
>
> This video shows the illustrative billing UI, without an AI agent running. I'm looking for developers willing to try the live workflow on one change and tell me where the architecture view helps—or falls short.
>
> https://github.com/120devin/NavoCode

## X post

Draft; attach the labeled walkthrough:

> I built NavoCode to understand and steer AI-generated changes through an architecture workspace: responsibilities, contracts, decisions, and feedback to your coding assistant.
>
> Open source. Local UI. Demo below.
>
> https://github.com/120devin/NavoCode

## Console submission email

Recipient: hello@console.dev. [Console's criteria](https://console.dev/selection-criteria) accept tool submissions and emphasize developer usefulness, self-service access, quality, maintenance, and documentation. No feature is guaranteed.

Subject: NavoCode — open-source architecture workspace for coding agents

Draft:

> Hello Console team,
>
> I'm the creator of NavoCode, an open-source local architecture workspace for authoring and reviewing software changes with coding assistants.
>
> It presents responsibilities, contracts, decisions, alternatives, and evidence for a change. Developers can send architectural feedback to their active assistant, accept decisions before implementation, and prepare GitHub review proposals.
>
> NavoCode 0.2.0 uses Python's standard library for its backend, requires no separate account or model API key, and uses the developer's existing assistant for reasoning. It includes portable skills and a Claude Code plugin. Compatibility and current limitations are documented.
>
> Repository and quick demo: https://github.com/120devin/NavoCode
>
> The README includes screenshots and a labeled walkthrough of the illustrative billing demo. After cloning, `python3 bin/navocode.py demo --open` opens the UI without starting an agent.
>
> Thank you for considering it.

## Show HN: human-written submission

Write the title, submission text, and replies yourself. [HN guidelines](https://news.ycombinator.com/newsguidelines.html) prohibit generated and AI-edited text, automated posting, and soliciting votes or comments. This kit intentionally contains no ready-to-post HN copy.

Use [Show HN's requirements](https://news.ycombinator.com/showhn.html) as a checklist:

- Link the runnable project, not a signup-only page.
- Explain the problem you personally worked on and why you chose this approach.
- Give the clone-and-demo steps and distinguish the UI demo from a live assistant session.
- Explain the active-assistant requirement, inferred specs, and evidence limitations.
- Be available to answer engineering questions. Do not arrange votes or delete and repost for visibility.

## Claude resource list: later, human submission

[Awesome Claude Code contribution requirements](https://github.com/hesreallyhim/awesome-claude-code/blob/main/CONTRIBUTING.md) require either 14 days since the first commit on the default branch with development after day one, or 100 stars. The first commit is dated October 2, 2026, at 3:57 p.m. Pacific, so the age route is not available before October 16 at that time; verify the other criteria then.

Recommendations must be created by a human through the web issue form. Do not use `gh`, open a PR, or substitute a discussion post. Write your own description in the [resource recommendation form](https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml). Acceptance and responses are discretionary.

## Technical article outline

Suggested topic: **Reviewing the architecture of an AI-generated PR.**

1. Introduce delegated billing: account identity and delegation belong to account management; eligibility policy belongs to billing.
2. Show how a change affects responsibilities and the client contract.
3. Show the current and intended maps, decisions, and alternatives.
4. Run and record a genuine assistant feedback loop on an example repository before describing implementation results. The current UI video does not demonstrate that loop.
5. Explain how specs bind to source, what evidence is available, and what remains uncertain.
6. End with the quick demo, installation steps, and one specific request for reader feedback.

Publish a substantive walkthrough on DEV; reuse its concrete example in social posts. Do not invent a measured improvement or customer story.

## Launch sequence and measurement

1. Merge the launch assets and README; check image and video links on GitHub.
2. Share in the newest Reddit promotion thread and publish the social video. Record each post URL and time.
3. Help interested developers try one real change. Record host, setup failures, useful decisions, missing context, and whether they return.
4. Fix the most common onboarding failures before the human-written Show HN launch.
5. Submit the Console email; consider the Claude resource list when eligible.

Initial learning target: five developers try a real change, three provide detailed feedback. These are goals, not traffic forecasts.

Use GitHub's repository traffic view to record visitors, clones, and referring sites promptly; it has a limited retention window. Track stars separately from reported usage. No telemetry needs to be added to users' local workspaces.

| Channel | Post URL | Posted at | Visitors/clones after posting | Reported real trials | Setup blockers | Repeat use |
| --- | --- | --- | --- | --- | --- | --- |
| Reddit weekly thread | | | | | | |
| LinkedIn | | | | | | |
| X | | | | | | |
| Show HN | | | | | | |
| Console | | | | | | |
