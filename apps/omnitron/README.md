# @omnitron-dev/omnitron

Omnitron runs and manages classic Node applications and Titan services. Its CLI and Console use Netron to control application lifecycle, inspect runtime state and review deployment operations.

## Capabilities

- Projects, stacks, application processes and worker pools.
- Project interviews, multi-provider team rooms, shared memory and delegated work through local subscriptions. [Agent Studio](AGENT-STUDIO.md)
- Visual event flows for host observations, notifications, project pipelines and Studio assignments. [Event flows](FLOWS.md)
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

In **Console → Projects → Create project**, choose automation, persistence and
service supervision independently. Review the destination, dependencies, commands
and complete file contents. An administrator can then create and register a new
directory under `$OMNITRON_HOME/workspaces/<name>`. The operator chooses when to
install dependencies and run the generated commands.
**Add existing project** registers a directory you already own.

| Need | Generated program | Operation |
| --- | --- | --- |
| Automation | Xec task | `npm run automation` checks the syntax of each program using the local Node runtime and runs the database command if selected. |
| Persistence | Kysera with SQLite, PostgreSQL or MySQL | `npm run data` creates `starter_events` if needed, inserts an event and reads it back. SQLite uses a project-local file. For external databases, the generated README names the project's connection variable. |
| Service | Node or Titan worker | `npm start` starts the worker directly. Its **dev** stack can supervise the same entry and observe its IPC readiness. With persistence, startup also records one event. |

The generated `omnitron.starter.json` records the selected composition and the
README lists its commands. Xec and Kysera standalone projects work with their
own dependencies and commands. Run `npm install` in the project directory when
the manifest lists dependencies. The default Node worker uses the standard library.

An automation or database project also includes `npm run --silent pipeline`.
It prints a manual Pipeline definition for the working directory on the
controller. The generated README walks through checking it, saving it and
starting the reviewed run. Its receipts appear in the system workspace's
Pipelines page, including for projects without a supervised application.

When asking Agent Studio about a project, describe the intended operation, the
database it may use and an observable success condition. A SQLite starter
records a single local event. Existing-schema migrations, tenant isolation,
schedules and business rules each need their own implementation and acceptance
checks. If a starter covers part of the request, the agent should identify the
remaining work and ask whether to create that starting point.

`omnitron init` generates the same starter locally. For example, from an empty
directory run `omnitron init --name notes --automation --database sqlite --service none`
to create an independent Xec and Kysera project. Register an existing directory
with `omnitron project add <name> <absolute-directory>`.

For an existing Xec or Kysera package, run these commands from the directory
you intend to register. The preview lists framework declarations by package
manifest and dependency section, including development dependencies. At a
workspace root it follows the package patterns in `pnpm-workspace.yaml` or
the npm/Yarn `workspaces` field. Inside an individual member it inspects that
member and its own declared workspace.

```sh
omnitron init --existing --check
omnitron init --existing
omnitron project add my-project "$PWD"
```

The write creates only `omnitron.config.ts` with empty `apps` and `stacks`.
Existing configurations can be reviewed and registered directly. Project
scripts and database connections are managed by their existing tools. The
operator can also register the same directory in **Projects → Add existing project**.

```sh
omnitron start project/stack/app
omnitron logs project/stack/app
omnitron stop project/stack/app
```

`stop` requires a responsive daemon and fails when completion cannot be confirmed. `stop all` stops managed applications; `down` explicitly shuts down the daemon. Inspect the current process and operation state after a lost acknowledgement before issuing another mutation.

### Running a separate local daemon

`OMNITRON_HOME` selects an instance's `daemon.pid`, `daemon.sock` and private
supervision record. For local lifecycle commands, an explicit
`OMNITRON_SOCKET` must point to that same `daemon.sock`. For a private
foreground session, use an empty working directory, a fresh absolute instance
directory and two unused loopback ports. This example runs an unpaired slave
with local SQLite storage.

```sh
export OMNITRON_HOME="$(mktemp -d)"
export OMNITRON_SOCKET="$OMNITRON_HOME/daemon.sock"
cd "$OMNITRON_HOME"
printf '%s\n' '{"role":"slave","initialized":true,"host":"127.0.0.1","port":49701,"httpPort":49702,"webapp":false}' > config.json
omnitron up --foreground --no-infra --no-watch
```

Stop with Ctrl+C, or run `omnitron down` in another shell with those same two
exported paths. An unregistered instance uses its own socket and PID file.
`service install` explicitly registers the selected instance for native
supervision. `up`, `down` and `service uninstall` match the installed
definition, supervisor domain and loaded job. Independent owner/backend jobs
also have to match both roles and sealed artifacts in the private record.
A label collision, a changed loaded definition or an unrecognized systemd
override reports the affected registration for reconciliation. Site-owned
resource-limit drop-ins can stay in place.

