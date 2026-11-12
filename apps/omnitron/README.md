# @omnitron-dev/omnitron

> Production-grade application supervisor and CLI

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Overview

Omnitron is the main entry point for running and managing Titan-based applications. It provides a CLI (`omnitron dev`, `omnitron logs`, etc.) and a process management pipeline that forks child processes, captures structured logs, and exposes both management and data plane Netron RPC interfaces.

Key responsibilities:

- Application lifecycle — start, stop, restart, health monitoring
- Process supervision with configurable startup timeouts and worker pools
- Structured logging with pino, per-app log files, and size-based rotation
- Dual Netron planes — Unix socket management + HTTP data plane per child
- Configuration via `omnitron.config.ts` at the monorepo root

## Usage

The CLI and daemon require Node.js 22.14 or newer on 22.x, or Node.js 23.6
or newer. Their embedded SQLite storage uses Node-API 10.

Use `omnitron start project/stack/app` to start one application through a running daemon. If the daemon is down, `omnitron up` starts it and may also start configured stacks. A fleet-wide `omnitron start` or `omnitron start all` can start a stopped daemon.

Use `omnitron stop project/stack/app` to stop one application or `omnitron stop all` to stop all managed applications. Both require a responsive daemon. If RPC is unavailable or the stop cannot be confirmed, the CLI reports the reason and exits with a failure. Use `omnitron down` for an explicit daemon shutdown.

The resident owner's `executionScopes@1` contract provides one durable stop mechanism
for a stack or one application. `inspectExecution`, `stopExecution` and `enableExecution`
use `{ project, stack, application? }`; application plans bind both the launch generation
and the parent stack revision. SQLite acknowledges a stop fence before any process is
stopped. Retrying a lost reply uses the same operation and plan; a different generation
or parent intent requires a new inspection. An application start requires the observed
intent revision, and enabling the parent never clears a child fence. Installed-stack
recovery also refuses a separately fenced child before starting anything.

This private Netron contract is the owner primitive for independent application source
selection; it does not yet add a CLI or Console switch between dev sources and a release.
Older owners are rejected before scoped RPC or recovery-state changes. Backend handoff
can retain an older owner, but enabling scoped execution requires a separately qualified
owner upgrade. An owner downgrade must reconcile outstanding child fences first: legacy
owners do not understand those records.

```bash
# Link globally
pnpm link:global

# Run in dev mode
omnitron dev

# View logs
omnitron logs
omnitron logs --level warn --grep "error"
omnitron logs project/test/api --node test --level unknown
omnitron logs --status
```

Ranked levels in the CLI are minimum severities. Use `--level unknown` for records without a recognized level, or specify the exact stored spelling of a custom level. In Console, the level chips and the custom-level selector match exact values in both live and historical logs. Share the main log view with one `level` URL parameter per selected level.

## Scoped backups

`omnitron backup artifact storage-objects --project acme --stack prod --bucket uploads`
captures one declared stack's current object contents. Use `tor-keys` without
`--bucket` to capture its onion identity. These administrator-only operations use
the same Netron service as other backups. The index and CLI retain the project,
stack and bucket; restore refuses to redirect an unavailable origin to another
stack. Infrastructure retained after stopping application writers remains eligible.

`backup full` visits every provisioned stack on this daemon and every declared
MinIO bucket, alongside database, Tor and daemon-state backups. Missing inventory
and per-target failures remain explicit. Object snapshots reject unsupported or
changing keyspaces and publish an archive only after transfer and validation.
They preserve current bytes, not object version history or S3 metadata; a full
pass is not an atomic transaction across services. Restore overwrites archived
keys without deleting other keys or creating a missing bucket. Quiesce writers
before an application-consistent snapshot or restore. An interrupted restore
requires reconciliation before writers resume.

Active backup, restore and scheduled retention block backend handoff. A prepared
handoff pauses backup admission and schedules; an abort re-arms persisted schedules.
The native storage integration test uses a disposable, resource-limited MinIO
container without network or application mounts:

```sh
cd apps/omnitron
OMNITRON_TEST_MINIO_IMAGE=<cached-image-digest> pnpm exec vitest run test/integration/backup-storage.test.ts --maxWorkers=1
```

## Configuration reads

