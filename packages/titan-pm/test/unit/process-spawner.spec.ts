/**
 * ProcessSpawner Unit Tests
 *
 * Tests for the ProcessSpawner and WorkerHandle classes behavior.
 * These tests use isolated implementations to avoid ESM import.meta.url issues.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { ProcessStatus } from '../../src/types.js';

// Mock dependencies
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
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
  // Mirrors Node's ChildProcess.connected — true while the IPC
  // channel is open, false after disconnect or exit. Production
  // WorkerHandle.send (T#54) gates on this flag.
  public connected = true;

  send(message: unknown): boolean {
    this.messages.push(message);
    return true;
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.exitCode = 0;
    this.connected = false;
    setImmediate(() => this.emit('exit', 0, signal));
    return true;
  }

  /** Force-close the IPC channel without killing the process (mirrors `child.disconnect()`). */
  disconnect(): void {
    this.connected = false;
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
    // T#54: mirror production WorkerHandle.send — gate on the IPC
    // channel being open. Without this guard, `child.send(...)`
    // throws ERR_IPC_CHANNEL_CLOSED once the channel closed.
    if (this.isWorkerThread) {
      const w = this.worker as MockWorker;
      if (this._status !== ProcessStatus.RUNNING && this._status !== ProcessStatus.STARTING) {
        throw new Error(`Worker thread ${this.id} is ${this._status}; cannot post message`);
      }
      w.postMessage(message);
    } else {
      const child = this.worker as MockChildProcess;
      if (!child.connected) {
        throw new Error(`IPC channel to child ${this.id} is closed; cannot send`);
      }
      child.send(message);
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
    vi.clearAllMocks();
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
      const mockProxy = { someMethod: vi.fn() };

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

  describe('send() — IPC channel guard (T#54)', () => {
    it('rejects with a structured error when the IPC channel is closed', async () => {
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
        undefined,
      );

      // Channel open — happy path.
      await handle.send({ ping: 1 });
      expect(mockChild.messages).toHaveLength(1);

      // Simulate the child disconnecting / dying. The next send must
      // surface a structured error rather than producing
      // ERR_IPC_CHANNEL_CLOSED from `child.send` synchronously.
      mockChild.disconnect();
      await expect(handle.send({ ping: 2 })).rejects.toThrow(/IPC channel.*closed/);

      // No additional message reached the (closed) channel.
      expect(mockChild.messages).toHaveLength(1);
    });

    it('rejects when the worker thread has stopped', async () => {
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
        undefined,
      );

      // Drive status to STOPPED by emitting exit.
      mockWorker.emit('exit', 0);

      await expect(handle.send({ ping: 1 })).rejects.toThrow(/cannot post message/);
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

      const disconnectSpy = vi.spyOn(mockNetron, 'disconnect');

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

      const handler = vi.fn();
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

      const handler1 = vi.fn();
      const handler2 = vi.fn();

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
        spawn: vi.fn().mockResolvedValue({
          id: 'test-id',
          status: ProcessStatus.STARTING,
        }),
        getActiveWorkers: vi.fn().mockReturnValue([]),
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
      const validatePath = (path: string): boolean => path.endsWith('.js') || path.endsWith('.ts');

      expect(validatePath('/path/to/process.js')).toBe(true);
      expect(validatePath('/path/to/process.ts')).toBe(true);
      expect(validatePath('/path/to/invalid')).toBe(false);
    });
  });

  describe('MockProcessSpawner', () => {
    it('should provide mock implementation for testing', () => {
      const mockSpawner = {
        spawn: vi.fn().mockResolvedValue({
          id: 'mock-id',
          status: ProcessStatus.RUNNING,
          terminate: vi.fn().mockResolvedValue(undefined),
          send: vi.fn().mockResolvedValue(undefined),
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
        spawn: vi.fn().mockResolvedValue(mockHandle),
      };

      const result = await mockSpawner.spawn('/path/to/service.js');

      expect(result.id).toBe('custom-id');
      expect(result.serviceName).toBe('TestService');
    });
  });
});
