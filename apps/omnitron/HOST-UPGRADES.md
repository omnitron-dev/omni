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

To reuse a completed Linux qualification for a specific receiver, run
`pnpm exec xec update fetch COMMIT --previous PREVIOUS --node-version VERSION --run RUN_ID`.
The command checks source CI, the exact handoff and return, and the native archive.
It uses the local build of COMMIT in `OMNITRON_DEV_CACHE` to extract the archive.
Pass the returned `runtime` directory to
`pnpm exec xec update plan COMMIT --node NODE --runtime DIRECTORY`.
This stages the backend and reports the receiver's admission. An owner or guardian
change has its own runtime update plan.

`fleet upgrade --dry-run <node>` lists transport eligibility using the controller's
registered inventory, including when the controller runs from an installed runtime.
An explicit source-version comparison requires a build workspace.

A standalone controller can update up to 128 registered remote Linux servers.
Each target needs an enrolled, independently verified SSH host key, a healthy
resident owner and an independently stoppable guardian. The controller excludes
itself by execution-owner identity, including alternate registrations. Elected
controller clusters need recipient-side fencing across leaders and remain outside
this fleet workflow.

Planning binds the source commit, ordered targets, staging choice, pinned SSH
endpoint, both runtime digests, selection revision, backend PID, owner and complete
application/worker inventory, effective configuration digest and exact cancellable
backup attempts. Staging verifies and installs a catalog artifact
without selecting it. The first guardian bootstrap cannot rely on a handoff
protocol the incumbent does not implement. Prepare its management runtime through
the separately qualified native installation path.

Use `omnitron fleet rollout plan <commit> <node> --stage --wait` to install
the matching catalog build and review the candidate. Apply the resulting plan
separately when the owner is ready for a handoff. The SSH login holds the
machine deployment lease. On a Linux host enrolled through a dedicated service
account, SFTP places the qualified archive under the login's protected
`/opt/omnitron/locks` directory. The receiver gets one read-only file
descriptor. It rechecks the enrolled UID, GID and instance home, drops to that
account before using its Node, and verifies the archive and installed tree.
Allow space for the compressed archive on the administrative filesystem and
twice the expanded tree on the runtime filesystem, each with 256 MiB headroom.
Large inspection and receiver programs use SHA-256-checked SSH channel data.
The recipient verifies the complete script before its execution.

After a lost staging acknowledgment, inspect `fleet rollout status <id>`, the
node deployment lease and execution record, the current selection and the
target artifact. An unresolved writer requires inspected recovery. Once the
writer is settled, a fresh stage request recognizes the verified installation
or reuses the preserved archive bound to its catalog digest. A terminal blocked
plan keeps its original result. Where the verified runtime tree already exists
locally, the service owner can use `omnitron --json backend install <runtime>`
and check the reported digest, `selected: false`, and original selection
revision with `omnitron --json backend installation`.

CLI and Console read the same durable plan ID and per-target outcomes. CLI omission
of node arguments retains its public meaning of all registered remotes in name
order. Console requires explicit targets or **All registered remote nodes**.
Aliases resolving to the same target and ambiguous selections refuse before
planning. Administrative authority is revalidated before staging and dispatch.
Viewers and operators can inspect receipts without gaining activation rights.

Guardian preparation installs a sealed management artifact and records its native
stop boundary. The authenticated serving backend supplies its public socket path;
reading that address does not require a recovery certificate. A controller with
`backupHandoffProtocol: 1` also records the exact owned backup attempts that the
transition may cancel. `backend guardian apply <plan> --check` performs read-only validation
of a prepared plan using the same guards as apply. It requires `checked: true` for
a fresh approval. A completed receipt reports `checked: false`. Apply rechecks
under the installation lease before retirement and changes only the guardian job,
retaining the selected backend and execution owner.

Apply passes those exact references to the existing backend handoff. Completed
attempts are observed without cancellation; a new or changed active attempt needs
a new review. The handoff drains owned backups, then obtains its strict checkpoint
before retirement. Unknown outcomes, restores and foreign operations remain
blockers. A lost preparation acknowledgement leaves `preparing`; continuation
must observe the original controller's ticket and cannot send preparation again.

Warm backend and fleet updates use `backendHandoffReviewProtocol: 1` on both the
serving controller and guardian. Their read-only review uses the same ownership
observer as local runtime review and the same snapshot builder as recovery and
handoff. It can describe exact owned backups while recovery remains `pending`;
it never publishes a ready certificate or permits retirement. A controller or
guardian without this protocol refuses before cancelling work.

`backend upgrade --check --json` exposes the reviewed controller grant,
configuration digest and backup receipts. The private resolved snapshot stays on
the node. A standalone upgrade takes a fresh review by default. To apply the
exact check that an operator approved, keep its JSON response in an owner-only
file and pass it to the upgrade. The guardian checks that the target, controller,
configuration and scope of backup cancellation still agree before draining.

```sh
umask 077
omnitron --json backend upgrade "$dist" --check > backend-check.json
omnitron --json backend upgrade "$dist" --from-check backend-check.json
```

Managed plans retain these values, and CLI and Console display the
per-node cancellation scope before applying. A completed attempt is observed;
new attempts, changed revisions, unknown outcomes and foreign operations refuse.
The guardian revalidates admission under its native operation boundary. It
performs candidate verification and read-only infrastructure adoption once there,
instead of repeating the same native probe in the delegating CLI.

