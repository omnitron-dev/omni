import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { INodeHealthSummary, IHealthCheckResult } from '../../src/workers/types.js';

// Must mock before importing the service
vi.mock('../../src/services/remote-ops.service.js', () => {
  class MockRemoteOpsService {
    ping = vi.fn().mockResolvedValue({ reachable: true, latencyMs: 10 });
    checkSsh = vi.fn().mockResolvedValue({ connected: true, latencyMs: 50 });
    checkRemoteOmnitron = vi.fn().mockResolvedValue({ connected: true, version: '0.1.0' });
    dispose = vi.fn();
    constructor(_logger: any) {}
  }
  return {
    RemoteOpsService: MockRemoteOpsService,
    DEFAULT_CHECK_CONFIG: {
      pingEnabled: true,
      pingTimeout: 5000,
      sshTimeout: 10000,
      omnitronCheckTimeout: 15000,
    },
  };
});

// Must import after mocks
const { NodeManagerService } = await import('../../src/services/node-manager.service.js');

describe('NodeManagerService — Worker Integration', () => {
  let service: InstanceType<typeof NodeManagerService>;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(() => mockLogger),
    };
    service = new NodeManagerService(mockLogger);
  });

  describe('updateStatusCacheFromWorker', () => {
    it('updates status cache from worker summaries', () => {
      const checkResult: IHealthCheckResult = {
        nodeId: 'local',
        checkedAt: new Date().toISOString(),
        checkDurationMs: 5,
        pingReachable: true,
        pingLatencyMs: 0,
        pingError: null,
        sshConnected: true,
        sshLatencyMs: 0,
        sshError: null,
        omnitronConnected: true,
        omnitronVersion: '0.1.0',
        omnitronPid: 1234,
        omnitronUptime: 60000,
        omnitronRole: 'master',
        omnitronError: null,
        os: { platform: 'darwin', arch: 'arm64', hostname: 'test', release: '24.0' },
      };

      const summaries: INodeHealthSummary[] = [{
        nodeId: 'local',
        status: 'online',
        lastCheck: checkResult,
        lastSeenOnline: checkResult.checkedAt,
        consecutiveFailures: 0,
      }];

      service.updateStatusCacheFromWorker(summaries);

      const node = service.getNode('local');
      expect(node).not.toBeNull();
      expect(node!.status).not.toBeNull();
      expect(node!.status!.pingReachable).toBe(true);
      expect(node!.status!.omnitronConnected).toBe(true);
      expect(node!.status!.omnitronVersion).toBe('0.1.0');
      expect(node!.status!.omnitronPid).toBe(1234);
      expect(node!.status!.omnitronRole).toBe('master');
      expect(node!.status!.os).toEqual({ platform: 'darwin', arch: 'arm64', hostname: 'test', release: '24.0' });
    });

    it('emits node:status events', () => {
      const handler = vi.fn();
      service.on('node:status', handler);

      const summaries: INodeHealthSummary[] = [{
        nodeId: 'local',
        status: 'online',
        lastCheck: {
          nodeId: 'local',
          checkedAt: new Date().toISOString(),
          checkDurationMs: 1,
          pingReachable: true,
          pingLatencyMs: 0,
          pingError: null,
          sshConnected: true,
          sshLatencyMs: 0,
          sshError: null,
          omnitronConnected: true,
          omnitronVersion: null,
          omnitronPid: null,
          omnitronUptime: null,
          omnitronRole: null,
          omnitronError: null,
          os: null,
        },
        lastSeenOnline: new Date().toISOString(),
        consecutiveFailures: 0,
      }];

      service.updateStatusCacheFromWorker(summaries);
      expect(handler).toHaveBeenCalledWith('local', expect.objectContaining({ nodeId: 'local' }));
    });

    it('skips summaries without lastCheck', () => {
      const summaries: INodeHealthSummary[] = [{
        nodeId: 'local',
        status: 'unknown',
        lastCheck: null,
        lastSeenOnline: null,
        consecutiveFailures: 0,
      }];

      // Should not throw
      service.updateStatusCacheFromWorker(summaries);
    });

    it('handles error fields correctly', () => {
      const summaries: INodeHealthSummary[] = [{
        nodeId: 'local',
        status: 'offline',
        lastCheck: {
          nodeId: 'local',
          checkedAt: new Date().toISOString(),
          checkDurationMs: 5000,
          pingReachable: false,
          pingLatencyMs: null,
          pingError: 'Host unreachable',
          sshConnected: false,
          sshLatencyMs: null,
          sshError: 'Connection refused',
          omnitronConnected: false,
          omnitronVersion: null,
          omnitronPid: null,
          omnitronUptime: null,
          omnitronRole: null,
          omnitronError: 'Not running',
          os: null,
        },
        lastSeenOnline: null,
        consecutiveFailures: 5,
      }];

      service.updateStatusCacheFromWorker(summaries);
      const node = service.getNode('local');
      expect(node!.status!.pingError).toBe('Host unreachable');
      expect(node!.status!.sshError).toBe('Connection refused');
      expect(node!.status!.omnitronError).toBe('Not running');
    });
  });

  describe('getNodeCheckTargets', () => {
    it('returns serializable targets for all nodes', async () => {
      const targets = await service.getNodeCheckTargets();
      expect(targets.length).toBeGreaterThanOrEqual(1);
      const local = targets.find((t) => t.id === 'local');
      expect(local).toBeDefined();
      expect(local!.isLocal).toBe(true);
      expect(local!.host).toBe('127.0.0.1');
      expect(local!.offlineTimeout).toBeNull();
    });

    it('includes offlineTimeout from node config', async () => {
      const node = service.addNode({
        name: 'test-remote',
        host: '192.168.1.100',
        offlineTimeout: 120_000,
      });
      const targets = await service.getNodeCheckTargets();
      const remote = targets.find((t) => t.id === node.id);
      expect(remote).toBeDefined();
      expect(remote!.offlineTimeout).toBe(120_000);
      expect(remote!.isLocal).toBe(false);

      service.removeNode(node.id);
    });
  });

  describe('offlineTimeout in CRUD', () => {
    it('addNode accepts offlineTimeout', () => {
      const node = service.addNode({
        name: 'timeout-test',
        host: '10.0.0.1',
        offlineTimeout: 60_000,
      });
      expect(node.offlineTimeout).toBe(60_000);
      service.removeNode(node.id);
    });

    it('updateNode can set offlineTimeout', () => {
      const node = service.addNode({ name: 'update-test', host: '10.0.0.2' });
      const updated = service.updateNode(node.id, { offlineTimeout: 30_000 });
      expect(updated.offlineTimeout).toBe(30_000);
      service.removeNode(node.id);
    });
  });
});
