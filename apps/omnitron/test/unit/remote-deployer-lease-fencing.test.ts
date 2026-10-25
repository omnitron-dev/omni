import { beforeEach, describe, expect, it, vi } from 'vitest';
const lease = vi.hoisted(() => ({ confirm: vi.fn(), acquire: vi.fn() }));
vi.mock('../../src/services/node-deploy-lease.js', () => ({
  withNodeLeases: async (_targets: unknown, _purpose: unknown, _logger: unknown, work: (leases: unknown) => unknown) => {
    lease.acquire(); return work({ has: () => true, confirm: lease.confirm, unreachable: new Map() });
  },
}));
import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';
const logger: any = { info() {}, warn() {}, error() {}, debug() {}, child() { return logger; } };
const target = { host: 'leased-host', sshPort: 22 };
beforeEach(() => { vi.clearAllMocks(); lease.confirm.mockResolvedValue(undefined); });
function fixture() {
  const execution = { ssh: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }), uploadFile: vi.fn().mockResolvedValue(undefined) };
  const deployer = new RemoteDeployer(logger, execution as any); return { deployer, execution };
}
describe('RemoteDeployer lease confirmation fences later work', () => {
  it('refuses a remote command when renewal was lost before the next step', async () => {
    const { deployer, execution } = fixture();
    await deployer.underLease(target, 'host upgrade', async () => {
      lease.confirm.mockRejectedValue(Error('lease taken over'));
      await expect(deployer.runOnNode(target, 'mutate')).rejects.toThrow('lease taken over');
    });
    expect(execution.ssh).not.toHaveBeenCalled();
  });
  it('retains the confirmation capability through reentrant operations without acquiring twice', async () => {
    const { deployer, execution } = fixture();
    await deployer.underLease(target, 'platform', () => deployer.underLease(target, 'framework', async () => {
      await deployer.runOnNode(target, 'first'); lease.confirm.mockRejectedValue(Error('lost after first'));
      await expect((deployer as any).sshExec(target, 'rollback')).rejects.toThrow('lost after first');
    }));
    expect(lease.acquire).toHaveBeenCalledOnce(); expect(execution.ssh).toHaveBeenCalledOnce();
    expect(execution.ssh.mock.calls[0]?.[1]).toBe('first');
  });
  it('uses a raw data channel for lease renewal so confirmation cannot recurse', async () => {
    const { deployer, execution } = fixture();
    execution.ssh.mockResolvedValue({ exitCode: 0, stdout: Buffer.from('RENEWED').toString('hex'), stderr: '' });
    await deployer.underLease(target, 'platform', async () => {
      lease.confirm.mockRejectedValue(Error('must not recurse'));
      await expect(deployer.leaseRunner(target)('renew-script')).resolves.toBe('RENEWED');
    });
    expect(lease.confirm).not.toHaveBeenCalled(); expect(execution.ssh).toHaveBeenCalledOnce();
  });
  it('fences uploads before the transport can promote any bytes', async () => {
    const { deployer, execution } = fixture();
    await deployer.underLease(target, 'platform', async () => {
      lease.confirm.mockRejectedValue(Error('lease uncertain'));
      await expect((deployer as any).scpTransfer(target, '/local', '/remote')).rejects.toThrow('lease uncertain');
    });
    expect(execution.uploadFile).not.toHaveBeenCalled();
  });
});
