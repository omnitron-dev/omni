# Controlled host upgrades

## Managed backend rollout

The local controller replaces its backend through its independent supervisor.
Remote managed Linux backends use `fleet rollout` and the Console's **Managed
backend updates** panel. A guardian that predates `kernelHandoff@1` needs a
separate, qualified native guardian transition first. `fleet upgrade` and the
Console's advanced workspace source bundle controls retain the coupled-host
workflow described below. They do not substitute for a managed backend handoff.
The [operator procedure](https://omnitron.dev/docs/omnitron/backend-handoff)
contains the operation table, exact commands and review steps.

A standalone controller can update up to 128 registered remote Linux servers.
Each target needs an enrolled, independently verified SSH host key, a healthy
resident owner and an independently stoppable guardian. The controller excludes
itself by execution-owner identity, including alternate registrations. Elected
controller clusters need recipient-side fencing across leaders and remain outside
this fleet workflow.

Planning binds the source commit, ordered targets, staging choice, pinned SSH
endpoint, both runtime digests, selection revision, backend PID, owner and complete
application/worker inventory. Staging verifies and installs a catalog artifact
without selecting it. The first guardian bootstrap cannot rely on a handoff
protocol the incumbent does not implement. Prepare its management runtime through
the separately qualified native installation path.

CLI and Console read the same durable plan ID and per-target outcomes. CLI omission
of node arguments retains its public meaning of all registered remotes in name
order. Console requires explicit targets or **All registered remote nodes**.
Aliases resolving to the same target and ambiguous selections refuse before
planning. Administrative authority is revalidated before staging and dispatch.
Viewers and operators can inspect receipts without gaining activation rights.

Guardian preparation installs a sealed management artifact and records its native
stop boundary. `backend guardian apply <plan> --check` performs read-only validation
of a prepared plan using the same guards as apply. It requires `checked: true` for
a fresh approval. A completed receipt reports `checked: false`. Apply rechecks
under the installation lease before retirement and changes only the guardian job,
retaining the selected backend and execution owner.

Normal pool recycling can invalidate a reviewed inventory. Before dispatch, a
stale owner/PID/inventory/selection refuses the operation without handing off.
Prepare a fresh guardian or fleet plan and review its new identities. Retain the
old receipt. Once dispatch may have occurred, follow the original running
operation or reconcile its uncertain outcome before planning further work.

Reconciliation distinguishes the original runtime with its original PID/revision
(unchanged) from a verified return after activation (`rolled-back`). An unchanged
target is recorded as `failed` with its evidence, rather than as a rollback. A failed
batch can include an earlier successful target and unattempted later targets.
CLI and Console preserve that per-target result. Reconciliation observes outcomes
without replaying activation or restoring application data. An unprovable result
remains uncertain and blocks a new rollout.

Activation proceeds sequentially and verifies readiness and ownership between
nodes. Business acceptance, such as a new committed replication watermark or a
public transaction, remains an external gate. Use a separate one-node plan before
advancing to another node when that evidence is required. Reversing an accepted,
healthy target uses a new plan for its retained previous artifact. Owner updates,
Node changes, schema changes and the first coupled-to-resident transition remain
separate maintenance operations.

## Local development rollout

Finish a reviewed batch on a macOS development machine from its clean main
checkout. The build uses local Git, frozen pnpm dependencies and the Turbo
cache. `OMNITRON_DEV_CACHE` selects a private build cache on the development
volume. Xec reuses the sealed runtime for the same commit, platform and Node
version. The build-cache lock uses the public Xec operations API in 0.11.5.
Omnitron owns the local plan, process transitions and durable receipt.

```sh
pnpm exec xec update local-sync
pnpm exec xec update local-sync --review <plan-sha256>
pnpm exec xec update local-sync --status
```

These Xec commands build and verify the committed runtime, then invoke its
public CLI. An installed operator can use the same workflow with a sealed
runtime and no source checkout.

```sh
omnitron runtime verify <runtime-root>
omnitron runtime update prepare <runtime-root>
omnitron runtime update apply <plan-sha256>
omnitron runtime update status [plan-sha256]
omnitron runtime update recover <plan-sha256>
```

`verify` checks the artifact without executing it. Preparation and application
run through the verified candidate's own Node and CLI. `status` returns the
prepared plan, current or requested receipt, and verified candidate paths. It
remains available while the daemon is stopped. Xec status and recovery accept
`--cli <executable>` when selecting an installed operator. Mutation authority
for this host operation comes from the local private instance and native user
services. The HTTP API exposes no host-update mutation.

Preparation stages the candidate alongside the running installation. The plan
names both native process owners, the serving Console, physical container IDs,
logical project and stack names, application generations, source watches and
verified release pins. Review the affected stacks and rollback identities with
their operators. A change to the checkout, launch policy or process inventory
requires reviewing the new digest. Active work, including backups, is reported
by the controller.

Application replaces the user launchd services through Omnitron. The resident
owner restores enabled local stacks with their configured launch selections.
Acceptance checks new generations, release receipts, the served Console
`BUILD.json` and retained infrastructure. An accepted digest can be checked
again without restarting a stack. The instance keeps the previous receipt when
a new reviewed batch begins.

A failed transition attempts to restore the recorded roles and Console from the
installed artifacts once clean process retirement is established. For an
interrupted operation, inspect `omnitron runtime update status` and recover the
exact receipt with `omnitron runtime update recover <plan-sha256>`. The Xec
equivalent is `pnpm exec xec update local-sync --review <plan-sha256> --rollback`.
The receipt records the original error and any recovery failure. Once a
restoration start has been attempted, another recovery invocation inspects
that result and cannot launch the previous runtime again. An unproven
execution owner requires inspection before a new installation can start.

The automatic path requires independent supervision and retained containers.
Preparation checks both installed binaries with `backend select <artifact> --check`.
When both advertise `coldStackAdmissionProtocol: 1`, the plan records
`stackAdmissionProtocol: 1`. Each replacement owner may consume the exact
infrastructure review once per enabled local stack in each direction. A retry
checks the durable claim. The stack keeps its saved boot policy and its full
release selection. With an older binary, preparation requires an already
persisted preserve policy and matching review for every affected stack. It
reports the first unsatisfied review before shutdown.
A stack running with disabled boot intent needs its intent reconciled before
a cold restart. A database expansion, Docker resource change or shared research
data transition has its own Omnitron review. Developer SDK mode and an
application's installed release remain independent of the platform version.

For a backend-only handoff with resident applications running, use
`pnpm exec xec update local-check` followed by `pnpm exec xec update local-apply`.
An explicit sealed `<dist>` is supported for this pair.

The infrastructure preflight reports the container and the first mismatch in
identity, ownership, enforced limits or specification. A saved Docker label
does not establish that a memory limit is enforced. Preservation also checks
the command produced by the image and any entrypoint override, the published
interfaces and the mounted volumes. An anonymous volume inherited from an
image is bound to its exact native identity in the reviewed plan. A change of
volume or restart generation requires a fresh review. Correct real resource
drift and qualify the rollback before stopping the stack.

## Cold-start infrastructure preview

Before a cold selection, run `omnitron --json backend select <sha256> --check`.
The candidate expands its own service presets and compares them with the native
containers. Each entry reports its current ID, predicted action and the names of
changed configuration fields. A historical declaration is labelled with its
capture time. Changes to projects, release mounts or application declarations
since that capture are checked against the actual definitions when each stack starts.
An older candidate can report runtime and migration compatibility only.

Boot and automatic stack resume can create missing services, start matching
stopped containers and apply verified legacy memory limits in place. They hold
an existing stack container when the effective declaration requires replacement.
A missing specification receipt also holds automatic startup. A full native
preservation review can establish the existing configuration before starting
the applications that depend on it.
Review that stack in Console or with `omnitron stack diagnose <project> <stack>`
and apply an intended change with `omnitron stack start <project> <stack> --infrastructure reconcile`.
A verified unhealthy container restarts with its native Docker ID and mounts.
Preparing the replacement image precedes graceful removal during reconciliation.
Reconciliation keeps named volumes and writable bind mounts attached to their
existing destinations. Changing the host directory of a writable mount requires
an explicit data migration. A release may replace a read-only bind mount such
as its static site. Docker inspection supplies the mount's access mode.

The health monitor records a restarting container while Docker owns its
restart, and reports a missing or unobservable service during recovery backoff.
After a lifecycle action, readiness is checked against the container ID that
the action addressed. A preserved stack derives its receipt and service states
from the same native inspection at admission, during monitoring and at handoff.

The master also checks its own PostgreSQL against the native image, process,
published port and mounts. Its data volume and bridge belong to the host.
An older installation can have this database attached to a project's bridge.
When every other setting matches, cold boot moves the running container to
`omnitron_default`. It attaches and verifies the host bridge before removing the
old endpoint and reads both native IDs again after an uncertain Docker reply.
The preview reports both bridges. Other differences hold startup for review.
If the move fails, recovery restores the original attachments. When host SQL
is unreachable after reattachment, the same container can require a second
PostgreSQL restart to restore port forwarding. Recovery checks the cluster
identifier through the container and its published SQL port, and retains the
original transition error.

## Cold recovery after a reviewed writer exits

An `unconfirmed` hold with an admitted checkpoint can outlive the backend that
accepted the grant. This blocks project operations that require that backend.
With a CLI containing this diagnostic, run:

```sh
omnitron --json backend installation --recovery
```

The command reads the held plan, original and admitted checkpoints, selection,
execution journal, project catalogue and writer certificate. It returns the
admitted and durable epochs, digest comparisons, observed PID state, and the
certificate status and invalidation time. The **previous** writer snapshot in an
invalid certificate describes the last certified state. Older journals retain
only the first invalidation reason. Project registration, a matching source
configuration and running app identities cannot establish the final controller
state after that point. A successful inspection reports its findings and keeps
the hold in place.

To recover from the current local registrations, enabled stacks and durable
lifecycle choices, preview the decision while applications are still running.

```sh
omnitron --json backend recover --current-state --check
```

The preview returns `currentStateReview` only when the admitted writer has
exited and the persisted grant, catalogue, checkpoints and writer agree.
Review the current declarations, data volumes, release pins and any pending
application operations before scheduling a cold restart. During that window,
stop the managed services normally. Use the preview's exact digest once the
owner records a clean shutdown.

```sh
omnitron --json backend recover --current-state --review <currentStateReview>
```

Omnitron verifies the native services, processes, boot and sockets, then
archives the original and admitted checkpoints, writer receipt, grant and
selection in one SQLite transaction with retirement of the held activation.
The interval since the last certified state is recorded as unverified. Retrying
the same digest returns the recorded decision. The existing rollback runtime
remains selected. Install or select the desired runtime and start the services
using the normal cold-start procedure. Verify stack readiness, queue delivery
and the Console after startup.

## Application releases and coupled hosts

An app release holds `RemoteDeployer.underLease` across `inspectInstalledBundle`, dependency installation, and app activation. Inspection returns `{root, version, commit}` for the immutable installed host and verifies its clean build, live process entry, and supervisor binding. App releases must not install/activate a host bundle or rewrite its service. They refuse an unfinished host upgrade.

`activateBundle` and `activateBundleHeld` are separate, disruptive host operations under the same machine lease. They capture all projects and app states, validate an installed candidate, check declared bindings and operational readiness, and durably write a private receipt before stopping the daemon. They rebind the same app releases, restore the previous boot selection, check exact online identities, supervisor ownership, dependency identity, and declared health. The held variant also checks its gateways before retention. Retention protects both previous and candidate bundles even with `keepVersions=1`.

## Application contract

Each registered project directory declares `omnitron.host-upgrade.json`:

```json
{
  "schema": 1,
  "apps": [{
    "name": "example/prod/api",
    "cwd": "/srv/example/releases/2026-10-25/apps/api",
    "version": "2026-10-25",
    "binding": {
      "kind": "hook",
      "bundleRoot": "/opt/omnitron/versions/0.3.0+local.commit.timestamp",
      "bundleEnv": "EXAMPLE_OMNITRON_BUNDLE",
      "rebind": ["pnpm", "--dir", "/srv/example/releases/2026-10-25", "install", "--no-lockfile"],
      "verify": ["node", "/srv/example/releases/2026-10-25/scripts/verify-binding.mjs"]
    },
    "health": ["node", "/srv/example/releases/2026-10-25/scripts/production-check.mjs", "--online"]
  }]
}
```

Every configured local app, including offline apps, needs its exact qualified identity, immutable canonical cwd, and release version. A framework-independent app explicitly uses `binding: {"kind":"independent"}`. Each previously online app also declares an operational `health` command; package resolution alone is not health. Offline apps are not health-probed or started. Hook executables are checked before disruption. Arguments execute literally without a shell under the recorded cwd. Binding and health commands receive the declared bundle environment variable. There are no project-name or package-manager heuristics.

Rebind hooks must change only framework dependency bindings and be repeatable against either recorded bundle. Verify hooks inspect physical binding/compatibility; health hooks inspect operational readiness. They must not deploy a different app version, migrate application data, replace source, or edit benchmark evidence. The version and source directory are declared release facts, not an independent source-content attestation. After verification the contract's bound root is updated atomically; cwd/version remain unchanged.

## Recovery

Receipts live at `/opt/omnitron/upgrade-receipts/<id>.json`, directory mode 0700 and file mode 0600. Each phase is recorded with a file fsync, rename, and directory fsync before the next mutation. Captured state includes prior/candidate bundle identity, every project and enabled stack, online/offline identities, app release contracts, and systemd unit contents/enablement when applicable. Treat receipts as private because service definitions may contain environment values.

Caught failures restore the previous bundle, original service definition and enabled state, and app dependency bindings; then they verify the previous online set and health. They never prune on failure or restore business data. Failure to complete recovery records `recovery-required`.

A lost controller can leave `running` at any phase. A new activation detects this before probing the serving daemon and recovers the recorded previous state first. It returns failure for the requested new upgrade: retry that upgrade after recovery. Explicit recovery is available through:

```sh
omnitron fleet recover <registered-node-name-or-id> <receipt-id>
```

The command uses the master's stored SSH credentials and the same target lease; the target daemon may be down. `RemoteDeployer.recoverBundleUpgrade` is the corresponding native API. Multiple unfinished receipts require an explicit ID. A changed/missing previous bundle, missing release cwd, unavailable hook, failed health, or lost SSH connection leaves recovery incomplete and retains the evidence.

## Supported boundary and verification

Current support is Linux, with an ordinary native systemd system/user unit or a manually forked daemon. It preserves systemd identity, unrelated environment, unit bytes on rollback, and enabled/disabled state. Native `ExecStart`, `WorkingDirectory`, and `OMNITRON_CWD` framework paths move together. Multiple supervisor scopes, service drop-ins/custom framework paths, other operating systems, enabled remote/cluster stacks, unknown live handles, and missing contracts refuse before stopping.

Existing daemon startup resumes entire enabled local stacks. Therefore a partially online enabled stack or an online disabled stack refuses before stopping; the upgrade does not guess how to preserve a partial stack through that boot policy. Disabled stacks remain offline. Exact qualified identities are required across projects; a bare basename cannot prove stack ownership.

The focused courts exercise phase failures, interrupted receipts, no-prune recovery, operational-health refusal, real filesystem receipt/hook/unit commands, and separate projects with the same app basename. RemoteDeployer adapter tests simulate daemon replies and inject failures; they are not live Linux/systemd deployment evidence. No live host mutation was performed while developing this mechanism.

Validation receipt (2026-10-25): 114 tests passed across 14 focused/neighboring files in 21.20 seconds; package typecheck passed. The current local build used for native preparation is deliberately stamped dirty until coordinated source commits finish. Initial adapter tests exposed rejection of valid semver `+local` versions; the installed-version validator now accepts that format. A read-only production probe exposed the native unit's `OMNITRON_CWD` binding; it is now validated and migrated with the other two native framework fields. No production upgrade result is claimed by these tests.

### Infrastructure lifetime

Project service disposal releases health monitors and janitors without removing
stack containers. Explicit stack/infrastructure teardown remains the operation
that removes them. The slave daemon also disposes its own monitor without
removing the data plane. Regression coverage traverses ProjectService, its stack
manager and a real InfrastructureService, proving that disposal preserves
containers while explicit teardown still removes them.

An already-running older daemon can still execute its former destructive
container teardown on the first transition. Its retained named volumes and
application declarations must be validated and backed up before that transition;
readiness is checked after recreation. A later ingress handoff must capture the
actual post-upgrade legacy container identity, not a stale pre-upgrade ID.

## Explicit infrastructure ownership handoff

After registering a changed local project configuration, the admin native
`OmnitronProject.refreshInfrastructureOwnership({project, stack})` operation
resolves the fresh validated stack through the same container resolver and
requirements merge as stack startup. It returns exact `released` and `adopted`
container names. It does not create, remove, stop, or restart containers.

The operation freezes new monitoring/reconcile work and drains existing work
before changing ownership. Removed services leave the desired set; delayed
health snapshots cannot revive them after the operation returns. Retained
specifications must remain identical. Newly declared services can be adopted
only when already running with matching native ownership labels and spec hash;
missing, stopped, foreign, or changed services are refused. Restore the previous
profile, register it again, and invoke the same operation to restore monitoring
after an ingress rollback. A native ingress takeover must still validate the
exact container identity after the refresh drains prior work. This bounded
operation does not deploy changed service specifications or provision missing
infrastructure; those remain explicit stack deployment operations.

Lease confirmation is retained through reentrant `underLease` calls. Every
subsequent remote command, data command and `uploadToNode` transfer confirms
ownership first; failed confirmation also prevents rollback commands from
racing a new owner. Application controllers should use `uploadToNode`, not call
the bare transport while assuming the surrounding lease confirms each step.
Commands and upload promotion also run under the native host execution fence,
which verifies the lease token and holds its lock for the command lifetime.
Lease acquisition cannot replace a holder while that command is busy or its
durable execution intent is unresolved. A native timeout/abnormal exit retains
unresolved intent and refuses automatic retries; it does not infer that every
possible descendant has died.

A failed final verified-receipt write resets the in-memory outcome to running
before any rollback intent is saved. A crash during rollback therefore leaves
an unfinished receipt discoverable by native recovery, never an `upgraded`
receipt describing a stopped or partially restored host.

## Durable operator workflow barrier

An interrupted operation around a framework upgrade (for example, transferring
public ingress ownership) must also block ordinary app/fleet deployment. Native
`inspectInstalledBundle`, activation and recovery check the host registry at
`/opt/omnitron/platform-operations/<name>/pending.json`. Each journal has schema 1,
an exact `id` and an `outcome`. `running` and `recovery-required` block new work;
unknown, malformed or aliased registry entries fail closed. Finished receipts can
be archived after a crash without undoing the accepted operation.

A recovering orchestrator may pass `{ name, id }` to the native inspection,
activation or recovery call for its own captured journal. That allowance neither
bypasses another pending operation nor accepts a changed/missing identity. App
pipelines use the default unscoped inspection. The barrier is checked under the
host lease, alongside the separate native framework recovery receipts. It does
not replace execution fencing or make arbitrary administrator commands transactional.

Controlled host inspection/activation/recovery currently supports daemon port
9700 only; a different explicit target port is refused before SSH. Supervisor
rewrites first require the on-disk unit to equal the captured original or one
of this operation's two framework-bound variants. Outside unit edits are
preserved and force recovery-required instead of being overwritten.

### Remaining verification boundaries (25 October 2026)

The installed-tree receipt binds all installed dependency bytes and rejects
changes on reuse. The source bundle currently does not carry a generated npm
lockfile for all external transitive dependencies: their first resolution still
occurs during installation. This is not a claim of bit-for-bit dependency
reproducibility across fresh hosts. A lockfile/SBOM build step and an offline
installation check remain separate supply-chain work.

Execution fencing covers native leased commands and guarded upload publication.
An abnormal timeout or killed command retains durable unresolved intent; no
elapsed-time heuristic declares it safe to admit a new writer. Recovery needs
inspection of the recorded operation and host processes. Intentionally detached
late mutations and direct administrator operations outside the deployment
contract are not made transactional by this mechanism. A single physical host
also remains a failure domain; process recovery is not multi-host availability.
