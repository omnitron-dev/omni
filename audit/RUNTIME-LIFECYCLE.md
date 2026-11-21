# Runtime lifecycle audit

17 November 2026. Scope: local runtime update, its existing native recovery paths
and the boundary with backup admission. Source changes described as implemented
are development changes; this document is not an activation or release receipt.
The broader execution architecture is in [AUTOMATION-ARCHITECTURE.md](./AUTOMATION-ARCHITECTURE.md).

## Authority and responsibility

| Boundary | Owner and source of truth | Required invariant |
| --- | --- | --- |
| Build and operator workflow | Xec `update local-sync`; sealed runtime manifest | Reuse verified immutable artifacts. Xec delegates lifecycle; it does not stop native services itself. |
| One local transition | `daemon/runtime-update.ts`; private plan, kernel lock and current receipt | Persist intent before each native effect. A lost response does not grant another start. |
| Installation selection | `daemon/runtime-installation.ts`; private SQLite registry and lease | Selection revision, artifact identity and unfinished activation remain fenced. Read-only inspection cannot claim or clear a lease. |
| Application processes | Execution owner and its operation journal | One owner, exact process lifetime and generation, complete inventory. Backend replacement does not transfer application ownership. |
| Native supervision | Guardian and existing supervisor transaction | A restoration binds the original guardian transaction and resumes it; it cannot manufacture a second transition. |
| Launch policy | Project registry and private `RuntimeRestartConfiguration` | Preserve effective definitions, environment, order, source watches and release pins. Stored bytes and semantic intent prove different things. |
| Backup effects | BackupService and execution operation receipts | Only exact owned attempts may be cancelled; uncertainty retains claims and history. Schedule policy is not evidence of a completed backup. |
| Console publication | Instance WebappService, reviewed release and native Docker identity | The cold controller selects the reviewed artifact. Local start uses the serving daemon's publication policy. Independent stop verifies Docker ownership. |
| Acceptance | `daemon/runtime-update-host.ts`; complete independent observation | Owner readiness alone is insufficient: verify roles, applications, launches, Console, source watches and native containers before committing acceptance. |

These boundaries are not interchangeable. The update receipt orchestrates the
existing owners; it must not duplicate their effect journals. A daemon status
report can expose an active owner while the backend is still restoring its own
watches and recovery certificate.

## Corrected causes

### A restoring controller and CLI both created the same Console

The bridge controller could start its own nginx while the update host launched
the previous Console through a different CLI. The bridge now reads the exact
Console artifact and commit from the private receipt. On restoration it mounts
that release before the warm backend and guardian handoffs. An OFF review has
no Console start. The host verifies the published HTTP build and full native
container ID independently.

Manual start, offline stop, instance configuration writes and admission share
the instance policy lock. Image preparation and source compilation finish
before a writer enters the lock. The Docker creator can recover a lost reply
using its own creation nonce. A matching name, spec and instance alone cannot
take ownership of a competing creation.

The supported control path uses Xec's macOS/Linux kernel file lock.
`daemon/daemon.ts` and `daemon/daemon-client.ts` register Titan's Unix socket
transport. Titan's `netron/transport/unix-transport.ts` supplies a separate
`NamedPipeTransport` for Windows, and `daemon/execution-platform.ts` explicitly
requires owner-only Unix sockets for resident execution. Instance configuration
can still be initialized on other operating systems.

The Console lifecycle tests exercise competing requests, separate retained
artifacts, disabled startup, broken artifacts, HTTP build drift and offline
stop. The Docker execution tests distinguish a lost creation reply from a
different creator with the same specification. The recovery tests run the
sealed cold controller's preflight without a serving backend and check that an
unsupported restoration preserves the candidate.

### Native Console allocation used to extend the application outage

An OrbStack create can continue after its client times out. A qualification of
the released Console observed a newly visible container in `Created` after the
60-second caller had already reported absence. A separate native measurement
took 78.10 seconds to create, 8.13 seconds to start by full ID and 86.29 seconds
to serve the reviewed HTTP build. A longer timeout inside cold startup still
left the applications down throughout allocation.