An ecosystem file exports data or an async factory receiving `{ phase: 'runtime' | 'release' }`.
Each read evaluates the real file and its complete import graph in a fresh, short-lived
process. Editing a selected registration or another transitive import therefore takes
effect on the next reload. Native `import.meta.url`, `createRequire`, TypeScript,
ESM/CommonJS, the invoking working directory and environment keep their normal meanings.
App-relative paths are then anchored to the configuration's directory.

All bootstrap forks, topology children and pool workers receive the application's
working directory. The owner's sealed runtime is not an application state directory.
Keep persistent storage outside release trees and configure its absolute path;
an application package can itself be immutable even when its launch cwd is correct.

Before replacing an owner, validate both the forward and rollback application
selections through the ordinary stack release check, against the actual registered
configuration and its complete inputs. A backend compatibility check does not
establish cold application recovery. Retained launch handles belong to a living
owner; after replacing it, a selected archive still needs an admissible deployment
declaration. Preserve and qualify that declaration instead of relaxing its digest
check or temporarily substituting files to obtain an admission receipt.

The native `test/runtime/managed-backend.mjs` owner roundtrip accepts
`--application-project /absolute/path/to/installed-consumer`
and `--application-sdk-commit <full-sha>`.
The consumer must directly resolve its matching Omnitron, Titan and Titan Storage.
The full production dependency graphs must stay inside that consumer checkout
(or its pnpm workspace); virtual-store siblings are included, external links are refused.
Alongside the baseline → candidate → baseline service transition, this exercises
one project's source and pinned-release stacks through the public project API:
single and pooled bootstrap workers, source watch without restarting frozen workers,
a storage write/read from each worker in the application's directory, a second cold
candidate start, retained release selection, and explicit refusal of
a changed declaration. It verifies runtime bytes and entry change times after the
applications run. All services, Git inputs and release archives belong to the private
fixture; this does not establish cold readiness of real application registrations.

Return plain declarative objects, arrays and finite primitives; optional `undefined`
values are preserved. Functions inside the result, accessors, class instances, cycles,
symbols and bigint values are refused explicitly. Lifecycle hooks belong in the app's
bootstrap definition. A configuration factory must not start services or rely on
mutating the controller's process environment: it exits after returning its data.
Configuration is trusted executable code; graph isolation controls freshness and
lifetime, and does not restrict filesystem or network access.

Definition and ecosystem reads share one process lifecycle. The default deadline is
60 seconds; `loadEcosystemConfig` / `loadEcosystemConfigFile` from
`@omnitron-dev/omnitron/config` may
pass `{ timeoutMs }` as the third argument, up to ten minutes. Reader output is private
and limited to 1 MiB; results are limited to 16 MiB. A failure includes a bounded,
credential-redacted reason. A read completes only after its child exits; a timeout
kills that reader, and a disconnected parent ends a pending asynchronous read.

## Building an application release

`omnitron release build <project> --for <stack>` uses the selected project
commit, its `pnpm-lock.yaml` and the stack's build environment. The Console
Build action runs the same builder. A registered project can live in a Git
subdirectory. Its lockfile and configuration belong in that directory. The
builder clones the selected commit and records the subdirectory in the release
manifest. Declare `@omnitron-dev/omnitron` in a
workspace importer and commit the lockfile. Install all `@omnitron-dev/*`
dependencies from the same framework release.
Development definition reads and application builds use the same package
resolution policy: TypeScript workspace entries are compiled with their relative
imports and decorators; built packages remain external to preserve shared module
and DI identity. Source workspace dependencies participate in the incremental
watch graph. Reading a definition never requires changing those package exports
to built output or installing a second runtime loader in the application.
Compiled imports retain the dependency selected from their original package,
including its ESM conditions and version. Generated local bundles reference that
file relative to their output, so library dependencies need not be copied into
every application manifest. These `.omnitron-build` files belong to the local
installation; checked releases use the ordinary package build and sealed closure.

Each application with a Titan bootstrap must declare `@omnitron-dev/titan`
in its own runtime dependencies. Before packing, the builder verifies that
the public Titan entry resolves inside the application’s staged package.

Each new manifest records the Git directory and `package.json` blob of the
package compiled for each artifact under `artifacts[].packageSource`. Its
`migrations` map contains package-relative paths and SHA-256 digests of the
tracked migration sources in that package. Files owned by a nested package
are counted separately. A checked build refuses a source migration or package
manifest whose bytes differ from the selected commit. An empty map records a
checked package with no matching source files. Older artifacts lack this
inventory. The runtime database journal records which migrations actually ran.

