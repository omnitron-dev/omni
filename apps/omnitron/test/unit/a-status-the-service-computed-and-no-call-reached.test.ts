/** Preserve the actual schedule coverage reported by the backup owner. */
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';

import { BackupRpcService } from '../../src/services/backup.rpc-service.js';

describe('the backup commands and the service they call', () => {
  it('hands over what the service computed', async () => {
    const status = { schedules: [], stacks: [{ stack: 'sample/test', covered: false }] };
    const rpc = new BackupRpcService({ getStatus: async () => status } as never, null);
    expect(await rpc.getBackupStatus()).toBe(status);
  });
});
