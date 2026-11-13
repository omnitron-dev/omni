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

On local cold updates, `omnitron backend select <sha256> --check` previews changes to the host database and stack containers. If the host PostgreSQL was created on a project bridge, the preview identifies its SQL cluster and the required PostgreSQL process restart. Moving the retained container to the platform bridge rebuilds host port forwarding. Startup checks the cluster through both the container and its published SQL port before applying migrations. The named volume and container ID survive this transition.

The management backend and resident execution owner have separate identities. A backend handoff can retain the owner and application processes. Application release identity is distinct from either runtime's build commit. Status and operation receipts expose those identities; compare the actual target rather than assuming one commit describes the entire node.

On a development machine, run `xec update local-check` in the main checkout to build the committed revision and inspect its handoff. Run `xec update local-apply` to activate the same candidate on a healthy controller. Both commands reuse the verified backend and Console build for that commit, platform and Node version. Use the same `--cache-dir <directory>` for both commands to keep builds on a development volume. This path uses the local Git checkout, frozen dependencies and the Turbo build cache.

Use the ordinary stack release lifecycle to prepare and select installed artifacts. A backend source upgrade takes the compiled backend directory, `<runtime-root>/packages/0/dist`, while runtime installation takes the runtime root. Read-only checks and reviewed plans precede activation. Older peers that cannot enforce a required capability refuse the operation instead of falling back to another execution path.

Backend preflight loads the actual daemon dependency graph with a 30-second child deadline. Failures include a machine-readable code and details with the verified runtime hash, elapsed time, child PID and last reported loading phase, while retaining the original cause. Bounded progress records appear on stderr only for `--check-backend`; they do not establish readiness or replace a successful protocol/build response. A successful standalone preflight does not qualify a transition or rollback.

Before draining a backend, the candidate also inspects the certified infrastructure snapshot without starting a daemon or changing Docker. It must support adoption preflight protocol 1 and confirm the exact snapshot digest. The guardian repeats this check on the frozen handoff checkpoint before retirement; a refusal there aborts the handoff. Targets and guardians without this capability are refused, including an ordinary upgrade targeting an older runtime. Automatic restoration of the original backend retains its separate recovery checks; it is not reported as a successful candidate adoption probe.

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

The first selection may ask pnpm to generate its package-manager metadata. That metadata is not a registry application lock. A missing or stale registry baseline requires a normal registry installation before `sdk registry` can restore it. Ordinary `pnpm run` commands use the selected profile without extra flags.

`sdk status` validates registry importers with pnpm's frozen lockfile check, including overrides and relative local dependencies. Framework packages must still resolve to registry archives with SHA512 integrity; file and link overrides for them are refused. Inspection uses the installed pnpm matching the project's exact package-manager pin (qualified with pnpm 12.16.1), keeps its temporary cache separate, and runs no install scripts or custom manifest hooks. A lock that requires those hooks, an unsupported pnpm command, or stale dependency configuration fails explicitly. This checks existing installation provenance and lock freshness offline; pnpm's `--trust-lockfile` skips a new supply-chain policy lookup, so status is not a fresh registry security audit.

Every `--no-watch` invocation refreshes the graph once. Without it, the SDK watcher rebuilds changed packages. With `--stack dev`, Omnitron records the owner's receipt for each watched application that uses the changed SDK. An application such as a Vite server can declare `watch: false` and manage its own reloads. The CLI reports it separately and leaves its generation running. It checks the declaration in the stack's registered configuration before and after refresh. A missing required watcher or a changed binding fails the operation. Check an application's own reload mechanism through its native client.

Keep the consumer's `node_modules` directory physical. Standard pnpm `virtualStoreDir` configuration can place the store on another disk; a symlink replacing the entire directory is refused. Initial selection and registry restoration must satisfy the lifecycle and dependency admission checks. SDK selection does not activate a deployed release.

After a confirmed `stack stop --keep-infrastructure`, the SDK can start the local working tree and keep watching it.

```sh
omnitron stack start acme dev --working-tree --dry-run --infrastructure preserve
omnitron sdk dev /path/to/omni --project-dir /path/to/acme --stack dev --start-stopped --review "$digest"
```

Set `digest` to the digest from the first command. The second builds the selected SDK, checks the stopped applications and retained infrastructure, and sends one start request for that stop ID. The first owner generations become the receipts for those SDK outputs. If the reply is lost, the CLI reports the observed stack state and leaves the SDK receipts unconfirmed. On a confirmed start, the watcher handles later source edits. Add `--no-watch` for a single reviewed start.

Run `omnitron sdk status --project-dir /path/to/project --stack dev` to compare current package outputs and owner generations with the receipts from the last build. The command is read-only. Its JSON result identifies each confirmed application, each explicit opt-out, and the inactive and unaffected applications.

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
omnitron pipeline status <run-id> --output
omnitron pipeline save publication.json --id <pipeline-id> --expected-revision <sha256>
```

The public `PipelineDef` contract is exported from `@omnitron-dev/omnitron/dto/services`; `verifyInstalledRuntime` from `/runtime` supplies a verified caller's producer identity. Console's JSON editor preserves release targets and arguments. Entries must belong to the admitted closure, arguments are literal arrays, and output belongs outside the immutable installation.

Admission rechecks the installed payload, release selection, registration, runtime, owner authority and environment before each Xec attempt. It does not install dependencies, prepare missing releases, provision infrastructure or select another owner. Remote release targets are not supported. Runtime loader overrides are refused; native library paths are bounded by the verified closure.

Xec owns output, retries, timeouts and cancellation. If effects may have started but execution or durable completion cannot be confirmed, the attempt becomes `unconfirmed` and automatic replay is refused. Restart recovery marks unfinished attempts conservatively and does not promise exactly-once execution. Existing callers that compare physical executable paths need an explicitly reviewed definition update to use this contract.

## Logs and operations

CLI ranked log levels are minimum severities; `--level unknown` selects records without a recognized level. Console's level filters select exact values. Capture, storage and remote delivery are separate states: a live log line does not prove durable delivery.

Use reviewed rollout plans and reconciliation for backend or owner transitions. Lost replies remain visible in operation receipts. Do not infer successful mutation from a local timeout or replace unresolved operations with an unreviewed retry.

## Documentation

[CLI](src/cli/omnitron.ts) · [Public API and exports](package.json) · [Console](webapp/README.md) · [Omni](../../README.md) · [Project documentation](https://omnitron.dev)

## License

[MIT](../../LICENSE).
