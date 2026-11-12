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

The management backend and resident execution owner have separate identities. A backend handoff can retain the owner and application processes. Application release identity is distinct from either runtime's build commit. Status and operation receipts expose those identities; compare the actual target rather than assuming one commit describes the entire node.

Use the ordinary stack release lifecycle to prepare and select installed artifacts. A backend source upgrade takes the compiled backend directory, `<runtime-root>/packages/0/dist`, while runtime installation takes the runtime root. Read-only checks and reviewed plans precede activation. Older peers that cannot enforce a required capability refuse the operation instead of falling back to another execution path.

Stops use durable execution intent. Starting a stack does not silently clear a separately stopped child application's fence. Native process lifetimes and generations distinguish a current process from a reused PID.

## Starting with existing infrastructure

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

Every `--no-watch` invocation refreshes the graph once. Without it, the SDK watcher rebuilds changed packages. Add `--stack dev` when a managed stack must apply each new SDK build: success requires an authoritative watch binding and an owner-confirmed source-refresh receipt. Excluded, missing or changed bindings fail visibly; a successful build alone does not confirm application refresh.

Keep the consumer's `node_modules` directory physical. Standard pnpm `virtualStoreDir` configuration can place the store on another disk; a symlink replacing the entire directory is refused. Initial selection and registry restoration must satisfy the lifecycle and dependency admission checks. SDK selection does not activate a deployed release.

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