For a target advertising `preparedConsoleProtocol: 1`, the read-only review
captures the serving container's full ID, publication address and port, and the
device, inode and SHA-256 of its mounted nginx configuration. On reviewed apply
the host allocates one inactive nginx under a plan-specific name while the
previous Console and applications still serve. It records the creation nonce
before calling Docker. A lost reply permits discovery of that creation under
the same name. The host verifies the immutable ID, read-only mounts, image,
ownership labels, resources, configured host binding and `Created` state
before requesting backup admission. It checks the allocation and incumbent
again before issuing shutdown. The private journal records when allocation
started, when it first became ready and whether the host requested admission.
A repeated recovery checks the same native ID while retaining both timestamps.
Each new reviewed transition records its own timings.

A supervised `omnitron down` unloads the native service and can return after
the backend exits while its nginx still serves. After confirming the reviewed
processes have retired, the host checks the canonical Console name and the exact
predecessor. When the incumbent still occupies that name it records its full ID
before submitting one Docker removal. Handoff waits for native inspection to
confirm that ID disappeared and checks the name again. A lost reply leaves the
request in the private plan journal. Both forward publication and restoration
observe that same request on retry. A different ID, including one belonging to
the same instance, keeps the handoff pending.

The cold controller then renames and starts the allocated ID. It verifies the
native identity before updating the configuration through its checked file descriptor. A replay observes the
same ID and the issued native operation. The independent host acceptance also
checks the serving ID against the published allocation receipt. Health, effective port publication
and HTTP BUILD must all match. A rejected create leaves the incumbent and
applications in place. An unresolved create remains inactive and its receipt
retains the nonce until recovery can account for the outcome.

An explicit rollback preallocates the reviewed previous Console while the
candidate still serves. Its assets and original nginx configuration bytes
come from the reviewed release and private receipt. Before retiring a candidate,
the host verifies which Console actually occupies the native name. The original
reviewed ID can still serve when the forward allocation is staged in `Created`.
A candidate on the canonical name must match its allocation ID, creation nonce
and issued publication phase. A rename or start whose outcome is unknown keeps
recovery pending until native evidence settles it. A failed rollback allocation
preserves the accepted candidate.

An installed CLI containing this handoff can run `omnitron runtime update
recover <full-plan-sha256>` for an earlier interrupted preparation. It releases
the reviewed predecessor after process retirement and before issuing the cold
start, so the previously sealed starter can publish its verified allocation.
The current receipt records whether a restoration has already been issued.
An issued process start continues through the existing observation path.
Legacy transactions and targets without the capability use the original
cold-start contract.

A permanent nginx with a switchable directory would require a different mount
layout. Existing releases bind the exact immutable asset directory and derive
the rollback release from that physical path. The handoff handles both a
shutdown which removed the old container and a shutdown which preserved it.

`test/integration/console-preallocation.test.ts` runs the update coordinator
and cold WebappService with a controlled Docker boundary, a loopback HTTP
server, sealed asset trees and two OS application processes. It checks their
PIDs during delayed refusal, loss of create/remove/rename/start replies,
substitution of a native identity, changed configuration content or inode,
supervised shutdown with a serving nginx, and rollback with an incumbent or
a published candidate on the canonical name.

An isolated OrbStack run used the shipped bf935080 and 7a59d5a0 Console
assets on one loopback port. The inactive successor took 52.143 seconds to
allocate. All 127 HTTP probes of the old build succeeded and both test
application PIDs stayed alive throughout. Docker reported the reviewed host
binding, zero start time and no effective ports for the successor before
admission. The test discarded create, rename and start acknowledgements and
delayed the native start. The controller accepted the same full ID and
verified the new HTTP BUILD and entry JavaScript bytes. Retiring the previous
test container through HTTP and asset acceptance took a further 75.988 seconds.

### Owner polling and update admission repeatedly transferred historical log lines