To exercise both platforms with a disposable registry and fake managers, run
`pnpm exec vitest run test/unit/service-instance-lifecycle.test.ts` from `apps/omnitron`.

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

During creation, Omnitron records the full Docker ID before starting the container. If Docker loses a reply, Omnitron checks the creation label, image, resource limits and port bindings against that allocation. The inspection requests only the fields needed for this check. Environment variables and command lines stay out of the response.

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

### Prepare a remote replacement from its own release source

A controller can keep serving the registered project checkout while an administrator prepares another commit of the same project for one registered remote node. On a credential-free build machine, use the qualified checkout with its build dependencies and the canonical release store. This command evaluates the configuration in release mode and captures bootstrap infrastructure declarations. Its readers have a private home and receive synthetic values for symbolic stack bindings.

```sh
omnitron release capture-source acme prod "$release" --source "$qualified_checkout" --release-root "$producer_store" --json
```

Transfer the returned `.remote-sources/<declarations-sha256>.json` to the same relative path in the controller's release store. Supply a separate physical checkout at the manifest's exact commit. The controller can keep both on an external volume. Authenticate the declaration digest through the producer's delivery channel along with the manifest digest. A source capture is independent of the canonical release manifest. Projects whose topology depends on secret values must make their release declarations independent of those values.

```sh
omnitron stack prepare-release acme prod "$release" --source "$checkout" --release-root "$store" \
  --manifest "$manifest_sha256" --declarations "$declarations_sha256" --node-id "$node_id" --json
omnitron stack check-release acme prod "$release" --prepared "$prepared_digest" --json
omnitron stack review-host-bindings acme prod --release "$release" --node-id "$node_id" --prepared "$prepared_digest" --json
omnitron stack start acme prod --release "$release" --prepared "$prepared_digest" --infrastructure preserve --dry-run --json
```

Preparation checks the current project registration, both stack release policies, Git history, source and verified archive bytes, stable node ID, approved SSH host key and the recipient's execution runtime. Subsequent checks repeat admission. Changing the registration, source, manifest, declaration bytes or recipient invalidates the receipt. Operators can inspect an administrator's digest. The prepared source is scoped to this release and logical stack.

The host-binding review identifies expected units, public template hashes and the recipient. A preservation review also needs a positive observation of each resource from that recipient. For a native host service this includes the running process and service identity, executable, unit, protected configuration and storage bindings. A successful source check alone authorizes no cutover. The prepared start command supports inspection. Switching an existing deployment requires a separately verified handoff from its current owner.

### Verify an existing Monero wallet before moving a stack

A stack administrator can check whether the active mainnet wallet owns the deposit addresses that the application has already issued in account zero. Supply a private JSON request on standard input.

```sh
omnitron --json stack verify-wallet-addresses acme prod < wallet-membership.json
```

| Request field | Value |
| --- | --- |
| `nodeId`, `fingerprint` | Registered source node ID and its approved SSH host fingerprint |
| `unit`, `port` | Active Linux unit (`monero-wallet-rpc.service` or `monero-walletd.service`) and its numeric RPC port |
| `userRef`, `passwordRef` | Names of the two vault references declared in the mainnet `monero-wallet-rpc` service override |
| `nonce` | A fresh 32-byte random value encoded as 64 lowercase hex characters |
| `members` | One lowercase SHA-256 per distinct issued subaddress, computed over the ASCII text `nonce + ":" + address`, with 1 to 8,192 entries |

For a wallet managed by Omnitron, the two references come from the service override's `secrets`. For a wallet already installed on the registered node, use `external.secrets` and declare its IP address and port in `external.host` and `external.ports.rpc`. The node checks that the Linux unit owns the listener and that the declared address is local before opening the connection.

The controller answers the wallet's HTTP Digest challenge over the registered SSH connection. The query reads account zero. Its receipt gives the fingerprint of the primary address, the number checked, and the number matched. The CLI succeeds only when every supplied subaddress matches. Keep the receipt alongside the ledger observation and compare it again after restoring the wallet, before enabling payouts.

### Move one stopped remote stack to its prepared recipient

#### Prepare the disabled receiver allocation

Run this while the original registered recipient still serves the stack. Keep the native `stack prepare-release` JSON receipt and its producer declarations. For a configured artifact store, the normal transfer is `omnitron release push "$RELEASE"` at the producer and `omnitron release pull "$RELEASE"` under the receiving daemon account. The prepared allocation also accepts the same verified bytes already present in that account’s canonical release store. The receiver needs a registered administrative SSH route, the serving backend and execution-owner artifact digests, a running independent Linux owner, its private daemon socket, and a working container inventory.

