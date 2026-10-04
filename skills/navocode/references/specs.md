# Specifications

Run `CLI schema` for the complete versioned JSON Schema. It is also shipped at `runtime/schema/spec.schema.json` in an installed skill, or `schema/spec.schema.json` at the plugin root. Use `examples/billing.json` at the same runtime/root as a structural example; its contents are illustrative, not evidence.

Top-level fields are required. Collections can be empty while the design is being explored. The schema rejects unknown keys, duplicate IDs, invalid paths, and dangling references.

- `groups`: architectural purpose, summary, `componentIds`, `decisionIds`, and changed `paths`.
- `components`: stable `id`, `name`, and prose for `current`, `intended`, `observed` responsibilities.
- `relations`: stable ID, component `from`/`to`, meaningful label, and `state` (`current`, `intended`, `both`).
- `decisions`: title, choice, alternatives, consequences, `status` (`proposed`, `accepted`), `provenance` (`agent`, `human`), evidence IDs, and optional `category` (see [engineer decisions](decisions.md)).
- `evidence`: claim, `kind` (`source`, `test`, `inference`), `status` (`supported`, `unverified`, `failed`), detail, paths, and source digest.
- `acceptanceCriteria`, `nonGoals`, `unknowns`: human-readable statements.
- `supportingChanges`: `{path, reason}` for changes that do not warrant their own architectural group.

## Technical architecture depth

Show internal high-level components, not only product areas. Use the level where a senior engineer can decide responsibility boundaries and contracts: request/event entry points, orchestration, domain policy, persistence, external adapters, and UI/state transport where relevant. Include unchanged participants when needed to explain a changed interaction. A component may span many files; do not turn every class, helper, endpoint, or file into a node. Avoid a universal node-count quota.

Use concrete component names and concise `current`/`intended` responsibilities that identify owned behavior or state. Relations must name what crosses the boundary (for example “POST feedback with spec revision”, “read/write spec.json atomically”, or “gh API: revision-bound proposal”), with direction and `state` matching inspected code. Explain consequential sync/async, trust, persistence, and failure semantics in responsibilities and decisions. Do not invent queues, databases, or services to make the graph look technical. Keep IDs stable while refining existing components, and label inferred details as unverified.

For NavoCode itself, useful boundaries include the host skill/CLI, GitHub review adapter, spec validator and source binding, local HTTP feedback server, browser workspace, proposal engine, and spec/baseline files. “Runtime” and “Integration” alone hide those contracts; individual validation helpers are too granular.

Use architecture-level language. Cover data ownership, contracts, behavior, failures, migrations, and dependencies as relevant. Cross-group relationships belong in `relations`. Grouping must not hide unrelated changes. Make unsupported observations explicit in `unknowns` or unverified evidence.

`baseRef` is a resolved comparison commit; retain it as source changes. `sourceDigest` binds to the tracked and nonignored source tree, excluding `.navocode/`. Run `CLI context` to get the current digest. After inspecting or executing evidence, put that digest on the evidence record. Record actual test command and outcome in `detail`. Re-run or re-inspect stale evidence; do not bulk relabel old evidence as current.

The UI automatically reads the spec on refresh. Use atomic file replacement so it never sees half-written JSON. Source binding is not a correctness proof; `--ready` checks explicit completeness predicates, not arbitrary behavior.

## Diagram that explains itself

The diagram should answer most review questions directly: scope/intent, responsibility owners, internal/external boundaries, technology where known, who calls whom, the exchanged contract, what changes, failure behavior, unresolved decisions and evidence limitations. Treat “90% directly inferable” as a usability target, not a measured claim or validator guarantee.

Keep `current` and `intended` concise ownership statements. Components can optionally record `kind` (`component`, `service`, `datastore`, `external`, `actor`), `technology`, `boundary`, and a consequential `risk`. Relations can optionally record `protocol` and `failure`. These fields are factual architectural claims: inspect the source before filling them; do not invent missing metadata. Common metadata applies to both views; describe version-specific differences in responsibilities or separate current/intended relations. Old specs remain valid and missing metadata remains visibly unknown.

Prefer a holistic end-to-end flow: compact named components, dependency stages, and labeled arrows showing requests, data movement and protocols. Keep component responsibilities, risks and failure detail in supporting sections or tooltips rather than expanded component cards. The overview should reveal the entry points, internal handoffs and outcomes together. Keep relation direction consistent with the label; distinguish a request from a returned event. Use specific names and short action/data labels. Avoid repeating node responsibilities in contracts. Put a reliability decision in the relevant group's `decisionIds` so its unresolved status appears on the affected components. Preserve stable IDs so Before/Intended positions remain comparable.

Before opening the workspace, inspect the diagram itself and answer: where does the flow enter, which components process it, what crosses each connection, where does it end, what changed, and which decisions or claims remain unresolved? If a consequential answer is missing, revise the spec or expose the uncertainty. Do not hide a material issue to make the canvas smaller.

## Execution scenarios

Record representative execution paths in optional `scenarios`. Each has an `id`, `title`, `trigger`, `outcome`, and ordered `current` / `intended` step arrays. Each step has a stable `id`, a `relationId`, and an optional short `description`. An empty version means that path is not recorded for that version. Steps must connect: each destination must be the next source. Refer only to relations available in that version. Add explicit return relations to show responses. Do not turn a dependency graph into an invented execution sequence.

Use separate scenarios for success, rejection, and retry paths when they matter. Record what starts each path and what the caller receives. Repeated relations can represent retries, with distinct step IDs. Include a state change or external side effect in the relevant contract. A scenario is a recorded explanation, not an execution trace from production.

Relations can link `paths`, `evidenceIds`, and `decisionIds`. These links must refer to inspected source paths and recorded evidence/decisions. The reviewer can select a connection to inspect its contract, failure behavior, references, and decisions, then send feedback about that step. Do not label evidence as supported solely because its link exists.

## Clear review text

Use [ASD-STE100-inspired writing guidance](writing.md) for summaries, diagram labels, decisions, and test reports. This is an adapted style, not a claim of standard compliance. The workspace reports sentence-length warnings in Assurance. These warnings do not block readiness or change the author's text.
