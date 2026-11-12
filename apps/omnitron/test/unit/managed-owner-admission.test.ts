import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { OmnitronDaemon } from '../../src/daemon/daemon.js';
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';
import { attestManagedOwnerBuild } from '../../src/daemon/managed-owner-build.js';
import type { BuildStamp } from '../../src/shared/build-stamp.js';

vi.mock('../../src/daemon/managed-owner-build.js', () => ({ attestManagedOwnerBuild: vi.fn() }));
const owner = { id: 'owner-1', pid: 3728, startedAt: '2026-11-02T10:07:16.000Z' };
const expected = { owner, epoch: 8 };
const stamp = { commit: 'a'.repeat(40), dirty: false, builtAt: '2026-11-02T10:00:00.000Z' };
const different = { ...stamp, commit: 'b'.repeat(40) };
const snapshot = () => ({ status: { phase: 'active', controller: { controllerId: 'controller', epoch: 8 }, owner } });
const native = vi.mocked(attestManagedOwnerBuild);
beforeEach(() => native.mockReset().mockResolvedValue(stamp));

function fixture() {
  const execution = { controllerId: 'controller', controlledOwnerSnapshot: vi.fn(async (): Promise<ReturnType<typeof snapshot> & { ownerBuild?: BuildStamp | null }> => snapshot()) };
  const daemon = Object.create(OmnitronDaemon.prototype) as OmnitronDaemon;
  Object.assign(daemon, { execution, supervision: { type: 'independent' } });
  return { daemon, execution };
}

describe('application release admission using a supervised legacy owner', () => {
  it('keeps native owner attestation scoped to authenticated operators', () => {
    expect(Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, DaemonRpcService.prototype, 'attestApplicationOwner')?.roles)
      .toEqual(['admin', 'operator', 'service_role']);
  });

  it('coalesces overlapping native verification, takes a new proof for each later admission and never retains a completed proof', async () => {
    const { daemon, execution } = fixture();
    const pending = Promise.withResolvers<BuildStamp>();
    native.mockImplementationOnce(() => pending.promise);
    const one = daemon.attestApplicationOwner(expected), two = daemon.attestApplicationOwner(expected);
    await vi.waitFor(() => expect(native).toHaveBeenCalledTimes(1));
    await expect(daemon.attestApplicationOwner({ ...expected, epoch: 9 })).rejects.toThrow('Another owner');
    pending.resolve(stamp);
    await expect(Promise.all([one,two])).resolves.toEqual([stamp,stamp]);
    expect(execution.controlledOwnerSnapshot).toHaveBeenCalledTimes(2);
    await expect(daemon.attestApplicationOwner(expected)).resolves.toEqual(stamp);
    expect(native).toHaveBeenCalledTimes(2);
  });

  it('refuses a PID, birth, controller epoch or owner change before or after a native seal verification', async () => {
    const { daemon, execution } = fixture();
    await expect(daemon.attestApplicationOwner({ ...expected, owner: { ...owner, pid: owner.pid+1 } })).rejects.toThrow('changed');
    await expect(daemon.attestApplicationOwner({ ...expected, owner: { ...owner, startedAt: 'earlier' } })).rejects.toThrow('changed');
    expect(native).not.toHaveBeenCalled();
    execution.controlledOwnerSnapshot.mockRejectedValueOnce(Error('Application owner or controller changed during admission'));
    await expect(daemon.attestApplicationOwner(expected)).rejects.toThrow('changed');
    expect(native).not.toHaveBeenCalled();
    execution.controlledOwnerSnapshot.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(Error('Application owner or controller changed during admission'));
    await expect(daemon.attestApplicationOwner(expected)).rejects.toThrow('changed');
    execution.controlledOwnerSnapshot.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(Error('Application owner or controller changed during admission'));
    await expect(daemon.attestApplicationOwner(expected)).rejects.toThrow('changed');
    native.mockRejectedValueOnce(Error('Native executable changed'));
    await expect(daemon.attestApplicationOwner(expected)).rejects.toThrow('executable changed');
  });

  it('honors self-reported stamps and refuses absence, dirtiness or disagreement without substituting an OS result', async () => {
    const { daemon, execution } = fixture();
    execution.controlledOwnerSnapshot.mockResolvedValueOnce({ ...snapshot(), ownerBuild: different });
    await expect(daemon.attestApplicationOwner(expected)).resolves.toEqual(different);
    for (const ownerBuild of [null, { ...stamp, dirty: true }]) {
      execution.controlledOwnerSnapshot.mockResolvedValueOnce({ ...snapshot(), ownerBuild });
      await expect(daemon.attestApplicationOwner(expected)).rejects.toThrow('clean');
    }
    expect(native).not.toHaveBeenCalled();
    execution.controlledOwnerSnapshot.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce({ ...snapshot(), ownerBuild: different });
    await expect(daemon.attestApplicationOwner(expected)).rejects.toThrow('different build');
    Object.assign(daemon,{ supervision:null });
    await expect(daemon.attestApplicationOwner(expected)).rejects.toThrow('independent OS supervision');
  });

});
