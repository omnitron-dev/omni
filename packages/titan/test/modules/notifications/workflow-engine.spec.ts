/**
 * Comprehensive Tests for WorkflowEngine
 * Tests workflow orchestration and complex notification scenarios
 */

import Redis from 'ioredis';
import { WorkflowEngine } from '../../../src/modules/notifications/workflow-engine.js';
import { NotificationService } from '../../../src/modules/notifications/notifications.service.js';
import { NotificationManager } from '../../../src/rotif/rotif.js';
import {
  ChannelManager,
  NotificationChannel,
  ChannelType
} from '../../../src/modules/notifications/channel-manager.js';
import { PreferenceManager } from '../../../src/modules/notifications/preference-manager.js';
import { RateLimiter } from '../../../src/modules/notifications/rate-limiter.js';
import { RedisDockerTestHelper } from './test-redis-docker.js';
import type {
  NotificationWorkflow
} from '../../../src/modules/notifications/workflow-engine.js';

describe('WorkflowEngine', () => {
  let redis: Redis;
  let pubRedis: Redis;
  let subRedis: Redis;
  let rotifManager: NotificationManager;
  let channelManager: ChannelManager;
  let preferenceManager: PreferenceManager;
  let rateLimiter: RateLimiter;
  let notificationService: NotificationService;
  let workflowEngine: WorkflowEngine;
  const TEST_PREFIX = `test:workflow:${Date.now()}`;

  // Mock channel for testing
  class TestChannel implements NotificationChannel {
    type = 'test' as ChannelType;
    priority = 100;
    isAvailable = true;
    sentMessages: any[] = [];

    async validate(recipients: any[]): Promise<any[]> {
      return recipients.filter(r => r.test);
    }

    formatContent(content: any, recipient: any): any {
      return { ...content, formatted: true };
    }

    async send(content: any, recipients: any[]): Promise<{ success: boolean; messageId?: string }> {
      this.sentMessages.push({ content, recipients });
      return { success: true, messageId: 'test-msg-id' };
    }
  }

  beforeAll(async () => {
    // Start Redis container and create connections
    await RedisDockerTestHelper.startRedis();
    const clients = RedisDockerTestHelper.createClients();
    redis = clients.redis;
    pubRedis = clients.pubRedis;
    subRedis = clients.subRedis;

    // Clear test data
    await RedisDockerTestHelper.cleanup(redis, `${TEST_PREFIX}:*`);

    // Initialize Rotif Manager
    rotifManager = new NotificationManager({
      redis,
      pubRedis,
      subRedis,
      redisNamespace: TEST_PREFIX,
      disableDelayed: false,
      maxRetries: 2,
      retryDelay: 100,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {}
      }
    });

    await rotifManager.waitUntilReady();

    // Initialize services
    channelManager = new ChannelManager();
    preferenceManager = new PreferenceManager(redis);
    rateLimiter = new RateLimiter(redis);
    notificationService = new NotificationService(
      rotifManager,
      channelManager,
      preferenceManager,
      rateLimiter
    );

    workflowEngine = new WorkflowEngine(notificationService, redis, {
      enabled: true,
      storage: 'redis',
      maxConcurrent: 5
    });
  }, 30000);

  afterAll(async () => {
    try {
      await RedisDockerTestHelper.cleanup(redis, `${TEST_PREFIX}:*`);
      if (rotifManager) await rotifManager.destroy();
      if (pubRedis) await pubRedis.quit();
      if (subRedis) await subRedis.quit();
      if (redis) await redis.quit();
    } finally {
      await RedisDockerTestHelper.stopRedis();
    }
  }, 30000);

  describe('Workflow Definition', () => {
    it('should define and retrieve workflows', () => {
      const workflow: NotificationWorkflow = {
        id: 'test-workflow-1',
        name: 'Test Workflow',
        description: 'A test workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'step1',
            name: 'Send notification',
            type: 'notification',
            config: {
              notification: {
                title: 'Test',
                body: 'Test message'
              }
            }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);
      const retrieved = workflowEngine.getWorkflow('test-workflow-1');
      expect(retrieved).toEqual(workflow);
    });

    it('should list all workflows', () => {
      const workflow1: NotificationWorkflow = {
        id: 'list-test-1',
        name: 'List Test 1',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'dummy',
            name: 'Dummy step',
            type: 'wait',
            config: { duration: 1 }
          }
        ]
      };

      const workflow2: NotificationWorkflow = {
        id: 'list-test-2',
        name: 'List Test 2',
        trigger: { type: 'event' },
        steps: [
          {
            id: 'dummy',
            name: 'Dummy step',
            type: 'wait',
            config: { duration: 1 }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow1);
      workflowEngine.defineWorkflow(workflow2);

      const workflows = workflowEngine.listWorkflows();
      expect(workflows).toContainEqual(expect.objectContaining({ id: 'list-test-1' }));
      expect(workflows).toContainEqual(expect.objectContaining({ id: 'list-test-2' }));
    });

    it('should validate workflow structure', () => {
      const invalidWorkflow: any = {
        id: 'invalid',
        // Missing required fields
        steps: []
      };

      expect(() => workflowEngine.defineWorkflow(invalidWorkflow))
        .toThrow();
    });
  });

  describe('Step Execution', () => {
    let testChannel: TestChannel;

    beforeEach(() => {
      testChannel = new TestChannel();
      channelManager.registerChannel('test', testChannel);
    });

    it('should execute notification step', async () => {
      const workflow: NotificationWorkflow = {
        id: 'notification-workflow',
        name: 'Notification Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'notify',
            name: 'Send notification',
            type: 'notification',
            config: {
              notification: {
                type: 'info',
                title: 'Test Notification',
                body: 'This is a test'
              },
              channels: ['test'],
              recipients: [{ test: true, id: 'user1' }]
            }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);
      const result = await workflowEngine.execute('notification-workflow', {});

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].success).toBe(true);
      expect(testChannel.sentMessages).toHaveLength(1);
    });

    it('should execute wait step', async () => {
      const workflow: NotificationWorkflow = {
        id: 'wait-workflow',
        name: 'Wait Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'wait',
            name: 'Wait 100ms',
            type: 'wait',
            config: {
              duration: 100
            }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);
      const startTime = Date.now();
      const result = await workflowEngine.execute('wait-workflow', {});
      const elapsed = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    it('should execute conditional step', async () => {
      const workflow: NotificationWorkflow = {
        id: 'condition-workflow',
        name: 'Conditional Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'check',
            name: 'Check condition',
            type: 'condition',
            config: {
              field: 'userLevel',
              operator: 'equals',
              value: 'premium',
              onTrue: 'premium-notify',
              onFalse: 'basic-notify'
            }
          },
          {
            id: 'premium-notify',
            name: 'Premium notification',
            type: 'notification',
            config: {
              notification: {
                title: 'Premium Feature',
                body: 'Exclusive for premium users'
              },
              channels: ['test'],
              recipients: [{ test: true }]
            },
            conditions: [{
              field: 'lastStepResult',
              operator: 'equals',
              value: true
            }]
          },
          {
            id: 'basic-notify',
            name: 'Basic notification',
            type: 'notification',
            config: {
              notification: {
                title: 'Basic Feature',
                body: 'Available for all users'
              },
              channels: ['test'],
              recipients: [{ test: true }]
            },
            conditions: [{
              field: 'lastStepResult',
              operator: 'equals',
              value: false
            }]
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);

      // Test with premium user
      const premiumResult = await workflowEngine.execute('condition-workflow', {
        userLevel: 'premium'
      });
      expect(premiumResult.success).toBe(true);
      expect(testChannel.sentMessages).toContainEqual(
        expect.objectContaining({
          content: expect.objectContaining({ title: 'Premium Feature' })
        })
      );

      // Clear messages
      testChannel.sentMessages = [];

      // Test with basic user
      const basicResult = await workflowEngine.execute('condition-workflow', {
        userLevel: 'basic'
      });
      expect(basicResult.success).toBe(true);
      expect(testChannel.sentMessages).toContainEqual(
        expect.objectContaining({
          content: expect.objectContaining({ title: 'Basic Feature' })
        })
      );
    });

    it('should execute parallel steps', async () => {
      const workflow: NotificationWorkflow = {
        id: 'parallel-workflow',
        name: 'Parallel Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'parallel',
            name: 'Send parallel notifications',
            type: 'parallel',
            config: {
              steps: [
                {
                  type: 'notification',
                  config: {
                    notification: { title: 'Email', body: 'Email notification' },
                    channels: ['test'],
                    recipients: [{ test: true, email: 'user@example.com' }]
                  }
                },
                {
                  type: 'notification',
                  config: {
                    notification: { title: 'SMS', body: 'SMS notification' },
                    channels: ['test'],
                    recipients: [{ test: true, phone: '+1234567890' }]
                  }
                }
              ]
            }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);
      const result = await workflowEngine.execute('parallel-workflow', {});

      expect(result.success).toBe(true);
      expect(testChannel.sentMessages).toHaveLength(2);
      expect(testChannel.sentMessages).toContainEqual(
        expect.objectContaining({
          content: expect.objectContaining({ title: 'Email' })
        })
      );
      expect(testChannel.sentMessages).toContainEqual(
        expect.objectContaining({
          content: expect.objectContaining({ title: 'SMS' })
        })
      );
    });

    it('should execute batch steps', async () => {
      const workflow: NotificationWorkflow = {
        id: 'batch-workflow',
        name: 'Batch Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'batch',
            name: 'Batch notifications',
            type: 'batch',
            config: {
              batchSize: 2,
              delay: 50,
              notification: {
                title: 'Batch notification',
                body: 'Sent in batches'
              },
              channels: ['test'],
              recipients: [
                { test: true, id: 'user1' },
                { test: true, id: 'user2' },
                { test: true, id: 'user3' },
                { test: true, id: 'user4' },
                { test: true, id: 'user5' }
              ]
            }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);
      const result = await workflowEngine.execute('batch-workflow', {});

      expect(result.success).toBe(true);
      // Should have sent 3 batches (2+2+1)
      expect(testChannel.sentMessages.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Error Handling', () => {
    it('should handle step errors with stop strategy', async () => {
      const workflow: NotificationWorkflow = {
        id: 'error-stop-workflow',
        name: 'Error Stop Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'error',
            name: 'Error step',
            type: 'notification',
            config: {
              notification: { title: 'Test', body: 'Test' },
              // Invalid config to trigger error
              channels: ['nonexistent'],
              recipients: []
            },
            onError: 'stop'
          },
          {
            id: 'next',
            name: 'Next step',
            type: 'notification',
            config: {
              notification: { title: 'Next', body: 'Should not execute' }
            }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);
      const result = await workflowEngine.execute('error-stop-workflow', {});

      expect(result.success).toBe(false);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].success).toBe(false);
    });

    it('should handle step errors with continue strategy', async () => {
      const testChannel = new TestChannel();
      channelManager.registerChannel('test', testChannel);

      const workflow: NotificationWorkflow = {
        id: 'error-continue-workflow',
        name: 'Error Continue Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'error',
            name: 'Error step',
            type: 'notification',
            config: {
              notification: { title: 'Error', body: 'Will fail' },
              channels: ['nonexistent']
            },
            onError: 'continue'
          },
          {
            id: 'success',
            name: 'Success step',
            type: 'notification',
            config: {
              notification: { title: 'Success', body: 'Should execute' },
              channels: ['test'],
              recipients: [{ test: true }]
            }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);
      const result = await workflowEngine.execute('error-continue-workflow', {});

      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].success).toBe(false);
      expect(result.steps[1].success).toBe(true);
      expect(testChannel.sentMessages).toHaveLength(1);
    });

    it('should handle step errors with retry strategy', async () => {
      let attempts = 0;
      class RetryTestChannel implements NotificationChannel {
        type = 'retry-test' as ChannelType;
        priority = 100;
        isAvailable = true;

        async validate(recipients: any[]): Promise<any[]> {
          return recipients;
        }

        formatContent(content: any): any {
          return content;
        }

        async send(): Promise<{ success: boolean }> {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary error');
          }
          return { success: true };
        }
      }

      const retryChannel = new RetryTestChannel();
      channelManager.registerChannel('retry-test', retryChannel);

      const workflow: NotificationWorkflow = {
        id: 'error-retry-workflow',
        name: 'Error Retry Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'retry',
            name: 'Retry step',
            type: 'notification',
            config: {
              notification: { title: 'Retry', body: 'Will retry' },
              channels: ['retry-test'],
              recipients: [{ id: 'user1' }]
            },
            onError: 'retry',
            retryAttempts: 3,
            retryDelay: 50
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);
      const result = await workflowEngine.execute('error-retry-workflow', {});

      expect(result.success).toBe(true);
      expect(attempts).toBe(3); // Failed twice, succeeded on third attempt
    });
  });

  describe('Workflow Context', () => {
    it('should maintain context throughout workflow', async () => {
      const workflow: NotificationWorkflow = {
        id: 'context-workflow',
        name: 'Context Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'set-context',
            name: 'Set context',
            type: 'condition',
            config: {
              field: 'input',
              operator: 'equals',
              value: 'test',
              setContext: { processedInput: 'TEST' }
            }
          },
          {
            id: 'use-context',
            name: 'Use context',
            type: 'notification',
            config: {
              notification: {
                title: '{{processedInput}}',
                body: 'Context value: {{processedInput}}'
              },
              channels: ['test'],
              recipients: [{ test: true }]
            }
          }
        ]
      };

      const testChannel = new TestChannel();
      channelManager.registerChannel('test', testChannel);

      workflowEngine.defineWorkflow(workflow);
      const result = await workflowEngine.execute('context-workflow', {
        input: 'test'
      });

      expect(result.success).toBe(true);
      expect(testChannel.sentMessages[0].content.title).toBe('TEST');
    });

    it('should store step results in context', async () => {
      const workflow: NotificationWorkflow = {
        id: 'result-context-workflow',
        name: 'Result Context Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'first',
            name: 'First step',
            type: 'notification',
            config: {
              notification: { title: 'First', body: 'First message' },
              channels: ['test'],
              recipients: [{ test: true }]
            }
          },
          {
            id: 'second',
            name: 'Second step',
            type: 'condition',
            config: {
              field: 'step_first_result.success',
              operator: 'equals',
              value: true
            }
          }
        ]
      };

      const testChannel = new TestChannel();
      channelManager.registerChannel('test', testChannel);

      workflowEngine.defineWorkflow(workflow);
      const result = await workflowEngine.execute('result-context-workflow', {});

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[1].success).toBe(true);
    });
  });

  describe('Workflow History', () => {
    it('should store workflow execution history', async () => {
      const workflow: NotificationWorkflow = {
        id: 'history-workflow',
        name: 'History Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'step1',
            name: 'Step 1',
            type: 'wait',
            config: { duration: 10 }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);
      await workflowEngine.execute('history-workflow', {});

      const history = await workflowEngine.getExecutionHistory('history-workflow');
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        workflowId: 'history-workflow',
        success: true
      });
    });

    it('should retrieve specific execution details', async () => {
      const workflow: NotificationWorkflow = {
        id: 'details-workflow',
        name: 'Details Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'step1',
            name: 'Step 1',
            type: 'wait',
            config: { duration: 10 }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);
      const result = await workflowEngine.execute('details-workflow', {});

      const details = await workflowEngine.getExecutionDetails(result.instanceId);
      expect(details).toMatchObject({
        instanceId: result.instanceId,
        workflowId: 'details-workflow',
        success: true,
        steps: expect.arrayContaining([
          expect.objectContaining({
            stepId: 'step1',
            success: true
          })
        ])
      });
    });

    it('should limit execution history', async () => {
      const workflow: NotificationWorkflow = {
        id: 'limit-history-workflow',
        name: 'Limit History Workflow',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'step1',
            name: 'Step 1',
            type: 'wait',
            config: { duration: 10 }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);

      // Execute multiple times
      for (let i = 0; i < 15; i++) {
        await workflowEngine.execute('limit-history-workflow', {});
      }

      const history = await workflowEngine.getExecutionHistory('limit-history-workflow', 10);
      expect(history).toHaveLength(10);
    });
  });

  describe('Complex Workflows', () => {
    it('should execute welcome series workflow', async () => {
      const testChannel = new TestChannel();
      channelManager.registerChannel('test', testChannel);

      const workflow: NotificationWorkflow = {
        id: 'welcome-series',
        name: 'Welcome Series',
        trigger: { type: 'manual' },
        steps: [
          {
            id: 'welcome',
            name: 'Welcome email',
            type: 'notification',
            config: {
              notification: {
                title: 'Welcome!',
                body: 'Welcome to our platform'
              },
              channels: ['test'],
              recipients: [{ test: true, id: 'newuser' }]
            }
          },
          {
            id: 'wait',
            name: 'Wait',
            type: 'wait',
            config: { duration: 100 }
          },
          {
            id: 'onboarding',
            name: 'Onboarding tips',
            type: 'notification',
            config: {
              notification: {
                title: 'Getting Started',
                body: 'Here are some tips...'
              },
              channels: ['test'],
              recipients: [{ test: true, id: 'newuser' }]
            }
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);
      const result = await workflowEngine.execute('welcome-series', {
        userId: 'newuser',
        email: 'newuser@example.com'
      });

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(3);
      expect(testChannel.sentMessages).toHaveLength(2);
      expect(testChannel.sentMessages[0].content.title).toBe('Welcome!');
      expect(testChannel.sentMessages[1].content.title).toBe('Getting Started');
    });

    it('should execute order processing workflow', async () => {
      const testChannel = new TestChannel();
      channelManager.registerChannel('test', testChannel);

      const workflow: NotificationWorkflow = {
        id: 'order-processing',
        name: 'Order Processing',
        trigger: { type: 'event', config: { event: 'order.created' } },
        steps: [
          {
            id: 'confirm',
            name: 'Order confirmation',
            type: 'notification',
            config: {
              notification: {
                title: 'Order Confirmed',
                body: 'Your order #{{orderId}} has been confirmed'
              },
              channels: ['test'],
              recipients: [{ test: true }]
            }
          },
          {
            id: 'check-stock',
            name: 'Check stock',
            type: 'condition',
            config: {
              field: 'hasStock',
              operator: 'equals',
              value: true
            }
          },
          {
            id: 'ship',
            name: 'Shipping notification',
            type: 'notification',
            config: {
              notification: {
                title: 'Order Shipped',
                body: 'Your order has been shipped'
              },
              channels: ['test'],
              recipients: [{ test: true }]
            },
            conditions: [{
              field: 'step_check-stock_result',
              operator: 'equals',
              value: true
            }]
          },
          {
            id: 'backorder',
            name: 'Backorder notification',
            type: 'notification',
            config: {
              notification: {
                title: 'Item Backordered',
                body: 'Your item is currently out of stock'
              },
              channels: ['test'],
              recipients: [{ test: true }]
            },
            conditions: [{
              field: 'step_check-stock_result',
              operator: 'equals',
              value: false
            }]
          }
        ]
      };

      workflowEngine.defineWorkflow(workflow);

      // Test with stock available
      const stockResult = await workflowEngine.execute('order-processing', {
        orderId: '12345',
        hasStock: true
      });

      expect(stockResult.success).toBe(true);
      expect(testChannel.sentMessages).toContainEqual(
        expect.objectContaining({
          content: expect.objectContaining({ title: 'Order Shipped' })
        })
      );

      // Clear messages
      testChannel.sentMessages = [];

      // Test without stock
      const noStockResult = await workflowEngine.execute('order-processing', {
        orderId: '12346',
        hasStock: false
      });

      expect(noStockResult.success).toBe(true);
      expect(testChannel.sentMessages).toContainEqual(
        expect.objectContaining({
          content: expect.objectContaining({ title: 'Item Backordered' })
        })
      );
    });
  });
});