After CAS cancellation and ingress drain, preparation freezes project and
infrastructure ownership and obtains the owner ticket. The exact frozen checkpoint
must retain the reviewed controller PID/grant, registry digest, effective project
and watch definitions, resolved infrastructure declarations and native IDs,
execution environment and complete application inventory.
The candidate validates every native infrastructure resource in that checkpoint
before retirement. This final check is necessary: health observations can advance
between read-only review and freeze. It is not replaced by a cached probe or a
previous recovery certificate.

A lost preparation reply is never replayed or guessed to have failed. Inspect the
original backend ticket and private checkpoint. Automatic rollback may follow the
successor's exact grant while preserving the reviewed configuration, but its backup
list is empty: it cannot cancel attempts started after review. Such a backup must
finish before rollback. Historical plans without admission remain readable and
require a new plan before activation.

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

When an additive database migration names a compatible rollback release, qualify
the candidate against that exact sealed release. The migration check opens the
candidate registry with the rollback writer present and exercises both writers
before and after expansion. Existing Pipeline runs retain their admission
records, including older runs created before admission was recorded.
On a worker, the native test also compares every SQLite migration row before
the guardian change. It verifies the checksum and execution order of the
reviewed addition at backend activation and retains its timestamp through
rollback, crash recovery and restart. The owner replacement and local update
fixtures apply the same check at the first candidate backend startup. Each
later owner change must preserve the complete recorded journal.

If fleet planning reports a missing `backupOperations` counter, the serving
backend cannot account for active backups. Waiting for a quiet interval cannot
add that capability. The named counter identifies a protocol gap. A report such
as `fileTransfers=1` identifies work the operator can observe to completion.
For a protocol gap, retain the staged runtime and prepare a native maintenance
transition with the service owner, including the exact previous role bindings
and the recovery path for data written during the transition.

### Linux service identity

Give the resident owner and backend a dedicated system account with a private
home. Prepare their system units as that account with
`omnitron service install --scope system --prepare`. The plan emits both units
and the private supervision record. Review the unit contents before installing
them with administrative privileges. systemd uses the account's primary GID.

The registered SSH administrator and the resident service can have different
Linux accounts. When root's private Omnitron configuration is an explicit link
to the service account's private `~/.omnitron/config.json`, the controller
uses its owner to locate the instance. It checks the link and file permissions
and adopts the service UID and groups before reading the supervision record or
loading the installed SDK. A second supervision record under the administrator's
home makes this selection ambiguous and stops admission.

For this split-account installation, import the selected release into the
recipient's canonical store before starting the remote stack. Admission checks
each assigned archive against the manifest. During installation the service
account copies the archive into its new application directory and verifies
the on-disk byte count and SHA-256 before extraction. The same account runs
migrations, registers applications and verifies their health. The SSH
administrator holds the machine deployment lease under `/opt/omnitron/locks`
and opens the declared route from the gateway. Application directories under
`/opt/omnitron/projects` and `/opt/omnitron/artifacts` belong to the service.

Automatic guardian replacement currently supports a Linux system instance only
when its private state and running guardian belong to root. The coordinator
checks the real and effective operator UID, the guardian's four kernel UID and
GID values, its sealed executable, and the loaded unit's stop effects.
The sealed guardian and backend load compiled JavaScript directly. Project
TypeScript configuration is evaluated by a separate reader. An older guardian
can retain an `esbuild --service` child from its TypeScript loader. The extra
process blocks a hot guardian replacement. A backend-only rollout can retain
that guardian when its usual admission checks pass. To replace a guardian
whose stop group stays occupied, use a reviewed cold transition.

For a dedicated system account, use the cold procedure below. The private
socket, runtime registry, candidate verification and supervision record belong
to the service account. The host administrator owns the two unit files and
dispatches the native start.

When moving an existing instance to a different account, retain the original
units and a consistent copy of its private state. Verify the runtime selections,
absolute paths, node identity, application registrations, and recovery history
under the new account before enabling the services. Stop the original writers
before taking the final copy. Rehearse how the previous runtime will read any
records accepted after activation.

For the first change of Unix account, prepare both native definitions in the
new account's view of the instance. Install the reviewed private
`runtime/supervision-plan/supervision.json` byte-for-byte at
`runtime/supervision.json` under that account with mode 0600. This file binds
the two roles to their releases and carries the retained private environment.
The administrator installs both reviewed definitions and reloads systemd.
Check each kernel UID, GID, process, cgroup and serving backend reply. A
rollback also needs the previous private record and the data accepted since
the cutover. A renamed directory can invalidate absolute paths in the registry.

#### Cold maintenance of a registered dedicated system pair

Use a root-owned CLI installation and Node executable for the administrative
commands. Run the instance commands as its dedicated account inside the same
mount view as both services. The runtime selected by that account remains
eligible for a native start through its existing sealed `managed-entry.js`.
The administrative commands verify the Linux host locally and require
`systemctl`, `busctl`, `flock`, cgroup v2 and native process evidence.

1. Retain both role hashes, root-owned unit files, the active record SHA-256
   and a consistent private backup. Review application and infrastructure
   retention separately. Drain the instance and stop its two native services
   in the approved maintenance window.
