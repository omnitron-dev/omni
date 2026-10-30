import fs from 'node:fs';
import path from 'node:path';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import type { ControllerGrant } from '@omnitron-dev/titan-pm';
import type { BackendBootRecord, BackendHandoffState } from './backend-handoff-types.js';
import { DaemonStateStore } from './daemon-state-store.service.js';

export interface BackendRecoveryRecord extends Omit<BackendBootRecord, 'state'> {
  state: Omit<BackendHandoffState, 'ticket'>;
  controller: ControllerGrant;
  runtimeHash: string;
  registryDigest: string;
}

export type BackendRecoveryState =
  | { status: 'invalid'; reason: string; at: string; previous?: BackendRecoveryRecord }
  | { status: 'ready'; record: BackendRecoveryRecord; at: string };

/** Small, private FULL-synchronous journal, using the daemon's SQLite store. */
export class BackendRecoveryJournal {
  private readonly store: DaemonStateStore;
  private invalid = false;
  constructor(readonly directory: string) {
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
    this.store = new DaemonStateStore(createNullLogger(), file);
    this.store.initSync().pragma('synchronous = FULL');
  }

  invalidate(reason: string): void {
    // One durable invalidation suffices until another snapshot is published.
    if (this.invalid) return;
    const prior = this.read();
    const previous = prior?.status === 'ready' ? prior.record : prior?.previous;
    this.store.kvSetSync('backend.recovery', { status: 'invalid', reason, at: new Date().toISOString(), ...(previous && { previous }) });
    this.invalid = true;
  }

  publish(record: BackendRecoveryRecord): void {
    this.store.kvSetSync('backend.recovery', { status: 'ready', record, at: new Date().toISOString() });
    this.invalid = false;
  }

  read(): BackendRecoveryState | null {
    const row = this.store.initSync().prepare('SELECT value FROM state_kv WHERE key = ?').get('backend.recovery') as { value: string } | undefined;
    if (!row) return null;
    const state = JSON.parse(row.value) as BackendRecoveryState;
    if (!Number.isFinite(Date.parse(state.at))) throw new Error('Invalid recovery journal timestamp');
    if (state.status === 'invalid' && typeof state.reason === 'string') return state;
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

  async close(): Promise<void> { await this.store.dispose(); }
}
