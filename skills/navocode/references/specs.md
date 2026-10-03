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
