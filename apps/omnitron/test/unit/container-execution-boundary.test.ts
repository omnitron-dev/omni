import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ execute: vi.fn(), dispose: vi.fn(), engines: vi.fn() }));
vi.mock('@xec-sh/core', () => ({
  DockerAdapter: class { async listImages() { return ['example/service:1']; } },
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
  it('preserves the sanitized executor error instead of rebuilding it from raw argv', async () => {
    const failure = new Error('docker run --rpc-login [REDACTED]: image unavailable');
    native.execute.mockRejectedValue(failure);
    await expect(createContainer(config())).rejects.toBe(failure);
    expect(native.execute).toHaveBeenCalledOnce(); expect(native.dispose).toHaveBeenCalledOnce();
  });
});