Declared migration entries also appear in `packageSource.migrationPrograms`,
independently of their filename. Each record binds the package-relative source
path, Git blob and SHA-256 to the compiled entry and its SHA-256 inside the packed
closure. Capture uses the same database ownership and stack overrides as migration
execution. `--for <stack>` selects that stack's declarations; without it, the
builder combines the declared stacks and refuses conflicting bindings. Neither
source nor compiled migration code runs during this inspection.

These records describe the migration program, not an applied database version or
every file it imports. A registry may change when adding a migration. Its digest
is therefore separate from the immutable `migrations` map; the shared Kysera
runner still checks executed migration bodies against database history. Imported
applications retain their producer's evidence. Older artifacts without
`migrationPrograms` have unknown declaration provenance; an empty source
inventory does not prove that they have no migrations.

For a checked remote release, the controller reads the application's
`config/default.json` infrastructure declaration from the verified archive.
The same declaration is used to check the release, provision services and
resolve application connections. An absent section stays absent. Bootstrap
code declarations retain their existing precedence and come from the
registered project. Local releases read the installed, verified package.

For registry dependencies the builder downloads the exact public npm archives
and compares each SHA-512 digest with the lockfile. Each package must carry the
same full `gitHead`. Omnitron's own `dist/BUILD.json` must confirm that clean
commit. The manifest records the package names, versions and archive digests in
`omni.registry.packages`. Frozen installs can use a local store or registry
mirror. Independent archive verification requires access to
`registry.npmjs.org` on every build. Older packages without packed source
metadata require a linked source checkout or committed, reproducible archives.

For a workspace that commits its framework tarballs, use
`omnitron release build <project> --omni-commit <full-upstream-commit>`.
The lockfile must pin every framework archive by its project-relative path,
version and SHA-512. The builder reads the blobs directly from the project
commit, checks out the requested commit on Omnitron's upstream main branch,
installs its frozen dependencies, builds the workspace and reproduces each
package with pnpm. The canonical archive must match the committed bytes.
The manifest records the upstream tree, package paths, versions and digests
in `omni.reproduced`. Supply a Node and pnpm toolchain capable of producing
the same bytes. An existing Omnitron source checkout can provide the Git
objects when its upstream tracking branch contains that commit. Otherwise
the builder clones the official repository.

The builder compares the installed framework with those archives and checks
the framework files again inside each application's staged dependency graph.
Build reuse hashes pnpm's effective override rules and the bytes of local override
archives, including version-qualified selectors, parent-specific aliases and
dependency removals. These rules retain pnpm's semantics: a checked release ships
the verified installed graph for its target rather than resolving it again with
another package manager. Local override archives must remain inside their source
workspace and must not change during verification or copying.

An npm-installable source bundle has a narrower contract. It refuses selectors
that cannot be represented without changing their scope, such as pnpm's immediate
`parent>child` rule, and version-qualified local archive overrides. Npm's nested
overrides also affect deeper descendants and are not an equivalent translation.
Use `omnitron release build <project>` for these projects. This limitation does
not invalidate a checked release or its build-input checksum.

Admission checks the target execution owner's source commit. On a supervised
node with an older owner that cannot report its build, an updated target
backend verifies the live OS service, process, owner identity and sealed
runtime when the operator checks or deploys the release. A connected owner
with a different build, an unverified runtime or an interrupted handoff
refuses admission. Installation also checks the target Node executable, OS, architecture and dependency
graph against the application archive. The release details show Git branch
visibility separately. If GitHub cannot confirm the framework commit on
`main`, its visibility is unknown and a stack requiring `requireOnRemote`
will refuse admission.

Projects developing against a linked Omni checkout can keep their existing
relative layout. The builder clones that repository at its selected commit
and builds the linked packages. `--omni-commit` selects the checkout revision
in this mode. With registry dependencies it is an assertion and must be the
full commit recorded by the pinned archives. A release uses one source mode for its whole framework.

## Imported applications in local releases

A local stack can use an application built by another project without linking
its source tree or adopting the consumer's SDK. Declare an application entry
with `releaseFrom: { release, manifestSha256, app }`, where `release` is the
producer release ID and `manifestSha256` pins its exact manifest bytes. The
consumer release retains that evidence and the unchanged application archive.
Each producer's gates must pass. Its package source, framework and Node target
remain independent of the consumer's build.