```sh
xec passive-allocation prepared.json producer-declarations.json \
  --expect-prepared "$PREPARED_DIGEST" --from-node "$ORIGINAL_NODE_ID" \
  --user "$RECEIVER_USER" --uid "$RECEIVER_UID" \
  --backend "$SERVING_BACKEND_ARTIFACT" --owner-artifact "$EXECUTION_OWNER_ARTIFACT" \
  > prepare-allocation.pipeline.json
omnitron pipeline check prepare-allocation.pipeline.json
omnitron pipeline save prepare-allocation.pipeline.json
```

Review and run the resulting Pipeline through the controller. It confirms the original placement and registered SSH fingerprint. The daemon UID checks the existing allocation, owner and canonical manifest. The administrative login uses the native deployment lease in `/opt/omnitron/locks` and holds its execution guard while the service UID verifies and registers the release. A missing `/opt/omnitron` is created root-owned. A missing `locks` is created root-owned at 0700. Existing lock files must be physical root-owned regular files with one link in that private directory. Only missing `artifacts` and `projects` parents are created at 0700 for the reviewed daemon UID and primary GID. A foreign owner, symlink or unsafe mode causes a refusal. Existing permissions are preserved.

The receiver verifies the complete manifest, archives, dependency closures, tree digests and owner target using the installed release SDK. It publishes a new `/opt/omnitron/projects/<project>` directory exclusively, registers it through the live daemon, and requests a native full-stop review. Its receipt includes each installed tree, the source-stack definition fingerprint, the observed owner revision, and zero handles and containers. The final controller step rechecks the original placement. A wired controller and receiver at revision `57eb4ad9` expose the necessary operations.

The generated local `deployed` stack records the logical `managedOrigin`, sets controller-owned infrastructure and requires an immutable release. Every admitted application has `enabled: false`. The empty owner may initially report phase `running` at revision zero. The source handoff and any subsequent return require their own reviewed full stops with the revision and empty physical inventory observed at that time.

On an interrupted run, inspect the Pipeline and the node's normal deployment lease. Repeat the same declaration after the previous attempt has ended and its lease has settled. An exact passive publication can complete a missing registration or verify the existing one. An occupied directory, different artifact set, enabled project, retained application handle, physical stack container or replaced publication requires reconciliation. Normal deployment writes the active configuration before starting the release. The operator can verify its data, host-service and execution-account prerequisites separately.

To rehearse the receiver boundary, use a disposable Linux host with its own container engine. Mount the producer release read-only under a writable release store and point `OMNITRON_HOME` at a new empty directory. Run the installed runtime's Node with `.xec/passive-allocation/linux-qualification.mjs <installed-package> <release-store> <release-id> <declarations.json> <empty-home>`. Set `PASSIVE_FIXTURE_CONTAINER_IMAGE` to a local image ID to exercise a full stop after partial container provisioning. Set `PASSIVE_ACTIVE_SMOKE=1` for a separate run that builds and starts two synthetic programs through the normal publisher and CLI. The producer's real applications stay disabled during release verification.

Before the maintenance window, retain the source capture, canonical release store and exact checkout on durable controller storage. Enroll both nodes with stable IDs and approved SSH host keys. Prepare the release above. At the receiver, verify each restored named volume against its data-adoption receipt and its declared mount target. A first `reconcile` creates missing containers on the declared volumes. A missing volume can be created empty by the container engine. Verify protected host configuration with its native installer, including the expected file owner, mode and content digest. The host reconciler also checks the binary, unit, activation state and data directory.

After ordinary reviewed `stack stop` completes on the source, an administrator can review and select the replacement. Use a full stop that records the logical allocation, definition and execution revision on the recipient. A stop with `--keep-infrastructure` retains ownership and cannot be used for this handoff. Supply the registered ID even if the original single-node declaration predates stable IDs.

```sh
omnitron stack select-placement acme prod --from-node "$old_id" --release "$release" --prepared "$prepared_digest" --json
omnitron stack select-placement acme prod --from-node "$old_id" --release "$release" --prepared "$prepared_digest" --review "$placement_digest" --json
omnitron stack start acme prod --infrastructure reconcile
omnitron stack status acme prod --json
```

Selection rechecks the stopped owner on its enrolled connection and commits the placement to this stack’s existing target journal. The receipt binds both node identities, the confirmed stop, the release source and the journal generation. The old applications must still be stopped when the first deployment takes its lease. An accepted selection survives controller restarts. Status, stop and automatic attachment use the selected recipient. Deployment uses its verified archives and producer declarations. The registered development stack retains its own configuration. Existing cluster-managed allocations continue to require their recipient-fenced deployment adapter.

