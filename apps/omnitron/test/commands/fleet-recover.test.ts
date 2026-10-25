import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ nodes: [] as any[], recovered: true, available: true,
  recover: vi.fn(), disconnect: vi.fn(), error: vi.fn(), json: vi.fn(), success: vi.fn() }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ LONG_REQUEST_TIMEOUT: 600000,
  createDaemonClient: () => ({ service: async () => ({ listNodes: async () => mock.nodes, recoverBundleOnNode: mock.recover }), disconnect: mock.disconnect }) }));
vi.mock('../../src/commands/daemon-required.js', () => ({ requireDaemon: async () => mock.available }));
vi.mock('../../src/commands/output.js', () => ({ emitError: mock.error, emitJson: mock.json, emitSuccess: mock.success }));
import { fleetRecoverCommand } from '../../src/commands/fleet-recover.js';
beforeEach(() => { vi.clearAllMocks(); process.exitCode = undefined; mock.available = true; mock.nodes = [{ id: 'n1', name: 'host', isLocal: false }]; mock.recover.mockResolvedValue(true); mock.json.mockReturnValue(true); });
afterEach(() => { process.exitCode = undefined; });
describe('fleet recover native entry', () => {
  it('selects the registered node without requiring its target daemon online', async () => {
    await fleetRecoverCommand('host', 'record-1');
    expect(mock.recover).toHaveBeenCalledWith({ nodeId: 'n1', receiptId: 'record-1' });
    expect(mock.json).toHaveBeenCalledWith({ nodeId: 'n1', receiptId: 'record-1', recovered: true });
    expect(mock.disconnect).toHaveBeenCalled(); expect(process.exitCode).toBeUndefined();
  });
  it.each(['unknown', 'ambiguous', 'local'])('refuses %s selection without recovering another machine', async kind => {
    if (kind === 'unknown') mock.nodes = [];
    if (kind === 'ambiguous') mock.nodes.push({ id: 'n2', name: 'host' });
    if (kind === 'local') mock.nodes[0].isLocal = true;
    await fleetRecoverCommand('host', 'record-1');
    expect(mock.recover).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1); expect(mock.disconnect).toHaveBeenCalled();
  });
  it('fails visibly when recovery remains incomplete', async () => {
    mock.recover.mockResolvedValue(false); await fleetRecoverCommand('n1', 'record-1');
    expect(process.exitCode).toBe(1); expect(mock.error).toHaveBeenCalledWith(expect.stringContaining('upgrade-receipts/record-1.json'));
  });
});
