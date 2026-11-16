# Creation, agents and automation: architecture review

Status: proposed implementation decisions; no runtime activation or completed-feature claim.
Reviewed: 16 November 2026, Omnitron `ea166e5af56e462941363729ebf381d7412adfa2`
and Xec `b2b6aab4b4b0d321996ca26cd10f7b7fb92aff78`.

The public [Studio](https://omnitron.dev/docs/omnitron/studio),
[agent harness](https://omnitron.dev/docs/omnitron/agent-harness) and
[automation runtime](https://omnitron.dev/docs/omnitron/workflow-runtime)
describe the intended product and its semantics. This review connects those
requirements to current code, resolves implementation boundaries and defines
the first delivery gates. It does not replace those specifications or introduce
a second roadmap with different execution rules.

## What the source establishes

These are gaps relative to the proposed product, not assertions that existing
administrator automation promises these capabilities today.

| ID | Observed implementation | Consequence and required change |
| --- | --- | --- |
| A1 | [`PipelineService.initialize`](../apps/omnitron/src/services/pipeline.service.ts) changes unfinished runs to `interrupted`; active execution is tracked in a process-local map. | Existing run history is not durable continuation. Add persisted transitions and effect recovery before advertising restartable workflows. |
| A2 | [`pipeline-definition.ts`](../apps/omnitron/src/services/pipeline-definition.ts) accepts manual triggers and scalar parameters; configured retries apply to executable steps. | Introduce explicit typed values, effect classes and trigger identities. Do not infer whether repeating shell source is safe. |
| A3 | [`PipelineRpcService`](../apps/omnitron/src/services/pipeline.rpc-service.ts) authorizes administrators; its execution request has no restricted task grant. | This is not a restricted agent tool API. Use the existing principal and policy infrastructure with resource-scoped delegation, enforced at dispatch as well as ingress. |
| A4 | [`OperationJournal`](../apps/omnitron/src/execution/operation-journal.ts) persists attempt receipts, revisions and logical resource claims in the daemon state store. Its [DTO](../apps/omnitron/src/shared/dto/execution-operations.ts) describes execution resources and observations. | Reuse this execution evidence. A stopped process is not proof that a remote business effect succeeded; associate attempts with a stable effect and its receiver receipt. |
| A5 | [Pipeline history](../apps/omnitron/src/database/migrations/003_pipelines_traces.ts) and the daemon operation journal have different transaction boundaries. | A single transaction cannot cover both databases or a remote receiver. Specify an outbox/inbox protocol and reconciliation instead of promising atomic cross-store execution. |
| A6 | Xec [Workflow](https://github.com/xec-sh/xec/blob/b2b6aab4b4b0d321996ca26cd10f7b7fb92aff78/packages/ops/src/workflow/index.ts) keeps results in maps and invokes callbacks. [Pipeline](https://github.com/xec-sh/xec/blob/b2b6aab4b4b0d321996ca26cd10f7b7fb92aff78/packages/ops/src/pipeline/index.ts) already owns graph execution, retries and event callbacks. | Reuse execution scopes and consolidate portable scheduling semantics there. An event callback is not a durable continuation; arbitrary JavaScript closures cannot be recovered by replaying a saved graph. |
| A7 | [`McpBridge`](../apps/omnitron/src/mcp/mcp-bridge.ts) handles requests sequentially, advertises fixed protocol/package versions and ignores cancellation notifications. | Qualify negotiation, bounded framing, schema validation, independent cancellation and scoped identity before exposing mutating agent tools. Protocol compliance alone does not provide isolation. |
| A8 | [`ExecutionClient.controlledOwnerSnapshot`](../apps/omnitron/src/daemon/execution-client.ts) obtains admission observations through the observation connection, configured with a 4-second timeout. | Separate the cost and scheduling of authority checks from bulk observations. This is a concrete coupling to measure under load, not proof that every observed update timeout has this cause. |

The existing pipeline reserves its in-memory active-run slot before asynchronous
admission work. This review does not claim a local oversubscription race there.
What is missing for the proposed scheduler is durable, project-scoped admission
and fairness across workers and controller restarts.

## Decisions and rejected alternatives

### One execution model, several editors

Define a versioned portable graph in Xec Ops. A deterministic transition function
consumes the pinned definition, current state and one accepted event, returning
new state and effect intents. It performs no external I/O. Its implementation
and graph validation are shared by local automation and Omnitron orchestration.
Persistence, authorization, placement and artifact access are supplied by the
host; Xec must not import Omnitron or require its database for local tasks.

The current in-process APIs remain useful for trusted scripting. Consolidate
their common dependency ordering, cancellation and retry primitives as the
portable implementation is introduced. Remove replaced schedulers and callers
in the same migration; do not leave an agent scheduler, canvas scheduler and
CLI scheduler with independently evolving rules.

Visual editing and a supported declarative TypeScript format compile to the
same canonical graph. Arbitrary TypeScript is a pinned activity, not a promise
of reversible visual editing or resumable JavaScript stacks. A model proposes
the same graph or activity changes that a person can review.

### Keep workflow authority and node supervision distinct

Use Omnitron's existing relational persistence for workflow runs, accepted
commands, decisions and pending effects. Commit a run transition, command
deduplication receipt and outbox records in one database transaction. Publish
subscription events only after that transaction commits.

The node execution journal remains the authority for its observed processes
and execution attempts. The workflow record references its receipts; it does
not independently invent process state. Its current resource claims protect
local conflicting operations, not consensus across independent nodes.

An unavailable workflow database must stop new workflow admission without
stopping already supervised applications. Existing node supervision must not
acquire a new mandatory dependency on the workflow database. Cancellation and
recovery retain explicit authority and a reserved execution path; database
failure never implicitly grants a caller unrestricted local control.

Reject independent writable SQLite replicas as fleet-wide workflow authority.
Initially each run belongs to one authority domain. A later shared-store or
partitioned-authority implementation must qualify failover and fencing. A
Netron connection is transport, not consensus.

### Separate identities by what they prove

| Identity | Lifetime and purpose |
| --- | --- |
| Command ID | Deduplicates a request within its authenticated domain and principal scope. Reuse with another input digest is a conflict. |
| Definition digest | Canonical executable semantics and dependency versions. Excludes canvas coordinates and other presentation metadata. |
| Run ID | One admitted execution with pinned definition, inputs, acceptance policy and budget. |
| Effect ID | One intended external change. Stable across retries and lost acknowledgements. |
| Attempt ID | One dispatch or execution attempt; references the effect and node execution receipt. |
| Authority generation | Fences a worker or controller grant. A newer generation is not permission to repeat an uncertain external effect. |
| Evidence identity | Binds criterion, artifact, verifier, relevant environment and observed result. |

Canonical serialization must specify number ranges, absent/null behavior,
ordered collections and Unicode handling. Secret values are resolved by
versioned references; do not expose hashes of low-entropy secret values as a
public identity. Semantic dependency changes invalidate the definition digest;
moving a canvas node does not.

### Dispatch is a protocol, not a function call

1. Authenticate the command, resolve scope and validate the runtime schema.
2. In one workflow transaction, check relevant revisions, reserve capacity,
   deduplicate the command, persist the transition and enqueue the effect.
3. A worker claims an outbox record with a fencing generation. Resolve current
   authority, pinned artifacts and credential references before dispatch.
4. The receiver independently admits the effect. Where supported, it stores
   effect identity and payload binding with the actual change.
5. Record the observed receipt and advance the run transactionally. A lost
   reply leads to inspection of that same effect, not a new mutation identity.

| Failure boundary | Recovery rule |
| --- | --- |
| Before workflow commit | No effect is authorized; retry the same command ID. |
| After commit, before dispatch | Reclaim the pending intent within current authority. |
| After receiver mutation, before acknowledgement | Reconcile the same effect at the receiver. If that is impossible, keep the outcome unconfirmed. |
| After receipt arrival, before workflow commit | Reaccept the same receipt idempotently; do not redispatch. |
| While cancelling | Keep outstanding effects visible until stopped, completed or explicitly unconfirmed. |
| After restoring an old backup | Reconcile outstanding receiver effects and deduplication horizons before resuming writes. |

Reject universal exactly-once claims. Receiver deduplication has a documented
retention horizon; automatic retries cannot outlive it without another safe
reconciliation mechanism. Compensation is a new effect with its own authority
and potential failure. No database transaction rolls back a sent email.

### Agents propose; constrained executors act; independent checks accept

The agent process cannot access the controller socket, Docker socket, operator
home, verifier credentials or unrestricted inherited environment. An environment
allowlist and scoped credential broker apply to the isolated worker, including
its children. Running a project build also executes untrusted dependency hooks
and bundler plugins; it belongs inside that boundary.

Preview applications need a distinct browser origin and network boundary from
Console. Do not place untrusted application HTML under an authenticated Console
path. Host-only credentials, restrictive frame permissions, validated message
origins, bounded preview lifetimes and controlled service-worker scope must be
tested. A compromised preview must not read the control plane or mint approval.

Acceptance criteria and verifier versions are outside the candidate workspace.
Candidate tests contribute evidence but cannot replace protected checks.
The verifier runs untrusted candidate code in an isolated environment without
granting that code access to verifier control or reporting credentials.
Model-generated judgments stay distinguishable from measured results.

For UI work, acceptance includes actual composition: shared alignment, frame
ownership, responsive geometry, keyboard access, contrast, state persistence
and motion. A screenshot is evidence for review, not an automatic declaration
of quality. Seed known defects to test detection. The homepage regression that
exposed nested borders and unequal surfaces is an example, not a universal
visual oracle.

Evaluate small and large models on the same held-out requirements. Record
false acceptance, completion rate, human interventions, repair cost and elapsed
time. A harness can reduce mistakes and decompose work; it cannot guarantee
that an arbitrarily weak model solves every task. Failure remains observable.

### Keep the control path responsive and reuse qualified work

Split resource admission, cancellation and reconciliation capacity from bulk
logs, artifact transfer and long-running work. Request only observations needed
for the affected resources. Receiver-side revision and authority checks remain
mandatory; a cached Console projection cannot authorize a mutation.

Measure the full path: source change, affected checks, build, transfer, backup,
admission, service interruption and verified target state. Record queue time
separately from execution time. Do not hide prerequisite work outside a claimed
deployment latency. Warm and cold paths require separate results.

Cache acceptance by immutable artifact/dependency/verifier identities and
declared environment assumptions. Refresh only mutable facts relevant to
admission. Treat cache invalidation as a correctness contract with mutation
tests. A trusted immutable installation can avoid repeated tree traversal;
a mutable working directory cannot use that assumption.

Project queues have independent quotas and fair service; conflicting resources
serialize. Reserve recovery capacity. Durable waits occupy no worker process.
Backups retain their real consistency and freshness requirements but are not
duplicated for unrelated changes. The public Studio performance targets remain
targets until measured, including its 1–5 minute qualified small-release path.

## UI and extension boundaries

MUI provides primitives. Prism provides coherent components, state behavior,
layouts and reusable compositions. Lumen provides project-site and documentation
assembly, content processing and publication. Good defaults do not justify
locking the developer into a single template.

Shared components expose documented themes, slots and supported lower-level
composition. Application composition owns its chosen layout; shared controls
own interaction and accessibility behavior. Do not add website-specific layout
policy to every Prism consumer, or copy missing reusable controls into each app.

CLI, Console, agents and mobile clients consume the same operation descriptors
and receipts. Forms may be generated from schemas, with deliberate Prism
composition for complex interactions. Review shows the exact target, effect,
data destination and remaining uncertainty. A code editor and a canvas are
alternative views, not separate sources of execution truth.

Native mobile shares protocol, synchronization and design tokens. MUI's DOM
components do not become native controls automatically. Begin with inspection
and scoped decisions; qualify device management independently for each OS.

## Reference studies and concrete conclusions

Primary sources were reviewed on 16 November 2026. These are design inputs,
not performance benchmarks or assertions of universal superiority.

| Source | Conclusion for this design |
| --- | --- |
| [T3 Code architecture, pinned revision](https://github.com/pingdotgg/t3code/blob/0a842b222d5732e12451484098e035429dc0f315/docs/internals/overview.md) | Reuse the separation of committed intent, effects and client projections. Define our own identity, privacy and retention contract; do not copy a client application into the supervisor. |
| [Impeccable](https://github.com/pbakaus/impeccable) | Design guidance and critique inform authoring. Independent measured acceptance must still detect faulty geometry and behavior. |
| [Node-RED messages](https://nodered.org/docs/user-guide/messages) | Preserve understandable event composition; add explicit schema, ordering, persistence and overload contracts for each port. |
| [n8n queue mode](https://docs.n8n.io/hosting/scaling/queue-mode/) | Separate ingress and workers. Qualify project fairness and storage boundaries rather than equating worker count with reliability. |
| [Windmill flow editor](https://www.windmill.dev/docs/flows/flow_editor) | Code and visual authoring are important baselines. Our supported subset must round-trip without changing executable identity. |
| [Flowise Agentflow V2](https://docs.flowiseai.com/using-flowise/agentflowv2) | Explicit agent steps and shared flow state are useful; they remain subject to the same authority, effect and verification contracts. |
| [Temporal execution](https://docs.temporal.io/workflow-execution) and [Restate actions](https://docs.restate.dev/foundations/actions) | Specify recorded nondeterminism and recovery explicitly. Do not confuse replaying decisions with repeating external mutations. |

Test three proposed improvements: consequence-based review derived from effect
descriptors; selective verification backed by an evidence dependency graph; and
delegation that transfers only the authority and private data required for a
subtask. Each must improve measured outcomes over a simpler baseline. None is
claimed as a novel invention or a capability already delivered by this review.

## Implementation gates and first reference workload

| Gate | Owning implementation | Required evidence before the next gate |
| --- | --- | --- |
| F0 — protocol and invariants | Xec Ops graph semantics; Netron/Titan DTO and authorization owners | Runtime schema tests, deterministic transition tests, graph/source round trips and explicit effect classes. |
| F1 — durable run path | Existing Omnitron pipeline services and persistence | Transactional command/outbox admission; same-effect recovery through each failure boundary above. |
| F2 — restricted execution | Existing Xec scopes, Omnitron execution and MCP adapter | Negative scope tests, cancellation under load, no host/credential/egress escape, bounded requests and queues. |
| F3 — one workbench | Prism components and Console/CLI consumers | Equal canonical plans and receipts; accessible list and graph editing; geometry, state, review and recovery acceptance. |
| F4 — project creation | Agent/provider adapters and protected verifier integration | One unfamiliar application created and repaired through the ordinary path; measured false acceptance and total cost across model classes. |
| F5 — federation and native clients | Netron trust-domain adapters and shared client runtime | Partition, revocation, delegated-budget and reconnect tests; mobile approval bound to current server state. |

The first reference workload is delivery for two independent test projects:
qualify a source revision, reuse the sealed artifact, review its consequences,
deploy through the normal Omnitron API and verify target receipts. Pause project
A at a human decision while B completes. Lose A's acknowledgement after the
receiver changed state, restart its isolated workflow worker, and establish
the original effect's result without redeploying it blindly.

Run the same scenario through CLI, Console and a restricted agent adapter.
Include a non-reconcilable synthetic receiver: its uncertain write must remain
unconfirmed. Tests must not manufacture a successful receipt for it. Exercise
crashes only in declared isolated fixtures, not working applications or Atlas.

Migrate existing pipelines explicitly. Finish or interrupt active runs before
switching execution semantics, preserve historical receipts and convert stored
definitions with an unsupported-feature report. Remove superseded execution
paths once consumers move. Preserving historical truth does not require legacy
source aliases or permanent duplicate engines.

## Decisions still requiring experimental evidence

- Receiver reconciliation and deduplication retention for the first real
  deployment operations; later connectors must declare their own guarantees.
- Cost of transactional outbox, fair admission and cancellation with ten
  independent projects under backup and log pressure.
- Isolation support on Linux, macOS and Windows, including preview origins and
  dependency/build execution; unsupported guarantees must be reported.
- False acceptance and useful capability of smaller models with the protected
  harness, against a plain-prompt baseline and selected harness ablations.
- Connector coverage and maintenance cost. A correct handful of adapters is
  not equivalent to a mature integration catalog.

## First execution increment — 16 November 2026

The existing pipeline receiver now admits one stable command through
`prepareRun` → `startRun` → `getRunStatus`. CLI, Console and administrative MCP
use the same authenticated Titan service over Netron. The execution graph and
command lifetime remain in Xec; there is no additional scheduler.

The prepared row contains the definition revision, a private keyed parameter
commitment and the public review digest. The row itself is the pending dispatch
record: storing intent and making it eligible for explicit admission is one SQL
insertion. A conditional SQL update claims it before command preparation or
effects. Re-delivery reads that row; it cannot claim an already started run.
Waiting for review consumes no executor capacity. Capacity is bounded per
registered release project as well as per daemon; unscoped scripts have a shared
budget. A rejected capacity request stays reviewable.

The native reference test uses two independent sealed project artifacts,
ordinary `ProjectService.resolvePipelineRelease`, Xec child execution, real
SQLite persistence and the actual Titan service over Netron TCP. Project B
finishes while A awaits review. After A's effect completes, the test drops its
TCP acknowledgement, recreates the caller and service with another database
connection, and recovers one completed receipt with one observed execution.
An injected failure after a real child effect but before recording completion
remains `unconfirmed` across service reconstruction. Concurrent delivery and
per-project capacity have separate acceptance checks.

This is the first bounded execution increment, not completion of all F0/F1
gates. It does not yet provide a portable serializable graph reducer, mid-graph
continuations, a leased distributed outbox dispatcher, remote deployment
reconciliation or a restricted agent sandbox. It executes installed compiled
entries; it does not claim the fixture deployed a stack to an external server.
Source bodies are not archived by these receipts. Removing terminal history
ends command deduplication. These boundaries must be preserved when the next
increment adds receiver-specific reconciliation and distributed scheduling.

## Graph recovery increment — 17 November 2026

The admission now retains the exact serialized definition as private source,
alongside its public revision. Recovery projects only the remaining nodes and
edges into the existing Xec Pipeline; it adds no scheduler or script replay.
Step-start is persisted before dispatch, and completion before releasing graph
dependencies. Confirmed nodes are retained. Nodes with no dispatch evidence may
continue. Started commands with unknown outcomes block continuation. A recovery
digest binds the inspected state; a conditional database claim and retained
resume identity reject stale approvals and deduplicate delivery.

A `deploy` step uses ProjectService's normal release/start path with an exact
manifest and preservation review. Its reconciliation reads the same remote
Netron inventory as Console, checking every expected placement's verified-launch
receipt, artifact and consumer identity. The observation is explicitly target
convergence, not causal attribution to an operation ID. It cannot prove a script's
business effects, provider migrations or exactly-once deployment. Failed or absent
receipts never trigger an implicit second deployment. Cancellation cannot undo
dispatched native operations; the executor awaits settlement before releasing its
slot. Lease-based cross-controller dispatch and restricted agent execution remain
separate gates.

The additive schema policy covers `017_pipeline_admission`: nullable JSONB,
without default or backfill. Runtime rollback preserves this column, migration
history and private command receipts; it must never execute the destructive down
migration. The exact runtime/database binding is prepared through `backend schema
prepare`, approved/applied through `backend schema apply`, and passed to backend
upgrade as `--schema-plan`. Local-sync cannot silently substitute for this review.
