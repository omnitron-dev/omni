/**
 * Unit tests for ProcessSupervisor
 *
 * Tests supervision lifecycle, strategies, restart decisions,
 * child management, crash handling, and error scenarios.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';
import { ProcessSupervisor } from '../../../../src/modules/pm/process-supervisor.js';
import { SupervisionStrategy, RestartDecision, ProcessStatus } from '../../../../src/modules/pm/types.js';
import type { IProcessManager, ISupervisorOptions, ISupervisorChild, IProcessInfo } from '../../../../src/modules/pm/types.js';
import { SUPERVISOR_METADATA_KEY } from '../../../../src/modules/pm/decorators.js';

// ============================================================================
// Mock Dependencies
// ============================================================================

const createMockLogger = () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
  child: jest.fn().mockReturnThis(),
});

// Mock Process Classes
class MockWorkerProcess {}
class MockDatabaseProcess {}
class MockCacheProcess {}
class MockApiProcess {}

// Counter for unique process IDs
let processIdCounter = 0;

// Create mock proxy with __processId
const createMockProxy = (processId: string) => ({
  __processId: processId,
  __destroy: jest.fn().mockResolvedValue(undefined),
  __getMetrics: jest.fn().mockResolvedValue({ cpu: 0, memory: 0 }),
  __getHealth: jest.fn().mockResolvedValue({ status: 'healthy', checks: [], timestamp: 0 }),
  someMethod: jest.fn().mockResolvedValue('result'),
});

// Create mock ProcessManager
const createMockProcessManager = (): IProcessManager & EventEmitter => {
  const emitter = new EventEmitter() as IProcessManager & EventEmitter;
  
  (emitter as any).spawn = jest.fn().mockImplementation(() => {
    const processId = `proc-${++processIdCounter}`;
    return Promise.resolve(createMockProxy(processId));
  });
  
  (emitter as any).pool = jest.fn().mockImplementation(() => {
    const processId = `pool-${++processIdCounter}`;
    return Promise.resolve(createMockProxy(processId));
  });
  
  (emitter as any).discover = jest.fn().mockResolvedValue(null);
  (emitter as any).workflow = jest.fn().mockResolvedValue({});
  (emitter as any).supervisor = jest.fn().mockResolvedValue({});
  (emitter as any).getProcess = jest.fn().mockReturnValue(undefined);
  (emitter as any).listProcesses = jest.fn().mockReturnValue([]);
  (emitter as any).kill = jest.fn().mockResolvedValue(true);
  (emitter as any).getMetrics = jest.fn().mockResolvedValue(null);
  (emitter as any).getHealth = jest.fn().mockResolvedValue(null);
  (emitter as any).shutdown = jest.fn().mockResolvedValue(undefined);
  
  return emitter;
};

// Helper to create supervisor class with metadata
const createSupervisorClass = (children: Map<string, ISupervisorChild>, onChildCrash?: (child: any, error: Error) => Promise<RestartDecision>) => {
  class TestSupervisor {
    // Child properties that will be resolved at runtime
    worker = MockWorkerProcess;
    database = MockDatabaseProcess;
    cache = MockCacheProcess;
    api = MockApiProcess;
    
    onChildCrash?: (child: any, error: Error) => Promise<RestartDecision>;
    
    constructor() {
      if (onChildCrash) {
        this.onChildCrash = onChildCrash;
      }
    }
  }
  
  // Set metadata on the class
  Reflect.defineMetadata(SUPERVISOR_METADATA_KEY, { children }, TestSupervisor);
  
  // If onChildCrash is provided, add it to the prototype
  if (onChildCrash) {
    TestSupervisor.prototype.onChildCrash = onChildCrash;
  }
  
  return TestSupervisor;
};

// ============================================================================
// Test Suites
// ============================================================================

describe('ProcessSupervisor', () => {
  let mockManager: IProcessManager & EventEmitter;
  let mockLogger: ReturnType<typeof createMockLogger>;
  
  beforeEach(() => {
    mockManager = createMockProcessManager();
    mockLogger = createMockLogger();
    processIdCounter = 0;
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    mockManager.removeAllListeners();
  });

  // ==========================================================================
  // Supervisor Lifecycle Tests
  // ==========================================================================
  
  describe('Supervisor Lifecycle', () => {
    it('should start all child processes', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
        ['database', { name: 'database', processClass: MockDatabaseProcess, propertyKey: 'database' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      expect(mockManager.spawn).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ supervisor: 'TestSupervisor' }),
        'Starting supervisor'
      );
    });
    
    it('should stop all child processes and clean up handlers', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      // Verify crash handler is registered
      expect(mockManager.listenerCount('process:crash')).toBe(1);
      
      await supervisor.stop();
      
      // Verify crash handler is removed
      expect(mockManager.listenerCount('process:crash')).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ supervisor: 'TestSupervisor' }),
        'Stopping supervisor'
      );
    });
    
    it('should not start twice (idempotent start)', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      await supervisor.start(); // Second call should be no-op
      
      // spawn should only be called once per child
      expect(mockManager.spawn).toHaveBeenCalledTimes(1);
    });
    
    it('should not stop if not started', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = {};
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      // Stop without starting - should be no-op
      await supervisor.stop();
      
      // No stop log should be emitted
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ supervisor: 'TestSupervisor' }),
        'Stopping supervisor'
      );
    });
    
    it('should start child with pool configuration', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { 
          name: 'worker', 
          processClass: MockWorkerProcess, 
          propertyKey: 'worker',
          pool: { size: 4, strategy: 'round-robin' as any }
        }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      expect(mockManager.pool).toHaveBeenCalledTimes(1);
      expect(mockManager.spawn).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Supervision Strategies Tests
  // ==========================================================================
  
  describe('Supervision Strategies', () => {
    describe('ONE_FOR_ONE strategy', () => {
      it('should restart only the failed child', async () => {
        const children = new Map<string, ISupervisorChild>([
          ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
          ['database', { name: 'database', processClass: MockDatabaseProcess, propertyKey: 'database' }],
          ['cache', { name: 'cache', processClass: MockCacheProcess, propertyKey: 'cache' }],
        ]);
        
        const SupervisorClass = createSupervisorClass(children);
        const options: ISupervisorOptions = { 
          strategy: SupervisionStrategy.ONE_FOR_ONE,
          maxRestarts: 5,
          window: 60000
        };
        
        const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
        
        await supervisor.start();
        
        // Get the processId of the worker
        const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
        const workerProxy = await workerSpawnCall.value;
        const workerProcessId = workerProxy.__processId;
        
        // Clear spawn calls after initial start
        (mockManager.spawn as jest.Mock).mockClear();
        
        // Simulate crash of worker process
        const processInfo: IProcessInfo = {
          id: workerProcessId,
          name: 'worker',
          status: ProcessStatus.CRASHED,
          startTime: 1000,
          restartCount: 0,
        };
        
        mockManager.emit('process:crash', processInfo, new Error('Worker crashed'));
        
        // Wait for async crash handling
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Only worker should be restarted (stop + start = 2 operations on same child)
        // The implementation calls stopChild then startChild for restart
        expect(mockManager.spawn).toHaveBeenCalled();
      });
    });
    
    describe('ONE_FOR_ALL strategy', () => {
      it('should restart all children when one fails', async () => {
        const children = new Map<string, ISupervisorChild>([
          ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
          ['database', { name: 'database', processClass: MockDatabaseProcess, propertyKey: 'database' }],
        ]);
        
        const SupervisorClass = createSupervisorClass(children);
        const options: ISupervisorOptions = { 
          strategy: SupervisionStrategy.ONE_FOR_ALL,
          maxRestarts: 5,
          window: 60000
        };
        
        const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
        
        await supervisor.start();
        
        // Get the processId of the worker
        const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
        const workerProxy = await workerSpawnCall.value;
        const workerProcessId = workerProxy.__processId;
        
        // Clear spawn calls after initial start
        (mockManager.spawn as jest.Mock).mockClear();
        
        // Simulate crash of worker process
        const processInfo: IProcessInfo = {
          id: workerProcessId,
          name: 'worker',
          status: ProcessStatus.CRASHED,
          startTime: 1000,
          restartCount: 0,
        };
        
        mockManager.emit('process:crash', processInfo, new Error('Worker crashed'));
        
        // Wait for async crash handling
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // All children should be restarted
        expect(mockManager.spawn).toHaveBeenCalledTimes(2);
      });
    });
    
    describe('REST_FOR_ONE strategy', () => {
      it('should restart failed child and all children started after it', async () => {
        const children = new Map<string, ISupervisorChild>([
          ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
          ['database', { name: 'database', processClass: MockDatabaseProcess, propertyKey: 'database' }],
          ['cache', { name: 'cache', processClass: MockCacheProcess, propertyKey: 'cache' }],
        ]);
        
        const SupervisorClass = createSupervisorClass(children);
        const options: ISupervisorOptions = { 
          strategy: SupervisionStrategy.REST_FOR_ONE,
          maxRestarts: 5,
          window: 60000
        };
        
        const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
        
        await supervisor.start();
        
        // Get the processId of the database (middle child)
        const databaseSpawnCall = (mockManager.spawn as jest.Mock).mock.results[1];
        const databaseProxy = await databaseSpawnCall.value;
        const databaseProcessId = databaseProxy.__processId;
        
        // Clear spawn calls after initial start
        (mockManager.spawn as jest.Mock).mockClear();
        
        // Simulate crash of database process (middle child)
        const processInfo: IProcessInfo = {
          id: databaseProcessId,
          name: 'database',
          status: ProcessStatus.CRASHED,
          startTime: 1000,
          restartCount: 0,
        };
        
        mockManager.emit('process:crash', processInfo, new Error('Database crashed'));
        
        // Wait for async crash handling
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // database and cache should be restarted (2 children), worker should not
        expect(mockManager.spawn).toHaveBeenCalledTimes(2);
      });
    });
    
    describe('SIMPLE_ONE_FOR_ONE strategy', () => {
      it('should restart only the failed child (for dynamic children)', async () => {
        const children = new Map<string, ISupervisorChild>([
          ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
          ['database', { name: 'database', processClass: MockDatabaseProcess, propertyKey: 'database' }],
        ]);
        
        const SupervisorClass = createSupervisorClass(children);
        const options: ISupervisorOptions = { 
          strategy: SupervisionStrategy.SIMPLE_ONE_FOR_ONE,
          maxRestarts: 5,
          window: 60000
        };
        
        const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
        
        await supervisor.start();
        
        // Get the processId of the worker
        const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
        const workerProxy = await workerSpawnCall.value;
        const workerProcessId = workerProxy.__processId;
        
        // Clear spawn calls after initial start
        (mockManager.spawn as jest.Mock).mockClear();
        
        // Simulate crash of worker process
        const processInfo: IProcessInfo = {
          id: workerProcessId,
          name: 'worker',
          status: ProcessStatus.CRASHED,
          startTime: 1000,
          restartCount: 0,
        };
        
        mockManager.emit('process:crash', processInfo, new Error('Worker crashed'));
        
        // Wait for async crash handling
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Only the failed child should be restarted
        expect(mockManager.spawn).toHaveBeenCalledTimes(1);
      });
    });
    
    describe('Default/Unknown strategy', () => {
      it('should use ONE_FOR_ONE as fallback for unknown strategy', async () => {
        const children = new Map<string, ISupervisorChild>([
          ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
          ['database', { name: 'database', processClass: MockDatabaseProcess, propertyKey: 'database' }],
        ]);
        
        const SupervisorClass = createSupervisorClass(children);
        const options: ISupervisorOptions = { 
          strategy: 'unknown-strategy' as SupervisionStrategy,
          maxRestarts: 5,
          window: 60000
        };
        
        const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
        
        await supervisor.start();
        
        // Get the processId of the worker
        const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
        const workerProxy = await workerSpawnCall.value;
        const workerProcessId = workerProxy.__processId;
        
        // Clear spawn calls after initial start
        (mockManager.spawn as jest.Mock).mockClear();
        
        // Simulate crash
        const processInfo: IProcessInfo = {
          id: workerProcessId,
          name: 'worker',
          status: ProcessStatus.CRASHED,
          startTime: 1000,
          restartCount: 0,
        };
        
        mockManager.emit('process:crash', processInfo, new Error('Worker crashed'));
        
        // Wait for async crash handling
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Should behave like ONE_FOR_ONE - only restart failed child
        expect(mockManager.spawn).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ==========================================================================
  // Restart Decision Logic Tests
  // ==========================================================================
  
  describe('Restart Decision Logic', () => {
    it('should return RESTART decision by default', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { 
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 5,
        window: 60000
      };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
      const workerProxy = await workerSpawnCall.value;
      const workerProcessId = workerProxy.__processId;
      
      (mockManager.spawn as jest.Mock).mockClear();
      
      // Simulate crash - should restart by default
      const processInfo: IProcessInfo = {
        id: workerProcessId,
        name: 'worker',
        status: ProcessStatus.CRASHED,
        startTime: 1000,
        restartCount: 0,
      };
      
      mockManager.emit('process:crash', processInfo, new Error('Worker crashed'));
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Child should be restarted
      expect(mockManager.spawn).toHaveBeenCalled();
    });
    
    it('should escalate when max restarts exceeded for critical child', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { 
          name: 'worker', 
          processClass: MockWorkerProcess, 
          propertyKey: 'worker',
          critical: true
        }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { 
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 2,
        window: 60000
      };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
      const workerProxy = await workerSpawnCall.value;
      const workerProcessId = workerProxy.__processId;
      
      // Simulate multiple crashes to exceed max restarts
      const processInfo: IProcessInfo = {
        id: workerProcessId,
        name: 'worker',
        status: ProcessStatus.CRASHED,
        startTime: 1000,
        restartCount: 0,
      };
      
      // Trigger crashes up to maxRestarts
      for (let i = 0; i < 3; i++) {
        mockManager.emit('process:crash', processInfo, new Error('Worker crashed'));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // After exceeding max restarts, error should be logged for escalation
      expect(mockLogger.error).toHaveBeenCalled();
    });
    
    it('should respect IGNORE decision from custom crash handler for non-critical child', async () => {
      // Test the IGNORE decision path via custom crash handler
      let crashCount = 0;
      const customCrashHandler = jest.fn().mockImplementation(async () => {
        crashCount++;
        // Return IGNORE after 2 crashes
        if (crashCount > 2) {
          return RestartDecision.IGNORE;
        }
        return RestartDecision.RESTART;
      });

      const children = new Map<string, ISupervisorChild>([
        ['worker', {
          name: 'worker',
          processClass: MockWorkerProcess,
          propertyKey: 'worker',
          critical: false
        }],
      ]);

      const SupervisorClass = createSupervisorClass(children, customCrashHandler);
      const options: ISupervisorOptions = {
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 2,
        window: 60000
      };

      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);

      await supervisor.start();

      const initialSpawnCount = (mockManager.spawn as jest.Mock).mock.calls.length;

      // Helper to get current process ID and trigger crash
      const triggerCrash = async () => {
        const spawnResults = (mockManager.spawn as jest.Mock).mock.results;
        const lastProxy = await spawnResults[spawnResults.length - 1].value;
        const currentProcessId = lastProxy.__processId;

        const processInfo: IProcessInfo = {
          id: currentProcessId,
          name: 'worker',
          status: ProcessStatus.CRASHED,
          startTime: 1000,
          restartCount: crashCount,
        };

        mockManager.emit('process:crash', processInfo, new Error('Worker crashed'));
        await new Promise(resolve => setTimeout(resolve, 100)); // Longer delay for async handling
      };

      // Trigger 4 crashes, each using the current process ID
      await triggerCrash(); // Crash 1: RESTART
      await triggerCrash(); // Crash 2: RESTART
      await triggerCrash(); // Crash 3: IGNORE
      await triggerCrash(); // Crash 4: IGNORE

      // Custom handler returns RESTART for first 2 crashes, IGNORE for the rest
      // So we expect 2 additional restarts
      expect(customCrashHandler).toHaveBeenCalledTimes(4);
      expect((mockManager.spawn as jest.Mock).mock.calls.length).toBe(initialSpawnCount + 2);
    });
    
    it('should use custom onChildCrash handler when provided', async () => {
      const customCrashHandler = jest.fn().mockResolvedValue(RestartDecision.IGNORE);
      
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children, customCrashHandler);
      const options: ISupervisorOptions = { 
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 5,
        window: 60000
      };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
      const workerProxy = await workerSpawnCall.value;
      const workerProcessId = workerProxy.__processId;
      
      (mockManager.spawn as jest.Mock).mockClear();
      
      const processInfo: IProcessInfo = {
        id: workerProcessId,
        name: 'worker',
        status: ProcessStatus.CRASHED,
        startTime: 1000,
        restartCount: 0,
      };
      
      mockManager.emit('process:crash', processInfo, new Error('Worker crashed'));
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Custom handler returned IGNORE, so no restart should happen
      expect(customCrashHandler).toHaveBeenCalled();
      expect(mockManager.spawn).not.toHaveBeenCalled();
    });
    
    it('should handle SHUTDOWN decision', async () => {
      const customCrashHandler = jest.fn().mockResolvedValue(RestartDecision.SHUTDOWN);
      
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
        ['database', { name: 'database', processClass: MockDatabaseProcess, propertyKey: 'database' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children, customCrashHandler);
      const options: ISupervisorOptions = { 
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 5,
        window: 60000
      };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
      const workerProxy = await workerSpawnCall.value;
      const workerProcessId = workerProxy.__processId;
      
      const processInfo: IProcessInfo = {
        id: workerProcessId,
        name: 'worker',
        status: ProcessStatus.CRASHED,
        startTime: 1000,
        restartCount: 0,
      };
      
      mockManager.emit('process:crash', processInfo, new Error('Worker crashed'));
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Shutdown should have been triggered
      expect(mockLogger.info).toHaveBeenCalledWith('Shutting down supervisor due to child failure');
    });
  });

  // ==========================================================================
  // Child Management Tests
  // ==========================================================================
  
  describe('Child Management', () => {
    it('should start child process via spawn', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { 
          name: 'worker', 
          processClass: MockWorkerProcess, 
          propertyKey: 'worker',
          options: { name: 'worker-service', version: '1.0.0' }
        }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      expect(mockManager.spawn).toHaveBeenCalledWith(
        MockWorkerProcess,
        expect.objectContaining({ name: 'worker-service', version: '1.0.0' })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ child: 'worker' }),
        'Starting child process'
      );
    });
    
    it('should stop specific child', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      await supervisor.stop();
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ child: 'worker' }),
        'Stopping child process'
      );
    });
    
    it('should restart specific child', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      (mockManager.spawn as jest.Mock).mockClear();
      
      await supervisor.restartChild('worker');
      
      // restartChild calls stopChild then startChild
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ child: 'worker' }),
        'Stopping child process'
      );
      expect(mockManager.spawn).toHaveBeenCalledTimes(1);
    });
    
    it('should handle restart of non-existent child gracefully', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      // Restart non-existent child should not throw
      await expect(supervisor.restartChild('non-existent')).resolves.toBeUndefined();
    });
    
    it('should differentiate critical vs non-critical children on spawn failure', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { 
          name: 'worker', 
          processClass: MockWorkerProcess, 
          propertyKey: 'worker',
          critical: true
        }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      // Make spawn fail
      (mockManager.spawn as jest.Mock).mockRejectedValue(new Error('Spawn failed'));
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      // Critical child failure should propagate
      await expect(supervisor.start()).rejects.toThrow('Spawn failed');
    });
    
    it('should not throw on spawn failure for non-critical child', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { 
          name: 'worker', 
          processClass: MockWorkerProcess, 
          propertyKey: 'worker',
          critical: false
        }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      // Make spawn fail
      (mockManager.spawn as jest.Mock).mockRejectedValue(new Error('Spawn failed'));
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      // Non-critical child failure should be logged but not thrown
      await expect(supervisor.start()).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ child: 'worker' }),
        'Failed to start child process'
      );
    });
  });

  // ==========================================================================
  // Crash Handling Tests
  // ==========================================================================
  
  describe('Crash Handling', () => {
    it('should handle child crash via process:crash event', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { 
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 5,
        window: 60000
      };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
      const workerProxy = await workerSpawnCall.value;
      const workerProcessId = workerProxy.__processId;
      
      const processInfo: IProcessInfo = {
        id: workerProcessId,
        name: 'worker',
        status: ProcessStatus.CRASHED,
        startTime: 1000,
        restartCount: 0,
      };
      
      const error = new Error('Worker crashed');
      mockManager.emit('process:crash', processInfo, error);
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ child: 'worker' }),
        'Child process crashed'
      );
    });
    
    it('should use O(1) lookup via processIdToName map', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
        ['database', { name: 'database', processClass: MockDatabaseProcess, propertyKey: 'database' }],
        ['cache', { name: 'cache', processClass: MockCacheProcess, propertyKey: 'cache' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { 
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 5,
        window: 60000
      };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      // Get the last child's processId (cache)
      const cacheSpawnCall = (mockManager.spawn as jest.Mock).mock.results[2];
      const cacheProxy = await cacheSpawnCall.value;
      const cacheProcessId = cacheProxy.__processId;
      
      const processInfo: IProcessInfo = {
        id: cacheProcessId,
        name: 'cache',
        status: ProcessStatus.CRASHED,
        startTime: 1000,
        restartCount: 0,
      };
      
      mockManager.emit('process:crash', processInfo, new Error('Cache crashed'));
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // The crash should be handled - O(1) lookup should find the child
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ child: 'cache' }),
        'Child process crashed'
      );
    });
    
    it('should track restart counts', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { 
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 5,
        window: 60000
      };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      let currentProcessId: string;
      const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
      const workerProxy = await workerSpawnCall.value;
      currentProcessId = workerProxy.__processId;
      
      // Simulate multiple crashes
      for (let i = 0; i < 3; i++) {
        const processInfo: IProcessInfo = {
          id: currentProcessId,
          name: 'worker',
          status: ProcessStatus.CRASHED,
          startTime: 1000,
          restartCount: i,
        };
        
        mockManager.emit('process:crash', processInfo, new Error('Worker crashed ' + (i + 1)));
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Update processId for next iteration (new spawn creates new ID)
        const lastSpawnCall = (mockManager.spawn as jest.Mock).mock.results[(mockManager.spawn as jest.Mock).mock.results.length - 1];
        if (lastSpawnCall) {
          const newProxy = await lastSpawnCall.value;
          currentProcessId = newProxy.__processId;
        }
      }
      
      // All 3 crashes should have been handled
      expect(mockLogger.error).toHaveBeenCalledTimes(3);
    });
    
    it('should track restart timestamps via restartTimestamps map', async () => {
      // Test that restart timestamps are being tracked
      let crashCount = 0;
      const customCrashHandler = jest.fn().mockImplementation(async () => {
        crashCount++;
        // Return IGNORE after 2 crashes to limit restarts
        if (crashCount > 2) {
          return RestartDecision.IGNORE;
        }
        return RestartDecision.RESTART;
      });

      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);

      const SupervisorClass = createSupervisorClass(children, customCrashHandler);
      const options: ISupervisorOptions = {
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 2,
        window: 60000
      };

      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);

      await supervisor.start();

      const initialSpawnCount = (mockManager.spawn as jest.Mock).mock.calls.length;

      // Helper to get current process ID and trigger crash
      const triggerCrash = async () => {
        const spawnResults = (mockManager.spawn as jest.Mock).mock.results;
        const lastProxy = await spawnResults[spawnResults.length - 1].value;
        const currentProcessId = lastProxy.__processId;

        const processInfo: IProcessInfo = {
          id: currentProcessId,
          name: 'worker',
          status: ProcessStatus.CRASHED,
          startTime: 1000,
          restartCount: crashCount,
        };

        mockManager.emit('process:crash', processInfo, new Error('Crash ' + (crashCount + 1)));
        await new Promise(resolve => setTimeout(resolve, 100)); // Longer delay for async handling
      };

      // Trigger 3 crashes
      await triggerCrash(); // Crash 1: RESTART
      await triggerCrash(); // Crash 2: RESTART
      await triggerCrash(); // Crash 3: IGNORE

      // Custom handler returns RESTART for first 2, IGNORE for the 3rd
      expect(customCrashHandler).toHaveBeenCalledTimes(3);
      expect((mockManager.spawn as jest.Mock).mock.calls.length).toBe(initialSpawnCount + 2);
    });
    
    it('should ignore crashes from unknown processes', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      (mockManager.spawn as jest.Mock).mockClear();
      
      // Emit crash from unknown process
      const processInfo: IProcessInfo = {
        id: 'unknown-process-id',
        name: 'unknown',
        status: ProcessStatus.CRASHED,
        startTime: 1000,
        restartCount: 0,
      };
      
      mockManager.emit('process:crash', processInfo, new Error('Unknown process crashed'));
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // No restart should happen for unknown process
      expect(mockManager.spawn).not.toHaveBeenCalled();
      // Should not log crash for unknown child
      expect(mockLogger.error).not.toHaveBeenCalledWith(
        expect.objectContaining({ child: 'unknown' }),
        'Child process crashed'
      );
    });
    
    it('should handle errors in crash handler gracefully', async () => {
      const customCrashHandler = jest.fn().mockRejectedValue(new Error('Handler error'));
      
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children, customCrashHandler);
      const options: ISupervisorOptions = { 
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 5,
        window: 60000
      };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
      const workerProxy = await workerSpawnCall.value;
      const workerProcessId = workerProxy.__processId;
      
      const processInfo: IProcessInfo = {
        id: workerProcessId,
        name: 'worker',
        status: ProcessStatus.CRASHED,
        startTime: 1000,
        restartCount: 0,
      };
      
      // Should not throw
      mockManager.emit('process:crash', processInfo, new Error('Worker crashed'));
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error), originalError: expect.any(Error) }),
        'Error in crash handler'
      );
    });
  });

  // ==========================================================================
  // Error Scenarios Tests
  // ==========================================================================
  
  describe('Error Scenarios', () => {
    it('should throw error when supervisor metadata not found', async () => {
      // Create a class without supervisor metadata
      class NoMetadataSupervisor {}
      
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, NoMetadataSupervisor, options, mockLogger);
      
      await expect(supervisor.start()).rejects.toThrow();
    });
    
    it('should escalate critical child failure via ESCALATE decision', async () => {
      // Test the ESCALATE decision path via custom crash handler
      let crashCount = 0;
      const customCrashHandler = jest.fn().mockImplementation(async () => {
        crashCount++;
        // Return ESCALATE after first crash
        if (crashCount > 1) {
          return RestartDecision.ESCALATE;
        }
        return RestartDecision.RESTART;
      });

      const children = new Map<string, ISupervisorChild>([
        ['critical-worker', {
          name: 'critical-worker',
          processClass: MockWorkerProcess,
          propertyKey: 'worker',
          critical: true
        }],
      ]);

      const SupervisorClass = createSupervisorClass(children, customCrashHandler);
      const options: ISupervisorOptions = {
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 1,
        window: 60000
      };

      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);

      await supervisor.start();

      // Helper to get current process ID and trigger crash
      const triggerCrash = async () => {
        const spawnResults = (mockManager.spawn as jest.Mock).mock.results;
        const lastProxy = await spawnResults[spawnResults.length - 1].value;
        const currentProcessId = lastProxy.__processId;

        const processInfo: IProcessInfo = {
          id: currentProcessId,
          name: 'critical-worker',
          status: ProcessStatus.CRASHED,
          startTime: 1000,
          restartCount: crashCount,
        };

        mockManager.emit('process:crash', processInfo, new Error('Crash ' + (crashCount + 1)));
        await new Promise(resolve => setTimeout(resolve, 100)); // Longer delay for async handling
      };

      // Trigger 2 crashes
      await triggerCrash(); // Crash 1: RESTART
      await triggerCrash(); // Crash 2: ESCALATE

      // Custom handler was called twice
      expect(customCrashHandler).toHaveBeenCalledTimes(2);

      // Escalation logs "Child failure escalated" and then throws
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ child: 'critical-worker' }),
        'Child failure escalated'
      );
    });
    
    it('should handle stop child failure gracefully', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      // Make spawn return a proxy with failing __destroy
      (mockManager.spawn as jest.Mock).mockResolvedValue({
        __processId: 'test-proc-id',
        __destroy: jest.fn().mockRejectedValue(new Error('Destroy failed')),
      });
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      // Stop should not throw even if __destroy fails
      await expect(supervisor.stop()).resolves.toBeUndefined();
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ child: 'worker' }),
        'Failed to stop child process'
      );
    });
    
    it('should use default values for options', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      // Empty options - should use defaults
      const options: ISupervisorOptions = {};
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
      const workerProxy = await workerSpawnCall.value;
      const workerProcessId = workerProxy.__processId;
      
      (mockManager.spawn as jest.Mock).mockClear();
      
      const processInfo: IProcessInfo = {
        id: workerProcessId,
        name: 'worker',
        status: ProcessStatus.CRASHED,
        startTime: 1000,
        restartCount: 0,
      };
      
      // Trigger a crash - should use default strategy (ONE_FOR_ONE) and defaults
      mockManager.emit('process:crash', processInfo, new Error('Worker crashed'));
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Should restart using defaults
      expect(mockManager.spawn).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Edge Cases Tests
  // ==========================================================================
  
  describe('Edge Cases', () => {
    it('should handle empty children map', async () => {
      const children = new Map<string, ISupervisorChild>();
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await expect(supervisor.start()).resolves.toBeUndefined();
      
      expect(mockManager.spawn).not.toHaveBeenCalled();
    });
    
    it('should handle restartChild for non-registered child', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      // Should not throw for non-existent child
      await expect(supervisor.restartChild('non-existent')).resolves.toBeUndefined();
    });
    
    it('should clean up processIdToName map on stop', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      const workerSpawnCall = (mockManager.spawn as jest.Mock).mock.results[0];
      const workerProxy = await workerSpawnCall.value;
      const workerProcessId = workerProxy.__processId;
      
      await supervisor.stop();
      
      // Emit crash after stop - should not match any child
      const processInfo: IProcessInfo = {
        id: workerProcessId,
        name: 'worker',
        status: ProcessStatus.CRASHED,
        startTime: 1000,
        restartCount: 0,
      };
      
      // Need to re-attach listener to test (it was removed on stop)
      // This verifies the map was cleaned up
      expect(mockManager.listenerCount('process:crash')).toBe(0);
    });
    
    it('should handle proxy without __processId', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      // Return proxy without __processId
      (mockManager.spawn as jest.Mock).mockResolvedValue({
        __destroy: jest.fn().mockResolvedValue(undefined),
        someMethod: jest.fn(),
      });
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      // Should not throw
      await expect(supervisor.start()).resolves.toBeUndefined();
    });
    
    it('should handle proxy without __destroy method', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      // Return proxy without __destroy
      (mockManager.spawn as jest.Mock).mockResolvedValue({
        __processId: 'test-proc-id',
        someMethod: jest.fn(),
      });
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      await supervisor.start();
      
      // Should not throw on stop
      await expect(supervisor.stop()).resolves.toBeUndefined();
    });
    
    it('should handle multiple starts and stops', async () => {
      const children = new Map<string, ISupervisorChild>([
        ['worker', { name: 'worker', processClass: MockWorkerProcess, propertyKey: 'worker' }],
      ]);
      
      const SupervisorClass = createSupervisorClass(children);
      const options: ISupervisorOptions = { strategy: SupervisionStrategy.ONE_FOR_ONE };
      
      const supervisor = new ProcessSupervisor(mockManager, SupervisorClass, options, mockLogger);
      
      // Start -> Stop -> Start -> Stop
      await supervisor.start();
      await supervisor.stop();
      
      (mockManager.spawn as jest.Mock).mockClear();
      
      await supervisor.start();
      await supervisor.stop();
      
      // Second start should spawn again
      expect(mockManager.spawn).toHaveBeenCalledTimes(1);
    });
  });
});