For a return to the original registration, first complete a reviewed full stop on the replacement. Run `select-placement acme prod --from-node "$new_id" --restore-registration --json`, then repeat with its `--review` digest. A return checks the original stable endpoint, SSH enrollment and clean Git commit. To deploy there, specify a release at that exact commit. Data promotion, recovery and signer custody each require their own positive evidence before enabling writers.

Runtime-only recovery uses `--infrastructure preserve`. Review the intended release and current resources before stopping applications:

```sh
omnitron stack start acme prod --release <release-id> --infrastructure preserve --dry-run --json
```

The review requires existing, running resources whose native identities and specification match the declaration. It cannot provision, recreate or restart infrastructure, run post-provision setup or framework migrations. Changed presets or unverifiable resource receipts require a separate reconcile.

In preserve mode, a healthy Docker probe can coexist with a degraded stack. For example, restarting a container keeps its ID but changes its generation. `omnitron stack status acme prod --json` lists the affected resources and reasons in `infrastructure.preservationIssues`, alongside their native health. A fresh dry run checks the current declaration, including the creation receipt for mounted configuration. Reading status or running a dry run leaves the existing approval in place.

An enabled-stack reconciler tick with no eligible launch leaves a recovery review valid. Actual configuration loads, launch attempts and retry bookkeeping invalidate recovery before they change state; a stack waiting for its retry deadline does not invalidate a review merely because its timer ran.

Infrastructure planning resolves one complete data definition: presets, application containers, overrides and mounted configuration. Local, CLI and remote paths use that same resolver. A preview does not create a resource owner, reserve ports or invalidate recovery. Applying a definition acquires ownership and rechecks native identities; conflicting container declarations are rejected before provisioning. Handoff restores the recorded definition without resolving it against a newer preset implementation.

After the planned runtime transition, inspect again if its owner or launch context changed, then use the current review:

```sh
omnitron stack start acme prod --release <release-id> --infrastructure preserve --review <digest>
```

Startup repeats release, environment and native-resource checks. Omitting `--review` obtains a fresh review automatically; supplying it pins the inspected digest. Application code and its own startup hooks still run. `check-release` alone does not establish infrastructure preservation.

### Versioned Linux service binaries

Stack service overrides can refer to vault entries with `{ "secret": "key" }`.
The controller resolves each referenced key once per configuration. A missing
required entry stops delivery before credentials are sent to the node. The
error lists the missing names. Use `omnitron secret list` to check them.

A bare-metal service can declare `binaryRelease` in its configuration or in a network
variant. Declare the release name, version, executable names and one archive per
Linux machine architecture. Pin each archive's SHA-256 from the verified upstream
release manifest. Set `directory` to the directory containing the executables
inside the archive, or to an empty string for files at its root.

```ts
const binaryRelease = {
  name: 'indexer',
  version: '2.1.0',
  executables: ['indexer', 'indexer-cli'],
  archives: {
    x86_64: {
      url: 'https://downloads.example.org/indexer-2.1.0-linux-x86_64.tgz',
      sha256: verifiedArchiveSha256,
      directory: 'indexer-2.1.0/bin',
    },
  },
};
```

On a Linux host with Python 3.9 or later, Omnitron verifies the archive and installs
its declared regular files together under `/opt/omnitron/binaries/indexer/2.1.0`.
Reference that path in the systemd unit. A repeated installation verifies the
existing files against the publication receipt. A changed digest at the same
version requires explicit reconciliation. Data directories and service activation
use the ordinary bare-metal plan.

Administrators can inspect a prepared set of public Bitcoin Core and Monero units on a registered node while the services remain inactive. The inspection records the service identities, unit hashes and canonical config path occupancy. [Passive host binding inspection](../../.xec/host-bindings/README.md)

## Source SDK development

Use a complete Omni checkout with its ordinary frozen installation. From a consumer project:

```sh
omnitron sdk init --project-dir /path/to/project
omnitron sdk dev /path/to/omni --project-dir /path/to/project --no-watch
omnitron sdk status --project-dir /path/to/project
```

`init` installs the canonical pnpm hook. `dev` follows the consumer's declared framework dependency graph and builds it through Turbo. It supports standalone Lumen or Prism consumers without adding Omnitron to their runtime dependencies. A private development lock holds the local graph; the registry application lock remains the baseline for restoration.

Changing an SDK selection retains the affected dependency directories, generated outputs and selection metadata in the development cache before writing them. At each phase the CLI reports the duration of the completed phase, total elapsed time and the size of the retained files once known. `retain` copies and checks those files. `verify` rechecks the source and records the recovery proof. Set `OMNITRON_DEV_CACHE` to the mounted development volume to keep the snapshot there. Application database backups follow their own schedule.

`sdk status` reports whether the installed SDK build is current and whether the consumer's package manifests or effective pnpm settings have changed. In JSON, `consumerProfileChanged` is `true` for a changed profile and `null` for an older selection that never recorded its inputs. A project can need a rebind while its installed build and distribution lock are both current.