Use `omnitron stack prepare-release <project> <stack> <release>` to verify and
materialize the consumer's immutable entries. Preparation runs no application
code and changes no running selection. Starting with `--release <release>`
stores the selection durably; an unresolved imported entry cannot start from a
working tree. Startup loads declarations from the verified installed package
and resolves its own Omnitron adapter and Titan. Imported applications default
to their installed package as the working directory; an explicit `cwd` selects
a separate data directory. The actual owner's Node
executable must match the producer's recorded target. Changes to imported
migration history are checked against the previous producer package.
Readiness declarations are checked against the resolved execution mode:
bootstrap applications publish domain health through Titan hooks, while file
heartbeats remain available to classic scripts.

Concurrent preparation of the same entry accepts only a complete receipt for
the same application, owner and runtime. If receipt publication interrupts a
tree scan, preparation verifies the published receipt and the admitted payload
again; changed files or an incompatible binding still fail verification.

Read-only diagnosis and topology use captured launch declarations. If no
release is selected, or an older owner has not supplied declaration evidence,
they report the missing information. A retained archive match proves installed
bytes; it does not confirm which release an already-running process loaded.
Updating the controller cannot manufacture that missing owner evidence.

### Changing the applications of a stopped local stack

An explicit local stack start can reconcile the target graph with retained
applications when the owner supports `stoppedStackReconciliation@1`. Prepare the
release, review and complete a whole-stack stop, then start the selected release.
An unpinned development stack uses the same contract with its registered configuration.
Admission in CLI and Console identifies registrations that will be retired. An
older owner refuses the change before the release selection changes.

The existing SQLite selection and durable stack fence cover the operation.
The owner verifies the complete inventory, launch generations and confirmed exits,
revokes source watches, updates retained definitions and retires only applications
absent from the selected graph. It preserves logs, archives and infrastructure.
Concurrent starts, stale plans and unconfirmed processes are refused. Automatic
boot or resume never retires a retained application. After an interrupted operation,
inspect the stopped stack and explicitly finish its selected start or restore the
previous configuration and release. Cold recovery keeps the selected manifest;
rollback can recreate a retired registration from its original sealed artifact.

This supports a sealed shared-services stack alongside a separate development
stack. Imported producers keep their complete pinned SDK. It does not implement
a persistent public stop or source selector for an individual application.

Remote imports are currently refused before provisioning or transfer. They
need producer-captured deployment declarations and a compatible execution
owner; controller-side execution of a foreign bootstrap is not a substitute.
Existing single-project remote deployments keep their normal declaration path.

## Runtime identity inside an application

Titan bootstrap applications receive `RUNTIME_CONTEXT` from
`@omnitron-dev/omnitron/runtime` before module initialization. The bootstrap
adapter verifies the actual compiled entry, its installed payload, Node binary
and resource options against the private installation receipt. Applications
must not register their own provider for this reserved token; a competing
provider fails initialization. The returned context and its nested records are
immutable.

A verified context has `basis: 'verified-installed-runtime'`. Its `producer`
identifies the original release, manifest, archive, application and project/framework
commits; `consumer` identifies the stack's release and application alias.
Importing a release preserves this distinction. The existing version 2
installation receipt carries the additional origin binding; no parallel
application-authored provenance file or environment claim is trusted.

```ts
import { RUNTIME_CONTEXT } from '@omnitron-dev/omnitron/runtime';

const origin = container.resolve(RUNTIME_CONTEXT);
if (origin.state !== 'verified') {
  throw new Error(`Qualified capture requires installed origin: ${origin.reason}`);
}
// Persist a producer/session once, then reference it from observations.
const producer = origin.producer;
```

For an independently launched compiled script, call
`await verifyInstalledRuntime(new URL(import.meta.url))` at its real entry point.
The URL must be the admitted executable itself. A sibling module, directory,
symlink, extra loader, changed payload or malformed receipt is refused with
`RuntimeOriginVerificationError` (`RUNTIME_ORIGIN_INVALID`). Only a development
entry without an installation receipt, or a valid older receipt without the
origin contract, returns `state: 'unavailable'`. Applications may explicitly
record such development data as unknown; they must not silently attribute it to
an admitted producer. Existing historical rows remain unknown unless their
original source can independently be established.

Browser-facing DTOs can import `ArtifactIdentity` and `parseArtifactIdentity`
from `@omnitron-dev/omnitron/runtime/identity`. This subpath validates exactly the
six immutable identity fields and does not load Node filesystem or process APIs.

