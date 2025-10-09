/**
 * Saga Pattern Implementation for Distributed Transactions
 *
 * Provides orchestration and choreography-based saga execution
 * with automatic compensation on failure.
 */

import { EventEmitter } from 'events';
import { Errors } from '../../../errors/index.js';
import type { ILogger } from '../../logger/logger.types.js';

/**
 * Saga configuration
 */
export interface ISagaConfig {
  mode: 'orchestration' | 'choreography';
  timeout?: number;
  retries?: number;
  compensationStrategy?: 'immediate' | 'deferred';
  persistState?: boolean;
}

/**
 * Saga step definition
 */
export interface ISagaStep {
  name: string;
  handler: (...args: any[]) => Promise<any>;
  compensate?: (...args: any[]) => Promise<void>;
  retries?: number;
  timeout?: number;
  dependsOn?: string[];
  parallel?: boolean;
}

/**
 * Saga execution context
 */
export interface ISagaContext {
  id: string;
  name: string;
  state: 'pending' | 'running' | 'completed' | 'compensating' | 'failed';
  steps: Map<string, ISagaStepResult>;
  data: any;
  error?: Error;
  startTime: number;
  endTime?: number;
}

/**
 * Saga step result
 */
export interface ISagaStepResult {
  name: string;
  state: 'pending' | 'running' | 'completed' | 'compensated' | 'failed';
  result?: any;
  error?: Error;
  startTime?: number;
  endTime?: number;
  attempts?: number;
}

/**
 * Saga orchestrator
 */
export class SagaOrchestrator extends EventEmitter {
  private sagas = new Map<string, ISagaContext>();
  private stepDefinitions = new Map<string, Map<string, ISagaStep>>();
  private compensationLog = new Map<string, any[]>();

  constructor(
    private readonly logger: ILogger,
    private readonly config: ISagaConfig = { mode: 'orchestration' }
  ) {
    super();
  }

  /**
   * Register a saga definition
   */
  registerSaga(name: string, steps: ISagaStep[]): void {
    const stepMap = new Map<string, ISagaStep>();
    for (const step of steps) {
      stepMap.set(step.name, step);
    }
    this.stepDefinitions.set(name, stepMap);
  }

  /**
   * Execute a saga
   */
  async execute(sagaName: string, input?: any): Promise<any> {
    const sagaId = this.generateSagaId();
    const steps = this.stepDefinitions.get(sagaName);

    if (!steps) {
      throw Errors.notFound(`Saga ${sagaName} not found`);
    }

    // Create saga context
    const context: ISagaContext = {
      id: sagaId,
      name: sagaName,
      state: 'pending',
      steps: new Map(),
      data: input,
      startTime: Date.now()
    };

    this.sagas.set(sagaId, context);

    try {
      context.state = 'running';
      this.emit('saga:started', context);

      // Execute based on mode
      let result;
      if (this.config.mode === 'choreography') {
        result = await this.executeChoreography(context, steps);
      } else {
        result = await this.executeOrchestration(context, steps);
      }

      context.state = 'completed';
      context.endTime = Date.now();
      this.emit('saga:completed', context);

      return result;
    } catch (error) {
      context.state = 'compensating';
      context.error = error as Error;
      this.emit('saga:failed', context, error);

      // Run compensation
      await this.compensate(context, steps);

      context.state = 'failed';
      context.endTime = Date.now();
      throw error;
    }
  }

  /**
   * Execute saga in orchestration mode
   */
  private async executeOrchestration(
    context: ISagaContext,
    steps: Map<string, ISagaStep>
  ): Promise<any> {
    const executionPlan = this.buildExecutionPlan(steps);
    const results = new Map<string, any>();

    for (const batch of executionPlan) {
      const batchResults = await this.executeBatch(context, batch, results);

      for (const [stepName, result] of batchResults) {
        results.set(stepName, result);
      }
    }

    return this.collectResults(results);
  }

  /**
   * Execute saga in choreography mode
   */
  private async executeChoreography(
    context: ISagaContext,
    steps: Map<string, ISagaStep>
  ): Promise<any> {
    // In choreography mode, steps communicate via events
    const eventBus = new EventEmitter();
    const results = new Map<string, any>();
    const completedSteps = new Set<string>();

    // Setup step event handlers
    for (const [stepName, step] of steps) {
      eventBus.on(`step:${stepName}:ready`, async () => {
        try {
          const result = await this.executeStep(context, step, results);
          results.set(stepName, result);
          completedSteps.add(stepName);

          // Emit completion event
          eventBus.emit(`step:${stepName}:completed`, result);

          // Check if other steps are ready
          this.checkStepReadiness(steps, completedSteps, eventBus);
        } catch (error) {
          eventBus.emit(`step:${stepName}:failed`, error);
          throw error;
        }
      });
    }

    // Start initial steps (no dependencies)
    for (const [stepName, step] of steps) {
      if (!step.dependsOn || step.dependsOn.length === 0) {
        eventBus.emit(`step:${stepName}:ready`);
      }
    }

    // Wait for all steps to complete
    await this.waitForCompletion(steps, completedSteps);

    return this.collectResults(results);
  }

