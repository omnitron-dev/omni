# Controlled host upgrades

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
