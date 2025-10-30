/**
 * Simple Process Manager Test - Debug Version
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { ProcessManager } from '../../../src/modules/pm/process-manager.js';
import { Process, Method } from '../../../src/modules/pm/decorators.js';
import { ProcessStatus } from '../../../src/modules/pm/types.js';

// Simple mock logger
const mockLogger = {
  info: (...args: any[]) => console.log('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
  debug: (...args: any[]) => console.log('[DEBUG]', ...args),
  child: () => mockLogger,
} as any;

// Very simple test class
@Process({ name: 'simple-test' })
class SimpleTestService {
  private value = 0;

  @Method()
  async getValue(): Promise<number> {
    return this.value;
  }

  @Method()
  async setValue(v: number): Promise<void> {
    this.value = v;
  }
}

describe('Simple ProcessManager Test', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    console.log('Creating ProcessManager with mock spawner...');
    pm = new ProcessManager(mockLogger, {
      useMockSpawner: true, // Force mock spawner
    });
  });

  afterEach(async () => {
    console.log('Shutting down ProcessManager...');
    await pm.shutdown({ force: true });
  });

  it('should create ProcessManager', () => {
    expect(pm).toBeDefined();
  });

  it('should spawn a simple process', async () => {
    console.log('Spawning SimpleTestService...');
    const service = await pm.spawn(SimpleTestService);

    console.log('Service spawned:', service);
    expect(service).toBeDefined();
    expect(service.__processId).toBeDefined();

    // Check process status
    const processInfo = pm.getProcess(service.__processId);
    console.log('Process info:', processInfo);
    expect(processInfo).toBeDefined();
    expect(processInfo?.status).toBe(ProcessStatus.RUNNING);
  }, 10000);

  it('should call methods on spawned process', async () => {
    console.log('Spawning service...');
    const service = await pm.spawn(SimpleTestService);

    console.log('Getting initial value...');
    const value1 = await service.getValue();
    expect(value1).toBe(0);

    console.log('Setting value to 42...');
    await service.setValue(42);

    console.log('Getting updated value...');
    const value2 = await service.getValue();
    expect(value2).toBe(42);
  }, 10000);
});
