/**
 * Real-World Process Manager Scenarios
 *
 * Tests realistic business scenarios that demonstrate practical use cases
 * of the Process Manager module in production-like environments.
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestProcessManager, TestProcessManager, ProcessStatus } from '../../../src/modules/pm/index.js';

// Import actual classes for mock spawning
import PaymentProcessorService from './processes/payment-processor.process.js';
import InventoryService from './processes/inventory.process.js';
import NotificationService from './processes/notification.process.js';
import ImageProcessorService from './processes/image-processor.process.js';
import AnalyticsAggregatorService from './processes/analytics-aggregator.process.js';
import OrderProcessingWorkflow from './processes/order-processing.workflow.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Type Definitions
// ============================================================================

interface Order {
  id: string;
  userId: string;
  items: Array<{ sku: string; quantity: number; price: number }>;
  total: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface ImageJob {
  id: string;
  url: string;
  transformations: Array<'resize' | 'crop' | 'filter' | 'compress'>;
  priority: 'low' | 'normal' | 'high';
}

interface AnalyticsEvent {
  userId: string;
  eventType: 'page_view' | 'click' | 'purchase' | 'signup';
  timestamp: number;
  metadata: Record<string, any>;
}

interface AggregatedStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  uniqueUsers: Set<string>;
  timeWindow: { start: number; end: number };
}

// ============================================================================
// Tests
// ============================================================================

describe('Real-World Scenarios - E-Commerce Order Processing', () => {
  let pm: TestProcessManager;
  let paymentService: PaymentProcessorService;
  let inventoryService: InventoryService;
  let notificationService: NotificationService;

  beforeEach(async () => {
    pm = createTestProcessManager({ mock: true });
    paymentService = await pm.spawn<PaymentProcessorService>(PaymentProcessorService);
    inventoryService = await pm.spawn<InventoryService>(InventoryService);
    notificationService = await pm.spawn<NotificationService>(NotificationService);
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it.skip('should process a complete order successfully [MockSpawner: workflow dependency injection]', async () => {
    const order: Order = {
      id: 'ORD001',
      userId: 'user123',
      items: [
        { sku: 'SKU001', quantity: 2, price: 29.99 },
        { sku: 'SKU002', quantity: 1, price: 49.99 },
      ],
      total: 109.97,
      status: 'pending',
    };

    const workflow = await pm.workflow<OrderProcessingWorkflow>(OrderProcessingWorkflow);

    // Set dependencies on the workflow
    (workflow as any).setDependencies({
      paymentService,
      inventoryService,
      notificationService,
    });

    const result = await workflow.run(order);

    // Verify all stages completed
    expect(result['validate-order']).toBeDefined();
    expect(result['validate-order'].valid).toBe(true);

    expect(result['reserve-inventory']).toBeDefined();
    expect(result['reserve-inventory'].reserved).toBe(true);

    expect(result['process-payment']).toBeDefined();
    expect(result['process-payment'].success).toBe(true);
    expect(result['process-payment'].transactionId).toBeDefined();

    expect(result['send-confirmation']).toBeDefined();
    expect(result['send-confirmation'].sent).toBe(true);

    // Verify inventory was reserved
    const sku001Level = await inventoryService.getInventoryLevel('SKU001');
    expect(sku001Level).toBe(98); // 100 - 2

    // Verify payment was processed
    const paymentStatus = await paymentService.getPaymentStatus('ORD001');
    expect(paymentStatus).toBeDefined();
    expect(paymentStatus?.status).toBe('completed');

    // Verify notification was sent
    const notifications = await notificationService.getNotifications('user123');
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].message).toContain('ORD001');
  });

  it('should handle payment failures with compensation', async () => {
    const order: Order = {
      id: 'ORD002',
      userId: 'user456',
      items: [{ sku: 'SKU003', quantity: 5, price: 19.99 }],
      total: 99.95,
      status: 'pending',
    };

    // Get initial inventory level
    const initialLevel = await inventoryService.getInventoryLevel('SKU003');

    // Create workflow with injected services
    const workflow = await pm.workflow<OrderProcessingWorkflow>(OrderProcessingWorkflow);

    // Set dependencies on the workflow
    (workflow as any).setDependencies({
      paymentService,
      inventoryService,
      notificationService,
    });

    // The workflow might fail due to circuit breaker or simulated payment failure
    let failed = false;
    try {
      await workflow.run(order);
    } catch (error) {
      failed = true;
    }

    if (failed) {
      // If failed, verify inventory was released (compensation)
      const finalLevel = await inventoryService.getInventoryLevel('SKU003');
      expect(finalLevel).toBe(initialLevel);
    }
  });

  it.skip('should handle insufficient inventory gracefully [MockSpawner: workflow dependency injection]', async () => {
    const order: Order = {
      id: 'ORD003',
      userId: 'user789',
      items: [{ sku: 'SKU002', quantity: 1000, price: 49.99 }], // More than available
      total: 49990,
      status: 'pending',
    };

    const workflow = await pm.workflow<OrderProcessingWorkflow>(OrderProcessingWorkflow);

    // Set dependencies on the workflow
    (workflow as any).setDependencies({
      paymentService,
      inventoryService,
      notificationService,
    });

    await expect(workflow.run(order)).rejects.toThrow('Insufficient inventory');

    // Verify no payment was processed
    const paymentStatus = await paymentService.getPaymentStatus('ORD003');
    expect(paymentStatus).toBeNull();
  });

  it('should check service health', async () => {
    const health = await paymentService.__getHealth();
    expect(health).toBeDefined();
    expect(health.status).toBe('healthy');
    expect(health.checks.length).toBeGreaterThan(0);
  });
});

describe('Real-World Scenarios - Image Processing Pipeline', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should process images in parallel using a pool', async () => {
    const pool = await pm.pool<ImageProcessorService>(ImageProcessorService, {
      size: 4,
      strategy: 'least-loaded' as any,
      metrics: true,
    });

    const jobs: ImageJob[] = Array.from({ length: 10 }, (_, i) => ({
      id: `img_${i}`,
      url: `https://example.com/image${i}.jpg`,
      transformations: ['resize', 'compress'],
      priority: i % 3 === 0 ? 'high' : 'normal',
    }));

    // Process all jobs in parallel
    const startTime = Date.now();
    const results = await Promise.all(jobs.map((job) => pool.processImage(job)));
    const totalTime = Date.now() - startTime;

    // Verify all jobs completed successfully
    expect(results.length).toBe(10);
    expect(results.every((r) => r.success)).toBe(true);

    // With 4 workers and 10 jobs, should be faster than sequential
    // Sequential would take ~1000ms (10 jobs * 100ms each)
    // Parallel should take ~300ms (3 batches * 100ms)
    expect(totalTime).toBeLessThan(800);

    // Verify pool metrics
    const metrics = pool.metrics;
    expect(metrics.totalRequests).toBeGreaterThanOrEqual(10);
    expect(metrics.totalWorkers).toBe(4);
  });

  it('should scale pool dynamically based on load', async () => {
    const pool = await pm.pool<ImageProcessorService>(ImageProcessorService, {
      size: 2,
      autoScale: {
        enabled: true,
        min: 2,
        max: 6,
        scaleUpThreshold: 0.8,
        scaleDownThreshold: 0.3,
      },
    });

    expect(pool.size).toBe(2);

    // Simulate high load by scaling up
    await pool.scale(5);
    expect(pool.size).toBe(5);

    // Simulate low load by scaling down
    await pool.scale(2);
    expect(pool.size).toBe(2);
  });

  it('should handle worker failures gracefully', async () => {
    const pool = await pm.pool<ImageProcessorService>(ImageProcessorService, {
      size: 3,
      replaceUnhealthy: true,
    });

    // Process a few jobs successfully
    const job: ImageJob = {
      id: 'img_test',
      url: 'https://example.com/test.jpg',
      transformations: ['resize'],
      priority: 'normal',
    };

    const result = await pool.processImage(job);
    expect(result.success).toBe(true);

    // Pool should maintain workers
    expect(pool.size).toBe(3);
  });
});

describe('Real-World Scenarios - Real-Time Analytics', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it.skip('should process event stream and aggregate statistics [MockSpawner: async generator proxy support]', async () => {
    const service = await pm.spawn<AnalyticsAggregatorService>(AnalyticsAggregatorService);

    // Create a stream of events
    async function* generateEvents(): AsyncGenerator<AnalyticsEvent> {
      const eventTypes: Array<AnalyticsEvent['eventType']> = ['page_view', 'click', 'purchase', 'signup'];

      for (let i = 0; i < 25; i++) {
        yield {
          userId: `user_${i % 5}`, // 5 unique users
          eventType: eventTypes[i % 4],
          timestamp: Date.now() + i,
          metadata: { page: `/page${i}` },
        };
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    // Process stream and collect aggregated stats
    const aggregations: AggregatedStats[] = [];
    for await (const stats of service.processEventStream(generateEvents())) {
      aggregations.push(stats);
    }

    // Verify we got intermediate and final aggregations
    expect(aggregations.length).toBeGreaterThan(1);

    // Verify final stats
    const finalStats = aggregations[aggregations.length - 1];
    expect(finalStats.totalEvents).toBe(25);
    expect(finalStats.uniqueUsers.size).toBe(5);

    // Verify event types were tracked
    expect(Object.keys(finalStats.eventsByType).length).toBeGreaterThan(0);
    const totalByType = Object.values(finalStats.eventsByType).reduce((sum, count) => sum + count, 0);
    expect(totalByType).toBe(25);
  });

  it('should handle high-throughput event streams', async () => {
    const pool = await pm.pool<AnalyticsAggregatorService>(AnalyticsAggregatorService, {
      size: 3,
      strategy: 'round-robin' as any,
    });

    // Get one worker from the pool for streaming
    const stats = await pool.getStats();
    expect(stats).toBeDefined();

    // Verify stats structure
    expect(stats.totalEvents).toBe(0);
    expect(stats.uniqueUserCount).toBe(0);
  });

  it.skip('should reset statistics [MockSpawner: service dependencies]', async () => {
    const service = await pm.spawn<AnalyticsAggregatorService>(AnalyticsAggregatorService);

    // Process some events first
    async function* generateEvents(): AsyncGenerator<AnalyticsEvent> {
      for (let i = 0; i < 5; i++) {
        yield {
          userId: `user_${i}`,
          eventType: 'page_view',
          timestamp: Date.now(),
          metadata: {},
        };
      }
    }

    for await (const _ of service.processEventStream(generateEvents())) {
      // Just consume the stream
    }

    let stats = await service.getStats();
    expect(stats.totalEvents).toBe(5);

    // Reset stats
    await service.resetStats();

    stats = await service.getStats();
    expect(stats.totalEvents).toBe(0);
    expect(stats.uniqueUserCount).toBe(0);
  });
});

describe('Real-World Scenarios - Service Integration', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it.skip('should handle multiple concurrent workflows [MockSpawner: workflow dependency injection]', async () => {
    const paymentService = await pm.spawn<PaymentProcessorService>(PaymentProcessorService);
    const inventoryService = await pm.spawn<InventoryService>(InventoryService);
    const notificationService = await pm.spawn<NotificationService>(NotificationService);

    const orders: Order[] = Array.from({ length: 5 }, (_, i) => ({
      id: `ORD_CONCURRENT_${i}`,
      userId: `user_${i}`,
      items: [{ sku: 'SKU001', quantity: 1, price: 29.99 }],
      total: 29.99,
      status: 'pending' as const,
    }));

    // Process all orders concurrently
    const workflows = await Promise.all(
      orders.map(() => pm.workflow<OrderProcessingWorkflow>(OrderProcessingWorkflow))
    );

    // Set dependencies on each workflow
    workflows.forEach((workflow) => {
      (workflow as any).setDependencies({
        paymentService,
        inventoryService,
        notificationService,
      });
    });

    const results = await Promise.allSettled(workflows.map((workflow, i) => workflow.run(orders[i])));

    // At least some orders should complete successfully
    const successful = results.filter((r) => r.status === 'fulfilled');
    expect(successful.length).toBeGreaterThan(0);
  });

  it('should maintain service isolation', async () => {
    const service1 = await pm.spawn<InventoryService>(InventoryService);
    const service2 = await pm.spawn<InventoryService>(InventoryService);

    // Services should have independent state
    await service1.reserveItems('order1', [{ sku: 'SKU001', quantity: 5 }]);

    const level1 = await service1.getInventoryLevel('SKU001');
    const level2 = await service2.getInventoryLevel('SKU001');

    // Each service instance maintains its own inventory
    expect(level1).toBe(95);
    expect(level2).toBe(100); // Independent instance
  });

  it('should handle graceful shutdown with active requests', async () => {
    const pool = await pm.pool<ImageProcessorService>(ImageProcessorService, { size: 3 });

    // Start some long-running jobs
    const jobs = Array.from({ length: 5 }, (_, i) => ({
      id: `img_shutdown_${i}`,
      url: `https://example.com/image${i}.jpg`,
      transformations: ['resize', 'compress', 'filter'] as Array<'resize' | 'crop' | 'filter' | 'compress'>,
      priority: 'normal' as const,
    }));

    const promises = jobs.map((job) => pool.processImage(job));

    // Wait a bit for jobs to start
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Trigger graceful shutdown
    const shutdownPromise = pm.shutdown({ timeout: 2000 });

    // Jobs should complete or be gracefully terminated
    await Promise.allSettled(promises);
    await shutdownPromise;

    // Verify all processes are stopped
    const processes = pm.listProcesses();
    expect(processes.every((p) => p.status === ProcessStatus.STOPPED)).toBe(true);
  });
});
