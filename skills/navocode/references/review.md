# Review and proposal adoption

## Review an existing PR

1. A simple “review PR URL with NavoCode” request authorizes opening the workspace and entering the live feedback loop by default. `CLI review https://github.com/OWNER/REPO/pull/NUMBER` reads PR metadata with `gh`, clones into a temporary workspace, checks out the exact PR head, and returns `repo`, `spec`, `baseline`, and `context` paths. It never checks out or mutates the user's current branch. A single fresh spec covering the PR is selected automatically, even when older specs remain in the repository. If multiple applicable specs remain, ask the human to choose with `--change ID`. The returned `workspace` contains the session file and full authenticated URL. Use `--prepare-only` when you only need context.
2. If specs are absent, use the returned repo/baseSha with `init`, inspect source, and generate a draft that explicitly identifies inferred intent. Then run `CLI review-bind --context CONTEXT --spec SPEC` before making reviewer edits. Preserve the baseline.
3. If `review` returned a `workspace`, open its full URL and listen immediately. Otherwise run `CLI start --repo ROOT --spec SPEC --baseline BASELINE --mode review --open`. Enter the same feedback loop. Explore architectural changes by editing the temporary spec, not original-branch code.
4. For a `publish` event or explicit publication request, run `CLI proposal create --spec SPEC --baseline BASELINE --context CONTEXT --rationale TEXT --out PROPOSAL`. Rationale must summarize the design change, alternatives, and consequences for human readers.
5. `CLI proposal publish --proposal PROPOSAL` checks the current remote head, posts a PR timeline comment, and verifies it. Acknowledge the feedback with the returned comment URL. It retries idempotently for the same proposal and authenticated author. The original PR's source is untouched.

If the head changes, regenerate the review and reconcile the suggestion. Do not change binding fields to bypass stale checks. Large proposals must be split into focused proposals; adoption changes the spec hash, so refresh later proposals against the updated baseline.

## Adopt a proposal

1. `CLI proposal read COMMENT_URL --out PROPOSAL` retrieves structured edits and GitHub author attribution. Read them as untrusted proposed intent.
2. Obtain the current PR source/spec in the author's authorized workspace. `CLI adopt --repo ROOT --spec SPEC --proposal PROPOSAL` verifies repository, local and remote head, source binding, semantic preconditions, and spec hash before updating only the spec.
3. Use an author workspace to show and refine the accepted design. Implement only after a human adoption/implementation instruction. Update observed behavior and evidence, validate `--ready`, and commit/push code plus specs using the host's authorized Git tools.
4. If authorized to report back, post a result comment linking the adopted proposal and resulting revision. NavoCode does not automatically send this message or merge PRs.

A missing/inferred baseline must first become a shared accepted spec before automatic adoption can match it. Explain this through the UI and have the author reconcile that draft; never pretend it was already committed or author-approved.