2. In the service account, use the normal `backend select` and
   `service install --scope system --prepare --owner-runtime <target-owner>`.
   Inspect the active and prepared record hashes with `sha256sum` in that
   account's view. Publish the exact proposed record with
   `omnitron service publish-system-plan <active-sha256> <prepared-sha256>`.
   This acquires the installation lease, checks the selected artifacts and
   stopped processes, and retains the previous bytes under
   `runtime/supervision-plan/retained-<active-sha256>.json`.
3. As the host administrator, run the following three commands with the same
   account, paths, role hashes and record SHA-256. Take the review digest
   from the first command. `install` rebinds the registered units while they
   are stopped. `start` checks the loaded commands, starts the owner then
   the guardian, and confirms their kernel credentials and executables.

```bash
pair=(--account "$service_account" --instance "$instance_home" --state "$backing_directory"
      --from-owner "$original_owner" --from-guardian "$original_guardian"
      --to-owner "$target_owner" --to-guardian "$target_guardian" --record "$prepared_record_sha")
"$admin_omnitron" --json service system-pair review "${pair[@]}"
"$admin_omnitron" --json service system-pair install "${pair[@]}" --review "$review"
"$admin_omnitron" --json service system-pair start "${pair[@]}" --review "$review"
```

The host path and the path seen by the services can be identical. The
supported separate view uses both `TemporaryFileSystem=<logical-parent>:mode=0755`
and one `BindPaths=<backing-directory>:<instance-home>` inside each trusted
fragment. Both roles use the generated Omnitron unit format and the same
dedicated account. Existing application copies may have separate
`BindReadOnlyPaths=<physical-copy>:<original-directory>` entries under
`/opt`, `/srv` or `/var/lib` in the service view. Use a physical directory
under administrator-owned parents. The review pins each source inode. Start
checks the mount seen by the process and its read-only flags. Verify each
package's contents and the service account's access to its entry point and
required data separately. The administrator independently supplies the role hashes.
The tool changes the existing `ExecStart`, `WorkingDirectory` and
`OMNITRON_CWD` for each role. An unknown directive, drop-in, pending job,
different private record, changed inode or changed loaded command stops the
operation. The service account receives no systemd administration grant.

After an interrupted unit replacement, repeat `install` with the same
review while the pair is still cold. After a lost start response, repeat
`start` with that review to observe the exact active roles and start a
remaining stopped role. Confirm the public backend PID and application
readiness through the instance CLI. For rollback, stop the pair, select the
retained previous runtime as the service account and run
`omnitron service publish-system-plan <current-record-sha256> <original-record-sha256> --restore`.
Review the inverse role bindings and original record SHA-256, then run the
native install and start for that review. This restores the native pair and
its supervision record. Data-format compatibility and the retained application
inventory still require their own checks.