Before stopping any consumers, check the exact SDK checkout that the next `sdk dev --no-watch` or reviewed `--start-stopped` will use.

```sh
omnitron --json sdk prepare /path/to/omni --project-dir /path/to/project --check
```

`data.action` and `data.reason` describe that selection. `rebind` requires a recovery snapshot, a build and a consumer installation. The profile includes each complete consumer workspace manifest, pnpm settings and the effective module layout. An edit to a package's scripts or exports can therefore require rebinding even with identical dependency lists and lockfile bytes. This comparison reads package metadata before inspecting any build output. `rebuild` also requires a snapshot and keeps the existing consumer bindings. `reuse` means the selected packages, source installation, Turbo inputs and build outputs currently qualify for reuse. `unconfirmed` gives a reason and `snapshotRequired: null` when a source pnpm hook or configuration dependency requires running project code to verify the installation. The actual selection repeats its checks under the workspace locks.

The check reads existing metadata and, when needed, build outputs. A `reuse` result returns `data.reuseDigest`. It identifies the physical project and SDK checkouts, their Git revisions, the pnpm installation directories, receipts and locks, and the verified build. After any planned checkout change, run the check again. Use the digest to require the exact observed installation for a one-shot command.

```sh
omnitron sdk dev /path/to/omni --project-dir /path/to/project --no-watch --reuse-only "$reuseDigest"
```

For a stopped stack, append `--stack dev --start-stopped --review "$launchDigest"` using its separate working-tree start review. The CLI rechecks SDK reuse under both workspace locks and again immediately before recording the start request. If the project, installation or build proof has changed, the command exits before taking a snapshot, installing, rebuilding or asking the owner to start. The `--reuse-only` option requires `--no-watch` and is exclusive with `--prepared`.

When `snapshotRequired` is true, prepare the development selection while its applications are serving. Use the same mounted development cache for preparation and selection.

```sh
omnitron --json sdk prepare /path/to/omni --project-dir /path/to/project
omnitron sdk dev /path/to/omni --project-dir /path/to/project --no-watch --prepared "$token"
```

Check `data.projectRevision` and `data.sourceRevision` against the planned Git commits. Set `token` to the complete `data.token` and stop the affected source consumers before the second command. Preparation takes the two SDK workspace locks for inspection and writes the verified image to the cache. The active selection and recovery journal stay available. Preparation uses the installed, pinned pnpm and a Turbo dry plan. Package-manager bootstrap and installation belong to the subsequent selection.

At use, the CLI discovers the paths again, checks both physical checkout identities and Git revisions, the package and Turbo inputs, the preceding recovery receipt, and the bytes, modes and links of live and retained trees. This still reads both trees during the outage. It copies no dependency tree during this stage. A missing file, changed input, or different revision requires a fresh preparation. The atomically claimed token applies to one development selection.

Cancellation observed through publication of the writer's admission releases the claim and leaves a completed image available. After admission, an interrupted writer can have an unknown outcome. If the CLI process dies during admission, inspect `sdk status` before retrying. A spent token without a new journal requires another preparation. A published `prepared` journal can be recovered through `sdk recover`. A `mutating` journal without an owned-output receipt requires inspection.

Snapshot work has bounded parallelism: at most 16 file readers and four independent copies. File order, modes, symbolic links and content digests remain part of the retained proof. Every admitted writer settles before failed staging data is removed; an incomplete copy cannot authorize a build. `sdk recover` verifies the retained bytes and current ownership before restoration, preserving foreign edits and reporting an uncertain interrupted writer explicitly.

The first selection may ask pnpm to generate its package-manager metadata. That metadata is not a registry application lock. A missing or stale registry baseline requires a normal registry installation before `sdk registry` can restore it. Ordinary `pnpm run` commands use the selected profile without extra flags.

`sdk status` validates registry importers with pnpm's frozen lockfile check, including overrides and relative local dependencies. Framework packages must still resolve to registry archives with SHA512 integrity; file and link overrides for them are refused. Inspection uses the installed pnpm matching the project's exact package-manager pin (qualified with pnpm 12.16.1), keeps its temporary cache separate, and runs no install scripts or custom manifest hooks. A lock that requires those hooks, an unsupported pnpm command, or stale dependency configuration fails explicitly. This checks existing installation provenance and lock freshness offline; pnpm's `--trust-lockfile` skips a new supply-chain policy lookup, so status is not a fresh registry security audit.

`--no-watch` checks the selected installation, Turbo inputs and output hashes under both workspace locks. If they match the saved build, the command can finish while applications are serving. It keeps their existing receipts and the recovery snapshot. If an install or rebuild is needed, stop the affected source stacks first. Omnitron retains a recovery snapshot before changing shared dependencies or outputs.

