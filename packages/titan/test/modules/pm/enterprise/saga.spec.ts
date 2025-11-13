/**
 * Comprehensive Tests for Saga Pattern
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  SagaOrchestrator,
  DistributedTransactionManager,
  type ISagaConfig,
  type ISagaStep,
  type ITransactionParticipant,
} from '../../../../src/modules/pm/enterprise/saga.js';

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

describe('Saga Orchestrator', () => {
  let orchestrator: SagaOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    
    const config: ISagaConfig = {
      mode: 'orchestration',
      timeout: 5000,
      retries: 2,
    };

    orchestrator = new SagaOrchestrator(mockLogger as any, config);
  });

  describe('Saga Registration', () => {
    it('should register saga definition', () => {
      const steps: ISagaStep[] = [
        {
          name: 'step1',
          handler: async () => ({ result: 'step1' }),
        },
        {
          name: 'step2',
          handler: async () => ({ result: 'step2' }),
        },
      ];

      orchestrator.registerSaga('test-saga', steps);
      
      // Verify registration
      expect((orchestrator as any).stepDefinitions.has('test-saga')).toBe(true);
    });

    it('should store all step definitions', () => {
      const steps: ISagaStep[] = [
        { name: 'step1', handler: async () => {} },
        { name: 'step2', handler: async () => {} },
        { name: 'step3', handler: async () => {} },
      ];

      orchestrator.registerSaga('multi-step-saga', steps);

      const registered = (orchestrator as any).stepDefinitions.get('multi-step-saga');
      expect(registered.size).toBe(3);
    });
  });

  describe('Saga Execution', () => {
    it('should execute simple saga successfully', async () => {
      const results: string[] = [];

      const steps: ISagaStep[] = [
        {
          name: 'reserve-inventory',
          handler: async () => {
            results.push('inventory-reserved');
            return { reserved: true };
          },
        },
        {
          name: 'charge-payment',
          handler: async () => {
            results.push('payment-charged');
            return { charged: true };
          },
        },
        {
          name: 'ship-order',
          handler: async () => {
            results.push('order-shipped');
            return { shipped: true };
          },
        },
      ];

      orchestrator.registerSaga('order-saga', steps);

      const result = await orchestrator.execute('order-saga', {
        orderId: 'order-123',
      });

      expect(results).toEqual([
        'inventory-reserved',
        'payment-charged',
        'order-shipped',
      ]);
      expect(result).toBeDefined();
    });

    it('should pass data between steps', async () => {
      const steps: ISagaStep[] = [
        {
          name: 'step1',
          handler: async (input) => {
            return { value: input.initial * 2 };
          },
        },
        {
          name: 'step2',
          handler: async (input) => {
            return { value: input.value * 3 };
          },
          dependsOn: ['step1'],
        },
      ];

      orchestrator.registerSaga('data-passing-saga', steps);

      const result = await orchestrator.execute('data-passing-saga', {
        initial: 5,
      });

      expect(result.step2?.value).toBe(30); // 5 * 2 * 3
    });

    it('should handle step dependencies', async () => {
      const executionOrder: string[] = [];

      const steps: ISagaStep[] = [
        {
          name: 'step-a',
          handler: async () => {
            executionOrder.push('a');
            return { a: true };
          },
        },
        {
          name: 'step-b',
          handler: async () => {
            executionOrder.push('b');
            return { b: true };
          },
          dependsOn: ['step-a'],
        },
        {
          name: 'step-c',
          handler: async () => {
            executionOrder.push('c');
            return { c: true };
          },
          dependsOn: ['step-a', 'step-b'],
        },
      ];

      orchestrator.registerSaga('dependency-saga', steps);

      await orchestrator.execute('dependency-saga');

      expect(executionOrder).toEqual(['a', 'b', 'c']);
    });

    it('should execute parallel steps concurrently', async () => {
      const startTimes: Record<string, number> = {};

      const steps: ISagaStep[] = [
        {
          name: 'parallel-1',
          handler: async () => {
            startTimes['parallel-1'] = Date.now();
            await new Promise(resolve => setTimeout(resolve, 50));
            return { p1: true };
          },
          parallel: true,
        },
        {
          name: 'parallel-2',
          handler: async () => {
            startTimes['parallel-2'] = Date.now();
            await new Promise(resolve => setTimeout(resolve, 50));
            return { p2: true };
          },
          parallel: true,
        },
      ];

      orchestrator.registerSaga('parallel-saga', steps);

      const start = Date.now();
      await orchestrator.execute('parallel-saga');
      const duration = Date.now() - start;

      // Should complete in ~50ms, not 100ms
      expect(duration).toBeLessThan(100);
      expect(Math.abs(startTimes['parallel-1']! - startTimes['parallel-2']!)).toBeLessThan(10);
    });

    it('should retry failed steps', async () => {
      let attempt = 0;

      const steps: ISagaStep[] = [
        {
          name: 'flaky-step',
          handler: async () => {
            attempt++;
            if (attempt < 3) {
              throw new Error('Temporary failure');
            }
            return { success: true, attempts: attempt };
          },
          retries: 3,
        },
      ];

      orchestrator.registerSaga('retry-saga', steps);

      const result = await orchestrator.execute('retry-saga');

      expect(result['flaky-step'].attempts).toBe(3);
      expect(attempt).toBe(3);
    });

    it('should timeout long-running steps', async () => {
      const steps: ISagaStep[] = [
        {
          name: 'slow-step',
          handler: async () => {
            await new Promise(resolve => setTimeout(resolve, 2000));
            return { done: true };
          },
          timeout: 100,
        },
      ];

      orchestrator.registerSaga('timeout-saga', steps);

      await expect(
        orchestrator.execute('timeout-saga')
      ).rejects.toThrow();
    });
  });

  describe('Saga Compensation', () => {
    it('should compensate completed steps on failure', async () => {
      const compensated: string[] = [];

      const steps: ISagaStep[] = [
        {
          name: 'reserve-inventory',
          handler: async () => ({ reserved: true }),
          compensate: async () => {
            compensated.push('inventory');
          },
        },
        {
          name: 'charge-payment',
          handler: async () => ({ charged: true }),
          compensate: async () => {
            compensated.push('payment');
          },
        },
        {
          name: 'failing-step',
          handler: async () => {
            throw new Error('Step failed');
          },
          compensate: async () => {
            compensated.push('failing');
          },
        },
      ];

      orchestrator.registerSaga('compensation-saga', steps);

      await expect(
        orchestrator.execute('compensation-saga')
      ).rejects.toThrow();

      // Should compensate in reverse order
      expect(compensated).toEqual(['payment', 'inventory']);
    });

    it('should not compensate failed steps', async () => {
      const compensated: string[] = [];

      const steps: ISagaStep[] = [
        {
          name: 'success-step',
          handler: async () => ({ success: true }),
          compensate: async () => {
            compensated.push('success');
          },
        },
        {
          name: 'fail-step',
          handler: async () => {
            throw new Error('Failed');
          },
          compensate: async () => {
            compensated.push('fail');
          },
        },
      ];

      orchestrator.registerSaga('partial-compensation', steps);

      await expect(
        orchestrator.execute('partial-compensation')
      ).rejects.toThrow();

      expect(compensated).toEqual(['success']);
      expect(compensated).not.toContain('fail');
    });

    it('should log compensation failures but continue', async () => {
      const steps: ISagaStep[] = [
        {
          name: 'step1',
          handler: async () => ({ done: true }),
          compensate: async () => {
            throw new Error('Compensation failed');
          },
        },
        {
          name: 'step2',
          handler: async () => {
            throw new Error('Step failed');
          },
        },
      ];

      orchestrator.registerSaga('compensation-error-saga', steps);

      await expect(
        orchestrator.execute('compensation-error-saga')
      ).rejects.toThrow('Step failed');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Choreography Mode', () => {
    beforeEach(() => {
      orchestrator = new SagaOrchestrator(mockLogger as any, {
        mode: 'choreography',
      });
    });

    it('should execute saga in choreography mode', async () => {
      const executed: string[] = [];

      const steps: ISagaStep[] = [
        {
          name: 'event-a',
          handler: async () => {
            executed.push('a');
            return { a: true };
          },
        },
        {
          name: 'event-b',
          handler: async () => {
            executed.push('b');
            return { b: true };
          },
          dependsOn: ['event-a'],
        },
      ];

      orchestrator.registerSaga('event-saga', steps);

      await orchestrator.execute('event-saga');

      expect(executed).toEqual(['a', 'b']);
    });
  });

  describe('Saga Status', () => {
    it('should track saga execution status', async () => {
      const steps: ISagaStep[] = [
        {
          name: 'step1',
          handler: async () => {
            return { done: true };
          },
        },
      ];

      orchestrator.registerSaga('status-saga', steps);

      const promise = orchestrator.execute('status-saga');
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const sagas = orchestrator.getAllSagas();
      expect(sagas.length).toBeGreaterThan(0);

      await promise;
    });

    it('should provide saga status by ID', async () => {
      const steps: ISagaStep[] = [
        {
          name: 'step1',
          handler: async () => ({ done: true }),
        },
      ];

      orchestrator.registerSaga('tracked-saga', steps);

      let sagaId: string | undefined;
      orchestrator.on('saga:started', (context) => {
        sagaId = context.id;
      });

      await orchestrator.execute('tracked-saga');

      if (sagaId) {
        const status = orchestrator.getSagaStatus(sagaId);
        expect(status).toBeDefined();
        expect(status?.state).toBe('completed');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should throw error for non-existent saga', async () => {
      await expect(
        orchestrator.execute('non-existent-saga')
      ).rejects.toThrow('not found');
    });

    it('should detect circular dependencies', () => {
      const steps: ISagaStep[] = [
        {
          name: 'step-a',
          handler: async () => ({}),
          dependsOn: ['step-b'],
        },
        {
          name: 'step-b',
          handler: async () => ({}),
          dependsOn: ['step-a'],
        },
      ];

      orchestrator.registerSaga('circular-saga', steps);

      expect(
        orchestrator.execute('circular-saga')
      ).rejects.toThrow('Circular dependency');
    });
  });
});

describe('Distributed Transaction Manager', () => {
  let txManager: DistributedTransactionManager;

  beforeEach(() => {
    txManager = new DistributedTransactionManager(mockLogger as any);
  });

  describe('Transaction Lifecycle', () => {
    it('should begin transaction', async () => {
      const txId = await txManager.begin();
      
      expect(txId).toBeDefined();
      expect(txId).toMatch(/^tx-/);
    });

    it('should prepare transaction', async () => {
      const txId = await txManager.begin();

      const participant: ITransactionParticipant = {
        prepare: async () => true,
        commit: async () => {},
        rollback: async () => {},
      };

      txManager.registerParticipant('participant-1', participant);
      txManager.addParticipant(txId, 'participant-1');

      const prepared = await txManager.prepare(txId);
      expect(prepared).toBe(true);
    });

    it('should commit prepared transaction', async () => {
      let committed = false;

      const txId = await txManager.begin();

      const participant: ITransactionParticipant = {
        prepare: async () => true,
        commit: async () => { committed = true; },
        rollback: async () => {},
      };

      txManager.registerParticipant('participant-1', participant);
      txManager.addParticipant(txId, 'participant-1');

      await txManager.prepare(txId);
      await txManager.commit(txId);

      expect(committed).toBe(true);
    });

    it('should rollback transaction', async () => {
      let rolledBack = false;

      const txId = await txManager.begin();

      const participant: ITransactionParticipant = {
        prepare: async () => true,
        commit: async () => {},
        rollback: async () => { rolledBack = true; },
      };

      txManager.registerParticipant('participant-1', participant);
      txManager.addParticipant(txId, 'participant-1');

      await txManager.rollback(txId);

      expect(rolledBack).toBe(true);
    });

    it('should abort if prepare fails', async () => {
      const txId = await txManager.begin();

      const participant: ITransactionParticipant = {
        prepare: async () => false,
        commit: async () => {},
        rollback: async () => {},
      };

      txManager.registerParticipant('participant-1', participant);
      txManager.addParticipant(txId, 'participant-1');

      const prepared = await txManager.prepare(txId);
      expect(prepared).toBe(false);
    });
  });

  describe('Multiple Participants', () => {
    it('should coordinate multiple participants', async () => {
      const committed: string[] = [];

      const txId = await txManager.begin();

      const createParticipant = (id: string): ITransactionParticipant => ({
        prepare: async () => true,
        commit: async () => { committed.push(id); },
        rollback: async () => {},
      });

      txManager.registerParticipant('p1', createParticipant('p1'));
      txManager.registerParticipant('p2', createParticipant('p2'));
      txManager.registerParticipant('p3', createParticipant('p3'));

      txManager.addParticipant(txId, 'p1');
      txManager.addParticipant(txId, 'p2');
      txManager.addParticipant(txId, 'p3');

      await txManager.prepare(txId);
      await txManager.commit(txId);

      expect(committed).toEqual(['p1', 'p2', 'p3']);
    });

    it('should abort if any participant fails prepare', async () => {
      const txId = await txManager.begin();

      txManager.registerParticipant('p1', {
        prepare: async () => true,
        commit: async () => {},
        rollback: async () => {},
      });

      txManager.registerParticipant('p2', {
        prepare: async () => false,
        commit: async () => {},
        rollback: async () => {},
      });

      txManager.addParticipant(txId, 'p1');
      txManager.addParticipant(txId, 'p2');

      const prepared = await txManager.prepare(txId);
      expect(prepared).toBe(false);
    });
  });
});
