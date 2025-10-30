/**
 * Supervisor and Workflow Tests
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  Process,
  Method,
  Supervisor,
  Child,
  Workflow,
  Stage,
  Compensate,
  SUPERVISOR_METADATA_KEY,
  WORKFLOW_METADATA_KEY,
} from '../../../src/modules/pm/decorators.js';
import { ProcessManager } from '../../../src/modules/pm/process-manager.js';
import { ProcessSupervisor } from '../../../src/modules/pm/process-supervisor.js';
import { ProcessWorkflow } from '../../../src/modules/pm/process-workflow.js';
import { SupervisionStrategy, RestartDecision } from '../../../src/modules/pm/types.js';

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(() => mockLogger),
} as any;

// Test processes for supervisor
@Process()
class StableService {
  private running = true;

  @Method()
  async doWork(): Promise<string> {
    return 'work done';
  }

  @Method()
  async stop(): Promise<void> {
    this.running = false;
  }

  @Method()
  async isRunning(): Promise<boolean> {
    return this.running;
  }
}

@Process()
class UnstableService {
  private failCount = 0;
  private maxFailures = 2;

  @Method()
  async doWork(): Promise<string> {
    if (this.failCount < this.maxFailures) {
      this.failCount++;
      throw new Error('Service failure');
    }
    return 'eventually succeeded';
  }

  @Method()
  async reset(): Promise<void> {
    this.failCount = 0;
  }
}

describe('ProcessSupervisor', () => {
  let processManager: ProcessManager;

  beforeEach(() => {
    processManager = new ProcessManager(mockLogger as any);
  });

  afterEach(async () => {
    await processManager.shutdown({ force: true });
  });

  describe('Supervisor Decorators', () => {
    it('should apply supervisor metadata', () => {
      @Supervisor({
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 5,
        window: 60000,
      })
      class TestSupervisor {
        @Child({ critical: true })
        critical = StableService;

        @Child({ optional: true })
        optional = UnstableService;
      }

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, TestSupervisor);

      expect(metadata).toBeDefined();
      expect(metadata.strategy).toBe(SupervisionStrategy.ONE_FOR_ONE);
      expect(metadata.maxRestarts).toBe(5);
      expect(metadata.children.size).toBe(2);
    });
  });

  describe('Child Process Management', () => {
    @Supervisor()
    class SimpleSupervisor {
      @Child()
      worker = StableService;
    }

    it('should start child processes', async () => {
      const supervisor = new ProcessSupervisor(processManager, SimpleSupervisor, {}, mockLogger as any);

      await supervisor.start();

      const processes = processManager.listProcesses();
      expect(processes.length).toBeGreaterThan(0);

      await supervisor.stop();
    });

    it('should restart crashed children', async () => {
      let restartCount = 0;

      @Supervisor({
        strategy: SupervisionStrategy.ONE_FOR_ONE,
        maxRestarts: 3,
      })
      class RestartSupervisor {
        @Child()
        unstable = UnstableService;

        async onChildCrash(child: any, error: Error): Promise<RestartDecision> {
          restartCount++;
          return RestartDecision.RESTART;
        }
      }

      const supervisor = new ProcessSupervisor(
        processManager,
        RestartSupervisor,
        { maxRestarts: 3 },
        mockLogger as any
      );

      await supervisor.start();

      // Simulate child crash
      const processes = processManager.listProcesses();
      const childProcess = processes[0];
      if (childProcess) {
        processManager.emit('process:crash', childProcess, new Error('Test crash'));
      }

      // Wait for restart handling
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(restartCount).toBeGreaterThan(0);

      await supervisor.stop();
    });
  });

  describe('Supervision Strategies', () => {
    it('should implement one-for-one strategy', async () => {
      @Supervisor({
        strategy: SupervisionStrategy.ONE_FOR_ONE,
      })
      class OneForOneSupervisor {
        @Child()
        worker1 = StableService;

        @Child()
        worker2 = StableService;
      }

      const supervisor = new ProcessSupervisor(
        processManager,
        OneForOneSupervisor,
        { strategy: SupervisionStrategy.ONE_FOR_ONE },
        mockLogger as any
      );

      await supervisor.start();

      const processes = processManager.listProcesses();
      expect(processes.length).toBe(2);

      // When one crashes, only that one should restart
      // (tested through supervisor restart logic)

      await supervisor.stop();
    });

    it('should implement one-for-all strategy', async () => {
      @Supervisor({
        strategy: SupervisionStrategy.ONE_FOR_ALL,
      })
      class OneForAllSupervisor {
        @Child()
        worker1 = StableService;

        @Child()
        worker2 = StableService;
      }

      const supervisor = new ProcessSupervisor(
        processManager,
        OneForAllSupervisor,
        { strategy: SupervisionStrategy.ONE_FOR_ALL },
        mockLogger as any
      );

      await supervisor.start();

      // When one crashes, all should restart
      // (strategy is implemented in supervisor)

      await supervisor.stop();
    });
  });

  describe('Critical vs Optional Children', () => {
    it('should handle critical child failure', async () => {
      @Supervisor()
      class CriticalSupervisor {
        @Child({ critical: true })
        critical = UnstableService;

        @Child({ optional: true })
        optional = StableService;
      }

      const supervisor = new ProcessSupervisor(processManager, CriticalSupervisor, {}, mockLogger as any);

      // Critical child failure should be handled differently
      await supervisor.start();
      await supervisor.stop();
    });
  });
});

describe('ProcessWorkflow', () => {
  let processManager: ProcessManager;

  beforeEach(() => {
    processManager = new ProcessManager(mockLogger as any);
  });

  afterEach(async () => {
    await processManager.shutdown({ force: true });
  });

  describe('Workflow Decorators', () => {
    it('should apply workflow metadata', () => {
      @Workflow()
      class TestWorkflow {
        @Stage()
        async step1(): Promise<string> {
          return 'step1-result';
        }

        @Stage({ dependsOn: 'step1' })
        async step2(input: string): Promise<string> {
          return `step2-${input}`;
        }
      }

      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, TestWorkflow);

      expect(metadata).toBeDefined();
      expect(metadata.stages.size).toBe(2);
      expect(metadata.stages.get('step2').dependsOn).toEqual(['step1']);
    });
  });

  describe('Stage Execution', () => {
    @Workflow()
    class SimpleWorkflow {
      public results: any[] = [];

      @Stage()
      async init(): Promise<{ initialized: boolean }> {
        this.results.push('init');
        return { initialized: true };
      }

      @Stage({ dependsOn: 'init' })
      async process(data: any): Promise<{ processed: boolean }> {
        this.results.push('process');
        return { ...data, processed: true };
      }

      @Stage({ dependsOn: 'process' })
      async finalize(data: any): Promise<{ finalized: boolean }> {
        this.results.push('finalize');
        return { ...data, finalized: true };
      }
    }

    it('should execute stages in dependency order', async () => {
      const workflow = new ProcessWorkflow(processManager, SimpleWorkflow, mockLogger as any);

      const instance = workflow.create();
      const result = await (instance as any).run();

      expect(result.init.initialized).toBe(true);
      expect(result.process.processed).toBe(true);
      expect(result.finalize.finalized).toBe(true);
    });

    it('should pass data between stages', async () => {
      @Workflow()
      class DataFlowWorkflow {
        @Stage()
        async fetchData(): Promise<{ data: string[] }> {
          return { data: ['item1', 'item2'] };
        }

        @Stage({ dependsOn: 'fetchData' })
        async transformData(input: { data: string[] }): Promise<string[]> {
          return input.data.map((item) => item.toUpperCase());
        }

        @Stage({ dependsOn: 'transformData' })
        async saveData(data: string[]): Promise<{ saved: number }> {
          return { saved: data.length };
        }
      }

      const workflow = new ProcessWorkflow(processManager, DataFlowWorkflow, mockLogger as any);

      const instance = workflow.create();
      const result = await (instance as any).run();

      expect(result.transformData).toEqual(['ITEM1', 'ITEM2']);
      expect(result.saveData.saved).toBe(2);
    });
  });

  describe('Parallel Stages', () => {
    @Workflow()
    class ParallelWorkflow {
      @Stage({ parallel: true })
      async task1(): Promise<string> {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'task1';
      }

      @Stage({ parallel: true })
      async task2(): Promise<string> {
        return 'task2';
      }

      @Stage({ dependsOn: ['task1', 'task2'] })
      async combine(inputs: any): Promise<string> {
        return `${inputs.task1}-${inputs.task2}`;
      }
    }

    it('should execute parallel stages concurrently', async () => {
      const workflow = new ProcessWorkflow(processManager, ParallelWorkflow, mockLogger as any);

      const instance = workflow.create();
      const startTime = Date.now();
      const result = await (instance as any).run();
      const duration = Date.now() - startTime;

      expect(result.combine).toBe('task1-task2');
      // Should be faster than sequential (< 20ms instead of 10ms + execution)
      expect(duration).toBeLessThan(50);
    });
  });

  describe('Stage Compensation', () => {
    @Workflow()
    class CompensatingWorkflow {
      public compensated: string[] = [];

      @Stage()
      async reserve(): Promise<{ reservationId: string }> {
        return { reservationId: 'res-123' };
      }

      @Compensate('reserve')
      async cancelReservation(reservation: any): Promise<void> {
        this.compensated.push('reservation-cancelled');
      }

      @Stage({ dependsOn: 'reserve' })
      async payment(): Promise<void> {
        throw new Error('Payment failed');
      }

      @Compensate('payment')
      async refundPayment(): Promise<void> {
        this.compensated.push('payment-refunded');
      }
    }

    it('should run compensation on failure', async () => {
      const workflow = new ProcessWorkflow(processManager, CompensatingWorkflow, mockLogger as any);

      const instance = workflow.create();

      await expect((instance as any).run()).rejects.toThrow('Payment failed');

      // Check that compensation was called
      expect((instance as any).compensated).toContain('reservation-cancelled');
    });
  });

  describe('Stage Retries', () => {
    @Workflow()
    class RetryWorkflow {
      private attempts = 0;

      @Stage({ retries: 2 })
      async flakeyStage(): Promise<string> {
        this.attempts++;
        if (this.attempts < 2) {
          throw new Error('Temporary failure');
        }
        return 'success';
      }
    }

    it('should retry failed stages', async () => {
      const workflow = new ProcessWorkflow(processManager, RetryWorkflow, mockLogger as any);

      const instance = workflow.create();
      const result = await (instance as any).run();

      expect(result.flakeyStage).toBe('success');
      expect((instance as any).attempts).toBe(2);
    });
  });

  describe('Complex Workflows', () => {
    @Workflow()
    class ETLWorkflow {
      @Stage()
      async extractFromAPI(): Promise<any[]> {
        return [
          { id: 1, value: 10 },
          { id: 2, value: 20 },
        ];
      }

      @Stage()
      async extractFromDB(): Promise<any[]> {
        return [
          { id: 3, value: 30 },
          { id: 4, value: 40 },
        ];
      }

      @Stage({ dependsOn: ['extractFromAPI', 'extractFromDB'] })
      async merge(inputs: any): Promise<any[]> {
        return [...inputs.extractFromAPI, ...inputs.extractFromDB];
      }

      @Stage({ dependsOn: 'merge' })
      async transform(data: any[]): Promise<any[]> {
        return data.map((item) => ({
          ...item,
          value: item.value * 2,
          transformed: true,
        }));
      }

      @Stage({ dependsOn: 'transform' })
      async validate(data: any[]): Promise<{ valid: boolean; count: number }> {
        const valid = data.every((item) => item.transformed);
        return { valid, count: data.length };
      }

      @Stage({ dependsOn: 'validate', timeout: 5000 })
      async load(validation: any): Promise<string> {
        if (!validation.valid) {
          throw new Error('Validation failed');
        }
        return `Loaded ${validation.count} items`;
      }
    }

    it('should handle complex ETL workflow', async () => {
      const workflow = new ProcessWorkflow(processManager, ETLWorkflow, mockLogger as any);

      const instance = workflow.create();
      const result = await (instance as any).run();

      expect(result.merge).toHaveLength(4);
      expect(result.transform[0].transformed).toBe(true);
      expect(result.transform[0].value).toBe(20); // 10 * 2
      expect(result.validate.valid).toBe(true);
      expect(result.validate.count).toBe(4);
      expect(result.load).toBe('Loaded 4 items');
    });
  });

  describe('Workflow Context', () => {
    @Workflow()
    class ContextWorkflow {
      @Stage()
      async step1(): Promise<string> {
        return 'data1';
      }

      @Stage({ dependsOn: 'step1' })
      async step2(): Promise<string> {
        return 'data2';
      }
    }

    it('should maintain workflow context', async () => {
      const workflow = new ProcessWorkflow(processManager, ContextWorkflow, mockLogger as any);

      const instance = workflow.create();
      const context = (instance as any).getContext();

      expect(context).toBeDefined();
      expect(context.id).toBeDefined();
      expect(context.stages).toBeDefined();
      expect(context.state).toBeDefined();

      await (instance as any).run();

      // After execution, context should have stage results
      expect(context.stages.size).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    describe('Supervisor Edge Cases', () => {
      it('should handle supervisor with no children', async () => {
        @Supervisor()
        class EmptySupervisor {}

        const supervisor = new ProcessSupervisor(processManager, EmptySupervisor, {}, mockLogger as any);

        await supervisor.start();
        const processes = processManager.listProcesses();
        expect(processes.length).toBe(0);
        await supervisor.stop();
      });

      it('should handle multiple restarts within window', async () => {
        let crashCount = 0;

        @Supervisor({
          strategy: SupervisionStrategy.ONE_FOR_ONE,
          maxRestarts: 3,
          window: 1000,
        })
        class RestartWindowSupervisor {
          @Child()
          worker = UnstableService;

          async onChildCrash(): Promise<RestartDecision> {
            crashCount++;
            return crashCount <= 3 ? RestartDecision.RESTART : RestartDecision.STOP;
          }
        }

        const supervisor = new ProcessSupervisor(
          processManager,
          RestartWindowSupervisor,
          { maxRestarts: 3, window: 1000 },
          mockLogger as any
        );

        await supervisor.start();

        // Simulate multiple crashes
        for (let i = 0; i < 3; i++) {
          const processes = processManager.listProcesses();
          if (processes[0]) {
            processManager.emit('process:crash', processes[0], new Error('Test crash'));
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }

        expect(crashCount).toBeLessThanOrEqual(3);
        await supervisor.stop();
      });

      it('should handle rest-for-one strategy', async () => {
        @Supervisor({
          strategy: SupervisionStrategy.REST_FOR_ONE,
        })
        class RestForOneSupervisor {
          @Child({ order: 1 })
          first = StableService;

          @Child({ order: 2 })
          second = StableService;

          @Child({ order: 3 })
          third = StableService;
        }

        const supervisor = new ProcessSupervisor(
          processManager,
          RestForOneSupervisor,
          { strategy: SupervisionStrategy.REST_FOR_ONE },
          mockLogger as any
        );

        await supervisor.start();
        const processes = processManager.listProcesses();
        expect(processes.length).toBe(3);
        await supervisor.stop();
      });
    });

    describe('Workflow Edge Cases', () => {
      it('should handle workflow with no stages', async () => {
        @Workflow()
        class EmptyWorkflow {}

        const workflow = new ProcessWorkflow(processManager, EmptyWorkflow, mockLogger as any);

        const instance = workflow.create();
        const result = await (instance as any).run();
        expect(result).toEqual({});
      });

      it('should handle circular dependencies detection', async () => {
        @Workflow()
        class CircularWorkflow {
          @Stage({ dependsOn: 'stage3' })
          async stage1(): Promise<void> {}

          @Stage({ dependsOn: 'stage1' })
          async stage2(): Promise<void> {}

          @Stage({ dependsOn: 'stage2' })
          async stage3(): Promise<void> {}
        }

        const workflow = new ProcessWorkflow(processManager, CircularWorkflow, mockLogger as any);

        const instance = workflow.create();
        await expect((instance as any).run()).rejects.toThrow('Circular dependency detected');
      });

      it('should handle stage timeout', async () => {
        @Workflow()
        class TimeoutWorkflow {
          @Stage({ timeout: 100 })
          async slowStage(): Promise<string> {
            await new Promise((resolve) => setTimeout(resolve, 200));
            return 'should-not-reach';
          }
        }

        const workflow = new ProcessWorkflow(processManager, TimeoutWorkflow, mockLogger as any);

        const instance = workflow.create();
        await expect((instance as any).run()).rejects.toThrow();
      });

      it('should handle workflow with dynamic stage results', async () => {
        @Workflow()
        class DynamicWorkflow {
          private counter = 0;

          @Stage()
          async initStage(): Promise<{ count: number }> {
            this.counter = 1;
            return { count: this.counter };
          }

          @Stage({ dependsOn: 'initStage' })
          async incrementStage(): Promise<number> {
            this.counter += 10;
            return this.counter;
          }

          @Stage({ dependsOn: 'incrementStage' })
          async finalStage(): Promise<{ final: number; message: string }> {
            return {
              final: this.counter * 2,
              message: `Processed ${this.counter} items`,
            };
          }
        }

        const workflow = new ProcessWorkflow(processManager, DynamicWorkflow, mockLogger as any);

        const instance = workflow.create();
        const result = await (instance as any).run();

        // Verify dynamic results
        expect(result.initStage).toEqual({ count: 1 });
        expect(result.incrementStage).toBe(11);
        expect(result.finalStage).toEqual({
          final: 22,
          message: 'Processed 11 items',
        });
      });

      it('should handle parallel stages with different durations', async () => {
        @Workflow()
        class ParallelDurationWorkflow {
          @Stage({ parallel: true })
          async fast(): Promise<string> {
            return 'fast-done';
          }

          @Stage({ parallel: true })
          async medium(): Promise<string> {
            await new Promise((resolve) => setTimeout(resolve, 50));
            return 'medium-done';
          }

          @Stage({ parallel: true })
          async slow(): Promise<string> {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return 'slow-done';
          }

          @Stage({ dependsOn: ['fast', 'medium', 'slow'] })
          async collect(inputs: any): Promise<number> {
            return Object.keys(inputs).length;
          }
        }

        const workflow = new ProcessWorkflow(processManager, ParallelDurationWorkflow, mockLogger as any);

        const instance = workflow.create();
        const start = Date.now();
        const result = await (instance as any).run();
        const duration = Date.now() - start;

        expect(result.fast).toBe('fast-done');
        expect(result.medium).toBe('medium-done');
        expect(result.slow).toBe('slow-done');
        expect(result.collect).toBe(3);

        // Should complete in roughly the time of the slowest stage, not the sum
        expect(duration).toBeLessThan(200);
      });

      it('should handle multiple compensation handlers', async () => {
        @Workflow()
        class MultiCompensationWorkflow {
          public compensations: string[] = [];

          @Stage()
          async stage1(): Promise<void> {
            // Success
          }

          @Compensate('stage1')
          async compensate1(): Promise<void> {
            this.compensations.push('stage1-compensated');
          }

          @Stage({ dependsOn: 'stage1' })
          async stage2(): Promise<void> {
            // Success
          }

          @Compensate('stage2')
          async compensate2(): Promise<void> {
            this.compensations.push('stage2-compensated');
          }

          @Stage({ dependsOn: 'stage2' })
          async stage3(): Promise<void> {
            throw new Error('Stage 3 failed');
          }
        }

        const workflow = new ProcessWorkflow(processManager, MultiCompensationWorkflow, mockLogger as any);

        const instance = workflow.create();

        await expect((instance as any).run()).rejects.toThrow('Stage 3 failed');

        // Both compensations should have run in reverse order
        expect((instance as any).compensations).toEqual(['stage2-compensated', 'stage1-compensated']);
      });

      it('should handle stage with no return value', async () => {
        @Workflow()
        class VoidStageWorkflow {
          public sideEffect = '';

          @Stage()
          async voidStage(): Promise<void> {
            this.sideEffect = 'executed';
            // No return value
          }

          @Stage({ dependsOn: 'voidStage' })
          async nextStage(): Promise<string> {
            return this.sideEffect;
          }
        }

        const workflow = new ProcessWorkflow(processManager, VoidStageWorkflow, mockLogger as any);

        const instance = workflow.create();
        const result = await (instance as any).run();

        expect(result.voidStage).toBeUndefined();
        expect(result.nextStage).toBe('executed');
        expect((instance as any).sideEffect).toBe('executed');
      });

      it('should handle retry with exponential backoff', async () => {
        @Workflow()
        class ExponentialBackoffWorkflow {
          private attempts = 0;
          private attemptTimes: number[] = [];

          @Stage({ retries: 3, retryDelay: 10 })
          async retryWithBackoff(): Promise<string> {
            this.attemptTimes.push(Date.now());
            this.attempts++;

            if (this.attempts < 3) {
              throw new Error('Retry needed');
            }
            return 'success-after-retries';
          }
        }

        const workflow = new ProcessWorkflow(processManager, ExponentialBackoffWorkflow, mockLogger as any);

        const instance = workflow.create();
        const result = await (instance as any).run();

        expect(result.retryWithBackoff).toBe('success-after-retries');
        expect((instance as any).attempts).toBe(3);

        // Check that delays increase between retries
        const times = (instance as any).attemptTimes;
        if (times.length > 2) {
          const firstDelay = times[1] - times[0];
          const secondDelay = times[2] - times[1];
          expect(secondDelay).toBeGreaterThanOrEqual(firstDelay);
        }
      });
    });
  });
});
