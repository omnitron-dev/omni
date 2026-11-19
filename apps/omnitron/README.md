# @omnitron-dev/omnitron

Omnitron runs and manages classic Node applications and Titan services. Its CLI and Console use Netron to control application lifecycle, inspect runtime state and review deployment operations.

## Capabilities

- Projects, stacks, application processes and worker pools.
- Logs, health, metrics, pipelines and operational receipts.
- Immutable application releases with verified runtime provenance.
- Independent backend and resident-owner upgrades.
- Local source SDK development through the workspace build graph.

## Quick start

```sh
pnpm add -g @omnitron-dev/omnitron
omnitron --help
omnitron status
```

The CLI and daemon require Node.js 22.14+ on 22.x or 23.6+, including the Node-API support needed by SQLite. Configure an ecosystem before starting applications. `omnitron up` starts the daemon and may start configured stacks.

```sh
omnitron start project/stack/app
omnitron logs project/stack/app
omnitron stop project/stack/app
```

`stop` requires a responsive daemon and fails when completion cannot be confirmed. `stop all` stops managed applications; `down` explicitly shuts down the daemon. Inspect the current process and operation state after a lost acknowledgement before issuing another mutation.

## Runtime ownership and releases

Build application releases on a host matching the execution owner's OS,
architecture, Node binary, ABI and libc. The executable's SHA-256 is part of
the release target. `omnitron release build <project> --for <stack>` also builds
the static frontend with that stack's environment.

On local cold updates, `omnitron backend select <sha256> --check` previews changes to the host database and stack containers. If the host PostgreSQL was created on a project bridge, the preview identifies its SQL cluster and the required PostgreSQL process restart. Moving the retained container to the platform bridge rebuilds host port forwarding. Startup checks the cluster through both the container and its published SQL port before applying migrations. The named volume and container ID survive this transition.

The management backend and resident execution owner have separate identities. A backend handoff can retain the owner and application processes. Application release identity is distinct from either runtime's build commit. Status and operation receipts expose those identities; compare the actual target rather than assuming one commit describes the entire node.

