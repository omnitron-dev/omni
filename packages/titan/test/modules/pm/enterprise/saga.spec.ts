/**
 * Saga and Distributed Transaction Tests
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  SagaOrchestrator,
  DistributedTransactionManager,
  type ISagaStep
} from '../../../../src/modules/pm/enterprise/saga.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
} as any;

// Test saga steps
class OrderSagaSteps {
  static inventoryReserved = false;
  static paymentCharged = false;
  static orderCreated = false;

  static async reserveInventory(items: any[]): Promise<{ reservationId: string }> {
    OrderSagaSteps.inventoryReserved = true;
    return { reservationId: 'res-123' };
  }

  static async releaseInventory(reservation: any): Promise<void> {
    OrderSagaSteps.inventoryReserved = false;
  }

  static async chargePayment(payment: any): Promise<{ transactionId: string }> {
    OrderSagaSteps.paymentCharged = true;
    return { transactionId: 'tx-456' };
  }

  static async refundPayment(transaction: any): Promise<void> {
    OrderSagaSteps.paymentCharged = false;
  }

  static async createOrder(data: any): Promise<{ orderId: string }> {
    OrderSagaSteps.orderCreated = true;
    return { orderId: 'order-789' };
  }

  static async cancelOrder(order: any): Promise<void> {
    OrderSagaSteps.orderCreated = false;
  }

  static reset(): void {
    OrderSagaSteps.inventoryReserved = false;
    OrderSagaSteps.paymentCharged = false;
    OrderSagaSteps.orderCreated = false;
  }
}

describe('SagaOrchestrator', () => {
  let orchestrator: SagaOrchestrator;

  beforeEach(() => {
    orchestrator = new SagaOrchestrator(mockLogger as any, {
      mode: 'orchestration',
      timeout: 5000,
      retries: 2
    });
    OrderSagaSteps.reset();
  });

  describe('Saga Execution', () => {
    it('should execute saga steps in order', async () => {
      const steps: ISagaStep[] = [
        {
          name: 'reserve-inventory',
          handler: OrderSagaSteps.reserveInventory,
          compensate: OrderSagaSteps.releaseInventory
        },
        {
          name: 'charge-payment',
          handler: OrderSagaSteps.chargePayment,
          compensate: OrderSagaSteps.refundPayment,
          dependsOn: ['reserve-inventory']
        },
        {
          name: 'create-order',
          handler: OrderSagaSteps.createOrder,
          compensate: OrderSagaSteps.cancelOrder,
          dependsOn: ['charge-payment']
        }
      ];

      orchestrator.registerSaga('order-saga', steps);

      const result = await orchestrator.execute('order-saga', {
        items: ['item1', 'item2'],
        payment: { amount: 100 }
      });

      expect(result).toBeDefined();
      expect(OrderSagaSteps.inventoryReserved).toBe(true);
      expect(OrderSagaSteps.paymentCharged).toBe(true);
      expect(OrderSagaSteps.orderCreated).toBe(true);
    });

    it('should execute parallel steps concurrently', async () => {
      const executionOrder: string[] = [];

      const steps: ISagaStep[] = [
        {
          name: 'step1',
          handler: async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            executionOrder.push('step1');
            return 'result1';
          },
          parallel: true
        },
        {
          name: 'step2',
          handler: async () => {
            executionOrder.push('step2');
            return 'result2';
          },
          parallel: true
        },
        {
          name: 'step3',
          handler: async () => {
            executionOrder.push('step3');
            return 'result3';
          },
          dependsOn: ['step1', 'step2']
        }
      ];

      orchestrator.registerSaga('parallel-saga', steps);
      await orchestrator.execute('parallel-saga');

      // Step 2 should complete before step 1 due to parallel execution
      expect(executionOrder[0]).toBe('step2');
      expect(executionOrder[1]).toBe('step1');
      expect(executionOrder[2]).toBe('step3');
    });
  });

  describe('Compensation', () => {
    it('should run compensation on failure', async () => {
      const steps: ISagaStep[] = [
        {
          name: 'reserve-inventory',
          handler: OrderSagaSteps.reserveInventory,
          compensate: OrderSagaSteps.releaseInventory
        },
        {
          name: 'charge-payment',
          handler: async () => {
            throw new Error('Payment failed');
          },
          compensate: OrderSagaSteps.refundPayment,
          dependsOn: ['reserve-inventory']
        }
      ];

      orchestrator.registerSaga('failing-saga', steps);

      await expect(orchestrator.execute('failing-saga')).rejects.toThrow('Payment failed');

      // Inventory should be released (compensated)
      expect(OrderSagaSteps.inventoryReserved).toBe(false);
    });

    it('should compensate in reverse order', async () => {
      const compensationOrder: string[] = [];

      const steps: ISagaStep[] = [
        {
          name: 'step1',
          handler: async () => 'result1',
          compensate: async () => {
            compensationOrder.push('compensate1');
          }
        },
        {
          name: 'step2',
          handler: async () => 'result2',
          compensate: async () => {
            compensationOrder.push('compensate2');
          },
          dependsOn: ['step1']
        },
        {
          name: 'step3',
          handler: async () => {
            throw new Error('Step 3 failed');
          },
          compensate: async () => {
            compensationOrder.push('compensate3');
          },
          dependsOn: ['step2']
        }
      ];

      orchestrator.registerSaga('compensation-order-saga', steps);

      await expect(orchestrator.execute('compensation-order-saga')).rejects.toThrow();

      // Compensation should run in reverse order
      expect(compensationOrder).toEqual(['compensate2', 'compensate1']);
    });
  });

  describe('Choreography Mode', () => {
    it('should execute saga in choreography mode', async () => {
      const choreographyOrchestrator = new SagaOrchestrator(mockLogger as any, {
        mode: 'choreography'
      });

      const steps: ISagaStep[] = [
        {
          name: 'init',
          handler: async () => ({ initialized: true })
        },
        {
          name: 'process',
          handler: async (data: any) => ({ ...data, processed: true }),
          dependsOn: ['init']
        }
      ];

      choreographyOrchestrator.registerSaga('choreography-saga', steps);
      const result = await choreographyOrchestrator.execute('choreography-saga');

      expect(result).toBeDefined();
      expect(result.init).toEqual({ initialized: true });
      expect(result.process).toHaveProperty('processed', true);
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed steps', async () => {
      let attempts = 0;

      const steps: ISagaStep[] = [
        {
          name: 'flaky-step',
          handler: async () => {
            attempts++;
            if (attempts < 2) {
              throw new Error('Temporary failure');
            }
            return 'success';
          },
          retries: 2
        }
      ];

      orchestrator.registerSaga('retry-saga', steps);
      const result = await orchestrator.execute('retry-saga');

      expect(attempts).toBe(2);
      expect(result['flaky-step']).toBe('success');
    });
  });

  describe('Saga Status', () => {
    it('should track saga execution status', async () => {
      const steps: ISagaStep[] = [
        {
          name: 'simple-step',
          handler: async () => 'done'
        }
      ];

      orchestrator.registerSaga('status-saga', steps);

      // Start saga execution
      const executePromise = orchestrator.execute('status-saga');

      // Get all sagas (should include the running one)
      const allSagas = orchestrator.getAllSagas();
      expect(allSagas.length).toBeGreaterThan(0);

      await executePromise;

      // Check completed saga
      const saga = allSagas[0];
      expect(saga.state).toBe('completed');
      expect(saga.steps.size).toBe(1);
    });
  });
});

describe('DistributedTransactionManager', () => {
  let txManager: DistributedTransactionManager;

  beforeEach(() => {
    txManager = new DistributedTransactionManager(mockLogger as any);
  });

  describe('Two-Phase Commit', () => {
    it('should execute 2PC successfully', async () => {
      // Mock participant
      const participant1 = {
        prepared: false,
        committed: false,
        async prepare(txId: string): Promise<boolean> {
          this.prepared = true;
          return true;
        },
        async commit(txId: string): Promise<void> {
          this.committed = true;
        },
        async rollback(txId: string): Promise<void> {
          this.prepared = false;
          this.committed = false;
        }
      };

      const participant2 = {
        prepared: false,
        committed: false,
        async prepare(txId: string): Promise<boolean> {
          this.prepared = true;
          return true;
        },
        async commit(txId: string): Promise<void> {
          this.committed = true;
        },
        async rollback(txId: string): Promise<void> {
          this.prepared = false;
          this.committed = false;
        }
      };

      // Register participants
      txManager.registerParticipant('p1', participant1);
      txManager.registerParticipant('p2', participant2);

      // Begin transaction
      const txId = await txManager.begin();
      txManager.addParticipant(txId, 'p1');
      txManager.addParticipant(txId, 'p2');

      // Prepare phase
      const canCommit = await txManager.prepare(txId);
      expect(canCommit).toBe(true);
      expect(participant1.prepared).toBe(true);
      expect(participant2.prepared).toBe(true);

      // Commit phase
      await txManager.commit(txId);
      expect(participant1.committed).toBe(true);
      expect(participant2.committed).toBe(true);
    });

    it('should rollback when prepare fails', async () => {
      const participant1 = {
        prepared: false,
        async prepare(txId: string): Promise<boolean> {
          this.prepared = true;
          return true;
        },
        async commit(txId: string): Promise<void> {},
        async rollback(txId: string): Promise<void> {
          this.prepared = false;
        }
      };

      const participant2 = {
        prepared: false,
        async prepare(txId: string): Promise<boolean> {
          // This participant fails to prepare
          return false;
        },
        async commit(txId: string): Promise<void> {},
        async rollback(txId: string): Promise<void> {
          this.prepared = false;
        }
      };

      txManager.registerParticipant('p1', participant1);
      txManager.registerParticipant('p2', participant2);

      const txId = await txManager.begin();
      txManager.addParticipant(txId, 'p1');
      txManager.addParticipant(txId, 'p2');

      const canCommit = await txManager.prepare(txId);
      expect(canCommit).toBe(false);

      // Should rollback
      await txManager.rollback(txId);
      expect(participant1.prepared).toBe(false);
    });

    it('should handle transaction not found', async () => {
      await expect(txManager.prepare('non-existent')).rejects.toThrow('Transaction non-existent not found');
      await expect(txManager.commit('non-existent')).rejects.toThrow('Transaction non-existent cannot be committed');
    });
  });
});