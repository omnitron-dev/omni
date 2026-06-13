/**
 * RETIRED (quarantined) — adversarial torn-write for the OLD StateStore.
 *
 * This spec pinned the pre-T-7 StateStore recipe: write tmp file → fsync →
 * rename, with `flaky-fs.ts` fault-injecting `fs.writeFileSync` / `renameSync`
 * to prove a SIGKILL mid-write never left a torn `state.json`.
 *
 * That storage mechanism NO LONGER EXISTS. T-7 migrated StateStore onto a
 * SQLite-backed DaemonStateStore (WAL), so:
 *   - `new StateStore(path)` is gone — it now takes a DaemonStateStore.
 *   - `save()` is fire-and-forget and never throws synchronously, so the
 *     `expect(() => save()).toThrow()` assertions can't hold.
 *   - the `flaky-fs` harness patches fs syscalls the SQLite path never calls,
 *     so the fault injection is inert here regardless.
 *
 * Durability of the new path (a fresh store recovers the FULL prior payload
 * after a flush — the property this spec really protected) is covered in
 * `test/unit/state-store.test.ts` → "SQLite durability". A sharper
 * kill-mid-transaction adversarial test belongs at the DaemonStateStore /
 * SQLite layer; tracked as a follow-up (see the audit task list). This file is
 * skipped rather than deleted so the lost coverage stays visible.
 */

import { describe, it } from 'vitest';

describe.skip('StateStore — adversarial torn-write (RETIRED: pre-SQLite, see state-store.test.ts)', () => {
  it('superseded by SQLite WAL atomicity + state-store.test.ts durability coverage', () => {
    // Intentionally empty — see file header. Re-implement against DaemonStateStore
    // (kill mid better-sqlite3 transaction) if SQLite-layer crash-safety needs pinning.
  });
});
