# Specifications

Run `CLI schema` for the complete versioned JSON Schema. It is also shipped at `runtime/schema/spec.schema.json` in an installed skill, or `schema/spec.schema.json` at the plugin root. Use `examples/billing.json` at the same runtime/root as a structural example; its contents are illustrative, not evidence.

Top-level fields are required. Collections can be empty while the design is being explored. The schema rejects unknown keys, duplicate IDs, invalid paths, and dangling references.

- `groups`: architectural purpose, summary, `componentIds`, `decisionIds`, and changed `paths`.
- `components`: stable `id`, `name`, and prose for `current`, `intended`, `observed` responsibilities.
- `relations`: stable ID, component `from`/`to`, meaningful label, and `state` (`current`, `intended`, `both`).
- `decisions`: title, choice, alternatives, consequences, `status` (`proposed`, `accepted`), `provenance` (`agent`, `human`), and evidence IDs.
- `evidence`: claim, `kind` (`source`, `test`, `inference`), `status` (`supported`, `unverified`, `failed`), detail, paths, and source digest.
- `acceptanceCriteria`, `nonGoals`, `unknowns`: human-readable statements.
- `supportingChanges`: `{path, reason}` for changes that do not warrant their own architectural group.

Use architecture-level language. Cover data ownership, contracts, behavior, failures, migrations, and dependencies as relevant. Cross-group relationships belong in `relations`. Grouping must not hide unrelated changes. Make unsupported observations explicit in `unknowns` or unverified evidence.

`baseRef` is a resolved comparison commit; retain it as source changes. `sourceDigest` binds to the tracked and nonignored source tree, excluding `.navocode/`. Run `CLI context` to get the current digest. After inspecting or executing evidence, put that digest on the evidence record. Record actual test command and outcome in `detail`. Re-run or re-inspect stale evidence; do not bulk relabel old evidence as current.

The UI automatically reads the spec on refresh. Use atomic file replacement so it never sees half-written JSON. Source binding is not a correctness proof; `--ready` checks explicit completeness predicates, not arbitrary behavior.