Installed identity proves the checked startup payload, not a process-owner
launch receipt, continued in-memory integrity, or a boundary against a hostile
host administrator. `ownerAttestation` is therefore explicitly `null`. An older
owner's missing launch evidence or unsupported installed-start capability stays
visible; updating a controller or application SDK does not manufacture either.
Local preparation requires a connected independent owner whose physical package
can be verified through its managed OS service. An unsupported or unverified
owner refuses preparation with an actionable error. Working-tree development
continues to use the explicit unavailable context.

For working-tree bootstraps, both a directly supervising daemon and a resident
owner select the adapter from the application's current dependencies. The
adapter and the application must resolve the same physical Titan installation.
Use the project's lockfile to install them together. The controller can use its
own SDK. In coupled mode, a plain bootstrap with no declared or installed
Omnitron or Titan package can use the daemon's built-in adapter.

Local and remote checked installations preserve the complete application package,
including its own Omnitron bootstrap adapter and Titan dependency identity. The
execution owner's SDK may be a different release: its responsibilities are the
verified Node image, lifecycle supervision and control authorization. Neither path
replaces application packages with owner dependencies, installs missing packages,
or ignores metadata and license files when comparing the admitted payload.

Remote admission authenticates the existing resident execution protocol (version
1), native owner process and controller epoch. It rechecks this binding around
transfer and activation. A coupled daemon or unknown protocol is refused before
transfer and requires an explicit owner transition. This does not grant missing
installed-start capabilities, bypass roles or recipient-fenced cluster admission,
or make a multi-node rollout atomic. An owner/controller change interrupts the
attempt instead of being silently adopted.

Both paths use the same bounded archive extraction and closure verification. The
manifest-selected `bootstrap` or `script` entry, closure digest, full payload,
Node executable/ABI/platform, resource options and aligned app-owned adapter are
checked before a receipt is published. Receipt v2 binds the **application SDK** to
the admitted producer and separately binds the **execution owner** by its physical
package and runtime target. Older receipts remain readable for diagnosis; they do
not authorize graph rewriting or adoption of unverified installations.

## Host-owned public ingress

See [host ingress setup, application publication and recovery](HOST-INGRESS.md) for independent multi-application HTTPS hosting through the native CLI and RPC API.

Development definitions and watched builds preserve the registered project path, including directory symlinks used by workspaces. Compiled external dependency imports are relative to the physical output directory used by Node, so opening a project through an alias does not change package selection or runtime module identity.

## Application migrations and diagnostics

Release migration admission validates `settings.env` and `settings.appEnv` against the complete stack, then verifies only the declared migration owners and files. Each migrator receives its own resolved application environment; variables declared for another running application are valid but are never copied into the migrator. Unknown application names and missing vault values still refuse admission before database changes.

`@omnitron-dev/omnitron/migration` provides migration definitions, the shared
Kysera-backed runner, PostgreSQL pool adapters and configuration helpers. It can
be imported without starting the daemon. Applications need no direct Kysera
installation. Use `omnitron migrate status`, `up --dry-run`, `up`, `verify` or
`down --steps 1` with `omnitron.migrations.ts`. `--daemon` explicitly selects the
daemon's own registry.

`@omnitron-dev/omnitron/readiness` exposes Titan Database's read-only
`requirePostgresSchema(pool, requirements)`. Applications use it after the declared
migration phase and before accepting traffic. Each component declares only the
schema it consumes; additive unrelated migrations remain compatible. A mismatch
reports `database_schema_incompatible` and exact violations without executing DDL
or closing the application pool. This is independent of migration-journal integrity,
which remains the responsibility of `migrate verify` and the shared runner.

Migration ownership belongs to the stack, not each application instance. A PostgreSQL
consumer does not gain permission to apply DDL. Declare one owner by its application
alias, independently of the database name:

```ts
api: {
  migrate: [
    { app: 'api-service', config: 'src/database/portal.migrations.ts', releaseConfig: 'dist/database/portal.migrations.js' },
    { app: 'api-service', config: 'src/database/market.migrations.ts', releaseConfig: 'dist/database/market.migrations.js' },
  ],
}
```

This entry belongs to the PostgreSQL preset's `config.databases` (or legacy
`infrastructure.postgres.databases`). A single binding can be an object. Every module
exports the existing `defineMigrationConfig`; its runner options, registry, checksum
format and lock remain independent. Source paths are relative to the owner's declared
`cwd`. Its ordinary package build must emit each `releaseConfig` within the sealed
application payload. Imported aliases retain their producer's admitted package.

