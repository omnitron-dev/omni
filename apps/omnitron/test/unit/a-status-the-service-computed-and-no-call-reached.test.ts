/**
 * A status the service computed and no call reached.
 *
 * `BackupService.getStatus()` answers each schedule's last pass and next run,
 * and which stacks this host backs up at all — and nothing on the RPC surface
 * called it, so `backup schedules` and `backup list` printed «unknown» where
 * the daemon knew the answer (the CLI asks through `invokeOptionalRpc`, which
 * reads «Unknown member» as «this daemon does not report it»).
 *
 * Every method the backup commands ask the daemon for must exist on the RPC
 * service they reach.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'reflect-metadata';

import { BackupRpcService } from '../../src/services/backup.rpc-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('the backup commands and the service they call', () => {
  it('ask for nothing the service does not answer', () => {
    const cli = fs.readFileSync(path.join(here, '../../src/commands/backup.ts'), 'utf8');
    const asked = new Set([...cli.matchAll(/invoke(?:Optional)?Rpc\(\s*'(\w+)'/g)].map((m) => m[1]!));
    expect(asked).toContain('getBackupStatus');

    const answered = new Set(Object.getOwnPropertyNames(BackupRpcService.prototype));
    const missing = [...asked].filter((m) => !answered.has(m));
    expect(missing, 'asked of the daemon and answered by nothing').toEqual([]);
  });

  it('hands over what the service computed', async () => {
    const status = { schedules: [], stacks: [{ stack: 'daos/test', covered: false }] };
    const rpc = new BackupRpcService({ getStatus: async () => status } as never);
    expect(await rpc.getBackupStatus()).toBe(status);
  });
});
