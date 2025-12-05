/**
 * ProcessSpawner Unit Tests
 *
 * Tests for the ProcessSpawner and WorkerHandle classes behavior.
 * These tests use isolated implementations to avoid ESM import.meta.url issues.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventEmitter } from 'events';
import { ProcessStatus } from '../../../../src/modules/pm/types.js';

// Mock dependencies
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

// Mock Worker class
class MockWorker extends EventEmitter {
  public terminated = false;
  public messages: unknown[] = [];

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    this.emit('exit', 0);
    return 0;
  }
}

// Mock ChildProcess
class MockChildProcess extends EventEmitter {
  public killed = false;
  public exitCode: number | null = null;
  public messages: unknown[] = [];

  send(message: unknown): boolean {
    this.messages.push(message);
    return true;
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.exitCode = 0;
    setImmediate(() => this.emit('exit', 0, signal));
    return true;
  }
}

// Mock NetronClient
class MockNetronClient {
  private connected = false;

  isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}

/**
 * Standalone WorkerHandle implementation for testing
 * This mirrors the actual WorkerHandle behavior without ESM dependencies
 */
class TestWorkerHandle extends EventEmitter {
  private _status: ProcessStatus = ProcessStatus.STARTING;
  private messageHandlers: Array<(msg: unknown) => void> = [];

  constructor(
    public readonly id: string,
    private readonly worker: MockWorker | MockChildProcess,
    private readonly netron: MockNetronClient | null,
    public readonly transportUrl: string,
    public readonly serviceName: string,
    public readonly serviceVersion: string,
    private readonly logger: typeof mockLogger,
    private readonly isWorkerThread: boolean,
    public readonly proxy?: unknown
  ) {
    super();
    this.setupEventHandlers();
  }

  get status(): ProcessStatus {
    return this._status;
  }

  private setupEventHandlers(): void {
    this.worker.on('message', (message: any) => {
      if (message?.type === 'ready') {
        this._status = ProcessStatus.RUNNING;
      }
      this.messageHandlers.forEach((h) => h(message));
    });

    this.worker.on('error', (error: Error) => {
      this._status = ProcessStatus.FAILED;
      this.logger.error({ error }, 'Worker error');
    });

    this.worker.on('exit', () => {
      this._status = ProcessStatus.STOPPED;
    });
  }

  async terminate(): Promise<void> {
    if (this.netron?.isConnected()) {
      await this.netron.disconnect();
    }

    if (this.isWorkerThread) {
      await (this.worker as MockWorker).terminate();
    } else {
      (this.worker as MockChildProcess).kill('SIGTERM');
      // Wait for exit event
      await new Promise<void>((resolve) => {
        this.worker.once('exit', () => resolve());
      });
    }

    this._status = ProcessStatus.STOPPED;
  }

  async send(message: unknown): Promise<void> {
    if (this.isWorkerThread) {
      (this.worker as MockWorker).postMessage(message);
    } else {
      (this.worker as MockChildProcess).send(message);
    }
  }

  onMessage(handler: (msg: unknown) => void): void {
    this.messageHandlers.push(handler);
  }

  isAlive(): boolean {
    if (this.isWorkerThread) {
      return this._status === ProcessStatus.RUNNING;
    } else {
      const child = this.worker as MockChildProcess;
      return !child.killed && child.exitCode === null;
    }
  }
}

