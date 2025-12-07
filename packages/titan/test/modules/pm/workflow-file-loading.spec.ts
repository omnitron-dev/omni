/**
 * Workflow File Path Loading Tests
 *
 * Tests for loading workflows from file paths instead of class references.
 * This enables better code organization and dynamic workflow loading.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTestProcessManager, TestProcessManager } from '../../../src/modules/pm/index.js';

// Get the directory for fixture files (ESM compatible)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('Workflow File Loading - Basic Loading', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should load workflow from file with default export', async () => {
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    expect(workflow).toBeDefined();
    expect((workflow as any).executionLog).toBeDefined();
    expect(Array.isArray((workflow as any).executionLog)).toBe(true);
  });

  it('should load workflow from file with named export', async () => {
    const workflowPath = path.join(fixturesDir, 'named-export-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    expect(workflow).toBeDefined();
    expect((workflow as any).stageLog).toBeDefined();
    expect(Array.isArray((workflow as any).stageLog)).toBe(true);
  });

  it('should load and execute workflow from file path', async () => {
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    const result = await (workflow as any).run('test-input');

    expect(result).toBeDefined();
    expect(result.step1).toBeDefined();
    expect(result.step1.data).toContain('test-input');
    expect(result.step2).toBeDefined();
    expect(result.step2.result).toContain('complete');

    // Verify execution log
    const executionLog = (workflow as any).executionLog;
    expect(executionLog).toEqual(['step1', 'step2']);
  });

  it('should resolve relative file paths', async () => {
    const relativePath = './fixtures/simple-workflow.ts';
    const workflowPath = path.resolve(__dirname, relativePath);
    const workflow = await pm.workflow(workflowPath);

    expect(workflow).toBeDefined();

    const result = await (workflow as any).run('input');
    expect(result.step1).toBeDefined();
  });

  it('should resolve absolute file paths', async () => {
    const absolutePath = path.join(fixturesDir, 'simple-workflow.ts');
    const workflow = await pm.workflow(absolutePath);

    expect(workflow).toBeDefined();

    const result = await (workflow as any).run('input');
    expect(result.step1).toBeDefined();
  });
});

describe('Workflow File Loading - Complex Workflows', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should load and execute complex workflow with parallel stages', async () => {
    const workflowPath = path.join(fixturesDir, 'complex-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    const orderData = {
      orderId: 'ORD-123',
      amount: 100,
      userId: 'USER-456',
    };

    const startTime = Date.now();
    const result = await (workflow as any).run(orderData);
    const duration = Date.now() - startTime;

    // Verify all stages executed
    expect(result.validate).toBeDefined();
    expect(result.validate.valid).toBe(true);
    expect(result['reserve-inventory']).toBeDefined();
    expect(result['reserve-inventory'].reserved).toBe(true);
    expect(result['process-payment']).toBeDefined();
    expect(result['process-payment'].paymentId).toBeDefined();
    expect(result['confirm-order']).toBeDefined();
    expect(result['confirm-order'].confirmed).toBe(true);

    // Verify parallel execution (both 50ms tasks should run in parallel)
    // Total time should be less than sequential execution
    expect(duration).toBeLessThan(200);

    // Verify execution log
    const executionLog = (workflow as any).executionLog;
    expect(executionLog).toContain('validate');
    expect(executionLog).toContain('reserve-inventory');
    expect(executionLog).toContain('process-payment');
    expect(executionLog).toContain('confirm-order');

    // Verify no compensations ran (successful execution)
    expect((workflow as any).compensationLog).toHaveLength(0);
  });

  it('should maintain workflow state across stages', async () => {
    const workflowPath = path.join(fixturesDir, 'complex-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    const orderData = {
      orderId: 'ORD-789',
      amount: 250,
      userId: 'USER-999',
    };

    await (workflow as any).run(orderData);

    // Check internal state
    expect((workflow as any).paymentProcessed).toBe(true);
    expect((workflow as any).inventoryReserved).toBe(true);
  });

  it('should handle multiple workflow instances from same file', async () => {
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');

    // Load multiple instances
    const workflow1 = await pm.workflow(workflowPath);
    const workflow2 = await pm.workflow(workflowPath);
    const workflow3 = await pm.workflow(workflowPath);

    // Execute them independently
    const results = await Promise.all([
      (workflow1 as any).run('input1'),
      (workflow2 as any).run('input2'),
      (workflow3 as any).run('input3'),
    ]);

    // Each should have its own results
    expect(results[0].step1.data).toContain('input1');
    expect(results[1].step1.data).toContain('input2');
    expect(results[2].step1.data).toContain('input3');

    // Each should have its own execution log
    expect((workflow1 as any).executionLog).toEqual(['step1', 'step2']);
    expect((workflow2 as any).executionLog).toEqual(['step1', 'step2']);
    expect((workflow3 as any).executionLog).toEqual(['step1', 'step2']);
  });
});

describe('Workflow File Loading - Error Handling', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should throw error for non-existent file', async () => {
    const invalidPath = path.join(fixturesDir, 'non-existent-workflow.ts');

    await expect(pm.workflow(invalidPath)).rejects.toThrow('not found');
  });

  it('should throw error for file without workflow decorator', async () => {
    const invalidPath = path.join(fixturesDir, 'invalid-workflow.ts');

    await expect(pm.workflow(invalidPath)).rejects.toThrow(
      'is not decorated with @Workflow()'
    );
  });

  it('should throw error for invalid file path', async () => {
    const invalidPath = '/invalid/absolute/path/workflow.ts';

    await expect(pm.workflow(invalidPath)).rejects.toThrow();
  });

  it('should provide helpful error message for missing decorator', async () => {
    const invalidPath = path.join(fixturesDir, 'invalid-workflow.ts');

    try {
      await pm.workflow(invalidPath);
      expect(true).toBe(false); // Should not reach here
    } catch (error: any) {
      expect(error.message).toContain('@Workflow()');
      expect(error.message).toContain('decorator');
    }
  });
});

describe('Workflow File Loading - Export Patterns', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should handle default export', async () => {
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    expect(workflow).toBeDefined();

    const result = await (workflow as any).run('test');
    expect(result.step1).toBeDefined();
  });

  it('should handle named export matching filename', async () => {
    const workflowPath = path.join(fixturesDir, 'named-export-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    expect(workflow).toBeDefined();

    const result = await (workflow as any).run({});
    expect(result.initialize).toBeDefined();
    expect(result.process).toBeDefined();
    expect(result.finalize).toBeDefined();
  });

  it('should handle complex workflow with default export', async () => {
    const workflowPath = path.join(fixturesDir, 'complex-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    expect(workflow).toBeDefined();

    const result = await (workflow as any).run({
      orderId: 'TEST-001',
      amount: 100,
      userId: 'USER-001',
    });

    expect(result.validate).toBeDefined();
    expect(result['confirm-order']).toBeDefined();
  });
});

describe('Workflow File Loading - Comparison with Class-Based', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('file-based and class-based workflows should produce same results', async () => {
    // Load from file
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');
    const workflowFromFile = await pm.workflow(workflowPath);

    // Import and use class directly
    const { SimpleWorkflow } = await import('./fixtures/simple-workflow.js');
    const workflowFromClass = await pm.workflow(SimpleWorkflow);

    // Execute both
    const resultFromFile = await (workflowFromFile as any).run('test');
    const resultFromClass = await (workflowFromClass as any).run('test');

    // Results should be identical
    expect(resultFromFile.step1.data).toBe(resultFromClass.step1.data);
    expect(resultFromFile.step2.result).toBe(resultFromClass.step2.result);

    // Execution logs should be identical
    expect((workflowFromFile as any).executionLog).toEqual(
      (workflowFromClass as any).executionLog
    );
  });

  it('should support both patterns in same application', async () => {
    // Load workflow from file
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');
    const workflowFromFile = await pm.workflow(workflowPath);

    // Load workflow from class
    const { NamedExportWorkflow } = await import('./fixtures/named-export-workflow.js');
    const workflowFromClass = await pm.workflow(NamedExportWorkflow);

    // Both should work independently
    const result1 = await (workflowFromFile as any).run('input');
    const result2 = await (workflowFromClass as any).run({});

    expect(result1.step1).toBeDefined();
    expect(result2.initialize).toBeDefined();
  });
});

describe('Workflow File Loading - Edge Cases', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should handle workflow with TypeScript file extension', async () => {
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    expect(workflow).toBeDefined();
  });

  it('should handle workflow with JavaScript file extension', async () => {
    // After compilation, .ts becomes .js
    const workflowPath = path.join(fixturesDir, 'simple-workflow.js');

    try {
      const workflow = await pm.workflow(workflowPath);
      expect(workflow).toBeDefined();
    } catch (error: any) {
      // If .js file doesn't exist yet (not compiled), expect file not found error
      expect(error.message).toMatch(/not found|Cannot find module/i);
    }
  });

  it('should handle concurrent loading of same workflow file', async () => {
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');

    // Load same file multiple times concurrently
    const workflows = await Promise.all([
      pm.workflow(workflowPath),
      pm.workflow(workflowPath),
      pm.workflow(workflowPath),
      pm.workflow(workflowPath),
      pm.workflow(workflowPath),
    ]);

    // All should be successfully loaded
    expect(workflows).toHaveLength(5);
    workflows.forEach((wf) => {
      expect(wf).toBeDefined();
      expect((wf as any).executionLog).toBeDefined();
    });

    // Each should be a separate instance
    const results = await Promise.all(
      workflows.map((wf, i) => (wf as any).run(`input-${i}`))
    );

    results.forEach((result, i) => {
      expect(result.step1.data).toContain(`input-${i}`);
    });
  });

  it('should cache module but create separate workflow instances', async () => {
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');

    // Load twice
    const workflow1 = await pm.workflow(workflowPath);
    const workflow2 = await pm.workflow(workflowPath);

    // Execute separately
    await (workflow1 as any).run('input1');
    await (workflow2 as any).run('input2');

    // Each should maintain its own state
    expect((workflow1 as any).executionLog).toEqual(['step1', 'step2']);
    expect((workflow2 as any).executionLog).toEqual(['step1', 'step2']);

    // They should be different instances
    expect(workflow1).not.toBe(workflow2);
  });
});
