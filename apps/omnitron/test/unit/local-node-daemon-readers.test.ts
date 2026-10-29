import { describe, expect, it, vi } from 'vitest';
import { NodeManagerRpcService } from '../../src/services/node-manager.rpc-service.js';

function fixture() {
  const registry = { getNode: (id: string) => id === 'missing' ? null : { isLocal: id === 'local', host: 'remote', daemonPort: 9700 }, setSlaveConnector() {} };
  const service = new NodeManagerRpcService(registry as never);
  const daemon = {
    status: vi.fn(async () => ({ apps: [{ name: 'api', status: 'online' }] })),
    getHealth: vi.fn(async () => ({ status: 'warn', indicators: { runtime: 'degraded' } })),
    getMetrics: vi.fn(async () => ({ cpu: 1 })),
  };
  service.setLocalDaemon(daemon as never);
  return { service, daemon };
}

describe('local node daemon readers', () => {
  it('returns the same live status, health and metrics as direct daemon readers', async () => {
    const { service, daemon } = fixture();
    expect(await service.getNodeDaemonStatus({ nodeId: 'local' })).toMatchObject({ reachable: true, answer: { apps: [{ name: 'api' }] } });
    expect(await service.getNodeDaemonHealth({ nodeId: 'local' })).toMatchObject({ reachable: true, answer: { status: 'warn' } });
    expect(await service.getNodeDaemonMetrics({ nodeId: 'local' })).toMatchObject({ reachable: true, answer: { cpu: 1 } });
    expect(daemon.getHealth).toHaveBeenCalledWith({});
    expect(daemon.getMetrics).toHaveBeenCalledWith({});
  });

  it('keeps remote reads on the mesh and does not substitute local data', async () => {
    const { service, daemon } = fixture();
    const invokeOnSlave = vi.fn(async () => ({ apps: [] }));
    service.setSlaveConnector({ invokeOnSlave } as never);
    expect(await service.getNodeDaemonStatus({ nodeId: 'remote' })).toMatchObject({ reachable: true, answer: { apps: [] } });
    expect(invokeOnSlave).toHaveBeenCalledWith('remote', 9700, 'OmnitronDaemon', 'status', []);
    expect(daemon.status).not.toHaveBeenCalled();
  });

  it('reports a failed or missing local reader without claiming the daemon is healthy', async () => {
    const { service, daemon } = fixture();
    daemon.status.mockRejectedValueOnce(new Error('state unavailable'));
    expect(await service.getNodeDaemonStatus({ nodeId: 'local' })).toMatchObject({ reachable: false, answer: null, error: 'state unavailable' });
    service.setLocalDaemon(null);
    expect(await service.getNodeDaemonHealth({ nodeId: 'local' })).toMatchObject({ reachable: false, answer: null });
    expect(await service.getNodeDaemonStatus({ nodeId: 'missing' })).toMatchObject({ reachable: false, error: 'No such node' });
  });
});