Review container permissions separately. Access to a rootful Docker socket
grants host administration to its clients, including processes that inherit
the service account's groups. Record which processes require that access and
verify the permitted operations against the retained containers and volumes.
[Docker Engine permissions](https://docs.docker.com/engine/install/linux-postinstall/)

## Local development rollout

Finish a reviewed batch on a macOS development machine from its clean main
checkout. Xec builds the backend, Console and their transitive build dependencies
from local Git using the frozen pnpm lockfile and the Turbo cache.
`OMNITRON_DEV_CACHE` selects a private build cache on the development
volume. During preparation, Xec reuses the sealed runtime for the same commit,
platform and Node version. Omnitron installs that runtime and records its identity
in the plan. Applying a reviewed plan resolves the installed runtime by digest
and uses its bundled Node, even if the shell now runs another Node version or
the build cache has been cleared. The checkout must still match the reviewed
commit and have a clean working tree.

For a fresh build, run Xec with a standalone Node distribution such as the
official Node binary. Xec checks the producer before creating the build
checkout or installing dependencies. A verified cached runtime uses its own Node.

When repacking an installed runtime, the build tool verifies the input with its
own verifier. It checks the same filesystem snapshot again after copying the
packages and records the digest of the new runtime.

```sh
pnpm exec xec update local-sync
pnpm exec xec update local-sync --review <plan-sha256>
pnpm exec xec update local-sync --status
```

A refused preservation review identifies the node, the affected resource and
the failed check. Run `omnitron stack start <project> <stack> --dry-run --infrastructure preserve`
to inspect the full report while applications are serving. For a service
with mounted configuration, the running container records the specification it
was created with. Editing a mounted file changes the desired specification.
After deploying the changed service, obtain a fresh review before updating the host.
Migration admission and backend handoff also report the affected resource.
If its replacement satisfies today's declaration, a handoff can still refuse
because the running controller recorded the previous container ID. Compare
the new review with the controller's recorded identity before selecting a recovery path.

Stack review reads the Docker ownership labels and full container IDs in one
listing. It inspects the declared containers by name and verifies each ID against
that listing. An unrelated container waiting on its own native operation does
not have to answer an inspection for the stack review to proceed.

### Studio and Flows when returning to an earlier backend

Run the capable manager's `omnitron --json backend upgrade <retained-runtime>/packages/0/dist --check` against the exact recovery target. The check opens the controller's SQLite journal read-only. The serving controller stops admitting new public requests and Flow work, waits for admitted requests, disk samples and deliveries, then checks the journal again before releasing ownership. A drain timeout resumes that controller. A new manager carries the verified target digest through the private guardian request.

| Current journal | Returning to the individual-conversation backend at `6c98e39f` |
| --- | --- |
| Individual conversations only, at most one queued or running turn per thread and one running turn per connector | The legacy backend can open the journal and continue those conversations. |
| A team room exists, including an idle one | Select a retained backend that understands team membership and separate provider conversations. The old backend can dispatch a peer's turn using the lead's provider session. |
| A live namespaced Studio connector, or a saved room, policy or member references a custom provider ID | Select a backend declaring `studioProviders: 1`. An expired registration with no saved references can remain in the journal. |
| Several outstanding turns in a thread or several running turns on one connector | Allow the work to settle or select a compatible backend. The legacy constructor attempts to recreate both unique indexes and can fail after creating the first. |
| An active flow or a queued or dispatching external delivery | Continue with a compatible runtime. To retire that automation deliberately, inspect original receiver IDs, settle outstanding work and review the pause in Flows before checking again. |
| Inactive flow drafts and historical receipts only | The old backend leaves these tables on disk. A compatible backend can reopen the same history later. An unconfirmed receipt still requires observation of its original command. |

A hot rollback after team collaboration or while monitoring is active uses a sealed backend that declares the required versions in `shared/controller-journal-formats.json`. When the only retained backend predates that declaration, prepare a compatible forward recovery build. Run the same check for this alternate target, review its ordinary transfer and retain the current journal. Restoring a pre-update database discards work admitted since that backup. Inspect compatibility before opening the journal with a legacy binary. Its constructor executes DDL even when the intended operation is a read.

The physical SQLite regression in `test/integration/studio-controller-compatibility.test.ts` can load both compiled releases. Point `OMNITRON_TEST_STUDIO_PREVIOUS_DIST` at the clean `6c98e39f` dist and `OMNITRON_TEST_STUDIO_CURRENT_DIST` at the candidate dist. A full source checkout can also compile the previous ledger from that exact Git object.

For a stack in `preserve` mode, preparation compares its saved review with
the retained launch and infrastructure for its next start. Inspect both with
the following read-only commands.

```sh
omnitron --json stack status <project> <stack>
omnitron --json stack start <project> <stack> --dry-run --infrastructure preserve
```

Compare `data.infrastructureReview` in the status with `data.digest` in the
start review. The latter includes launch selection, local bootstrap bytes,
declarations, environment and the infrastructure review from each placement.
A bootstrap edit can change this digest even when every native container passes
its checks. Verify the intended changes with the stack operator. Once the
operator authorizes and performs a stack start with the reviewed digest, run
`pnpm exec xec update local-sync` again to prepare the host plan. After a
refusal, `--status` can still show an earlier plan. Check its target commit
before reviewing a plan for application.

On macOS, an installed operator can run the same workflow against user services
with a sealed runtime and no source checkout. For a registered Linux server,
start with `omnitron fleet rollout plan <commit> <node>` on its controller.

```sh
omnitron runtime verify <runtime-root>
omnitron runtime update prepare <runtime-root>
omnitron runtime update apply <plan-sha256>
omnitron runtime update status [plan-sha256]
omnitron runtime update reconcile <plan-sha256>
omnitron runtime update recover <plan-sha256>
```

During `xec update local-sync`, the native updater reports each change of phase and
the reason it is waiting on stderr. The final receipt remains available on stdout.
`omnitron --json runtime update` keeps its usual single-result format. A caller can
opt into newline-delimited progress events on stderr with `OMNITRON_UPDATE_PROGRESS=1`.
An older installed operator may report only the final result.

For a quick progress check, run `omnitron runtime update status`. Agents can
read the same private records with `omnitron --json runtime update status --journal`,
optionally supplying a plan digest. This read works while the daemon is down or
the candidate is unavailable. The journal validates the plan digest and records
when the updater first entered each phase in `receipt.phaseEnteredAt`. For example,
the interval from `stopping` to `accepted` includes shutdown, startup and the
final service checks. Older receipts can have partial timing. For the verified
executable path, use `omnitron --json runtime update status <plan-sha256>`.

`verify` checks the artifact without executing it. Preparation and application
run through the verified candidate's own Node and CLI. `status` returns the
prepared plan, current or requested receipt, and verified candidate paths. It
remains available while the daemon is stopped. `reconcile` checks a candidate
which has already started; it cannot stop or start services or repeat an effect.
Xec status and recovery accept
`--cli <executable>` when selecting an installed operator. Mutation authority
for this host operation comes from the local private instance and native user
services. The HTTP API exposes no host-update mutation.

Ordinary CLI startup resolves the selected executable from the private registry,
manifest and physical entry-point checks without hashing the entire runtime.
Writable installation and admission modules load only when needed.
`InstalledRuntimeCli` is an executable selection, not an admitted
`BackendArtifact`: install, select, service startup and handoff still require
the full runtime digest and their applicable preflight checks.

Within one host preparation, the verified target retains its process-local
filesystem proof. Reuse checks the complete metadata inventory, including inode,
ownership, permissions and change time, instead of reading every file's contents
again. A changed entry invalidates that proof permanently; restoring its old bytes
does not revive it. JSON paths and digests are descriptions, not reusable proofs.
A new process, a distinct installed copy or another operation verifies independently.

Dependency materialization copies up to four independent packages together and
creates links only after every package copy succeeds. Application roots finish
before their nested dependency graph. Installation flushes at most 16 regular
files together, flushes directories after their descendants, then publishes the
directory. Failed copies and flushes settle before cleanup; neither parallelism
nor proof reuse changes the reviewed selection or permits a partial installation.

After Xec seals a new runtime outside its build checkout, `local-stage` can
install it and `local-sync` can prepare its plan while a background worker
removes the checkout. Use `xec update local-cleanup --status` with the same
`OMNITRON_DEV_CACHE` to inspect the cleanup receipt. Run `xec update local-cleanup`
to retry pending work. The installation and update plan have their own receipts.
`local-check` and `local-apply` wait for cleanup of any checkout they build.
Applying a reviewed digest uses the installation identified by its plan.

Preparation stages the candidate alongside the running installation. The plan
names both native process owners, the serving Console, physical container IDs,
logical project and stack names, application generations, source watches and
verified release pins. Review the affected stacks and rollback identities with
their operators. A change to reviewed launch policy, payload or process inventory
requires reviewing the new digest. Active work, including backups, is reported
by the controller. The plan records the exact locally owned backup attempts
that application may cancel. Preparation does not cancel work, pause schedules
or grant shutdown authority. Restores, unknown outcomes and operations without
confirmed local ownership block admission.

The retiring PID list comes from the resident owner's private protocol-1
snapshot. It includes classic applications, supervisor children and every
registered worker in each pool. An already stopped application contributes
no PID. A partially running application contributes its observed members.
A registered worker with an unknown PID prevents admission. The updater binds
the snapshot to the public owner and controller epoch, checks it again before
shutdown and checks the candidate under the rollback hold. Prepare a fresh
plan if an earlier CLI recorded only the representative PID from a pool.

When preparing a fresh plan, each owner-snapshot check waits up to 15 seconds
for admitted work to finish. The owner's activity count includes scheduled
child-metrics drains. During this wait the CLI repeats only the private
snapshot read and checks the same owner, controller epoch, application
generations and inventory digest. Applying a reviewed plan requires an idle
owner and the identities recorded in that plan.

Infrastructure preview reads the live controller through authenticated private
RPC, including while its owned backups run. The response marks this observation
as `reviewed-declarations`; it does not publish a recovery certificate. Offline
preview keeps `certified-declarations` and `historical-declarations` distinct,
and historical evidence cannot admit an automatic local update. A refused live
review never falls back to an older journal entry.

Cold infrastructure review binds configuration, resource ownership and native
container identities. Health-probe timestamps and reconciliation clocks are
observations, so advancing them does not invalidate the review. The candidate
separately proves the exact snapshot bytes it inspected; changed declarations,
container identities or non-retain actions still refuse the transition.

Each restart capture verifies an installed release once and shares that result
with its infrastructure review. Verification is repeated in the next capture
and at startup; no inspection cache survives an operation.

Runtime-only preparation captures the serving controller's effective project
definitions and resolved next-start environments in a private file; the public
plan records its digest and `basis: retained-next-start`. It compares those
definitions with the owner's current restart entries, without claiming the
original environment of a running process. Snapshot integrity covers the entire
file, including project `loadedAt` timestamps. The restart-intent comparison
excludes only that observation timestamp: reloading identical definitions does
not change restart authority. Owner and inventory identity, registry digest,
definitions, launch order, environment and selected releases remain bound.
The serving and target controllers
must advertise `runtimeRestartProtocol: 1`; an older serving controller first
needs a verified warm backend upgrade. The serving controller also advertises
`runtimeRestartAdmissionProtocol: 1` for read-only review and scoped backup
admission. Ordinary release deployment keeps its
source-closure admission checks. Updating unused project imports therefore
does not redeploy them during this reviewed runtime restart.

Application first records `draining`, pauses backup admission for this plan,
and cancels only its reviewed backup attempts through the operation journal.
A backup that already finished keeps its terminal receipt and is not replayed.
A new attempt or changed active revision requires a new review. Before any
process is stopped, the controller must publish a fresh recovery certificate
and confirm the reviewed restart intent against a fresh, fully verified snapshot.
Scheduled and manual backups remain paused across backend replacement and
restoration while the current native update receipt is nonterminal. The new
controller reads that same receipt before arming schedules and before admitting
an effect; no second pause journal or release RPC is involved. If admission fails,
Omnitron releases only this plan's pause and records `aborted`; applications
continue without a rollback restart. A lost release acknowledgement remains
`draining`. Recovery of that phase only releases the same plan's pause.

Once `accepted`, `rolled-back` or `aborted` is persisted, the backup scheduler
reconciles the receipt and resumes the saved policy. While held, one observation
runs at a time and rechecks after one second; disposal closes that observer before
clearing timers. A lost CLI reply therefore cannot leave schedules paused forever.
A missing previously observed receipt, malformed state or an unproven older
terminal digest keeps admission closed with a visible `unconfirmed` reason.
`backup schedules --json` includes `admission` with the reason and, when known,
the current update digest/phase. The human command reports the same pause.
These transitions do not edit user schedules or release unknown backup claims.

Database backup execution uses the shared Xec executor. PostgreSQL in Docker
runs each dump or restore in an owned, resource-limited job using the database
container's immutable image and network identity. The operation journal records
intent before effects, then the daemon identity and full job ID before start.
Cancellation waits for Xec's confirmed cleanup; it does not inspect the same
completed job a second time or infer termination from a closed Docker client.
Existing completed archives and persisted schedules survive cancellation.

Backup RPC exposes operation receipts through `listOperations` and
`getOperation`. Administrative `cancelOperation` and `reconcileOperation` take
only an operation ID and its reviewed revision; the controller obtains any
execution observation itself. A repeated operation ID never repeats its effect.
An unknown outcome retains its resource claims and staging files across restart.
For a local command whose leader exited while a descendant retained a pipe,
Xec reports uncertainty instead of signalling a potentially reused process
group. Such an operation cannot grant update admission.

These ownership APIs require Xec 0.13 or newer. Source qualification against a
private Core build is not npm compatibility or permission to activate a runtime
still declaring Xec 0.12.

Application then replaces the user launchd services through Omnitron. The resident
owner restores enabled local stacks from the private reviewed definitions and
their saved launch selections. The existing release installer verifies and
stages the same payload for the replacement owner's runtime, preserving
operational working directories, environment and readiness policy.
Acceptance checks roles, new generations and health, release receipts, source
watches, retained launch definitions, the served Console `BUILD.json` and retained
infrastructure as one observation. Its 15-minute deadline covers the complete
check, including the remaining budgets passed to CLI and RPC reads. Only an
explicit pending observation is retried: for example, the serving controller's
own startup lease, an unsettled recovery certificate or application readiness.
If the deadline expires, the CLI reports `RUNTIME_OBSERVATION_TIMEOUT` and the
budget in `details.timeoutMs`. When a subsystem reported a pending state,
`details.lastObservation` includes its stage, reason and any reported PID.
The update journal preserves that last observation in `receipt.error` for
offline inspection.
A foreign lease, changed intent or invalid evidence cannot become a retry by
matching an error message. An accepted digest can be checked again without
restarting a stack. The instance keeps the previous receipt when a new reviewed
batch begins.

Cold startup owns the Console container. When the review records an enabled
Console, the target controller mounts its own Console on apply. During rollback
the cold controller mounts the exact previous Console artifact and verifies its
served `BUILD.json` before transferring the backend and guardian. A previously
disabled Console stays off in both directions. Preparation checks the cold
controller's `coldConsoleProtocol` capability when rollback would mount a
different artifact. Recovery also checks that capability in the installed cold
controller before retiring a candidate, including when the backend is unavailable.

`omnitron webapp start` uses the serving daemon's local administrator socket,
HTTP port, bind address and seeded-password check. `--force` requests replacement
of the owned container. `webapp open` can start it temporarily and preserves the
boot preference. `webapp stop` disables automatic start and can remove the owned
container by its full Docker ID while the backend is down. `webapp status` reads
the actual Docker publication. Operator mutations and update admission share the
instance policy lock. An unfinished update holds manual Console changes until
its receipt reaches a terminal phase.

Native Console lifecycle uses the local Unix administrator socket and the Xec
kernel file lock on macOS and Linux. Omnitron's daemon and CLI register the Unix
socket transport. Windows local administration would require integrating Titan's
named-pipe transport and a matching native lock.

If acceptance times out or a read loses its result, the receipt becomes
`recovery-required`; this is not evidence that the candidate failed. The update
does not stop that candidate automatically. Inspect status, then choose the
operation whose evidence is available:

| Observation | Command | Effect |
| --- | --- | --- |
| Candidate roles and applications are serving the reviewed state | `runtime update reconcile <plan-sha256>` | Record full acceptance without a restart |
| Candidate cannot be accepted and restoration is required | `runtime update recover <plan-sha256>` | Prove retirement and restore the recorded roles, or retain an unconfirmed outcome |
| Admission stopped before process retirement | `runtime update recover <plan-sha256>` | Release only this plan's admission |

On macOS a cold candidate can lose its first backend before that backend publishes a recovery snapshot. For a reviewed plan with empty application, watch and backup lists, `runtime update recover` can retire this owner after proving the backend exited, the first controller grant completed, the owner has no activity or application history, and the previous certificate still matches the catalogue. The recovery receipt retains a digest of the native and journal evidence. The command rechecks it immediately before shutdown and on a retry. An earlier operator-reviewed unknown backup keeps its restore fence. Later operations, missing journal history or changed evidence require inspection.

The Xec equivalents are `update local-sync --review <plan-sha256> --reconcile`
and `update local-sync --review <plan-sha256> --rollback`. Neither path rebuilds
the runtime. A deadline ends observation, not the underlying operation's durable
ownership; a late reply cannot publish acceptance.

If the maintenance window depends on a consumer's development SDK, check it while the applications are serving. `omnitron --json sdk prepare --project-dir PROJECT --check` uses the already selected SDK checkout. Supply `SDK_CHECKOUT` after `prepare` for a planned switch. Inspect `data.action`, `data.reason` and `data.snapshotRequired`. A change to a workspace package's `exports` or `scripts` can require `rebind` even when the distribution lock and installed build are current. Resolve unexpected changes before scheduling the stop. For a planned `rebind` or `rebuild`, repeat the command without `--check`, retain its token and budget time for selection during the outage.

If the window includes declared application migrations, an administrator can run `omnitron --json infra migrate --stack PROJECT/STACK --dry-run` before stopping the stack. The owner checks the current SDK bindings, migration programs, installed dependencies and database destinations. A successful online review returns `targets`, `stopped: false` and `digest: null`. A prepared SDK snapshot leaves the active bindings in place, so a migration review can still report the old profile's mismatch. After the stop, complete any planned selection with `omnitron sdk dev SDK_CHECKOUT --project-dir PROJECT --no-watch --prepared TOKEN`, using the `source` returned by preparation and the same revisions and development cache. Repeat the migration dry-run on the stopped stack to obtain the execution digest for the selected SDK.

If recovery depends on an application release, compare its membership before the stop. A complete `omnitron --json stack stop PROJECT STACK --keep-infrastructure --dry-run` has a digest and lists the owner's `PROJECT/STACK/APP` handles in `data.targets[].applications[]`. On the controller, `omnitron --json release list` reports `APP@VERSION` entries in `data.releases[].artifacts.apps`. Among the project's complete releases, match every required application by name, including development-only and web processes. A missing artifact rules out a full-stack rollback to that release. For the chosen candidate, `omnitron --json stack start PROJECT STACK --release RELEASE --infrastructure preserve --dry-run` checks the release policy, artifact bytes and native resources. Verify that the review returns a digest.

For one application outage, review and perform `stack stop <project> <stack> --keep-infrastructure`, then prepare a fresh host update. Confirm the stopped stack appears in `excluded` with reason `disabled`, the host plan has the intended empty local application and watch lists, and the reviewed container IDs are retained. After host acceptance, SDK selection, migrations and the single reviewed stack start each use their own receipts.

For an application-only stop followed by a local native update, stage the exact runtime artifact and use a foreground backup window. This requires a serving backend with `applicationStopBackupWindowProtocol@1` and the local administrator socket. Use a CLI with cold infrastructure review for both commands below. With an older CLI on `PATH`, invoke the staged release's `node` and `packages/0/dist/cli/omnitron.js` directly.

```sh
omnitron stack stop <project> <stack> --keep-infrastructure --for-runtime <artifact-sha256> --dry-run
omnitron stack stop <project> <stack> --keep-infrastructure --review <stop-digest> --for-runtime <artifact-sha256> --backup-window-minutes 15
```

Both commands run the installed candidate's `backend select <artifact-sha256> --check` against the serving controller's infrastructure declarations. They also check the selected rollback runtime when its SHA differs. A stack start dry-run can accept the current gateway while the controller still holds its previous declaration. If either preview predicts `replace` for that gateway, the stop reports its name and action before opening the backup window. The detailed preview lists every container. Review the controller's retained infrastructure and rerun the dry-run after resolving the difference. Once the previews confirm retention, execution requires backup and restore operations to settle while the applications are still running. An unconfirmed operation needs its ordinary reconciliation.

Keep the second command running. In another terminal, confirm the stack's stopped receipt and its `backupWindow`, then prepare and apply the new host plan. The backend transfers backup admission to the native update when its durable `draining` receipt matches the artifact, serving controller and excluded local stack. The foreground command returns that receipt's digest. Backup schedules remain subject to the ordinary native update until it reaches a terminal phase.

The foreground window accepts 1 to 60 minutes. The backend checks the caller's OS process lifetime every second and releases the window when the caller exits or the deadline passes. A controller restart ends a foreground window. If applications already stopped, inspect their stop receipt and the native update status before choosing the next operation. Separate commands own SDK selection, migrations and application restart.

For a short start with an installed SDK, obtain a fresh `reuse` result for the final project and SDK revisions and use its `data.reuseDigest`. Obtain the stack's working-tree launch review separately. The command below checks the reviewed installation again immediately before recording the start request. A change requiring a new snapshot, installation or build ends the command before the first write or start request. See [Source SDK development](README.md#source-sdk-development).

```sh
omnitron sdk dev SDK_CHECKOUT --project-dir PROJECT --no-watch --reuse-only "$reuseDigest" \
  --stack STACK --start-stopped --review "$launchDigest"
```

Cold rollback checks the current journal against both its interim starter and final backend before retiring the owner. A serving controller holds public requests and background Flow work, then checks the journal, catalogue, workers and watches against the recorded shutdown intent. Native service control can retire the reviewed owner while public ingress is held. If the updating process exits first, the controller reopens ingress and resumes sampling. An unavailable backend uses the independent native empty-owner evidence described above. A serving controller without the rollback admission protocol can accept a new stack between its final inventory check and shutdown. Use a compatible managed backend handoff or a newly reviewed forward update on that version.

An empty plan cannot retire an application started after host acceptance. A partially started candidate can recover when its observed processes belong to the original reviewed stacks and app handles. A refusal before any native retirement keeps a previously accepted update available for independent forward recovery. Inspect the refusal in `runtime update status <plan-sha256>`. A migration or SDK change has its own recovery decision.

A confirmed transition failure attempts to restore the recorded roles and Console from the
installed artifacts once clean process retirement is established. For an
interrupted operation, inspect `omnitron runtime update status` before choosing
reconciliation or recovery for its exact receipt.
The receipt records the original error and any recovery failure. Once a
restoration start has been attempted, another recovery invocation inspects
that result and cannot launch the previous runtime again. For retained
configuration, the target controller first restores the previous owner and
applications, then restores previous backend and guardian roles through their
ordinary warm handoffs. Recovery may finish an interrupted handoff after
observing its committed roles. Before guardian effects, the runtime receipt
retains the existing guardian plan's private path and intent digest. A repeat
recover validates that binding and resumes the same `backend guardian apply`
transaction even while its backend is retired or its unit is configured.
It does not prepare another guardian plan or restart the owner.
Startup defaults which an older owner cannot
replace must still match before it is launched. An unproven
execution owner requires inspection before a new installation can start.

The automatic path requires independent supervision and retained containers.
Preparation checks both installed binaries with `backend select <artifact> --check`.
The target controller must advertise `coldStackAdmissionProtocol: 1`; it
performs stack restoration in both directions. Each replacement owner may consume the exact
infrastructure review once per enabled local stack in each direction. A retry
checks the durable claim. The stack keeps its saved boot policy and its full
release selection. Preparation reports an unsatisfied review before shutdown.
A stack running with disabled boot intent needs its intent reconciled before
a cold restart. A database expansion, Docker resource change or shared research
data transition has its own Omnitron review. Developer SDK mode and an
application's installed release remain independent of the platform version.

For a backend-only handoff with resident applications running, use
`pnpm exec xec update local-check` followed by `pnpm exec xec update local-apply`.
An explicit sealed `<dist>` is supported for this pair.

During a hot handoff the serving backend pauses metric pulls and alert evaluations.
It persists samples from any outstanding child pull while finishing the alert rule
or sink transition already in progress. The next admitted backend resumes pending
deliveries from their database receipts, including accepted events whose rule has
since been disabled. If the 30-second deadline expires, the incumbent resumes
service. The error reports the active stages and the metric queue at the deadline.
An alert stage identifies the rule, project configuration, sink transition or
delivery receipt in progress. An older incumbent can report a generic metric
timeout for any of these stages, including alert delivery.

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

The project lifecycle lock covers both the source read and the monitoring
handoff. A failed source read preserves the last validated configuration.
An active local runtime update retains its configuration until that update ends.

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

### Storage alerts and the 017/001 rollback release

The storage-alert bridge is commit `5be6b9744667ad4fe24fa0a7af17bcbc77b732ff`.
Build and seal it for the host's platform. Keep both immutable runtime roots, their
digests, the installation receipt and the schema plan through the rollback window.
`bf935080` and `1ff20dd5` use the same old registries. Their receivers lack trusted
alert provenance and their evaluators can close and deliver a replicated firing alert.

On the master, use the bridge or expanded release's CLI against the intended instance.
In the commands below, `$bridge_root` and `$target_root` are the sealed runtime roots.
Use their `packages/0/dist` directories for backend handoff. Capture the private file returned by schema preparation
as `$plan`. Review each check before the corresponding operation.

```sh
omnitron --json backend upgrade "$bridge_root/packages/0/dist" --check
omnitron --json backend upgrade "$bridge_root/packages/0/dist"
omnitron --json backend schema prepare "$target_root"
omnitron --json backend schema apply "$plan"
omnitron --json backend upgrade "$target_root/packages/0/dist" --schema-plan "$plan" --check
omnitron --json backend upgrade "$target_root/packages/0/dist" --schema-plan "$plan"
```

The bridge must be the selected and serving backend for schema preparation and application.
Application requires a current recovery certificate. The master records the exact old history,
new migration checksum, runtime digests and database identity. PostgreSQL 018 preserves ambiguous
historical `annotations.node` as an unverified report and keeps it outside automated delivery.
The master can roll its backend back with `backend upgrade "$bridge_root/packages/0/dist" --schema-plan "$plan" --check`
and then the same command without `--check`. Keep the expanded schema and the receipt.
The bridge continues distinguishing local, authenticated and historically unverified alerts.

On each SQLite node first select the same platform's bridge through the ordinary backend
handoff. A managed node needs a guardian advertising `nodeStorageExpansion: 1`.
Use `backend guardian prepare "$bridge_root"`, check the resulting guardian plan, then apply it
if the current guardian lacks that capability. Run `backend upgrade "$target_root/packages/0/dist" --check`
and `backend upgrade "$target_root/packages/0/dist"`. Local startup applies SQLite 002. To return use
`backend upgrade "$bridge_root/packages/0/dist" --check` and `backend upgrade "$bridge_root/packages/0/dist"`.
The bridge recognizes only the reviewed future SQLite checksum and preserves events and their rule.
The enrolled-node comparison also checks the controller ledger migration bodies.
The mesh sender retains storage entries while the receiving master lacks the storage alert capability,
subject to the node's ordinary outbox retention.

The backend handoffs retain the execution owner and application processes. Before either expansion,
the original binary remains a rollback option. After expansion the supported recovery target is
the sealed bridge. A PostgreSQL receipt belongs only to that rollback runtime, and an old SQLite
binary refuses the future history row. Reverting the binary to `bf935080` after expansion would
require a separate data restoration decision involving writes made since the backup.