The resident owner used to copy up to 1,000 raw lines per application into
each execution snapshot. The controller polls every second. Recovery,
handoff, process inventory checks and mutation replies also used this snapshot.
A read on 21 November 2026 with seven serving applications took 25 ms. Its
UTF-8 JSON projection occupied 1,253,659 bytes, including 1,227,699 bytes of
raw log tails spanning 3,528 lines. The live transport uses MessagePack.

These readers now request `appLogTails: 'on-demand'`. A supporting owner omits
the raw ring property from each application and identifies the representation
in the response. It still reports the worker and application identities,
inventory digest, stderr evidence from the last exit, persistence and log-sink
health, outstanding events, dropped-event count, cursors and journal status.
An explicit private ring read asks the owner for the selected application
and line count. Public `omnitron logs` continues to query captured records
and stored history through the daemon.

Durable delivery still reads pending journal records and acknowledges their
IDs and digests after the controller persists them. Owners without a journal
send log events through the event cursor. The controller reports their legacy
delivery semantics and withholds acknowledgment when persistence fails.
An older controller receives the full snapshot by default. An older owner
ignores the new request and returns its rings, which the new controller can
read synchronously. The transfer saving begins when both parties support the
request. The request adds no owner-upgrade prerequisite to recovery.

An isolated measurement seeded seven real `AppHandle` rings with 504 test
lines of 344 bytes each and retained one pending log and one event. Across 25
interleaved pairs of private Unix RPC calls, Netron serialized 1,228,763
MessagePack payload bytes for the full snapshot and 4,513 for the inventory.
A proxy counted 1,228,772 and 4,522 response bytes on the socket. The median
round trips were 26.27 ms and 0.85 ms. With the staged d52ccdde owner, both
request forms transferred 1,228,878 bytes. Each pairing of old and new owners
and controllers returned the two requested historical lines. An independent
run with the older 1ff20dd5 release also passed all four pairings.

`test/unit/execution-inventory.test.ts` covers both response forms, explicit
raw tails, public log reads without a journal, gaps in the bounded event
history, missing legacy rings, failed persistence and replay.
`test/runtime/execution-host.mjs` exercises the ordinary resident owner,
native Unix transport, stored durable records and handoff fencing.

### Observation metadata was treated as authorization

`project/runtime-restart.ts` previously used the complete serialized snapshot
both for stored-file integrity and for restart intent. `ProjectService` retains
project `loadedAt`, so loading identical declarations changed the authorization
digest. This caused a new review without any meaningful change to the restart.

`restartConfigurationDigest` continues to cover all stored bytes.
`restartIntentDigest` removes only `projects[*].loadedAt`. Preparation retains
the reviewed private snapshot reference when intent is unchanged; admission
passes a fresh complete digest to the incumbent controller and compares the
returned semantic intent. No ordered configuration list is sorted. Owner,
inventory, registry, launch definitions, environment and release changes still
invalidate the review. A changed file under an old snapshot digest is rejected.

Oracle: `test/unit/runtime-restart-configuration.test.ts` distinguishes identical
intent with a later load time, changed launch authority and corrupted stored bytes.

### Acceptance waited for only part of the system

The old host observer retried the status/application phase, then performed
retained launch and cold infrastructure checks once outside that loop. A new
backend's own startup lease or `setWatchMode` could therefore turn an ordinary
startup interval into a failed transition after the roles were already serving.

Acceptance now contains the complete verification in one observation scope:

| Result | Behaviour |
| --- | --- |
| `RuntimeObservationPending` | Retry read-only observation within the same deadline. A serialized startup lease is retryable only when its PID matches the independently observed serving backend. |
| `RuntimeObservationConflict` | Stop observation immediately when verified evidence differs from the reviewed intent. Existing recovery still requires native retirement evidence. |
| `RuntimeObservationUnconfirmed` | Preserve `recovery-required`; do not infer that the serving candidate failed and do not automatically retire it. |
| `RuntimeObservationTimeout` | The same unconfirmed outcome, with an expired total budget. A late completion cannot publish acceptance. |

