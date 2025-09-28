/**
 * Test Process Manager
 *
 * Specialized ProcessManager for testing with additional features
 * for simulating failures, controlling timing, and verifying behavior.
 */

import { ProcessManager } from '../process-manager.js';
import { ProcessStatus } from '../types.js';
import type {
  IProcessOptions,
  IProcessInfo,
  ServiceProxy,
  IProcessManagerConfig
} from '../types.js';

/**
 * Test process manager configuration
 */
export interface ITestProcessManagerConfig extends IProcessManagerConfig {
  /** Use mock spawner for faster tests */
  mock?: boolean;
  /** Control time for testing */
  controlTime?: boolean;
  /** Record all operations for verification */
  recordOperations?: boolean;
}

/**
 * Operation record for verification
 */
export interface IOperationRecord {
  type: 'spawn' | 'kill' | 'restart' | 'health' | 'metrics';
  processId?: string;
  processClass?: string;
  timestamp: number;
  data?: any;
}

/**
 * Test Process Manager with additional testing capabilities
 */
export class TestProcessManager extends ProcessManager {
  private operations: IOperationRecord[] = [];
  private simulatedFailures = new Map<string, Error>();
  private simulatedMetrics = new Map<string, any>();
  private simulatedHealth = new Map<string, any>();
  private timeOffset = 0;
  private crashHandlers = new Map<string, () => void>();
  private recoveryHandlers = new Map<string, () => void>();
  
  constructor(config: ITestProcessManagerConfig = {}) {
    // Create a simple logger that wraps console
    const logger = {
      debug: (...args: any[]) => console.debug(...args),
      info: (...args: any[]) => console.info(...args),
      warn: (...args: any[]) => console.warn(...args),
      error: (...args: any[]) => console.error(...args),
      fatal: (...args: any[]) => console.error(...args),
      trace: (...args: any[]) => console.debug(...args),
      child: () => logger,
      isLevelEnabled: () => true,
      time: () => ({}),
      _pino: {} as any
    } as any;

    super(
      logger,
      {
        ...config,
        useMockSpawner: config.mock !== false
      }
    );
    
    // Setup test event handlers
    this.setupTestHandlers();
  }

  /**
   * Setup test-specific event handlers
   */
  private setupTestHandlers(): void {
    this.on('process:crash', (info, error) => {
      const handler = this.crashHandlers.get(info.id);
      if (handler) {
        handler();
      }
    });
    
    this.on('process:ready', (info) => {
      const handler = this.recoveryHandlers.get(info.id);
      if (handler) {
        handler();
      }
    });
  }

  /**
   * Spawn a process with test recording
   */
  override async spawn<T>(
    ProcessClass: new (...args: any[]) => T,
    options: IProcessOptions = {}
  ): Promise<ServiceProxy<T>> {
    this.recordOperation('spawn', undefined, ProcessClass.name, options);
    
    // Check for simulated failure
    const failureKey = `spawn:${ProcessClass.name}`;
    if (this.simulatedFailures.has(failureKey)) {
      throw this.simulatedFailures.get(failureKey)!;
    }
    
    return super.spawn(ProcessClass, options);
  }

  /**
   * Simulate a process crash
   */
  async simulateCrash(processOrId: ServiceProxy<any> | string): Promise<void> {
    const processId = typeof processOrId === 'string' 
      ? processOrId 
      : (processOrId as any).__processId;
    
    const info = this.getProcess(processId);
    if (!info) {
      throw new Error(`Process not found: ${processId}`);
    }
    
    // Update status
    (info as any).status = ProcessStatus.CRASHED;
    
    // Emit crash event
    const error = new Error('Simulated crash for testing');
    this.emit('process:crash', info, error);
    
    // Kill the actual process if it exists
    try {
      await this.kill(processId, 'SIGKILL');
    } catch (e) {
      // Ignore errors during simulated crash
    }
  }

