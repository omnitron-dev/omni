import { afterEach, expect, it, vi } from 'vitest';
import { stackReleaseAdmissionCommand } from '../../src/commands/stack.js';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const api = vi.hoisted(() => ({ prepareRemoteReleaseSource: vi.fn(), disconnect: vi.fn() }));
vi.mock('../../src/daemon/daemon-client.js', async original => ({
  ...await original<typeof import('../../src/daemon/daemon-client.js')>(),
  createDaemonClient: () => ({ service: async () => api, disconnect: api.disconnect }),
}));
const priorExit = process.exitCode;
afterEach(() => { vi.restoreAllMocks(); resetEnvCache(); process.exitCode = priorExit; });

it.each([true, false])('confirms an explicit Files transfer only when the controller records it (%s)', async supported => {
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
  let output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { output += String(chunk); return true; });
  const transfer = 'c17bad70-19e7-4d93-9e58-1faab65d7def';
  const publication = { attemptId: 'bf318293-e893-4403-b100-21b43f58d118', fileTransferId: transfer };
  api.prepareRemoteReleaseSource.mockResolvedValue({ release: 'sample', nodeId: 'target', digest: '1'.repeat(64),
    ...(supported && { publication }) });
  await stackReleaseAdmissionCommand('example', 'test', 'sample', true, { source: '/checkout', releaseRoot: '/store',
    nodeId: 'target', manifest: '2'.repeat(64), declarations: '3'.repeat(64), fileTransfer: transfer });
  expect(api.prepareRemoteReleaseSource).toHaveBeenCalledWith({ project: 'example', stack: 'test', release: 'sample', fileTransferId: transfer,
    input: { sourceRoot: '/checkout', storeRoot: '/store', nodeId: 'target', manifestSha256: '2'.repeat(64), declarationsSha256: '3'.repeat(64) } });
  if (supported) expect(JSON.parse(output)).toMatchObject({ ok: true, data: { publication } });
  else { expect(output).toContain('did not confirm'); expect(process.exitCode).toBe(1); }
});
