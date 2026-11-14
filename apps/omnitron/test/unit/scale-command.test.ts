import { afterEach, expect, it, vi } from 'vitest';
import type { ProcessInfoDto } from '../../src/config/types.js';
const mocks = vi.hoisted(() => ({ scale: vi.fn(), disconnect: vi.fn(async () => {}), start: vi.fn(), stop: vi.fn(), clear: vi.fn(), error: vi.fn(), json: vi.fn(() => false), ready: vi.fn(async () => true) }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => mocks }));
vi.mock('../../src/commands/daemon-required.js', () => ({ requireDaemon: mocks.ready }));
vi.mock('../../src/commands/output.js', () => ({ createProgress: () => mocks, emitError: mocks.error, emitJson: mocks.json }));
import { scaleCommand } from '../../src/commands/scale.js';
const exitCode = process.exitCode;
afterEach(() => { process.exitCode = exitCode; vi.clearAllMocks(); });
it.each(['2bad', '1.5', 'NaN', 'Infinity', '0', '-2', '9007199254740992'])('refuses %s without an RPC', async count => {
  await scaleCommand('fixture', count, 'workers');
  expect(process.exitCode).toBe(1); expect(mocks.scale).not.toHaveBeenCalled();
});
it('requires explicit process selection', async () => {
  await scaleCommand('fixture', '2'); expect(process.exitCode).toBe(1); expect(mocks.scale).not.toHaveBeenCalled();
});
it('prints the selected pool observation rather than app aggregate instances', async () => {
  mocks.scale.mockResolvedValue({ name: 'fixture', instances: 1, processes: [{ name: 'workers', instances: 3, declaredInstances: 2 }] } as ProcessInfoDto);
  await scaleCommand('fixture', '3', 'workers');
  expect(mocks.scale).toHaveBeenCalledWith({ name: 'fixture', instances: 3, process: 'workers' });
  expect(mocks.stop.mock.lastCall?.[0]).toContain('3 observed workers');
  expect(mocks.stop.mock.lastCall?.[0]).toContain('restart restores the declaration');
  expect(mocks.disconnect).toHaveBeenCalledOnce();
});
it('returns nonzero on a refused or unobserved operation', async () => {
  mocks.scale.mockRejectedValueOnce(new Error('owner lacks capability'));
  await scaleCommand('fixture', '3', 'workers'); expect(process.exitCode).toBe(1);
  mocks.scale.mockResolvedValueOnce({ name: 'fixture', processes: [] });
  await scaleCommand('fixture', '3', 'workers'); expect(mocks.error.mock.lastCall?.[0]).toContain('absent');
  expect(mocks.error.mock.lastCall?.[1]).toMatchObject({ outcome: 'unknown' });
});


it('requires the same exact target for the MCP tool', async () => {
  const { createAppsTools } = await import('../../src/mcp/tool-groups/apps.tools.js');
  const tool = createAppsTools(mocks as never).find(item => item.name === 'apps.scale')!;
  await expect(tool.handler({ name: 'fixture', count: 3 })).rejects.toThrow('--process');
  expect(mocks.scale).not.toHaveBeenCalled();
  mocks.scale.mockResolvedValueOnce({ name: 'fixture' });
  await tool.handler({ name: 'fixture', count: 3, process: 'workers' });
  expect(mocks.scale).toHaveBeenCalledWith({ name: 'fixture', instances: 3, process: 'workers' });
});

it('emits an explicit machine result for the selected pool', async () => {
  mocks.json.mockReturnValueOnce(true);
  mocks.scale.mockResolvedValueOnce({ name: 'fixture', instances: 1, processes: [{ name: 'workers', instances: 3, declaredInstances: 2 }] });
  await scaleCommand('fixture', '3', 'workers');
  expect(mocks.json).toHaveBeenCalledWith(expect.objectContaining({ request: { name: 'fixture', process: 'workers', instances: 3 }, lifetime: 'until-restart', declarationChanged: false, observation: { app: 'fixture', process: { name: 'workers', instances: 3, declaredInstances: 2 } } }));
});
