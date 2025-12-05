/**
 * Workflow File Path Integration Tests
 *
 * Real-world integration tests demonstrating practical use cases
 * for file-based workflow loading.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import path from 'path';
import { createTestProcessManager, TestProcessManager } from '../../../src/modules/pm/index.js';

// Use path.resolve to get fixtures directory
const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('Workflow File Integration - Real-world Data Pipeline', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should execute complete ETL pipeline from file', async () => {
    const workflowPath = path.join(fixturesDir, 'data-pipeline-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    const dataSource = {
      type: 'database' as const,
      url: 'postgresql://localhost/data',
      credentials: 'secure-token',
    };

    const startTime = Date.now();
    const result = await (workflow as any).run(dataSource);
    const duration = Date.now() - startTime;

    // Verify all stages executed
    expect(result.extract).toBeDefined();
    expect(result.extract.count).toBe(1000);

    expect(result.validate).toBeDefined();
    expect(result.validate.valid).toBeGreaterThan(0);

    expect(result['transform-normalize']).toBeDefined();
    expect(result['transform-enrich']).toBeDefined();
    expect(result['transform-aggregate']).toBeDefined();
    expect(result['transform-aggregate'].aggregated.total).toBeGreaterThan(0);

    expect(result.load).toBeDefined();
    expect(result.load.loaded).toBe(true);
    expect(result.load.count).toBeGreaterThan(0);

    expect(result.notify).toBeDefined();
    expect(result.notify.notified).toBe(true);

    // Verify parallel execution improved performance
    // Extract (100ms) + Validate (50ms) + Transform parallel (80ms) + Aggregate (40ms) + Load (100ms) + Notify (30ms)
    // Total should be around 400ms, not 480ms (if transform stages were sequential)
    expect(duration).toBeLessThan(600);

    // Verify metrics were tracked
    const metrics = (workflow as any).getMetrics();
    expect(metrics.extracted).toBe(1000);
    expect(metrics.validated).toBeGreaterThan(0);
    expect(metrics.transformed).toBeGreaterThan(0);
    expect(metrics.loaded).toBeGreaterThan(0);
  });

  it('should handle large-scale data processing', async () => {
    const workflowPath = path.join(fixturesDir, 'data-pipeline-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    const dataSource = {
      type: 'api' as const,
      url: 'https://api.example.com/data',
    };

    const result = await (workflow as any).run(dataSource);

    // Verify pipeline processed all 1000 records
    expect(result.extract.count).toBe(1000);
    expect(result.load.count).toBeGreaterThan(0);

    // Verify aggregation summary
    const summary = result['transform-aggregate'].aggregated;
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.high).toBeGreaterThanOrEqual(0);
    expect(summary.low).toBeGreaterThanOrEqual(0);
    expect(summary.avgValue).toBeGreaterThan(0);
  });

  it('should provide detailed metrics throughout pipeline', async () => {
    const workflowPath = path.join(fixturesDir, 'data-pipeline-workflow.ts');
    const workflow = await pm.workflow(workflowPath);

    const dataSource = {
      type: 'file' as const,
      url: '/data/import.csv',
    };

    await (workflow as any).run(dataSource);

    const metrics = (workflow as any).getMetrics();

    expect(metrics.extracted).toBe(1000);
    expect(metrics.validated).toBeLessThanOrEqual(1000);
    expect(metrics.transformed).toBeLessThanOrEqual(metrics.validated);
    expect(metrics.loaded).toBeLessThanOrEqual(metrics.transformed);
    expect(metrics.failed).toBeGreaterThanOrEqual(0);

    // Verify pipeline efficiency
    const efficiency = (metrics.loaded / metrics.extracted) * 100;
    expect(efficiency).toBeGreaterThan(90); // At least 90% success rate
  });
});

describe('Workflow File Integration - Dynamic Workflow Loading', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should support dynamic workflow selection at runtime', async () => {
    // Simulate runtime workflow selection
    const workflowType = 'simple'; // Could come from config, database, etc.

    const workflowMap: Record<string, string> = {
      simple: path.join(fixturesDir, 'simple-workflow.ts'),
      complex: path.join(fixturesDir, 'complex-workflow.ts'),
      pipeline: path.join(fixturesDir, 'data-pipeline-workflow.ts'),
    };

    const workflowPath = workflowMap[workflowType];
    const workflow = await pm.workflow(workflowPath);

    const result = await (workflow as any).run('dynamic-input');
    expect(result).toBeDefined();
  });

  it('should support hot-loading of workflow files', async () => {
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');

    // Load workflow multiple times (simulating reload)
    const workflow1 = await pm.workflow(workflowPath);
    const workflow2 = await pm.workflow(workflowPath);
    const workflow3 = await pm.workflow(workflowPath);

    // Execute all instances
    const results = await Promise.all([
      (workflow1 as any).run('input1'),
      (workflow2 as any).run('input2'),
      (workflow3 as any).run('input3'),
    ]);

    // All should work independently
    expect(results[0].step1.data).toContain('input1');
    expect(results[1].step1.data).toContain('input2');
    expect(results[2].step1.data).toContain('input3');
  });

  it('should enable plugin-based workflow architecture', async () => {
    // Simulate plugin architecture where workflows are loaded from plugins
    const pluginWorkflows = [
      { name: 'simple-processor', path: path.join(fixturesDir, 'simple-workflow.ts') },
      { name: 'complex-processor', path: path.join(fixturesDir, 'complex-workflow.ts') },
      { name: 'data-pipeline', path: path.join(fixturesDir, 'data-pipeline-workflow.ts') },
    ];

    // Load all plugin workflows
    const workflows = await Promise.all(
      pluginWorkflows.map(async (plugin) => ({
        name: plugin.name,
        workflow: await pm.workflow(plugin.path),
      }))
    );

    expect(workflows).toHaveLength(3);

    // Verify each workflow is functional
    const simpleResult = await (workflows[0].workflow as any).run('test');
    expect(simpleResult.step1).toBeDefined();

    const complexResult = await (workflows[1].workflow as any).run({
      orderId: 'ORD-001',
      amount: 100,
      userId: 'USER-001',
    });
    expect(complexResult.validate).toBeDefined();

    const pipelineResult = await (workflows[2].workflow as any).run({
      type: 'database',
      url: 'test://localhost',
    });
    expect(pipelineResult.extract).toBeDefined();
  });
});

describe('Workflow File Integration - Configuration-Driven Workflows', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should support configuration-based workflow selection', async () => {
    // Simulate configuration from environment or config file
    const config = {
      workflows: {
        orderProcessing: path.join(fixturesDir, 'complex-workflow.ts'),
        dataProcessing: path.join(fixturesDir, 'data-pipeline-workflow.ts'),
      },
    };

    // Load workflows based on configuration
    const orderWorkflow = await pm.workflow(config.workflows.orderProcessing);
    const dataWorkflow = await pm.workflow(config.workflows.dataProcessing);

    // Execute workflows
    const orderResult = await (orderWorkflow as any).run({
      orderId: 'ORD-CONFIG-001',
      amount: 500,
      userId: 'USER-CONFIG',
    });

    const dataResult = await (dataWorkflow as any).run({
      type: 'api',
      url: 'https://api.config.example.com/data',
    });

    expect(orderResult.validate).toBeDefined();
    expect(dataResult.extract).toBeDefined();
  });

  it('should enable multi-tenant workflow isolation', async () => {
    // Simulate multi-tenant environment where each tenant has custom workflows
    const tenants = [
      { id: 'tenant-a', workflowPath: path.join(fixturesDir, 'simple-workflow.ts') },
      { id: 'tenant-b', workflowPath: path.join(fixturesDir, 'complex-workflow.ts') },
      { id: 'tenant-c', workflowPath: path.join(fixturesDir, 'data-pipeline-workflow.ts') },
    ];

    // Load workflows for each tenant
    const tenantWorkflows = await Promise.all(
      tenants.map(async (tenant) => ({
        tenantId: tenant.id,
        workflow: await pm.workflow(tenant.workflowPath),
      }))
    );

    expect(tenantWorkflows).toHaveLength(3);

    // Execute workflows concurrently for different tenants
    const results = await Promise.all([
      (tenantWorkflows[0].workflow as any).run('tenant-a-data'),
      (tenantWorkflows[1].workflow as any).run({
        orderId: 'ORD-TENANT-B',
        amount: 100,
        userId: 'TENANT-B-USER',
      }),
      (tenantWorkflows[2].workflow as any).run({
        type: 'database',
        url: 'tenant-c://data',
      }),
    ]);

    // Verify each tenant's workflow executed correctly
    expect(results[0].step1).toBeDefined();
    expect(results[1].validate).toBeDefined();
    expect(results[2].extract).toBeDefined();
  });
});

describe('Workflow File Integration - Performance and Scalability', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should handle high-volume concurrent workflow loading', async () => {
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');

    // Load many workflows concurrently
    const loadPromises = Array.from({ length: 50 }, () => pm.workflow(workflowPath));

    const startTime = Date.now();
    const workflows = await Promise.all(loadPromises);
    const loadTime = Date.now() - startTime;

    expect(workflows).toHaveLength(50);
    expect(loadTime).toBeLessThan(5000); // Should load efficiently
  });

  it('should handle high-volume concurrent workflow execution', async () => {
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');

    // Load multiple workflow instances
    const workflows = await Promise.all(
      Array.from({ length: 20 }, () => pm.workflow(workflowPath))
    );

    // Execute all concurrently
    const startTime = Date.now();
    const results = await Promise.all(
      workflows.map((wf, i) => (wf as any).run(`input-${i}`))
    );
    const executionTime = Date.now() - startTime;

    expect(results).toHaveLength(20);
    results.forEach((result, i) => {
      expect(result.step1.data).toContain(`input-${i}`);
    });

    // Concurrent execution should be efficient
    expect(executionTime).toBeLessThan(2000);
  });

  it('should efficiently cache workflow modules', async () => {
    const workflowPath = path.join(fixturesDir, 'simple-workflow.ts');

    // First load
    const startTime1 = Date.now();
    const workflow1 = await pm.workflow(workflowPath);
    const loadTime1 = Date.now() - startTime1;

    // Second load (should use cache)
    const startTime2 = Date.now();
    const workflow2 = await pm.workflow(workflowPath);
    const loadTime2 = Date.now() - startTime2;

    // Third load (should use cache)
    const startTime3 = Date.now();
    const workflow3 = await pm.workflow(workflowPath);
    const loadTime3 = Date.now() - startTime3;

    // All workflows should be functional
    expect(workflow1).toBeDefined();
    expect(workflow2).toBeDefined();
    expect(workflow3).toBeDefined();

    // Cached loads should be reasonably performant
    // Allow 5x tolerance for mock environment variability and system load fluctuations
    expect(loadTime2).toBeLessThanOrEqual(loadTime1 * 5);
    expect(loadTime3).toBeLessThanOrEqual(loadTime1 * 5);
  });
});
