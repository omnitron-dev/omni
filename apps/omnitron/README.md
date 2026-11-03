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

## Building an application release

`omnitron release build <project> --for <stack>` uses the selected project
commit, its `pnpm-lock.yaml` and the stack's build environment. The Console
Build action runs the same builder. A registered project can live in a Git
subdirectory. Its lockfile and configuration belong in that directory. The
builder clones the selected commit and records the subdirectory in the release
manifest. Declare `@omnitron-dev/omnitron` in a
workspace importer and commit the lockfile. Install all `@omnitron-dev/*`
dependencies from the same framework release.
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

## Host-owned public ingress

See [host ingress setup, application publication and recovery](HOST-INGRESS.md) for independent multi-application HTTPS hosting through the native CLI and RPC API.

## Application migrations and diagnostics

`@omnitron-dev/omnitron/migration` provides migration definitions, the shared
Kysera-backed runner, PostgreSQL pool adapters and configuration helpers. It can
be imported without starting the daemon. Applications need no direct Kysera
installation. Use `omnitron migrate status`, `up --dry-run`, `up`, `verify` or
`down --steps 1` with `omnitron.migrations.ts`. `--daemon` explicitly selects the
daemon's own registry.

For projects that provide a package-level `migrate` script, run
`omnitron infra migrate --dry-run` in the ecosystem directory to review
the package paths and their dependency order. `omnitron infra migrate`
runs the plan once per package. Supply an application name to select one.
A failure identifies its application and halts the remaining scripts.
On an enrolled node, direct lifecycle and migration writes require a
recipient-fenced execution path.

For a stack with explicitly requested PostgreSQL migrations (`migrate: true`),
startup validates every migration program before provisioning infrastructure.
A development stack uses its application’s `src/database/migrate.ts`; a selected
local release uses only `dist/database/migrate.js` inside the verified installed
artifact, with that artifact’s dependencies and the verified Node executable.
The compiled convention is shared with remote deployment. The current standard
migrator consumes the app-prefixed host, port, database, user and password fields.
A `DATABASE_URL` query or fragment is refused before local provisioning: frozen
migrators do not guarantee those options, including TLS settings. This is an
explicit compatibility limit, not permission to drop connection options. Imported applications
retain the original producer’s migration program and environment prefix. A missing
or modified compiled program refuses startup; it never falls back to the working tree.

After database readiness, the installed closure is checked again and each migrator
runs once. A failed or interrupted execution blocks application start and is not
automatically retried: the database may already have committed. Inspect the migration
ledger before retrying. The child execution has a ten-minute deadline; timeout or
cancellation terminates that child and reports an unknown outcome. Stack diagnosis
in CLI and Console verifies program availability without connecting to the database;
authentication, schema and the actual migration result remain explicitly unverified.

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

## License

MIT
