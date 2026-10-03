# Engineer-owned decisions

Keep the review at the level where engineers change system behavior and accept risk. Capture consequential choices that this change introduces or revisits; do not create a checklist decision for every helper, file, or unchanged subsystem.

| Category | Engineer chooses |
| --- | --- |
| boundaries | Responsibilities, dependency direction, synchronous versus asynchronous work, new services or dependencies |
| data | Source of truth, ownership, consistency, retention, schema semantics |
| contracts | Public behavior, API/event contracts, compatibility and versioning |
| security | Trust boundaries, permissions, sensitive data access, tenant isolation |
| reliability | Failure semantics, retries and idempotency where consequential, degraded behavior |
| migration | Backfill, rollout order, compatibility window, rollback constraints |
| operations | Deployment, observability, recovery and ownership |
| cost | Meaningful latency, resource and scaling tradeoffs |

A decision needs a proposed choice, realistic alternatives, and consequences for users or the system. Set its optional `category` where applicable. Show uncertainty and evidence honestly. Explain why a choice matters without turning low-level code into another diagram node. Architectural groups can contain many implementation files.

The agent chooses local implementation details within accepted constraints: helper names, internal factoring, syntax, and equivalent algorithms. Escalate a detail if it changes contracts, data semantics, trust, rollout risk, or material cost.

Record `status: proposed`, `provenance: agent` for suggestions. Only explicit human acceptance allows `status: accepted`, `provenance: human`. Changes to an accepted architectural choice must be proposed again. UI acceptance is feedback for the active agent, not automatic implementation. The agent updates the spec and acknowledges the actual scope accepted.

Before implementation, `brief` requires all recorded decisions to have human acceptance. `validate --ready` additionally checks observations, evidence freshness, coverage, and unresolved questions. These gates check recorded claims; they do not prove that the agent identified every architectural issue or obtained human acceptance truthfully.
