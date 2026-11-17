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
| Acceptance | `daemon/runtime-update-host.ts`; complete independent observation | Owner readiness alone is insufficient: verify roles, applications, launches, Console, source watches and native containers before committing acceptance. |

These boundaries are not interchangeable. The update receipt orchestrates the
existing owners; it must not duplicate their effect journals. A daemon status
report can expose an active owner while the backend is still restoring its own
watches and recovery certificate.

## Corrected causes

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

## Remaining architectural gaps

### Backup admission does not survive backend replacement

`services/backup.service.ts` stores `quiescing` and `handoffOwner` in memory.
`daemon.ts` restores schedules when the next backend initializes. A reviewed
pause therefore ends when the old backend dies, before the whole local update
has been accepted. An overdue scheduled dump can begin during acceptance or
restoration and contend with its certificate. This is a missing cross-process
admission contract, not a reason to remove backup verification.

Proposed correction, not implemented in this batch:

1. Derive the hold from the validated current local update receipt and its
   instance/digest. Do not add a separate pause file or another journal.
   Every nonterminal phase retains the hold, including `recovery-required`.
2. The starting backend checks this admission before arming restored schedules
   and before admitting manual backup effects. Persisted schedule definitions,
   completed archives and unknown operation claims remain unchanged.
3. Terminal `accepted`, `rolled-back` or `aborted` receipts release only their
   own digest. Perform terminal persistence before notifying the current backend.
   The release operation reads the current receipt again, so a stale notification
   cannot release a newer transition's hold.
4. Reconcile admission during backend startup and ordinary scheduler service
   reconciliation. A lost terminal notification must not leave schedules paused
   forever. Repeated notification is observation, not another backup attempt.
5. Before shutdown, keep the existing exact backup cancellation/release protocol.
   After replacement, release must address the current backend and authoritative
   receipt; requiring the retired backend PID would make recovery impossible.

Required oracles: crash before/after terminal persistence; lost release reply;
backend boot in every nonterminal phase; accepted and rolled-back release;
stale digest against a newer hold; corrupt receipt; unchanged user schedules;
unknown backup claims still blocking admission; no duplicate overdue backup.
The implementation must establish these before claiming a durable pause.

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