On a macOS development installation, finish a batch on `main` with `pnpm exec xec update local-sync`. It prepares the committed runtime and reports the affected local stacks, their launch selections and the installed versions available for rollback. Pass the returned digest with `--review` to update the backend, guardian, owner and Console and verify the stacks that the owner restarts. `--status` reads the durable outcome. See [local development rollout](HOST-UPGRADES.md#local-development-rollout) for recovery and the backend-only workflow.

Use the ordinary stack release lifecycle to prepare and select installed artifacts. A backend source upgrade takes the compiled backend directory, `<runtime-root>/packages/0/dist`; runtime installation and `backend guardian prepare` take the sealed runtime root. Reviewed rollback resolves these paths separately when restoring different backend and guardian releases. Read-only checks and reviewed plans precede activation. Older peers that cannot enforce a required capability refuse the operation instead of falling back to another execution path.

Backend preflight loads the actual daemon dependency graph with a 30-second child deadline. Failures include a machine-readable code and details with the verified runtime hash, elapsed time, child PID and last reported loading phase, while retaining the original cause. Bounded progress records appear on stderr only for `--check-backend`; they do not establish readiness or replace a successful protocol/build response. A successful standalone preflight does not qualify a transition or rollback.

Before draining a backend, the candidate inspects the live controller's reviewed infrastructure snapshot without starting a daemon or changing Docker. This read-only review can run during owned backups and does not certify recovery. It must support adoption preflight protocol 1 and confirm the exact snapshot digest. The guardian repeats this check on the frozen handoff checkpoint before retirement; a refusal there aborts the handoff. Targets and guardians without this capability are refused, including an ordinary upgrade targeting an older runtime. Automatic restoration of the original backend retains its separate recovery checks; it is not reported as a successful candidate adoption probe.

Container fingerprint schema 2 includes enforced resource limits. Handoff can migrate a schema 1 fingerprint only for the recorded native container, with the exact historical hash, matching ownership labels and verified Docker resource limits. The recovery state records both hashes and the full container ID; Docker labels and containers remain unchanged. Later reconciliation rechecks that binding, so a changed declaration or native resource is still rejected as drift.

At cold start, a running container carrying the original schema 1 hash is inspected against its image, ownership, command, environment, ports, networks, volumes and health checks. When only a previously unset memory limit or reservation is missing, Omnitron applies it to the existing container ID and verifies the same process generation and mount identities. An unexplained mismatch stops reconciliation for that service.

If a failed backend has already committed its grant and the resident execution inventory later changes, automatic rollback refuses the stale checkpoint. `backend guardian prepare <runtime-root> --recovery-checkpoint <original-checkpoint>` prepares a reviewed recovery through the existing guardian transition. It requires the original grant, certified controller configuration, unchanged registry, native owner lifetime and a new exact execution baseline. The plan explicitly records that historical execution differences are unknown; it does not claim that all changed workers or definitions are equivalent. Inspect the plan, then use `backend guardian apply <plan> --check` before approving its application.

Reviewed recovery installs a capable guardian and restores the original backend while the resident owner continues running applications. A durable hold blocks ordinary recovery and cold start during the attempt. Successful restoration requires public RPC readiness, a certificate from the restored backend, and a final match against the reviewed owner, registry, checkpoint and execution inventory.

When the admitted writer has exited, `omnitron backend recover --current-state --check` reads both checkpoints, the writer grant, the last certified receipt, the current project registry and stack selections from local storage. If the operator accepts the reported unverified interval, a controlled stop followed by `omnitron backend recover --current-state --review <digest>` records that decision. The command requires the same reviewed state, a clean shutdown receipt and no surviving managed processes. An interrupted caller can repeat the same review. The prior selection and historical receipts remain available for recovery.

If the restored backend exits after the owner commits its grant, inspect `omnitron backend installation --json`. The activation identifies the original checkpoint, the held plan and the admitted writer's checkpoint. A hold in phase `unconfirmed` survives a repeat invocation. The recovery journal retains the last certified writer and records the first 16 distinct reasons for subsequent invalidation. Older writers only stored the first reason. An invalid certificate leaves changes after its last valid snapshot unverified. Before authorizing another controller, reconcile the committed owner grant, that writer's native process, project ownership and both checkpoints.

Plan reviewed recovery between scheduled pool rotations. A worker reaching its configured lifetime can change the execution inventory while the guardian is preparing the plan. When the owner provides sufficient identity evidence, the refusal names the affected application or pool. Check the live membership and the outcome of the attempted operation before scheduling another transition.

During final verification, the guardian can wait up to 15 seconds for an operation on the restored owner to finish. It rereads the recovery certificate, registry, grant, ticket and execution inventory before selecting the backend. A change of ownership or inventory ends verification immediately.

Stops use durable execution intent. Starting a stack does not silently clear a separately stopped child application's fence. Native process lifetimes and generations distinguish a current process from a reused PID.

Installed bootstrap applications repeat release and runtime verification before every supervised spawn, including pool recycling and resizing. A refused replacement leaves the old pool worker in place. Membership changes make the release observation unreported until the owner re-verifies the artifact and a stable set of live process handles. A late check cannot confirm a changed definition, stopped generation or different membership. Confirmation identifies the actual verified composition; it does not assert that a failed resize reached its requested count. Bootstrap applications declare their processes explicitly, with pools selected by each process's `instances` field.

Application entries do not replicate a whole application with `instances`. Author configuration and activation targets containing a value other than `1` are refused before infrastructure changes, owner stop fences or launch. This includes imported releases. Historical process observations remain readable. Configure `process.instances` in `defineSystem()` and resize a declared pool with `omnitron scale <app> <count> --process <pool>`. The application's instance count remains `1`; process observations report the actual worker counts.

## Starting with existing infrastructure

For a newly built or previously published release on an independently owned local
stack, run `omnitron stack prepare-release acme prod <release-id>` on its controller
while the current applications serve. If it reports `declarations: "refresh-required"`,
an administrator runs `omnitron topology refresh acme prod --release <release-id>`.
This records the installed candidate's declarations for the operator's review.
The response can also report `state: "requires-stop"`; capture the declarations
and review preservation before scheduling that stop. Console's Releases view
offers the same operations according to the signed-in user's role.

Runtime-only recovery uses `--infrastructure preserve`. Review the intended release and current resources before stopping applications:

```sh
omnitron stack start acme prod --release <release-id> --infrastructure preserve --dry-run --json
```

The review requires existing, running resources whose native identities and specification match the declaration. It cannot provision, recreate or restart infrastructure, run post-provision setup or framework migrations. Changed presets or unverifiable resource receipts require a separate reconcile.

An enabled-stack reconciler tick with no eligible launch leaves a recovery review valid. Actual configuration loads, launch attempts and retry bookkeeping invalidate recovery before they change state; a stack waiting for its retry deadline does not invalidate a review merely because its timer ran.

Infrastructure planning resolves one complete data definition: presets, application containers, overrides and mounted configuration. Local, CLI and remote paths use that same resolver. A preview does not create a resource owner, reserve ports or invalidate recovery. Applying a definition acquires ownership and rechecks native identities; conflicting container declarations are rejected before provisioning. Handoff restores the recorded definition without resolving it against a newer preset implementation.

After the planned runtime transition, inspect again if its owner or launch context changed, then use the current review:

```sh
omnitron stack start acme prod --release <release-id> --infrastructure preserve --review <digest>
```

Startup repeats release, environment and native-resource checks. Omitting `--review` obtains a fresh review automatically; supplying it pins the inspected digest. Application code and its own startup hooks still run. `check-release` alone does not establish infrastructure preservation.

## Source SDK development

Use a complete Omni checkout with its ordinary frozen installation. From a consumer project:

```sh
omnitron sdk init --project-dir /path/to/project
omnitron sdk dev /path/to/omni --project-dir /path/to/project --no-watch
omnitron sdk status --project-dir /path/to/project
```

`init` installs the canonical pnpm hook. `dev` follows the consumer's declared framework dependency graph and builds it through Turbo. It supports standalone Lumen or Prism consumers without adding Omnitron to their runtime dependencies. A private development lock holds the local graph; the registry application lock remains the baseline for restoration.

Changing an SDK selection retains the affected dependency directories, generated outputs and selection metadata in the development cache before writing them. At each phase the CLI reports the duration of the completed phase, total elapsed time and the size of the retained files once known. `retain` copies and checks those files. `verify` rechecks the source and records the recovery proof. Set `OMNITRON_DEV_CACHE` to the mounted development volume to keep the snapshot there. Application database backups follow their own schedule.

Snapshot work has bounded parallelism: at most 16 file readers and four independent copies. File order, modes, symbolic links and content digests remain part of the retained proof. Every admitted writer settles before failed staging data is removed; an incomplete copy cannot authorize a build. `sdk recover` verifies the retained bytes and current ownership before restoration, preserving foreign edits and reporting an uncertain interrupted writer explicitly.

The first selection may ask pnpm to generate its package-manager metadata. That metadata is not a registry application lock. A missing or stale registry baseline requires a normal registry installation before `sdk registry` can restore it. Ordinary `pnpm run` commands use the selected profile without extra flags.

`sdk status` validates registry importers with pnpm's frozen lockfile check, including overrides and relative local dependencies. Framework packages must still resolve to registry archives with SHA512 integrity; file and link overrides for them are refused. Inspection uses the installed pnpm matching the project's exact package-manager pin (qualified with pnpm 12.16.1), keeps its temporary cache separate, and runs no install scripts or custom manifest hooks. A lock that requires those hooks, an unsupported pnpm command, or stale dependency configuration fails explicitly. This checks existing installation provenance and lock freshness offline; pnpm's `--trust-lockfile` skips a new supply-chain policy lookup, so status is not a fresh registry security audit.

`--no-watch` checks the selected installation, Turbo inputs and output hashes under both workspace locks. If they match the saved build, the command can finish while applications are serving. It keeps their existing receipts and the recovery snapshot. If an install or rebuild is needed, stop the affected source stacks first. Omnitron retains a recovery snapshot before changing shared dependencies or outputs.

In watch mode the SDK rebuilds changed packages. With `--stack dev`, Omnitron records the owner's receipt for each watched application that uses the changed SDK. An application such as a Vite server can declare `watch: false` and manage its own reloads. The CLI checks each binding against the stack declaration and reports applications that manage their own reloads separately.

The watcher uses Xec's polling API once per second over Turbo's task directories and declared shared input locations. This includes package-local generators and the first files added inside declared input glob directories. Dependency directories, build outputs and ignored artifacts are excluded unless Turbo explicitly declares them as inputs. File events trigger a debounced Turbo comparison; only changed task hashes are rebuilt, and idle polling does not launch Turbo. Watch roots must exist inside the SDK checkout; unsupported external or unbounded global patterns fail explicitly. Edits are coalesced, builds are serialized, and changes arriving during a build remain queued. A build whose inputs changed before completion cannot confirm application readiness; the queued edit is rebuilt. Successful completion is reported after application receipts and RPC cleanup settle. Interrupting the command closes its observers. The watcher is a foreground CLI process: the daemon does not supervise or restore it after the CLI exits. This requires `@xec-sh/loader` 0.12.0 or newer.

Keep the consumer's `node_modules` directory physical. Standard pnpm `virtualStoreDir` configuration can place the store on another disk; a symlink replacing the entire directory is refused. Initial selection and registry restoration must satisfy the lifecycle and dependency admission checks. SDK selection does not activate a deployed release.

After a confirmed `stack stop --keep-infrastructure`, the SDK can start the local working tree and keep watching it.

```sh
omnitron stack start acme dev --working-tree --dry-run --infrastructure preserve
omnitron sdk dev /path/to/omni --project-dir /path/to/acme --stack dev --start-stopped --review "$digest"
```

Set `digest` to the digest from the first command. The second verifies the selected SDK, checks the stopped applications and retained infrastructure, and sends one start request for that stop ID. With an unchanged, complete build checkpoint, it checks the selected dependency installation, Turbo inputs and output hashes under both workspace locks and skips another recovery snapshot and build. Missing or stale build evidence follows the ordinary retained snapshot and rebuild path; ownership failures and changes during admission refuse the launch. Build-only use remains available with `sdk dev --no-watch`.

The first owner generations become the receipts for those SDK outputs. Reuse preserves the existing recovery snapshot and never treats build readiness as application readiness. Inputs and outputs are checked again before the one start request and before recording its generations. If the reply is lost, the CLI reports the observed stack state and leaves the SDK receipts unconfirmed; it does not retry the start or fall back to a rebuild. On a confirmed start, the watcher handles later source edits. Add `--no-watch` for a single reviewed start.

Each completed SDK build binds its output hashes to Turbo's declared input graph, Turbo version and Node runtime. Input hashes must match before and after the build and when its checkpoint is saved. Filtered rebuilds retain the proofs for untouched packages. Shared root TypeScript configuration and the compiler script are declared in `turbo.json`, so the build cache and SDK readiness use the same inputs. This is a development freshness check, not an immutable production source attestation; build inputs and environment variables must be declared correctly in Turbo.

Run `omnitron sdk status --project-dir /path/to/project --stack dev` to compare those inputs, current outputs and owner generations with the last build. Without `--stack`, status still verifies build freshness. Inspection runs Turbo's dry plan only: it never builds, installs dependencies or restarts applications. Changed inputs or a checkpoint without input proof fail explicitly and require `sdk dev`. Successful JSON reports `build.status: "current"`; with `--stack` it also identifies each confirmed application, explicit opt-out, inactive and unaffected application.

Titan bootstrap workers can inject `RUNTIME_CONTEXT` from `@omnitron-dev/omnitron/runtime`.
For a working-tree bundle produced by Omnitron, `development` records the generated worker's
project-relative filename, SHA-256 and observation time. The adapter observes the file across
its ESM import and rejects replacements or edits during that interval. Installed identity stays
`unavailable`. External imports and process memory lie outside this measurement. Consumers
that require reproducible release data should require `state: 'verified'` and the producer identity.

## Pipelines pinned to releases

A pipeline step with `kind: 'release'` binds a registered project, stack, application, immutable producer artifact and package-relative JavaScript entry. It uses the verified resident owner's Node, rather than storing an installation directory or generated shell command in the definition. A new owner installation can therefore preserve the pipeline's identity and history.

```sh
omnitron pipeline save publication.json
omnitron pipeline run <pipeline-id>
omnitron pipeline run <pipeline-id> --prepare --run-id <uuid-v4> --json
omnitron pipeline start <run-id> --expected-digest <review-digest>
omnitron pipeline status <run-id> --output
omnitron pipeline reconcile <run-id> --json
omnitron pipeline resume <run-id> --expected-digest <recovery-digest> --params-file parameters.json
omnitron pipeline save publication.json --id <pipeline-id> --expected-revision <sha256>
```

The public `PipelineDef` contract is exported from `@omnitron-dev/omnitron/dto/services`; `verifyInstalledRuntime` from `/runtime` supplies a verified caller's producer identity. Console's JSON editor preserves release targets and arguments. Entries must belong to the admitted closure, arguments are literal arrays, and output belongs outside the immutable installation.

`prepareRun` persists the request before execution; `startRun` admits its exact
review digest and parameters. CLI, Console and MCP use these same Titan/Netron
methods. Retain the caller-generated run UUID before dispatch. Repeating the
request returns its recorded outcome instead of launching another process.
Parameters must be supplied again at start; only a private keyed commitment and
their names are stored. An edited definition requires a new review.

Waiting requests survive restart without occupying workers. Each registered
release project can occupy two of the daemon's eight run slots; unscoped scripts
share a separate two-slot budget. These are admission limits, not tenant isolation
or a distributed fair scheduler. A capacity rejection leaves the same request
available for later admission. Cancel waiting requests without starting them.

`OmnitronPipelines.listWorkspace({ project, stack?, limit? })` returns matching
definitions and recent run summaries for Console and SDK clients. It resolves
imported stack names through the project catalogue and applies the run limit
after matching the admitted graph. Controller-wide listings also include
unscoped scripts and receipts from before project attribution was recorded.

If a reply is lost, inspect the same run ID or repeat `start` with the same
digest and parameters. A durable completed receipt is recoverable across daemon
restart. `resume` continues the saved definition's remaining graph: confirmed
steps are retained, never-dispatched steps run through Xec, and uncertain commands
block continuation. It requires the current recovery digest and original parameters;
editing the definition does not alter this pinned graph. This does not resume an
arbitrary script midway or guarantee exactly-once business effects. Deduplication lasts
while the run history is retained. Deleting a definition and its terminal history
also removes these receipts.

Admission rechecks the installed payload, release selection, registration, runtime, owner authority and environment before each Xec attempt. It does not install dependencies, prepare missing releases, provision infrastructure or select another owner. Remote release targets are not supported. Runtime loader overrides are refused; native library paths are bounded by the verified closure.

For a remote deployment, `kind: 'deploy'` instead calls the existing ProjectService
stack lifecycle with an exact release ID, manifest digest and infrastructure
preservation review. It has no shell override or automatic retry. `reconcile`
reads fresh node-qualified launch receipts for every expected application and
replica, including consumer identity for imported artifacts. Its `observed-target`
evidence proves the desired launch state is present, not that this request caused
it. Missing, modified and unreachable receipts remain unconfirmed. Cancellation
stops later graph steps and waits for an already dispatched native operation to
settle; it does not claim to reverse or abort that remote deployment.

Xec owns output, retries, timeouts and cancellation. If effects may have started but execution or durable completion cannot be confirmed, the attempt becomes `unconfirmed` and automatic replay is refused. Restart recovery marks unfinished attempts conservatively and does not promise exactly-once execution. Existing callers that compare physical executable paths need an explicitly reviewed definition update to use this contract.

## Scheduled database backups

The daemon loads `backups.scheduledDatabaseExclusions` from its `config.json` at startup. Each entry names one `project/stack/database` or all PostgreSQL databases in one `project/stack`. For example, the following policy keeps the development cache database available for manual backup while other databases continue to follow their schedules.

```json
{
  "backups": {
    "scheduledDatabaseExclusions": ["catalog/dev/cache"]
  }
}
```

An omitted or empty list includes all eligible databases. The policy applies to scheduled `all`, `full` and individual database passes, including older schedules saved under a bare database name. A bare name shared by multiple stacks still requires an explicit target. `omnitron backup schedules --json` reports the loaded policy, affected databases and the last pass's exclusions. The schedule keeps its configured interval even when every database is excluded.

Run `omnitron backup create catalog/dev/cache` for a manual dump or `omnitron backup restore <id>` to restore an archive to its recorded origin. Scheduled retention preserves existing archives of excluded databases, including legacy archives whose recorded origin could match an exclusion. Other databases retain their normal rotation. Scheduled full passes still capture the control plane, daemon state and declared non-database resources. Runtime handoff and recovery retain their own admission checks.

For a single database, `omnitron backup create <project>/<stack>/<database>` prints the operation UUID before submitting the dump. If the RPC reply is lost, the CLI reads that same backup operation. It follows an in-progress receipt for up to the configured database transfer timeout. A successful receipt reports the archive UUID and size. If the outcome is still unconfirmed or you interrupt the CLI, inspect it with `omnitron --json backup operations <uuid>` before requesting another dump.

## Logs and operations

CLI ranked log levels are minimum severities; `--level unknown` selects records without a recognized level. Console's level filters select exact values. Capture, storage and remote delivery are separate states: a live log line does not prove durable delivery.

Use reviewed rollout plans and reconciliation for backend or owner transitions. Lost replies remain visible in operation receipts. Do not infer successful mutation from a local timeout or replace unresolved operations with an unreviewed retry.

## Documentation

[CLI](src/cli/omnitron.ts) · [Public API and exports](package.json) · [Console](webapp/README.md) · [Omni](../../README.md) · [Project documentation](https://omnitron.dev)

## License

[MIT](../../LICENSE).
