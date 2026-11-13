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

After a qualified batch, pin the intended `main` commit. Record the builds actually
running in the guardian, backend, owner and Console. Enumerate running and enabled
stacks from the owner and each logical project's catalogue. Select by local placement, including imported
configurations, and record each public project/stack and its `runtimeScope`.
Keep the launch selection for each stack, including working-tree watches and
retained application releases. Platform and application SDK versions are separate
observations.

For the maintenance window, review the platform transition and rollback with the
operator. Use a single lifecycle operator for each stack. When an owner transition
already restarted a stack on the new runtime, accept it there. For the other
stacks, run `stack stop` with `--keep-infrastructure --dry-run` and its reviewed
digest. Review `stack start` against the resulting state using
`--infrastructure preserve --dry-run`, the recorded launch selection and the
returned digest. A working-tree build between stop and start belongs to that
same window. Verify the new launch identities, development watches, health,
application receipts, fresh logs, and the Console stack page before the next
dependent stack. A failed stage retains its receipts and its prepared rollback.

## Blocker for a writer that exited after a reviewed handoff

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

Completing this recovery requires a platform operation that binds the held
intent, accepted grant, current owner and selected runtime under the installation
lease. It must either certify the final controller state or explicitly establish
a newly reviewed baseline for all affected projects and infrastructure. The new
baseline must account for pending operations and application and storage
ownership. Preserve the prior receipts and the unknown historical interval.
Qualification requires the public CLI to recover on a disposable installation,
refuse incompatible or changing evidence before dispatch, and settle an
interrupted attempt without duplicating a writer. Verify retained application
identities and delivery of logs through the restored backend. Until this
operation is qualified, a replay of the failed plan has no proven rollback.

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