During a switch, the CLI reports how long it spends reading the initial state, copying and checking the saved files, and verifying that the source still matches. It reads independent output trees in bounded parallel batches and keeps their original order in the recovery record.

In watch mode the SDK rebuilds changed packages. With `--stack dev`, Omnitron records the owner's receipt for each watched application that uses the changed SDK. An application such as a Vite server can declare `watch: false` and manage its own reloads. The CLI checks each binding against the stack declaration and reports applications that manage their own reloads separately.

To edit the source of one running application while keeping its current generation online, suspend its existing owner registration. Use the full name reported by the owner.

```sh
omnitron --json watch status example/dev/worker
omnitron --json watch suspend example/dev/worker
omnitron --json watch resume example/dev/worker <receipt-id>
```

Suspension drains that application's filesystem or esbuild watcher and revokes queued source-triggered restarts. A lifecycle transition already in progress must settle first. A completed receipt records the exact generation, definition revision, watch directory and mechanism. Its latest phase can be read by name after a lost reply or a backend handoff. Resuming requires the same resident owner, binding and a watch policy that still permits the application. A new generation or definition supersedes the receipt. An unconfirmed phase requires inspection before further work.

Resuming a native watch observes subsequent file events. Resuming an esbuild watch compiles the current source as its baseline and arms subsequent rebuild notifications. The running process continues serving its existing generation. Use a separately reviewed application action to activate code edited during the pause. Other watches, the project declaration and SDK selection keep their existing policies. This control requires the owner's `sourceWatchSuspension@1` capability. An older resident owner requires a reviewed owner transition to acquire it.

The watcher uses Xec's polling API once per second over Turbo's task directories and declared shared input locations. This includes package-local generators and the first files added inside declared input glob directories. Dependency directories, build outputs and ignored artifacts are excluded unless Turbo explicitly declares them as inputs. File events trigger a debounced Turbo comparison; only changed task hashes are rebuilt, and idle polling does not launch Turbo. Watch roots must exist inside the SDK checkout; unsupported external or unbounded global patterns fail explicitly. Edits are coalesced, builds are serialized, and changes arriving during a build remain queued. A build whose inputs changed before completion cannot confirm application readiness; the queued edit is rebuilt. Successful completion is reported after application receipts and RPC cleanup settle. Interrupting the command closes its observers. The watcher is a foreground CLI process: the daemon does not supervise or restore it after the CLI exits. This requires `@xec-sh/loader` 0.12.0 or newer.

Keep the consumer's `node_modules` directory physical. Standard pnpm `virtualStoreDir` configuration can place the store on another disk; a symlink replacing the entire directory is refused. Initial selection and registry restoration must satisfy the lifecycle and dependency admission checks. SDK selection does not activate a deployed release.

After a confirmed `stack stop --keep-infrastructure`, the SDK can start the local working tree and keep watching it.

```sh
omnitron stack start acme dev --working-tree --dry-run --infrastructure preserve
omnitron sdk dev /path/to/omni --project-dir /path/to/acme --stack dev --start-stopped --review "$digest"
```

Set `digest` to the digest from the first command. The second verifies the selected SDK, checks the stopped applications and retained infrastructure, and sends one start request for that stop ID. With an unchanged, complete build checkpoint, it checks the selected dependency installation, Turbo inputs and output hashes under both workspace locks and skips another recovery snapshot and build. Missing or stale build evidence follows the ordinary retained snapshot and rebuild path; ownership failures and changes during admission refuse the launch. Build-only use remains available with `sdk dev --no-watch`.

The first owner generations become the receipts for those SDK outputs. Reuse preserves the existing recovery snapshot and never treats build readiness as application readiness. Inputs and outputs are checked again before the one start request and before recording its generations. If the reply is lost, the CLI reports the observed stack state and leaves the SDK receipts unconfirmed; it does not retry the start or fall back to a rebuild. On a confirmed start, the watcher handles later source edits. Add `--no-watch` for a single reviewed start.

The file selection commits before the start request. A partial start or an unavailable owner therefore leaves the verified SDK in place; it cannot trigger automatic restoration underneath running applications. The durable attempt records the reviewed stop, selected SDK, build proof and, when received, the owner's successful reply with its exact generations. `omnitron sdk reconcile --project-dir /path/to/project --stack dev --check` only reads that evidence and the current owner observation. If it reports `reconcilable: true`, run the same command without `--check` to record the unchanged, acknowledged generations. Reconciliation never starts, restarts, installs or builds anything.

