import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemWorkerManager } from '../../src/workers/system-worker-manager.js';

// Mock PM
function createMockPm() {
  const handles = new Map<string, any>();
  let spawnCounter = 0;

  return {
    spawn: vi.fn(async (_path: string, opts: any) => {
      const id = `proc-${++spawnCounter}`;
      const proxy = {
        __processId: id,
        __destroy: vi.fn(),
        init: vi.fn(),
        updateNodes: vi.fn(),
        triggerCheck: vi.fn(),
        getStatusSummaries: vi.fn().mockResolvedValue([]),
        getCheckHistory: vi.fn().mockResolvedValue([]),
        shutdown: vi.fn(),
      };
      handles.set(id, {
        onMessage: vi.fn(),
        terminate: vi.fn(),
        isAlive: () => true,
      });
      return proxy;
    }),
    getWorkerHandle: vi.fn((id: string) => handles.get(id) ?? undefined),
    kill: vi.fn().mockResolvedValue(true),
    listProcesses: vi.fn().mockReturnValue([]),
    _handles: handles,
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  };
}

describe('SystemWorkerManager', () => {
  let pm: ReturnType<typeof createMockPm>;
  let logger: ReturnType<typeof createMockLogger>;
  let manager: SystemWorkerManager;

  beforeEach(() => {
    pm = createMockPm();
    logger = createMockLogger();
    manager = new SystemWorkerManager(pm as any, logger as any);
  });

  describe('spawn', () => {
    it('spawns a worker with system: prefix', async () => {
      const proxy = await manager.spawn('health-monitor', '/path/to/worker.js', { foo: 'bar' });

      expect(pm.spawn).toHaveBeenCalledWith('/path/to/worker.js', expect.objectContaining({
        name: 'system:health-monitor',
        allMethodsPublic: true,
        dependencies: { foo: 'bar' },
      }));
      expect(proxy).toBeDefined();
      expect((proxy as any).__processId).toBe('proc-1');
    });

    it('passes execArgv when provided', async () => {
      await manager.spawn('test-worker', '/path/to/worker.js', {}, {
        execArgv: ['--import', 'tsx/esm'],
      });

      expect(pm.spawn).toHaveBeenCalledWith('/path/to/worker.js', expect.objectContaining({
        execArgv: ['--import', 'tsx/esm'],
      }));
    });

    it('passes startupTimeout when provided', async () => {
      await manager.spawn('test-worker', '/path/to/worker.js', {}, {
        startupTimeout: 60_000,
      });

      expect(pm.spawn).toHaveBeenCalledWith('/path/to/worker.js', expect.objectContaining({
        startupTimeout: 60_000,
      }));
    });

    it('throws if worker already running', async () => {
      await manager.spawn('health-monitor', '/path/to/worker.js', {});
      await expect(
        manager.spawn('health-monitor', '/path/to/worker.js', {})
      ).rejects.toThrow('already running');
    });
  });

  describe('get', () => {
    it('returns null for unknown worker', () => {
      expect(manager.get('unknown')).toBeNull();
    });

    it('returns proxy for spawned worker', async () => {
      await manager.spawn('test', '/path/to/worker.js', {});
      const proxy = manager.get('test');
      expect(proxy).not.toBeNull();
      expect((proxy as any).__processId).toBe('proc-1');
    });
  });

  describe('onMessage', () => {
    it('registers handler via PM getWorkerHandle', async () => {
      await manager.spawn('test', '/path/to/worker.js', {});
      const handler = vi.fn();
      const result = manager.onMessage('test', handler);

      expect(result).toBe(true);
      expect(pm.getWorkerHandle).toHaveBeenCalledWith('proc-1');
      const handle = pm._handles.get('proc-1');
      expect(handle.onMessage).toHaveBeenCalledWith(handler);
    });

    it('returns false for unknown worker', () => {
      expect(manager.onMessage('unknown', vi.fn())).toBe(false);
    });
  });

  describe('stop', () => {
    it('calls pm.kill with processId', async () => {
      await manager.spawn('test', '/path/to/worker.js', {});
      await manager.stop('test');

      expect(pm.kill).toHaveBeenCalledWith('proc-1');
      expect(manager.get('test')).toBeNull();
    });

    it('no-ops for unknown worker', async () => {
      await manager.stop('unknown');
      expect(pm.kill).not.toHaveBeenCalled();
    });

    it('falls back to proxy.__destroy on kill failure', async () => {
      pm.kill.mockRejectedValueOnce(new Error('kill failed'));
      await manager.spawn('test', '/path/to/worker.js', {});
      const proxy = manager.get('test');

      await manager.stop('test');
      expect((proxy as any).__destroy).toHaveBeenCalled();
    });
  });

  describe('stopAll', () => {
    it('stops all workers', async () => {
      await manager.spawn('worker-a', '/a.js', {});
      await manager.spawn('worker-b', '/b.js', {});

      expect(manager.list()).toHaveLength(2);
      await manager.stopAll();
      expect(manager.list()).toHaveLength(0);
      expect(pm.kill).toHaveBeenCalledTimes(2);
    });
  });

  describe('list', () => {
    it('returns empty for no workers', () => {
      expect(manager.list()).toEqual([]);
    });

    it('returns info for all spawned workers', async () => {
      await manager.spawn('a', '/a.js', {});
      await manager.spawn('b', '/b.js', {});

      const list = manager.list();
      expect(list).toHaveLength(2);
      expect(list[0]!.name).toBe('a');
      expect(list[0]!.processId).toBe('proc-1');
      expect(list[1]!.name).toBe('b');
      expect(list[1]!.processId).toBe('proc-2');
    });
  });
});