The 15-minute ceiling is a maximum observation budget, not a prescribed pause.
Successful complete evidence returns immediately. CLI execution and HTTP probes
receive cancellation and remaining time; private RPC requests receive remaining
time. Read-only reconciliation is also bounded and never repeats a lifecycle
effect. No error message matching decides whether a failure is transient.

Oracles: `test/unit/runtime-observation.test.ts` checks a late final-stage pending
result, hard conflicts, a stalled leaf and late success, decreasing leaf budgets
and expiry while sleeping. `test/unit/runtime-installation.test.ts` verifies the
typed startup lease without allowing malformed leases or unfinished activation.
`test/unit/backup-operation-lifecycle.test.ts` preserves the distinction between
a read-only backup review and a strict idle certificate.

### Observation failure could initiate another interruption

The update transaction formerly sent every acceptance exception into automatic
recovery. A lost read is not evidence that another stop/start is needed. The
host now distinguishes incomplete observation from a verified mismatch; an
unconfirmed observation saves `recovery-required` without retirement. Existing
`runtime update reconcile` verifies the complete serving state and commits
acceptance without another start. `recover` remains an explicit restoration path.

Oracle: `test/runtime/runtime-update.test.mjs` records one stop and one start,
injects expiry or a lost read, and proves no rollback is attempted. Reconciliation
then accepts the candidate with those counts unchanged. Existing interruption,
lease, generation, health-floor and repeated-recovery checks remain in the suite.

## Durable backup admission

`services/backup.service.ts` previously held `quiescing` and `handoffOwner` only
in memory while `daemon.ts` unconditionally restored schedules in the next
backend. An overdue dump could begin during acceptance or restoration and
contend with the update's certificate. This was a cross-process admission gap,
not a reason to remove backup verification.

The corrected service derives admission from the validated native current
receipt and instance. Every nonterminal phase holds schedules and new effects,
including `recovery-required`. After `accepted`, `rolled-back` or `aborted` is
persisted, one scoped scheduler observer resumes the unchanged saved schedules.
Only a held or unreadable receipt needs a one-second recheck. No release RPC,
second journal or persisted pause flag exists, so losing a terminal CLI reply
does not require another operator action to restore scheduling.

Admission is counted as in-flight before awaiting its receipt read. It rechecks
the local handoff fence afterwards, and database effects recheck the durable
receipt after asynchronous target discovery. A timer armed just before a new
transition cannot bypass the fresh effect gate. Disposal closes local admission
and the observation scope before clearing timers; a late read cannot re-arm them.

A previously observed hold cannot disappear silently. A missing or malformed
receipt produces a visible `unconfirmed` status and keeps schedules unarmed.
If a different terminal digest is observed, the held digest's retained history
must prove its terminal state before release. Unknown operation claims remain
owned by the execution journal even after the runtime update is accepted.

Oracles in `test/unit/backup-operation-lifecycle.test.ts`: every nonterminal phase;
each terminal phase without a release notification; repeated restoration without
resetting an armed timer; stale terminal receipt against a newer hold;
missing/corrupt/dangling receipt; disposal during a blocked read; transition
beginning during Docker target discovery; unknown claims surviving acceptance.
The existing schedule-cadence and artifact handoff suites continue to cover
deadline calculation, serialization and full-pass retention ownership.

## Repeated artifact work

The preparation audit traced at least eight full SHA-256 content walks from a
fresh seal through first installation, before later cold previews. The count
includes sealing, the parent Xec verifier, CLI target admission, host action
construction, source installation, staging and post-rename admission. Each full
verification also walks metadata to detect a changed early file. These are I/O
costs, not repeated test suites. Isolated checkout cleanup alone took 111.1 seconds
in the recorded `365ce68a` preparation; other stage costs were not individually
measured and must not be inferred from that number.

