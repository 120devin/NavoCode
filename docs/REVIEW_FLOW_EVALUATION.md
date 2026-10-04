# Review output evaluation

This change implements clear text, complete execution scenarios, and interactive review. Videos are deferred.

## Test cases

| Case | Expected output | Result |
| --- | --- | --- |
| Simple success | Show the request, policy call, result, and response in order. | Browser assertions pass. Before has two steps; Intended has four. |
| Rejection branch | Show the rejection and response. Do not invent a Before path. | Browser assertions pass. Before states that no steps are recorded. |
| Stateful retry | Show each repeated attempt in order. Keep feedback attached to the selected occurrence. | Browser assertions pass. Repeated relations have distinct step IDs. |
| Source and evidence | Show protocol, failure behavior, source paths, evidence status, and linked decisions. | Browser assertions pass, including unverified evidence. |
| Version comparison | Keep participant positions stable. Mark changed steps by stable ID. | Browser assertions pass. Inserting a step does not mark unchanged later steps as changed. |
| Unsafe or incomplete spec | Reject missing references, disconnected paths, wrong-version relations, duplicate steps, and unsafe paths. | Runtime assertions pass. |
| Existing specs and proposals | Keep the architecture overview and preserve scenario edits through adoption. | Runtime and browser assertions pass. |
| Text review | Flag long descriptions and instructions without changing their text. | Runtime assertions pass at the 25-word and 20-word targets. |
| Keyboard and narrow screen | Select steps with the keyboard. Keep page width within the viewport. | Browser assertions pass. Wide diagrams scroll inside their pane. |
| Section-link refresh | Retain authentication when the page reloads at a section anchor. | Browser assertion passes. |

Commands: `npm run check` passed syntax checks and 38 Python tests. `npm run test:browser` passed all four Chromium scenarios. The success, rejection, and retry cases run inside one comprehensive scenario test.

The billing cases are illustrative UI fixtures. They do not prove billing behavior in a production system. The workspace preview separately records inspected NavoCode paths: state retrieval, rejection of a missing token, and repeated feedback acknowledgement. Existing runtime tests verify authentication and acknowledgement idempotency.

## LLM judge assessment

This is an author self-assessment based on the generated output, source inspection, browser assertions, and rendered preview. It is not independent evaluation or a human study.

| Criterion | Assessment |
| --- | --- |
| Clear text | Improved. Guidance defines consistent terms and short active sentences. Automatic checks cover length only. |
| Complete path | Strong for recorded scenarios. Ordered arrows expose entry, internal calls, returns, and outcome. |
| Branch and retry clarity | Strong for the tested cases. Each scenario keeps one path visible. Repeated steps retain their order and identity. |
| Useful interaction | Strong. Reviewers can trace a step, inspect its contract and evidence, and send contextual feedback. |
| Evidence honesty | Strong. Missing links are explicit. Unsupported and stale evidence remain distinct from supported claims. |
| Compact presentation | Improved. Components stay small; contract detail appears below the flow. Long flows still need scrolling. |

The output supports faster initial review, but these checks do not establish a 90% comprehension result. Engineer testing must measure correct answers, time, and supporting-section lookups.

## Limits

- Authors record execution order. The renderer does not discover it from source or production traces.
- Before and Intended share trigger and outcome text. Use separate scenarios when these facts differ materially.
- Sentence-length checks do not enforce the STE dictionary, active voice, or consistent naming.
- Evidence links identify recorded claims; they do not automatically verify those claims.
- Long flows require vertical scrolling. Narrow panels show each ordered step with its source and destination. Wide panels retain participant lanes.

The writing guidance adapts [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf). It does not claim standard compliance.

## Responsive rendering regression

The fixed-width sequence diagram clipped participants in the narrow author workspace. The renderer now fits the panel and uses source-to-destination steps when participant lanes would become too narrow. Labels wrap without shrinking the text. Resizing preserves the selected step and its contract.

All 38 runtime tests and four browser scenarios passed. The regression checks verify that every label fits at 390 pixels, all retry endpoints remain visible, and widening the panel preserves the active step. The live author workspace was also inspected at its 526-pixel width.
