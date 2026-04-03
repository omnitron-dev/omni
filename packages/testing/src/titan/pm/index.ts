/**
 * Process Manager Testing Utilities
 *
 * Testing utilities for Titan Process Manager including mock spawners
 * and test process manager with simulation capabilities.
 */

// Export test process manager
export { TestProcessManager, createTestProcessManager } from './test-process-manager.js';
export type { ITestProcessManagerConfig, IOperationRecord } from './test-process-manager.js';

// Export mock spawner (simpler version)
export { MockProcessSpawner } from './mock-spawner.js';

// Export advanced mock process spawner
export {
  MockWorker,
  MockNetronClient,
  MockWorkerHandle,
  MockProcessSpawner as AdvancedMockProcessSpawner,
  SimpleMockProcessSpawner,
} from './mock-process-spawner.js';