The host now retains the original `inspectRuntimeArtifact` proof with its frozen
target reference. Action construction and the installed-target branch reuse it
only for the same physical tree in the same process. They check the complete
inventory instead of hashing the same bytes again. A private WeakMap prevents a
deserialized path/digest object from claiming that proof. Metadata drift
invalidates reuse even after the original contents are restored. A distinct
copy and another process still require independent verification.

Graph materialization bounds concurrency to four packages, keeps each package's
overlapping publication paths ordered and admits physical destinations before
copying. An application root completes before its nested dependency packages.
All package copies must succeed before dependency links are created. Installation
flushes regular files in groups of at most 16, then flushes child directories
before their parents. Both paths join admitted I/O before returning a failure,
so cleanup cannot race unfinished copies or open file handles.

Oracles: `test/runtime/runtime-update-cli.test.mjs` proves that host construction
does not reread candidate contents and refuses forged or invalidated references.
`test/unit/bundled-framework.test.ts` covers bounded parallel copies, failed-batch
drain, real cyclic/peer dependency bindings and nested application closures.
`test/unit/runtime-installation.test.ts` checks descriptor bounds, descendant-first
durability, fsync failure, cleanup ordering and independently corrupted copies.
The existing same-size rewrite, restored mtime, link and physical-root replacement
tests in `runtime-artifact-snapshot.test.ts` remain applicable.

This does not remove all duplicate work. The seal still hashes before and after
writing its manifest, staging is verified again after its own rename, and checkout
cleanup previously blocked preparation. Xec now overlaps read-only preparation
with cleanup only after publishing and verifying the runtime outside its checkout.
Both steps are joined before success; build, preparation and cleanup failures
retain their causes and do not delete the published runtime or its receipt.
Mutation paths remain sequential. The final command output follows the join,
so a successful receipt cannot hide a failed cleanup. Tests in
`scripts/ci/xec-update.test.mjs` cover overlap, independent failures, failure drain,
retained runtime and the absence of activation after failed cleanup.

Eliminating the remaining seal/rename rehashes requires ownership of the exact
manifest write/rename. A persistent "already verified" flag would not satisfy
that contract.

## Remaining architectural gaps

### Other lifecycle waits still conflate failure and waiting

The older `until` helper in `runtime-update-host.ts` remains on native shutdown
and intermediate restoration paths. It retries generic exceptions and measures
its budget after a leaf returns. The complete acceptance path no longer uses
it, but the whole update cannot yet claim uniform deadlines or typed outcomes.
Each remaining observer needs a domain-specific pending/conflict result and a
shared remaining budget. Effecting start/stop calls must not be put into a retry
loop to achieve that change.

### A caller timeout does not prove that work terminated

Private Netron connection/disconnection and some native inventory readers have
their own bounds and may finish after the acceptance observer expires. They are
read-only here, so expiry cannot authorize a new effect or a late acceptance.
This is not structured cancellation of the underlying operation. The shared
transport/execution layer needs an explicit task scope which joins cleanup,
preserves cleanup failures and keeps an unknown outcome when termination cannot
be proved. Duplicating that scope inside each Omnitron command would recreate
the same inconsistency.

### Intent and health are still observed across several calls

Owner snapshots and native identity checks retain their own fences, but the
complete acceptance is not a single atomic snapshot of the machine. A future
consolidated observation should bind a controller grant/configuration revision
before and after its read set. It must reuse the owner/operation journal's
existing fences rather than add a second lock protocol or infer stability from
timestamps. Performance work must preserve this distinction: cache immutable
artifact proofs; refresh process identity and live authority.

## Documentation and qualification boundary

`apps/omnitron/HOST-UPGRADES.md` documents the implemented local lifecycle.
Website pages `docs/omnitron/cli.md`, `docs/omnitron/backend-handoff.md` and
`docs/community/contributing.md` carry the same reconciliation, intent and
observation contracts. Site deployment and runtime activation are separate
operations. These changes were qualified with focused tests, types and lint;
no working application or Atlas process was restarted by this audit.
