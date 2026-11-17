import { describe, expect, it, vi } from 'vitest';
import { BackupRpcService } from '../../src/services/backup.rpc-service.js';
import { runWithAuth } from '../../src/services/auth-context.js';
import type { AuthService } from '../../src/services/auth.service.js';

const request = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', revision: 5, reason: 'Retain uncertainty' };
const actor = (role = 'admin') => ({ userId: 'operator', roles: [role], permissions: [], metadata: { sessionId: 'session' } });
function fixture() {
  const backups = { acknowledgeUnknownBackup: vi.fn(() => ({ state: 'unknown' })) };
  const auth = { validateSession: vi.fn<AuthService['validateSession']>() };
  return { backups, auth, rpc: new BackupRpcService(backups as never, auth) };
}

describe('unknown backup review authority', () => {
  it.each(['viewer', 'operator'])('refuses %s before the durable journal is touched', async role => {
    const f = fixture();
    await expect(runWithAuth(actor(role), () => f.rpc.acknowledgeUnknownBackup(request))).rejects.toThrow();
    expect(f.backups.acknowledgeUnknownBackup).not.toHaveBeenCalled();
  });

  it('revalidates a human session and records only its admitted identity', async () => {
    const f = fixture(); f.auth.validateSession.mockResolvedValue(null);
    await expect(runWithAuth(actor(), () => f.rpc.acknowledgeUnknownBackup(request))).rejects.toThrow();
    expect(f.backups.acknowledgeUnknownBackup).not.toHaveBeenCalled();
    f.auth.validateSession.mockResolvedValue({ id: 'operator', role: 'admin' } as never);
    await runWithAuth(actor(), () => f.rpc.acknowledgeUnknownBackup({ ...request, actor: 'forged' } as typeof request));
    expect(f.auth.validateSession).toHaveBeenCalledWith('session');
    expect(f.backups.acknowledgeUnknownBackup).toHaveBeenCalledWith(request.id, 5, 'operator', request.reason);
  });

  it('admits the verified local UDS principal without granting remote session authority on a node', async () => {
    const f = fixture(); const rpc = new BackupRpcService(f.backups as never, null);
    await expect(runWithAuth(actor(), () => rpc.acknowledgeUnknownBackup(request))).rejects.toThrow();
    await runWithAuth({ userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' } },
      () => rpc.acknowledgeUnknownBackup(request));
    expect(f.backups.acknowledgeUnknownBackup).toHaveBeenCalledWith(request.id, 5, 'omnitron-local', request.reason);
  });
});
