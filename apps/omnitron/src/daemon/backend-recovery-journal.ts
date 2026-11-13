import fs from 'node:fs';
import path from 'node:path';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import type { ControllerGrant } from '@omnitron-dev/titan-pm';
import type { BackendBootRecord, BackendHandoffState } from './backend-handoff-types.js';
import { DaemonStateStore } from './daemon-state-store.service.js';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';

export interface BackendRecoveryRecord extends Omit<BackendBootRecord, 'state'> {
  state: Omit<BackendHandoffState, 'ticket'>;
  controller: ControllerGrant;
  runtimeHash: string;
  registryDigest: string;
}

export type BackendRecoveryState =
  | { status: 'invalid'; reason: string; at: string; reasons?: string[]; additionalReasons?: true; previous?: BackendRecoveryRecord }
  | { status: 'ready'; record: BackendRecoveryRecord; at: string };

/** Small, private FULL-synchronous journal, using the daemon's SQLite store. */
export class BackendRecoveryJournal {
  private readonly store: DaemonStateStore | null;
  private readonly inspection: import('better-sqlite3').Database | null;
  private recordedReasons = new Set<string>();
  private reasonsFull = false;
  private firstReason: string | null = null;
  private firstInvalidatedAt: string | null = null;
  constructor(readonly directory: string, options: { readOnly?: boolean } = {}) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())) throw new Error('Recovery directory must be private and owned by this user');
    const file = path.join(directory, 'recovery.db');
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try {
        const entry = fs.lstatSync(file + suffix);
        if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0 ||
            (process.getuid && entry.uid !== process.getuid())) throw new Error('Recovery state must be a private regular file');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    this.inspection = options.readOnly ? openSqliteDatabase(file, { readonly: true, fileMustExist: true }) : null;
    this.store = options.readOnly ? null : new DaemonStateStore(createNullLogger(), file);
    this.store?.initSync().pragma('synchronous = FULL');
  }

  invalidate(reason: string): void {
    if (!this.store) throw new Error('Recovery journal is read-only');
    // The original reason alone cannot describe overlapping mutations before
    // the next certificate. Persist each distinct reason once, with bounded I/O.
    const label = reason.slice(0, 256);
    if (this.reasonsFull || this.recordedReasons.has(label)) return;
    const prior = this.read();
    const previous = prior?.status === 'ready' ? prior.record : prior?.previous;
    const reasons = new Set(prior?.status === 'invalid' ? prior.reasons ?? [prior.reason] : []);
    // A journal from an older writer contains only one reason and cannot
    // prove how many mutations followed it before this process reopened it.
    const incomplete = prior?.status === 'invalid' && (prior.additionalReasons === true || prior.reasons === undefined);
    const full = reasons.size >= 16 && !reasons.has(label);
    const additional = incomplete || full;
    if (!full) reasons.add(label);
    const firstReason = this.firstReason ?? label, at = this.firstInvalidatedAt ?? new Date().toISOString();
    this.store.kvSetSync('backend.recovery', { status: 'invalid', reason: firstReason, at, reasons: [...reasons],
      ...(additional && { additionalReasons: true }), ...(previous && { previous }) });
    this.recordedReasons = reasons;
    this.reasonsFull = full;
    this.firstReason = firstReason;
    this.firstInvalidatedAt = at;
  }

  publish(record: BackendRecoveryRecord): void {
    if (!this.store) throw new Error('Recovery journal is read-only');
    this.store.kvSetSync('backend.recovery', { status: 'ready', record, at: new Date().toISOString() });
    this.recordedReasons.clear();
    this.reasonsFull = false;
    this.firstReason = null;
    this.firstInvalidatedAt = null;
  }

  read(): BackendRecoveryState | null {
    const row = (this.inspection ?? this.store!.initSync()).prepare('SELECT value FROM state_kv WHERE key = ?').get('backend.recovery') as { value: string } | undefined;
    if (!row) return null;
    const state = JSON.parse(row.value) as BackendRecoveryState;
    if (!Number.isFinite(Date.parse(state.at))) throw new Error('Invalid recovery journal timestamp');
    if (state.status === 'invalid' && typeof state.reason === 'string' &&
        (state.reasons === undefined || Array.isArray(state.reasons) && state.reasons.length > 0 && state.reasons.length <= 16 &&
          state.reasons.every(value => typeof value === 'string')) &&
        (state.additionalReasons === undefined || state.additionalReasons === true)) return state;
    if (state.status !== 'ready' || state.record?.protocol !== 1 || state.record.state?.protocol !== 1 ||
        !/^[a-f0-9]{64}$/.test(state.record.runtimeHash) || !/^[a-f0-9]{64}$/.test(state.record.registryDigest) ||
        !/^[a-f0-9]{64}$/.test(state.record.state.executionInventory) || !state.record.controller?.ownerId ||
        !state.record.controller.controllerId || !Number.isSafeInteger(state.record.controller.epoch) || state.record.controller.epoch < 1 ||
        !Number.isSafeInteger(state.record.previousPid) || state.record.previousPid < 1 ||
        !path.isAbsolute(state.record.previousEntry) || !path.isAbsolute(state.record.cwd) ||
        !state.record.daemonConfig?.executionHost?.enabled || !state.record.environment ||
        Object.values(state.record.environment).some(value => typeof value !== 'string')) throw new Error('Invalid backend recovery journal');
    return state;
  }

  async close(): Promise<void> { this.inspection?.close(); await this.store?.dispose(); }
}