Local startup and remote deployment use one normalized ownership plan. They validate
all destinations and programs, then import every config and resolve its definitions
before opening a migration connection. Config factories load definitions; `connect()`
owns connection creation. Every config uses the existing public `executeMigrationOperation`
in an isolated child. Programs never fall back to the working tree or another file.
Sealed payloads are reverified before execution. Configs receive the complete resolved
`DATABASE_URL`, including transport settings; URL options cannot override its host,
port, database or credentials.

`migrate: true` preserves the conventional `src/database/migrate.ts` →
`dist/database/migrate.js` script and app-prefixed environment. An omitted/root cwd
retains `apps/<database>` for this compatibility spelling; another declared cwd wins.
The old script cannot guarantee URL query options and refuses them. `migrationDir`
never controlled execution and is now refused with an explicit binding remedy.
Absent/false opt-in means no migration, including on remote nodes: an existing script
and `DATABASE_URL` are not permission to run it. Requirement discovery also grants none.

Several registries run in declaration order under one database owner. A failure blocks
candidate application activation, but previously committed migrations are history;
there is no transaction across registries or databases. Execution has a ten-minute
deadline, never retries an ambiguous outcome, and requires ledger inspection after
interruption. For explicit remote ownership, the owner must occupy exactly one node;
that node is processed first. Multiple explicit owning nodes are refused before
provisioning because the current deployment path has no global migration barrier.
Legacy boolean bindings describe node-local databases, not shared cluster ownership.

`omnitron infra migrate --stack dev --dry-run` previews the same declarations without
connecting. The standalone command uses the application's and stack's explicit
settings, or the invoking environment; it does not retrieve a managed vault or invent
connection defaults. Use the elected controller for enrolled or remote stacks. When
no database migration policy exists, the older explicit `infra migrate` command
continues running package `migrate` scripts in dependency order; a declared `false`
never falls through to that compatibility path.

Console and CLI stack diagnosis show the declared owner and available programs.
They do not execute config factories, authenticate to databases or certify schema
readiness. Runtime workers should inspect their required schema through the shared
read-only migration API instead of applying migrations on every restart.

`omnitron stack status <project> <stack>`, its JSON response and Console stack
cards/details retain unavailable applications and safe reasons from the last start.
Known missing modules identify the filename or package and the corrective action;
host directories, credentials and arbitrary application output stay out of reader
views. A source module missing during development can indicate an incompatible
active runtime compiler, not an application that merely needs building; verify
both dependency installation and the compiler used by its process owner.
These observations survive backend handoff and disappear from current status
when the application is online. `stack diagnose` also reports previous failed starts
and declaration reads, with their observation time. They remain **unknown**, rather
than a new startup test: editing a dependency does not prove a successful retry.
Successful declaration refresh replaces its previous failure; diagnosis itself
does not execute application code, provision services or run migrations.

Boot and automatic recovery admit each enabled stack independently. Docker is
required only by the stack's actual provisioning path: an unavailable local
daemon does not delay remote attachment or externally provisioned applications.
A failed stack retains its concrete error and retries with its own exponential
backoff (one to fifteen minutes). Healthy or degraded stacks remain under
application supervision; they are not restarted as a side effect of that retry.

## Independent service preparation

`omnitron service install --prepare` records the selected sealed runtime for both
native guardian and execution owner without stopping processes or loading services.
`--owner-runtime <sha256>` explicitly selects a different **already installed**
sealed owner. Both artifacts pass the ordinary integrity and native compatibility
checks; the owner's declared capabilities must satisfy the selected backend.
The owner unit uses its own pinned Node and managed entry point. The guardian and
backend retain the selected runtime.

After stopping the instance, repeat `service install --prepare` to review a
different owner or backend binding. Preparation validates the saved plan's
instance, execution directory, scope and native role identities and retains its
private environment, even when the preparing shell has no runtime secrets.
An invalid saved record is refused; it is never replaced with shell defaults.

Review the private supervision plan, then use the same scope and owner hash for
`service install` during an approved controlled shutdown. Installation refuses
running resident processes or loaded/queued native jobs, overlapping service scopes and a saved plan whose
owner or backend selection changed. The installation lease covers plan validation
and active unit writes; unload launchd jobs or stop systemd units before installing.
An unavailable OS status query refuses installation. This option does not install a runtime,
stop applications, supply missing owner capabilities or automatically fall back.
An older owner's unsupported application operations remain unavailable.