A missing reply remains `unconfirmed`, even if processes later appear online. Legacy attempts retain their original stop ID and explicitly report that the launch proof is missing; reconciliation does not invent it. Inspect the stack and owner before agreeing a recovery. `sdk recover` still requires stopped consumers and verifies its retained bytes; after a confirmed start it also preserves recovery ownership of SDK-written application receipts. No start is repeated for the same stop ID.

If a `recoverable` selection contains valid current files but its former SDK dependencies have changed, restoring that former installation is refused. Review the current state with `omnitron sdk adopt --project-dir /path/to/project --stack dev --check`. This independently verifies the selected profile, frozen installation, imports and complete current build proof; it cannot repair missing evidence. After stopping the affected source consumers, pass its exact digest with `--review DIGEST`. Admission holds both workspace locks, checks SDK mutation authority and revalidates the graph. It archives the original journal and start-attempt bytes and records `superseded`, with the old launch still `unconfirmed`. It does not restore dependencies, rebuild or send a start request. An interrupted writer or restoration cannot use this path.

Current-state admission retires restoration through the former receipt; that receipt, its snapshot and guards remain in history. The next ordinary `sdk dev` selection retains a fresh before-image of the verified current installation before writing anything. A rejected or interrupted admission preserves the current files. If its reply was lost after the atomic receipt write, observing/repeating the same reviewed admission revalidates that state and never replays an application start. Changing source, dependencies, build proof or launch-attempt evidence requires a new review. The new operation's rollback must be qualified against that newly retained installation, not an obsolete mutable SDK.

Each completed SDK build binds its output hashes to Turbo's declared input graph, Turbo version and Node runtime. Input hashes must match before and after the build and when its checkpoint is saved. Filtered rebuilds retain the proofs for untouched packages. Shared root TypeScript configuration and the compiler script are declared in `turbo.json`, so the build cache and SDK readiness use the same inputs. This is a development freshness check, not an immutable production source attestation; build inputs and environment variables must be declared correctly in Turbo.

Run `omnitron sdk status --project-dir /path/to/project --stack dev` to compare those inputs, current outputs and owner generations with the last build. Without `--stack`, status still verifies build freshness. Inspection runs Turbo's dry plan only: it never builds, installs dependencies or restarts applications. Changed inputs or a checkpoint without input proof fail explicitly and require `sdk dev`. A successful `build.status: "current"` describes the installed build. With `--stack`, status also identifies each confirmed application, explicit opt-out, inactive and unaffected application. Use `sdk prepare [SDK_CHECKOUT] --check` to determine whether the next selection needs a snapshot.

If an operator suspends a source watcher, stack status lists the application under `suspended` after verifying the owner's suspension receipt, current generation and matching SDK build receipt. Source refresh requires the watcher to be active again.

Titan bootstrap workers can inject `RUNTIME_CONTEXT` from `@omnitron-dev/omnitron/runtime`.
For a working-tree bundle produced by Omnitron, `development` records the generated worker's
project-relative filename, SHA-256 and observation time. The adapter observes the file across
its ESM import and rejects replacements or edits during that interval. Installed identity stays
`unavailable`. External imports and process memory lie outside this measurement. Consumers
that require reproducible release data should require `state: 'verified'` and the producer identity.

## Pipelines pinned to releases

A pipeline step with `kind: 'release'` binds a registered project, stack, application, immutable producer artifact and package-relative JavaScript entry. It uses the verified resident owner's Node, rather than storing an installation directory or generated shell command in the definition. A new owner installation can therefore preserve the pipeline's identity and history.