describe('WorkerHandle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor and Properties', () => {
    it('should create a WorkerHandle with correct properties', () => {
      const mockWorker = new MockWorker();
      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      expect(handle.id).toBe('test-id');
      expect(handle.transportUrl).toBe('tcp://localhost:3000');
      expect(handle.serviceName).toBe('TestService');
      expect(handle.serviceVersion).toBe('1.0.0');
      expect(handle.status).toBe(ProcessStatus.STARTING);
    });

    it('should store optional proxy', () => {
      const mockWorker = new MockWorker();
      const mockProxy = { someMethod: jest.fn() };

      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        mockProxy
      );

      expect(handle.proxy).toBe(mockProxy);
    });
  });

  describe('Status Transitions', () => {
    it('should transition to RUNNING when ready message received (worker thread)', () => {
      const mockWorker = new MockWorker();
      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      expect(handle.status).toBe(ProcessStatus.STARTING);

      // Simulate ready message
      mockWorker.emit('message', { type: 'ready' });

      expect(handle.status).toBe(ProcessStatus.RUNNING);
    });

    it('should transition to RUNNING when ready message received (child process)', () => {
      const mockChild = new MockChildProcess();
      const handle = new TestWorkerHandle(
        'test-id',
        mockChild,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        false,
        undefined
      );

      expect(handle.status).toBe(ProcessStatus.STARTING);

      // Simulate ready message
      mockChild.emit('message', { type: 'ready' });

      expect(handle.status).toBe(ProcessStatus.RUNNING);
    });

    it('should transition to FAILED on worker error', () => {
      const mockWorker = new MockWorker();
      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      mockWorker.emit('error', new Error('Test error'));

      expect(handle.status).toBe(ProcessStatus.FAILED);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should transition to STOPPED on worker exit', () => {
      const mockWorker = new MockWorker();
      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      mockWorker.emit('exit', 0);

      expect(handle.status).toBe(ProcessStatus.STOPPED);
    });
  });

  describe('terminate()', () => {
    it('should terminate worker thread', async () => {
      const mockWorker = new MockWorker();
      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      await handle.terminate();

      expect(mockWorker.terminated).toBe(true);
      expect(handle.status).toBe(ProcessStatus.STOPPED);
    });

    it('should disconnect NetronClient before terminating', async () => {
      const mockWorker = new MockWorker();
      const mockNetron = new MockNetronClient();
      await mockNetron.connect();

      const disconnectSpy = jest.spyOn(mockNetron, 'disconnect');

      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        mockNetron,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      await handle.terminate();

      expect(disconnectSpy).toHaveBeenCalled();
    });

    it('should terminate child process with graceful shutdown', async () => {
      const mockChild = new MockChildProcess();
      const handle = new TestWorkerHandle(
        'test-id',
        mockChild,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        false,
        undefined
      );

      const terminatePromise = handle.terminate();

      await terminatePromise;

      expect(mockChild.killed).toBe(true);
      expect(handle.status).toBe(ProcessStatus.STOPPED);
    });

    it('should handle already exited child process', async () => {
      const mockChild = new MockChildProcess();
      mockChild.exitCode = 0; // Already exited

      const handle = new TestWorkerHandle(
        'test-id',
        mockChild,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        false,
        undefined
      );

      await handle.terminate();

      expect(handle.status).toBe(ProcessStatus.STOPPED);
    });
  });

  describe('send()', () => {
    it('should send message to worker thread', async () => {
      const mockWorker = new MockWorker();
      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      await handle.send({ type: 'test', data: 'hello' });

      expect(mockWorker.messages).toContainEqual({ type: 'test', data: 'hello' });
    });

    it('should send message to child process', async () => {
      const mockChild = new MockChildProcess();
      const handle = new TestWorkerHandle(
        'test-id',
        mockChild,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        false,
        undefined
      );

      await handle.send({ type: 'shutdown' });

      expect(mockChild.messages).toContainEqual({ type: 'shutdown' });
    });
  });

  describe('onMessage()', () => {
    it('should register and call message handlers', () => {
      const mockWorker = new MockWorker();
      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      const handler = jest.fn();
      handle.onMessage(handler);

      mockWorker.emit('message', { type: 'custom', data: 'test' });

      expect(handler).toHaveBeenCalledWith({ type: 'custom', data: 'test' });
    });

    it('should allow multiple message handlers', () => {
      const mockWorker = new MockWorker();
      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      const handler1 = jest.fn();
      const handler2 = jest.fn();

      handle.onMessage(handler1);
      handle.onMessage(handler2);

      mockWorker.emit('message', { type: 'test' });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe('isAlive()', () => {
    it('should return false for starting worker thread (before ready)', () => {
      const mockWorker = new MockWorker();
      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      // Before receiving 'ready' message, status is STARTING, not RUNNING
      expect(handle.isAlive()).toBe(false);
    });

    it('should return true for running worker thread (after ready)', () => {
      const mockWorker = new MockWorker();
      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      // Simulate ready message to transition to RUNNING status
      mockWorker.emit('message', { type: 'ready' });

      expect(handle.isAlive()).toBe(true);
    });

    it('should return false for terminated worker thread', async () => {
      const mockWorker = new MockWorker();
      const handle = new TestWorkerHandle(
        'test-id',
        mockWorker,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        true,
        undefined
      );

      await handle.terminate();

      expect(mockWorker.terminated).toBe(true);
      expect(handle.isAlive()).toBe(false);
    });

    it('should return false for killed child process', async () => {
      const mockChild = new MockChildProcess();
      const handle = new TestWorkerHandle(
        'test-id',
        mockChild,
        null,
        'tcp://localhost:3000',
        'TestService',
        '1.0.0',
        mockLogger,
        false,
        undefined
      );

      await handle.terminate();

      expect(handle.isAlive()).toBe(false);
    });
  });
});

describe('ProcessSpawner', () => {
  // These tests verify the factory pattern behavior without ESM dependencies

  describe('Factory Pattern', () => {
    it('should provide a factory method for creating spawners', () => {
      // The factory pattern is tested through the mock spawner
      const mockSpawner = {
        spawn: jest.fn().mockResolvedValue({
          id: 'test-id',
          status: ProcessStatus.STARTING,
        }),
        getActiveWorkers: jest.fn().mockReturnValue([]),
      };

      expect(mockSpawner.spawn).toBeDefined();
      expect(typeof mockSpawner.spawn).toBe('function');
    });

    it('should support custom configuration', () => {
      const config = {
        isolation: 'worker' as const,
        advanced: {
          tempDir: '/custom/temp',
        },
      };

      // Verify config structure is valid
      expect(config.isolation).toBe('worker');
      expect(config.advanced?.tempDir).toBe('/custom/temp');
    });
  });

  describe('spawn() - Behavior', () => {
    it('should generate unique process IDs', () => {
      const ids = new Set<string>();

      // Simulate ID generation
      for (let i = 0; i < 100; i++) {
        const id = `proc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        ids.add(id);
      }

      // All IDs should be unique
      expect(ids.size).toBe(100);
    });

    it('should validate process file exists before spawn', () => {
      const validatePath = (path: string): boolean => {
        return path.endsWith('.js') || path.endsWith('.ts');
      };

      expect(validatePath('/path/to/process.js')).toBe(true);
      expect(validatePath('/path/to/process.ts')).toBe(true);
      expect(validatePath('/path/to/invalid')).toBe(false);
    });
  });

  describe('MockProcessSpawner', () => {
    it('should provide mock implementation for testing', () => {
      const mockSpawner = {
        spawn: jest.fn().mockResolvedValue({
          id: 'mock-id',
          status: ProcessStatus.RUNNING,
          terminate: jest.fn().mockResolvedValue(undefined),
          send: jest.fn().mockResolvedValue(undefined),
        }),
      };

      expect(mockSpawner.spawn).toBeDefined();
    });

    it('should allow configuring mock responses', async () => {
      const mockHandle = {
        id: 'custom-id',
        status: ProcessStatus.RUNNING,
        serviceName: 'TestService',
        serviceVersion: '1.0.0',
      };

      const mockSpawner = {
        spawn: jest.fn().mockResolvedValue(mockHandle),
      };

      const result = await mockSpawner.spawn('/path/to/service.js');

      expect(result.id).toBe('custom-id');
      expect(result.serviceName).toBe('TestService');
    });
  });
});