On Linux, guardian replacement checks the full systemd cgroup before stopping
the unit. Its only permitted processes are the recorded guardian and backend;
occupied descendants, additional processes, frozen or ambiguous group state
refuse the transition. The refusal identifies the group and expected/observed
PIDs or state. During preparation, if both original processes are present and
the root group has an extra member, Omnitron can spend up to 1.5 seconds waiting
between full inspections. Preparation succeeds only after the extra member exits
and the original process lifetimes and unit pass inspection again. Review and
apply check the saved plan against the current scope immediately. PID ordering and repeated entries in the kernel's
`cgroup.procs` record do not change its process set; process lifetimes, executable
identities and group membership are independently verified twice.

For an isolated native owner roundtrip with real application workloads, pass
`--application-project <installed-consumer>` and `--application-sdk-commit <full-sha>`
to `test/runtime/managed-backend.mjs` alongside `--owner-roundtrip`. The fixture
checks all required dependencies, their containment and the SDK's clean build stamp
before creating services. Its result
records the application's framework commit and the owner's commit and artifact hash.

## Starting with existing infrastructure

Runtime-only recovery uses the ordinary stack lifecycle with
`--infrastructure preserve`. It requires existing, running resources whose
native identities and specification match the resolved declaration. It cannot
provision, recreate or restart infrastructure, run post-provision setup or
framework database migrations, install a remote daemon, upload static content,
or rewrite a node's infrastructure configuration. Application startup still runs
the application itself; its readiness and application-owned startup hooks remain
separate checks.

Before the maintenance stop, prepare the selected release through
`stack prepare-release` if necessary, load the intended project configuration,
and review preservation for both the forward and rollback selections:

```sh
omnitron stack start acme prod --release <release-id> --infrastructure preserve --dry-run --json
```

The review reads existing resources and current cached bootstrap declarations;
it does not import application code or install a release. A non-null `digest`
requires every target to be verified. Native container IDs, restart generation,
image identity, ownership, environment, ports, mounts, network, resource limits
and health-check specification are checked against the desired plan. Extra or
missing resources and changed presets require a separately approved reconcile.
A changed historical spec-hash algorithm alone is not native drift. Mounted
configuration needs a matching creation receipt because mount paths cannot prove
which configuration bytes a running daemon consumed. Unverifiable configuration
receipts, host-service identities or recipient capabilities remain explicit
failures; they are never treated as a successful preservation review.

After the separately planned application stop and runtime transition, start with
the reviewed authority:

```sh
omnitron stack start acme prod --release <release-id> --infrastructure preserve --review <digest>
```

The daemon repeats release admission, installed provenance, declaration and
environment fingerprinting, and native inspection before startup. It checks
native identity again when adopting the existing resources. The digest binds
the exact launch context: a changed owner, installation, release, configuration
or resource requires a new inspection. A review made before a planned owner
change does not certify that changed owner. Omitting `--review` makes the CLI
obtain and submit a current review; supplying it additionally pins the previously
inspected digest. No secret environment values are returned in review evidence.

`stack stop --keep-infrastructure` persists the preservation restriction before
stopping applications and drains infrastructure repair work. Subsequent ordinary
and automatic starts cannot return to reconciliation. A successful preserve start
retains read-only health observation; unhealthy or replaced resources are reported
without repair. Handoff retains this authority. An operator must explicitly select
`--infrastructure reconcile` to authorize normal provisioning, setup and migrations
again. A new project registration does not inherit an old registration's authority.

The operator RPC contract is `OmnitronProject.reviewStackStart({ project, stack,
release?, workingTree?, infrastructure: 'preserve' })`, followed by
`startStack({ project, stack, release?, workingTree?, infrastructure: 'preserve',
review })`. The existing remote lifecycle forwards the resolved infrastructure
through `OmnitronInfra.reviewStack` and `provisionStack` with the same preservation
authority. Recipients must acknowledge protocol 1; an older node refuses recovery
without a provisioning fallback. Existing project isolation, deployment operations
and cluster authority checks continue to apply. `check-release` alone checks release
admission; its historical build/test gates do not certify preservation or classic
application startup compatibility.

## Standalone infrastructure

`omnitron infra up`, `down` and `reset --yes` operate on containers declared
by the current standalone ecosystem. Reset keeps their volumes. Projects with
named stacks use the stack lifecycle. In Console, a **Read only** chip on a
container explains which owner or operation controls its lifecycle. Its logs
remain available to authorized users.

