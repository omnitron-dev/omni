import { describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ExecutionService, sshConfig } from '../../src/execution/execution.service.js';

const pin = `SHA256:${'a'.repeat(43)}`;

describe('SSH server verification across managed operations', () => {
  it.each([undefined, pin])('carries the same verification to commands and tunnels (pin %s)', async expectedHostFingerprint => {
    const target = { host: 'test.invalid', ...(expectedHostFingerprint && { expectedHostFingerprint }) };
    const ssh = vi.fn((_options: ReturnType<typeof sshConfig>) => ({
      raw: () => ({ nothrow: async () => ({ stdout: 'ok', exitCode: 0 }) }),
      tunnel: async () => ({ localPort: 10000, close: async () => {} }),
    }));
    const service = new ExecutionService(createNullLogger());
    vi.spyOn(service as any, 'getEngine').mockResolvedValue({ ssh });
    expect((await service.ssh(target, 'printf ok')).exitCode).toBe(0);
    await (await service.tunnel(target, 9700)).close();
    expect(ssh).toHaveBeenCalledTimes(2);
    for (const [options] of ssh.mock.calls) {
      expect(options.hostKeyChecking).toBe('strict');
      expect(options.expectedHostFingerprint).toBe(expectedHostFingerprint);
    }
  });

  it('fails closed for remote commands and tunnels when Xec is unavailable', async () => {
    const service = new ExecutionService(createNullLogger());
    vi.spyOn(service as any, 'getEngine').mockResolvedValue(null);
    const shell = vi.spyOn(service as any, 'execFallback').mockRejectedValue(new Error('Unexpected local shell execution'));
    await expect(service.ssh({ host: 'test.invalid' }, 'ls')).resolves.toMatchObject({ exitCode: 1, stderr: expect.stringMatching(/xec/i) });
    await expect(service.tunnel({ host: 'test.invalid' }, 9700)).rejects.toThrow(/xec/i);
    expect(shell).not.toHaveBeenCalled();
  });
});