  /**
   * Build execution plan
   */
  private buildExecutionPlan(steps: Map<string, ISagaStep>): ISagaStep[][] {
    const plan: ISagaStep[][] = [];
    const completed = new Set<string>();

    while (completed.size < steps.size) {
      const batch: ISagaStep[] = [];

      for (const [stepName, step] of steps) {
        if (completed.has(stepName)) continue;

        const deps = step.dependsOn || [];
        if (deps.every(dep => completed.has(dep))) {
          batch.push(step);
        }
      }

      if (batch.length === 0 && completed.size < steps.size) {
        throw Errors.notFound('Circular dependency detected in saga');
      }

      if (batch.length > 0) {
        plan.push(batch);
        batch.forEach(step => completed.add(step.name));
      }
    }

    return plan;
  }

  /**
   * Execute a batch of steps
   */
  private async executeBatch(
    context: ISagaContext,
    batch: ISagaStep[],
    previousResults: Map<string, any>
  ): Promise<Map<string, any>> {
    const results = new Map<string, any>();

    const promises = batch.map(async step => {
      const result = await this.executeStep(context, step, previousResults);
      results.set(step.name, result);
      return { step: step.name, result };
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    context: ISagaContext,
    step: ISagaStep,
    previousResults: Map<string, any>
  ): Promise<any> {
    const stepResult: ISagaStepResult = {
      name: step.name,
      state: 'pending',
      startTime: Date.now(),
      attempts: 0
    };

    context.steps.set(step.name, stepResult);

    try {
      stepResult.state = 'running';
      this.emit('step:started', step.name, context);

      // Prepare input from dependencies
      const input = this.prepareStepInput(step, previousResults, context.data);

      // Execute with retries
      const result = await this.executeWithRetries(
        () => step.handler(input),
        step.retries || this.config.retries || 0,
        step.timeout || this.config.timeout
      );

      stepResult.state = 'completed';
      stepResult.result = result;
      stepResult.endTime = Date.now();

      this.emit('step:completed', step.name, context, result);

      // Log for compensation
      this.logForCompensation(context.id, step, input, result);

      return result;
    } catch (error) {
      stepResult.state = 'failed';
      stepResult.error = error as Error;
      stepResult.endTime = Date.now();

      this.emit('step:failed', step.name, context, error);
      throw error;
    }
  }

  /**
   * Compensate failed saga
   */
  private async compensate(
    context: ISagaContext,
    steps: Map<string, ISagaStep>
  ): Promise<void> {
    this.logger.info({ sagaId: context.id }, 'Running saga compensation');

    const completedSteps = Array.from(context.steps.entries())
      .filter(([, result]) => result.state === 'completed')
      .map(([name]) => name)
      .reverse(); // Compensate in reverse order

    for (const stepName of completedSteps) {
      const step = steps.get(stepName);
      if (!step?.compensate) continue;

      try {
        const stepResult = context.steps.get(stepName)!;
        await step.compensate(stepResult.result);

        stepResult.state = 'compensated';
        this.emit('step:compensated', stepName, context);
      } catch (error) {
        this.logger.error(
          { error, stepName, sagaId: context.id },
          'Failed to compensate step'
        );
      }
    }
  }

  /**
   * Prepare step input
   */
  private prepareStepInput(
    step: ISagaStep,
    previousResults: Map<string, any>,
    initialData: any
  ): any {
    if (!step.dependsOn || step.dependsOn.length === 0) {
      return initialData;
    }

    if (step.dependsOn.length === 1) {
      const dependency = step.dependsOn[0];
      return dependency ? previousResults.get(dependency) : initialData;
    }

    // Multiple dependencies - return object with all results
    const input: any = {};
    for (const dep of step.dependsOn) {
      input[dep] = previousResults.get(dep);
    }
    return input;
  }

  /**
   * Execute with retries
   */
  private async executeWithRetries(
    fn: () => Promise<any>,
    retries: number,
    timeout?: number
  ): Promise<any> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (timeout) {
          return await this.withTimeout(fn(), timeout);
        }
        return await fn();
      } catch (error) {
        lastError = error as Error;
        if (attempt < retries) {
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute with timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Step timeout')), timeout)
      )
    ]);
  }

  /**
   * Check step readiness
   */
  private checkStepReadiness(
    steps: Map<string, ISagaStep>,
    completedSteps: Set<string>,
    eventBus: EventEmitter
  ): void {
    for (const [stepName, step] of steps) {
      if (completedSteps.has(stepName)) continue;

      const deps = step.dependsOn || [];
      if (deps.every(dep => completedSteps.has(dep))) {
        eventBus.emit(`step:${stepName}:ready`);
      }
    }
  }

  /**
   * Wait for completion
   */
  private async waitForCompletion(
    steps: Map<string, ISagaStep>,
    completedSteps: Set<string>
  ): Promise<void> {
    const timeout = this.config.timeout || 60000;
    const startTime = Date.now();

    while (completedSteps.size < steps.size) {
      if (Date.now() - startTime > timeout) {
        throw Errors.notFound('Saga timeout');
      }
      await this.delay(100);
    }
  }

  /**
   * Log for compensation
   */
  private logForCompensation(
    sagaId: string,
    step: ISagaStep,
    input: any,
    result: any
  ): void {
    if (!this.compensationLog.has(sagaId)) {
      this.compensationLog.set(sagaId, []);
    }

    this.compensationLog.get(sagaId)!.push({
      step: step.name,
      input,
      result,
      timestamp: Date.now()
    });
  }

  /**
   * Collect results
   */
  private collectResults(results: Map<string, any>): any {
    const output: any = {};
    for (const [name, result] of results) {
      output[name] = result;
    }
    return output;
  }

  /**
   * Generate saga ID
   */
  private generateSagaId(): string {
    return `saga-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get saga status
   */
  getSagaStatus(sagaId: string): ISagaContext | undefined {
    return this.sagas.get(sagaId);
  }

  /**
   * Get all sagas
   */
  getAllSagas(): ISagaContext[] {
    return Array.from(this.sagas.values());
  }
}

/**
 * Distributed Transaction Manager
 */
export class DistributedTransactionManager {
  private transactions = new Map<string, ITransaction>();
  private participants = new Map<string, ITransactionParticipant>();

  constructor(private readonly logger: ILogger) {}

  /**
   * Begin a distributed transaction
   */
  async begin(): Promise<string> {
    const txId = this.generateTransactionId();

    const transaction: ITransaction = {
      id: txId,
      state: 'active',
      participants: new Set(),
      startTime: Date.now()
    };

    this.transactions.set(txId, transaction);
    this.logger.info({ txId }, 'Transaction started');

    return txId;
  }

  /**
   * Prepare phase of 2PC
   */
  async prepare(txId: string): Promise<boolean> {
    const transaction = this.transactions.get(txId);
    if (!transaction) {
      throw Errors.notFound(`Transaction ${txId} not found`);
    }

    transaction.state = 'preparing';
    const preparePromises: Promise<boolean>[] = [];

    for (const participantId of transaction.participants) {
      const participant = this.participants.get(participantId);
      if (participant) {
        preparePromises.push(participant.prepare(txId));
      }
    }

    const results = await Promise.all(preparePromises);
    const allPrepared = results.every(r => r === true);

    if (allPrepared) {
      transaction.state = 'prepared';
    } else {
      transaction.state = 'aborted';
    }

    return allPrepared;
  }

  /**
   * Commit phase of 2PC
   */
  async commit(txId: string): Promise<void> {
    const transaction = this.transactions.get(txId);
    if (!transaction || transaction.state !== 'prepared') {
      throw Errors.notFound(`Transaction ${txId} cannot be committed`);
    }

    transaction.state = 'committing';
    const commitPromises: Promise<void>[] = [];

    for (const participantId of transaction.participants) {
      const participant = this.participants.get(participantId);
      if (participant) {
        commitPromises.push(participant.commit(txId));
      }
    }

    await Promise.all(commitPromises);
    transaction.state = 'committed';
    transaction.endTime = Date.now();

    this.logger.info({ txId }, 'Transaction committed');
  }

  /**
   * Rollback transaction
   */
  async rollback(txId: string): Promise<void> {
    const transaction = this.transactions.get(txId);
    if (!transaction) {
      throw Errors.notFound(`Transaction ${txId} not found`);
    }

    transaction.state = 'rolling-back';
    const rollbackPromises: Promise<void>[] = [];

    for (const participantId of transaction.participants) {
      const participant = this.participants.get(participantId);
      if (participant) {
        rollbackPromises.push(participant.rollback(txId));
      }
    }

    await Promise.all(rollbackPromises);
    transaction.state = 'aborted';
    transaction.endTime = Date.now();

    this.logger.info({ txId }, 'Transaction rolled back');
  }

  /**
   * Register a participant
   */
  registerParticipant(
    participantId: string,
    participant: ITransactionParticipant
  ): void {
    this.participants.set(participantId, participant);
  }

  /**
   * Add participant to transaction
   */
  addParticipant(txId: string, participantId: string): void {
    const transaction = this.transactions.get(txId);
    if (!transaction) {
      throw Errors.notFound(`Transaction ${txId} not found`);
    }

    transaction.participants.add(participantId);
  }

  /**
   * Generate transaction ID
   */
  private generateTransactionId(): string {
    return `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Transaction interface
 */
interface ITransaction {
  id: string;
  state: 'active' | 'preparing' | 'prepared' | 'committing' | 'committed' | 'rolling-back' | 'aborted';
  participants: Set<string>;
  startTime: number;
  endTime?: number;
}

/**
 * Transaction participant interface
 */
interface ITransactionParticipant {
  prepare(txId: string): Promise<boolean>;
  commit(txId: string): Promise<void>;
  rollback(txId: string): Promise<void>;
}