`omnitron pipeline check` validates a local JSON definition, including dependency
names and cycles, using the same Xec graph rules as the server. Its JSON receipt
lists the steps, dependencies and SHA-256 of the file. Keep this receipt when
reviewing generated workflows. Runtime authorization, artifact identity and target
availability are checked when preparing or starting the operation. [Reviewing generated workflows](../../tests/verification/ASSURANCE.md#from-a-generated-graph-to-an-operator-receipt)

```sh
omnitron pipeline check publication.json --json
omnitron pipeline save publication.json
omnitron pipeline run <pipeline-id>
omnitron pipeline run <pipeline-id> --expected-revision <saved-revision> --prepare --run-id <uuid-v4> --json
omnitron pipeline start <run-id> --expected-digest <review-digest>
omnitron pipeline status <run-id> --output
omnitron pipeline reconcile <run-id> --json
omnitron pipeline resume <run-id> --expected-digest <recovery-digest> --params-file parameters.json
omnitron pipeline save publication.json --id <pipeline-id> --expected-revision <sha256>
```

For automation, keep the definition ID and revision returned by `save` and choose a run ID before submission. With these values, `run --prepare` submits the reviewed definition directly. The daemon records the run before any step starts. If the preparation reply times out or the transport disconnects, the CLI reconnects once with the same run ID, revision and parameters. A second lost reply includes the original run ID for inspection. After a lost start reply, use `pipeline status <run-id>` to see whether execution began.

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

That command also works after a cold controller or process-owner restart for an independently owned local stack stopped with `--keep-infrastructure`. For an imported stack configuration, use the project and stack from `runtimeScope` in `omnitron --json stack status <project> <stack>`, followed by the exact database name. The same status shows `stopOperation.retainedDatabaseSha256` when the stop recorded the project registration, the owner's stopped revision, the PostgreSQL database list and every retained container's full native ID in its digest. Before creating the backup operation, Omnitron checks the receipt against the current declarations and running containers. The dump uses the verified PostgreSQL container's network and the applications stay stopped.

An older stop receipt can lack this identity. While the original infrastructure owner is available, take the manual backup or complete a fresh application-only stop with this version. If the owner has already restarted, obtaining a new receipt requires a separately authorized preservation start followed by a new `--keep-infrastructure` stop.

`backups.databaseTimeoutMs` defaults to 1,800,000 ms per PostgreSQL dump or restore. It covers file preparation, the stream and durable archive publication. A growing archive uses the same deadline. Target lookup precedes the transfer. Executor settlement, file cleanup and receipt writes can extend total elapsed time. `omnitron backup schedules` shows the effective limit and the last scheduled pass, including the tool, phase and archive bytes at expiry. For a gzip dump these are compressed bytes. PostgreSQL's COPY counter measures data sent by the server.

`omnitron --json backup operations <uuid>` reports the outcome in `state` and its cause in `code`. A confirmed deadline produces `failed / BACKUP_DEADLINE_EXCEEDED`. An explicit cancellation that settles produces `cancelled / BACKUP_CANCELLED`. If Docker settlement is lost after expiry, the operation keeps `unknown / BACKUP_DEADLINE_EXCEEDED` and its execution claim. A lost execution result without evidence of deadline expiry reports `BACKUP_EXECUTION_UNCONFIRMED`. Reconciliation uses the exact recorded execution resource. Once absence or termination is confirmed, the earlier deadline remains in the failed receipt.

An archive stream or preparation error reports `BACKUP_ARCHIVE_IO_FAILED`. A publication error reports `BACKUP_PUBLICATION_UNCONFIRMED`, including when the final file already exists. `BACKUP_INDEX_UNCONFIRMED` means the archive was published and its index entry needs inspection. The daemon's transfer diagnostic includes the operation UUID, phase and measured archive bytes when available. Only a successful receipt certifies the archive ID and size. On earlier releases, `failed / BACKUP_FAILED` covers several causes, so consult the matching scheduled pass or daemon error.

`omnitron --json backup list` returns the archive records in `data.backups`, with full restore IDs, and the schedule outcomes and stack coverage in `data.status`. When the archive index is available but coverage cannot be read, the command exits with code 1 and includes the archive records under `backups` in the `BACKUP_STATUS_UNAVAILABLE` error.

## Logs and operations

### Storage hardware alerts

On Linux, **Linux storage degraded** opens a critical alert when the kernel reports a failed NVMe controller, a zero-capacity NVMe namespace or a degraded software RAID array. The alert can fire while applications are serving and filesystems still have space. The daemon samples its own host through sysfs on the monitoring interval.

Open **Alerts** for the incident. In **System → Storage**, select the affected host to see the device names, controller states and RAID member counts alongside mounted filesystem usage. The CLI reads the same snapshot with `omnitron system` or `omnitron system --node <node-id>`. Use `omnitron --json system --node <node-id>` for automation. An older daemon reports filesystem capacity only.

Repeated readings update the open incident. A lost reading keeps it open. After a repair, Omnitron looks for positive evidence that the affected devices or their redundant mirrors have recovered. The originating node delivers critical transitions through the configured `monitoring.alertSink`. Update the controller before its mesh nodes so their incidents can also appear in the controller's **Alerts**.

### Operational records

The controller allows one outstanding write for its own fleet heartbeat. When PostgreSQL is slow to commit, later ticks skip the pending write. The fleet row keeps its last recorded heartbeat until a write succeeds. Session cleanup follows the same scheduling rule.

CLI ranked log levels are minimum severities; `--level unknown` selects records without a recognized level. Console's level filters select exact values. Capture, storage and remote delivery are separate states: a live log line does not prove durable delivery.

Use reviewed rollout plans and reconciliation for backend or owner transitions. Lost replies remain visible in operation receipts. Do not infer successful mutation from a local timeout or replace unresolved operations with an unreviewed retry.

## Documentation

[CLI](src/cli/omnitron.ts) · [Public API and exports](package.json) · [Console](webapp/README.md) · [Omni](../../README.md) · [Project documentation](https://omnitron.dev)

## License

[MIT](../../LICENSE).