  /**
   * Wait for a process to recover
   */
  async waitForRecovery(
    processOrId: ServiceProxy<any> | string,
    timeout: number = 5000
  ): Promise<boolean> {
    const processId = typeof processOrId === 'string' 
      ? processOrId 
      : (processOrId as any).__processId;
    
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.recoveryHandlers.delete(processId);
        resolve(false);
      }, timeout);
      
      this.recoveryHandlers.set(processId, () => {
        clearTimeout(timer);
        this.recoveryHandlers.delete(processId);
        resolve(true);
      });
      
      // Check if already recovered
      const info = this.getProcess(processId);
      if (info && info.status === ProcessStatus.RUNNING) {
        clearTimeout(timer);
        this.recoveryHandlers.delete(processId);
        resolve(true);
      }
    });
  }

  /**
   * Simulate metrics for a process
   */
  setMetrics(processId: string, metrics: any): void {
    this.simulatedMetrics.set(processId, metrics);
  }

  /**
   * Get metrics with simulated values
   */
  override async getMetrics(processId: string): Promise<any> {
    if (this.simulatedMetrics.has(processId)) {
      return this.simulatedMetrics.get(processId);
    }
    return super.getMetrics(processId);
  }

  /**
   * Simulate health status for a process
   */
  setHealth(processId: string, health: any): void {
    this.simulatedHealth.set(processId, health);
  }

  /**
   * Get health with simulated values
   */
  override async getHealth(processId: string): Promise<any> {
    if (this.simulatedHealth.has(processId)) {
      return this.simulatedHealth.get(processId);
    }
    return super.getHealth(processId);
  }

  /**
   * Simulate a failure for next operation
   */
  simulateFailure(operation: string, error: Error): void {
    this.simulatedFailures.set(operation, error);
  }

  /**
   * Clear simulated failures
   */
  clearFailures(): void {
    this.simulatedFailures.clear();
  }

  /**
   * Advance simulated time
   */
  advanceTime(ms: number): void {
    this.timeOffset += ms;
  }

  /**
   * Reset simulated time
   */
  resetTime(): void {
    this.timeOffset = 0;
  }

  /**
   * Get current time with offset
   */
  getCurrentTime(): number {
    return Date.now() + this.timeOffset;
  }

  /**
   * Get operation history
   */
  getOperations(): IOperationRecord[] {
    return [...this.operations];
  }

  /**
   * Clear operation history
   */
  clearOperations(): void {
    this.operations = [];
  }

  /**
   * Verify operation occurred
   */
  verifyOperation(
    type: string,
    predicate?: (op: IOperationRecord) => boolean
  ): boolean {
    return this.operations.some(op => 
      op.type === type && (!predicate || predicate(op))
    );
  }

  /**
   * Wait for a specific operation
   */
  async waitForOperation(
    type: string,
    timeout: number = 5000
  ): Promise<IOperationRecord | null> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const op = this.operations.find(o => o.type === type);
      if (op) return op;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return null;
  }

  /**
   * Record an operation for verification
   */
  private recordOperation(
    type: any,
    processId?: string,
    processClass?: string,
    data?: any
  ): void {
    this.operations.push({
      type,
      processId,
      processClass,
      timestamp: this.getCurrentTime(),
      data
    });
  }

  /**
   * Clean up test resources
   */
  async cleanup(): Promise<void> {
    this.clearFailures();
    this.clearOperations();
    this.resetTime();
    this.simulatedMetrics.clear();
    this.simulatedHealth.clear();
    this.crashHandlers.clear();
    this.recoveryHandlers.clear();
    await this.shutdown();
  }

  /**
   * Create a spy for a process method
   */
  spyOnMethod<T>(
    proxy: ServiceProxy<T>,
    methodName: keyof T
  ): jest.SpyInstance | any {
    const original = (proxy as any)[methodName];
    const calls: any[] = [];
    
    (proxy as any)[methodName] = async (...args: any[]) => {
      calls.push({ args, timestamp: this.getCurrentTime() });
      return original.apply(proxy, args);
    };
    
    // Return spy-like interface
    return {
      calls,
      mockClear: () => calls.length = 0,
      mockRestore: () => (proxy as any)[methodName] = original
    };
  }

  /**
   * Assert process state
   */
  assertProcessState(
    processId: string,
    expectedStatus: ProcessStatus
  ): void {
    const info = this.getProcess(processId);
    if (!info) {
      throw new Error(`Process not found: ${processId}`);
    }
    if (info.status !== expectedStatus) {
      throw new Error(
        `Expected process ${processId} to have status ${expectedStatus}, but got ${info.status}`
      );
    }
  }

  /**
   * Get all processes of a specific class
   */
  getProcessesByClass<T>(ProcessClass: new (...args: any[]) => T): IProcessInfo[] {
    return this.listProcesses().filter(
      info => info.name === ProcessClass.name
    );
  }

  /**
   * Count processes by status
   */
  countByStatus(status: ProcessStatus): number {
    return this.listProcesses().filter(info => info.status === status).length;
  }
}

/**
 * Create a test process manager with defaults
 */
export function createTestProcessManager(
  config?: ITestProcessManagerConfig
): TestProcessManager {
  return new TestProcessManager({
    mock: true,
    recordOperations: true,
    ...config
  });
}
