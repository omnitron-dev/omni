import { describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ExecutionService, sshConfig } from '../../src/execution/execution.service.js';

import { ProjectService } from '../../src/services/project.service.js';

const pin = `SHA256:${'a'.repeat(43)}`;

describe('SSH server verification across managed operations', () => {
  it.each([undefined, pin])('carries the same verification to commands and tunnels (pin %s)', async expectedHostFingerprint => {
    const target = { host: 'test.invalid', ...(expectedHostFingerprint && { expectedHostFingerprint }) };
    const ssh = vi.fn((_options: ReturnType<typeof sshConfig>) => ({
      tunnel: async () => ({ localPort: 10000, close: async () => {} }),
    }));
    const execute = vi.fn(async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }));
    const service = new ExecutionService(createNullLogger());
    vi.spyOn(service as any, 'getEngine').mockResolvedValue({ ssh, execute });
    expect((await service.ssh(target, 'printf ok')).exitCode).toBe(0);
    await (await service.tunnel(target, 9700)).close();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ adapter: 'ssh',
      adapterOptions: expect.objectContaining({ hostKeyChecking: 'strict', ...(expectedHostFingerprint && { expectedHostFingerprint }) }) }));
    expect(ssh).toHaveBeenCalledTimes(1);
    for (const [options] of ssh.mock.calls) {
      expect(options.hostKeyChecking).toBe('strict');
      expect(options.expectedHostFingerprint).toBe(expectedHostFingerprint);
    }
  });

  it('resolves a stack node by its daemon port and ID and propagates registry errors', async () => {
    const project = Object.create(ProjectService.prototype);
    const resolve = vi.fn().mockRejectedValue(new Error('Invalid stored SSH host key approval'));
    project.setNodeCredentialResolver(resolve);
    const target = { host: 'test.invalid', port: 9701, nodeId: 'node-b', ssh: { privateKey: '/explicit/key' } };
    await expect(project.targetForStackNode(target)).rejects.toThrow('Invalid stored SSH host key approval');
    expect(resolve).toHaveBeenCalledWith('test.invalid', 9701, 'node-b');
    resolve.mockResolvedValue(null);
    await expect(project.targetForStackNode({ host: 'unregistered.invalid' })).resolves.toEqual({ host: 'unregistered.invalid' });
  });

  it('fails closed for remote commands and tunnels when Xec is unavailable', async () => {
    const service = new ExecutionService(createNullLogger());
    vi.spyOn(service as any, 'getEngine').mockRejectedValue(new Error('Xec is unavailable'));
    await expect(service.ssh({ host: 'test.invalid' }, 'ls')).rejects.toThrow(/xec/i);
    await expect(service.exec('ls')).rejects.toThrow(/xec/i);
    await expect(service.tunnel({ host: 'test.invalid' }, 9700)).rejects.toThrow(/xec/i);
  });
});
