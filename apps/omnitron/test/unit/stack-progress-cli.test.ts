import { afterEach, expect, it, vi } from 'vitest';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';
import { stackProgressCommand } from '../../src/commands/stack.js';

const api = vi.hoisted(() => ({ getDeployProgress: vi.fn(), disconnect: vi.fn() }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => ({
  service: async () => api, disconnect: api.disconnect,
}) }));
afterEach(() => { vi.restoreAllMocks(); resetEnvCache(); });

it('reads only transfer permission and keeps unattributed and foreign observations out of scoped JSON', async () => {
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
  const transfer = { project: 'sample', stack: 'prod', node: 'shared', app: 'api', operationId: 'selected',
    at: '2026-01-01T00:00:00Z', status: 'installing', progress: 50, message: 'Installing' };
  api.getDeployProgress.mockResolvedValue([transfer, { ...transfer, project: 'other' }, { node: 'legacy', app: 'api' }]);
  let output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true; });
  await stackProgressCommand('sample', 'prod');
  expect(api.getDeployProgress).toHaveBeenCalledWith({ project: 'sample', stack: 'prod' });
  expect(JSON.parse(output)).toEqual({ ok: true, data: { project: 'sample', stack: 'prod', transfers: [transfer], unscopedCount: 1 } });
  expect(api.disconnect).toHaveBeenCalledTimes(1);
});
