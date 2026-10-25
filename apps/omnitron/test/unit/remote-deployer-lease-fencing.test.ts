import { beforeEach, describe, expect, it, vi } from 'vitest';
const lease = vi.hoisted(() => ({ confirm: vi.fn(), acquire: vi.fn(), guard: vi.fn((_node: string, command: string) => `guarded:${command}`) }));
vi.mock('../../src/services/node-deploy-lease.js', () => ({
  withNodeLeases: async (_targets: unknown, _purpose: unknown, _logger: unknown, work: (leases: unknown) => unknown) => {
    lease.acquire(); return work({ has: () => true, confirm: lease.confirm, guard: lease.guard, unreachable: new Map() });
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
    expect(execution.ssh.mock.calls[0]?.[1]).toBe('guarded:first');
    expect(lease.guard).toHaveBeenCalledWith('leased-host:22', 'first', 600000);
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

it('guards the actual upload promotion after bulk transfer and refuses a lease lost during transfer', async () => {
  const { deployer, execution } = fixture();
  execution.uploadFile.mockImplementation(async (_ssh: any, _source: any, _destination: any, options: any) => {
    lease.confirm.mockRejectedValue(Error('lost during bulk upload'));
    await options.runControl('promote unique temporary bytes', 30000);
  });
  await expect(deployer.underLease(target, 'platform', () => deployer.uploadToNode(target, '/local', '/remote'))).rejects.toThrow('lost during bulk upload');
  expect(execution.ssh).not.toHaveBeenCalled();
});
it('passes the execution fence and cleanup budget to the transport for guarded promotion', async () => {
  const { deployer, execution } = fixture();
  execution.uploadFile.mockImplementation(async (_ssh: any, _source: any, _destination: any, options: any) => options.runControl('verify and promote', 30000));
  await deployer.underLease(target, 'platform', () => deployer.uploadToNode(target, '/local', '/remote'));
  expect(execution.ssh).toHaveBeenCalledWith(expect.anything(), 'guarded:verify and promote', { timeout: 75000 });
});

it('publishes the immutable asset pool through the native lease and guarded command', async () => {
  const { deployer, execution } = fixture();
  vi.spyOn(deployer, 'assertNoPendingHostOperations').mockResolvedValue(undefined);
  const receipt = { assetsRoot: '/opt/omnitron/stack-static/assets/project/stack/app/public', manifestSha256: 'a'.repeat(64), files: 1, added: 1, reused: 0, bytes: 4 };
  execution.ssh.mockResolvedValue({ exitCode: 0, stdout: JSON.stringify(receipt), stderr: '' });
  expect(await deployer.carryPreviousBuildForward(target, { owner: { project: 'project', stack: 'stack', app: 'app' }, sources: [{ root: '/release/assets', files: { 'a.js': 'b'.repeat(64) } }] })).toEqual(receipt);
  expect(lease.acquire).toHaveBeenCalledOnce();
  expect(execution.uploadFile).toHaveBeenCalledOnce();
  expect(execution.ssh.mock.calls[0]?.[1]).toMatch(/^guarded:node -e /);
  expect(lease.guard).toHaveBeenCalledWith('leased-host:22', expect.stringContaining('Immutable assets:'), 300000);
});
it('does not publish asset bytes when the lease is lost after manifest upload', async () => {
  const { deployer, execution } = fixture();
  vi.spyOn(deployer, 'assertNoPendingHostOperations').mockResolvedValue(undefined);
  execution.uploadFile.mockImplementation(async () => { lease.confirm.mockRejectedValue(Error('lost before asset publication')); });
  await expect(deployer.carryPreviousBuildForward(target, { owner: { project: 'project', stack: 'stack', app: 'app' }, sources: [{ root: '/release/assets', files: { 'a.js': 'b'.repeat(64) } }] })).rejects.toThrow('lost before asset publication');
  expect(execution.ssh).not.toHaveBeenCalled();
});