`@omnitron-dev/omnitron/diagnostics` exposes the shared Titan finding contract,
redacted cause formatting and an adapter for the existing durable alert outbox.
CLI health, doctor and Console node details report unresolved runtime failures
with evidence and recovery guidance. The bounded health projection lives in the
daemon process; structured logs remain the persistent record.

Application output is captured from spawn through EOF with stable IDs, source
process/stream and capture timestamps. SQLite journals retain unfinished multiline
messages and unacknowledged delivery. Files use replayable append offsets; database
rows and node replication outbox entries commit atomically. Retries verify the
original identity and content. `omnitron logs --status` and Console Logs share the
same persistence verdict, including pending delivery, commit evidence and errors.
An older resident owner is explicitly reported as `legacy-owner`; updating only
the backend cannot replace its capture mechanism without an owner maintenance window.

## Source development and installed releases

`omnitron sdk dev /path/to/omni --project-dir /path/to/project --stack dev`
selects a local SDK and watches its source changes. The project must have an npm
distribution lock and the hook installed by `omnitron sdk init`. The initial
dependency switch requires the project's local source stacks to be stopped.
The owner must advertise `applicationRuntimeResolution@1`: otherwise it can
retain a previous package identity after pnpm replaces dependencies. Both SDK
selection and restoration of registry dependencies refuse this owner before
installing packages. Prepare and qualify an owner transition separately.
SDK commands also require a fresh owner observation and a matching Node ABI,
platform and architecture. Use the Node version reported by `omnitron status`;
the SDK command passes its selected Node to package installation and builds.
A different shell default must not silently produce incompatible native addons.

`sdk status` checks the project's resolved imports; the daemon's `status` reports
the running backend and owner independently. Online applications or a source
watcher alone do not establish that the project uses the current SDK. Leave
`sdk dev` running to rebuild platform packages and refresh their watched
consumers; `--no-watch` selects dependencies without starting that watcher.

Build caches must include `.omnitron/dev-sdk/*.json` as inputs. For Turbo, add
this glob to the project's `globalDependencies`. It binds cached tasks to the
selected SDK and the successful build checkpoint, including declarations and
static assets. The distribution lock alone cannot identify locally linked code.
These private files stay outside Git and are absent in clean registry builds.

One owner can supervise development applications and installed releases together.
Watch applies only to source entries allowed by the application and global watch
policy. An installed entry (`releaseRoot`) never enters the source build pipeline
or either watcher, even when development mode is enabled. Launch receipts and
artifact integrity still determine whether an installed executable is trusted;
setting `releaseRoot` does not grant that trust.

Enabling watch reconciles edits made while watch was disabled. Disabling watch
awaits disposal and cancels queued automatic restarts. A restart already stopping an
application may finish when only global watching is disabled. Explicitly
redefining that application revokes its pending restart, including an identical
redefinition: the old request cannot relaunch a previous source entry or select
a different release. The stopped application retains its current definition;
inspect it and start it explicitly. This revision belongs to the supported
redefinition API, not to arbitrary in-place mutation of configuration objects.

`watch: false` leaves a source application available for an explicit restart, which rebuilds its current
TypeScript sources. Stopping and resuming an installed stack reuses its verified
release and retained launch configuration, independently of other applications'
watch policy. CLI and Console report both file and source build watchers through
the same owner state.

## License

MIT

### Resizing a process pool

`omnitron scale <app> <count> --process <name>` resizes one running, explicitly
named topology pool. `apps.scale` exposes the same required `process` to agents.
Classic applications and singleton processes cannot be replicated through this
operation. Counts must be positive safe integers. Fixed pools allow 1 through
`scaling.maxInstances` (default: their declared `instances`); automatic pools use
their declared instance count as the minimum and `maxInstances` (default: four
times that count) as the maximum. Automatic scaling continues after the request.

This changes runtime membership until restart. It does not modify project
configuration, release metadata, or the durable declared size. CLI, Console and
RPC report observed `instances` beside `declaredInstances` for the selected
process; the application's aggregate instance field is not the pool size. Change
the project declaration and deploy it to persist a different size.

The resident owner must advertise `processPoolResize@1`. Older owners refuse
this operation before dispatch; backend updates remain possible. Installing an
owner with this capability requires a separately planned application restart.
