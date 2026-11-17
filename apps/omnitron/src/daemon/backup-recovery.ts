import path from 'node:path';
import fs from 'node:fs/promises';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { RuntimeInstallation } from './runtime-installation.js';
import { readManagedRuntime } from './managed-runtime.js';
import { ExecutionJournal } from './execution-journal.js';
import { withOwnerBootFence, assertCleanManagedShutdown } from './owner-reconciliation.js';
import { assertResidentServicesStopped } from '../commands/service-resident.js';
import { DaemonStateStore } from './daemon-state-store.service.js';
import { RecoveryState } from './recovery-state.js';
import { OperationJournal, assertBackupReviewRuntime } from '../execution/operation-journal.js';
import type { OperationReceipt } from '../shared/dto/execution-operations.js';

/** Repair admission on a controller predating the RPC. This command never stops
 * services: the ordinary managed shutdown and its native proof are prerequisites. */
export async function acknowledgeStoppedBackup(id: string, revision: number, reason: string): Promise<OperationReceipt> {
  const installation = await RuntimeInstallation.open(undefined, { existing: true });
  if (!installation) throw Error('Offline backup review requires an installed managed instance');
  try {
    return await installation.exclusive(async () => {
      if (installation.activation()) throw Error('A runtime activation is unfinished; recover it before offline backup review');
      const selection = installation.selection();
      if (!selection) throw Error('Select the reviewed backup-capable runtime before acknowledging an unknown backup');
      const selected = await installation.artifact(selection.current);
      await assertBackupReviewRuntime(selected.directory);
      const config = await readManagedRuntime(installation.home);
      if (!config) throw Error('Offline backup review requires independent managed supervision');
      return withOwnerBootFence(config, async () => {
        assertResidentServicesStopped(config.scope);
        const execution = await new ExecutionJournal(path.join(config.directory, 'controller.json')).read();
        if (!execution) throw Error('No recorded execution owner is available');
        await assertCleanManagedShutdown(config, { pid: execution.owner.pid, lifetime: null }, []);
        const dbPath = path.join(installation.home, 'data/daemon-state.db');
        const metadata = await fs.lstat(dbPath);
        if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || !process.getuid || metadata.uid !== process.getuid())
          throw Error('Offline backup review requires the existing private instance database');
        const store = new DaemonStateStore(createNullLogger(), dbPath);
        try {
          return new OperationJournal(store, new RecoveryState()).acknowledgeUnknownBackup(id, revision, `local-uid:${process.getuid()}`, reason);
        } finally { await store.dispose(); }
      });
    });
  } finally { await installation.close(); }
}
