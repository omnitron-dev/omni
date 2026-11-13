import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ execute: vi.fn(), dispose: vi.fn(), engines: vi.fn(), inspect: vi.fn(), remove: vi.fn() }));
vi.mock('@xec-sh/core', () => ({
  DockerAdapter: class {
    async listImages() { return ['example/service:1']; }
    async listContainers() { return ['sample-service']; }
    inspectContainer = native.inspect;
    removeContainer = native.remove;
  },
  ExecutionEngine: class {
    constructor(options: unknown) { native.engines(options); }
    execute = native.execute;
    dispose = native.dispose;
  },
}));
import { createContainer } from '../../src/infrastructure/container-runtime.js';
import type { ResolvedContainer } from '../../src/infrastructure/types.js';
const config = (): ResolvedContainer => ({
  name: 'sample-service', image: 'example/service:1', ports: [], volumes: [], labels: {}, restart: 'no', critical: false,
  environment: { RPC_PASSWORD: 'environment-secret' },
  command: ['--rpc-login', 'service:rpc-secret'],
  healthCheck: { test: ['CMD-SHELL', 'curl --user "service:health secret" http://localhost/health'] },
});
beforeEach(() => { vi.clearAllMocks(); native.execute.mockResolvedValue({ stdout: 'abcdef1234567890'.repeat(4) + '\n' }); });
describe('container execution security boundary', () => {
  it('uses the Xec local argv executor with bounded execution and shared diagnostics', async () => {
    expect(await createContainer(config())).toBe('abcdef123456');
    expect(native.engines).toHaveBeenCalledWith(expect.objectContaining({ defaultShell: false, enableEvents: false }));
    expect(native.execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'docker', adapter: 'local', shell: false, timeout: 60_000, maxBuffer: 1024 * 1024,
      args: expect.arrayContaining(['--rpc-login', 'service:rpc-secret', '--health-cmd',
        'curl --user "service:health secret" http://localhost/health']),
    }));
    expect(native.dispose).toHaveBeenCalledOnce();
  });
  it('never erases the occupant of a reused name during a docker run retry', async () => {
    native.execute.mockRejectedValueOnce(new Error('Conflict. The container name "/sample-service" is already in use by container "previous"'));
    native.inspect.mockResolvedValue({ Name: '/sample-service', Id: 'f'.repeat(64), State: { Status: 'running' },
      Config: { Labels: { 'omnitron.creation': 'another-operation' } } });
    await expect(createContainer(config())).rejects.toThrow('belongs to another creation');
    expect(native.remove).not.toHaveBeenCalled();
    expect(native.execute).toHaveBeenCalledOnce();
  });

  it('retries a partial creation only by its own native container ID', async () => {
    native.execute.mockRejectedValueOnce(new Error('Conflict. The container name "/sample-service" is already in use by container "previous"'));
    native.inspect.mockImplementation(async () => {
      const label = native.execute.mock.calls[0]![0].args.find((arg: string) => arg.startsWith('omnitron.creation='));
      return { Name: '/sample-service', Id: 'f'.repeat(64), State: { Status: 'created' },
        Config: { Labels: { 'omnitron.creation': label.split('=')[1] } } };
    });
    expect(await createContainer(config())).toBe('abcdef123456');
    expect(native.remove).toHaveBeenCalledWith('f'.repeat(64), true, {});
    expect(native.execute).toHaveBeenCalledTimes(2);
  });

  it('checks both port numbers and the bind address on the exact container returned by Docker', async () => {
    const id = 'abcdef1234567890'.repeat(4);
    const desired = { ...config(), ports: [{ host: 80, container: 8080, bindHost: '127.0.0.1' }] };
    native.inspect.mockResolvedValue({ Id: id, NetworkSettings: { Ports: {
      '8080/tcp': [{ HostPort: '80', HostIp: '127.0.0.1' }],
    } } });
    await expect(createContainer(desired)).resolves.toBe(id.slice(0, 12));
    expect(native.inspect).toHaveBeenCalledWith(id);
    native.inspect.mockResolvedValue({ Id: 'd'.repeat(64), NetworkSettings: { Ports: {} } });
    await expect(createContainer(desired)).rejects.toThrow('Cannot verify native port publication');
    expect(native.remove).not.toHaveBeenCalled();
    native.inspect.mockImplementation(async (ref: string) => {
      if (ref === id) return { Id: id, NetworkSettings: { Ports: {
        '8080/tcp': [{ HostPort: '8080', HostIp: '127.0.0.1' }, { HostPort: '80', HostIp: '0.0.0.0' }],
        '80/tcp': [{ HostPort: '80', HostIp: '127.0.0.1' }],
      } } };
      const run = native.execute.mock.calls.at(-1)![0];
      const label = run.args.find((arg: string) => arg.startsWith('omnitron.creation='));
      return { Id: id, Config: { Labels: { 'omnitron.creation': label.split('=')[1] } } };
    });
    await expect(createContainer(desired)).rejects.toThrow('Docker did not publish the declared ports');
    expect(native.remove).toHaveBeenCalledTimes(2);
  });

  it('preserves the sanitized executor error instead of rebuilding it from raw argv', async () => {
    const failure = new Error('docker run --rpc-login [REDACTED]: image unavailable');
    native.execute.mockRejectedValue(failure);
    await expect(createContainer(config())).rejects.toBe(failure);
    expect(native.execute).toHaveBeenCalledOnce(); expect(native.dispose).toHaveBeenCalledOnce();
  });
});
