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
beforeEach(() => { vi.clearAllMocks(); native.execute.mockResolvedValue({ stdout: 'abcdef1234567890\n' }); });
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

  it('preserves the sanitized executor error instead of rebuilding it from raw argv', async () => {
    const failure = new Error('docker run --rpc-login [REDACTED]: image unavailable');
    native.execute.mockRejectedValue(failure);
    await expect(createContainer(config())).rejects.toBe(failure);
    expect(native.execute).toHaveBeenCalledOnce(); expect(native.dispose).toHaveBeenCalledOnce();
  });
});
