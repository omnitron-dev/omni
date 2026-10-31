/**
 * Process Workflow Implementation
 *
 * Implements workflow orchestration for complex multi-stage processes
 * with DAG (Directed Acyclic Graph) support for parallel execution
 */

import { Errors } from '@omnitron-dev/titan/errors';
import { dependencyBatches } from '@omnitron-dev/titan/utils';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { IWorkflowStage, IWorkflowContext, IStageResult, IProcessManager } from './types.js';
import type { WorkflowHandler } from './common-types.js';

import { WORKFLOW_METADATA_KEY } from './decorators.js';

/** A deadline is not proof that a handler stopped or that its side effects did not happen. */
export class WorkflowStageUncertainError extends Error {
  readonly code = 'WORKFLOW_STAGE_UNCERTAIN';
  constructor(
    readonly workflowId: string,
    readonly stage: string,
    readonly timeoutMs: number
  ) {
    super(
      `Workflow ${workflowId}: stage '${stage}' exceeded ${timeoutMs}ms; execution may continue. Automatic retry and compensation are blocked until its outcome is reconciled.`
    );
    this.name = 'WorkflowStageUncertainError';
  }
}

/**
 * Process workflow orchestrator
 */
export class ProcessWorkflow<T> {
  private stages = new Map<string, IWorkflowStage>();
  private stageResults = new Map<string, IStageResult>();
  private context: IWorkflowContext;
  private workflowInstance?: T;
  private running = false;
  private uncertain: WorkflowStageUncertainError | null = null;
  private recoveryRequired: Error | null = null;

  constructor(
    private readonly manager: IProcessManager,
    private readonly WorkflowClass: new () => T,
    private readonly logger: ILogger
  ) {
    this.context = {
      id: this.generateId(),
      stages: this.stageResults,
      state: {},
      metadata: {},
    };
  }

  /**
   * Create and return the workflow instance
   */
  create(): T {
    const metadata = this.getWorkflowMetadata();
    this.stages = metadata.stages;

    const workflow = new this.WorkflowClass();

    // Store the workflow instance for later use
    this.workflowInstance = workflow;

    // Enhance workflow with run method
    (workflow as any).run = async (input?: any) => this.run(input);

    // Enhance workflow with context access
    (workflow as any).getContext = () => this.context;

    return workflow;
  }

  /**
   * Run the workflow
   */
  async run(input?: any): Promise<any> {
    if (this.running) throw Errors.badRequest('This workflow instance is already running');
    if (this.uncertain) throw this.uncertain;
    if (this.recoveryRequired) throw this.recoveryRequired;
    const executionPlan = this.buildExecutionPlan();
    this.running = true;
    this.stageResults.clear();
    this.context.id = this.generateId();
    this.logger.info({ workflow: this.WorkflowClass.name, run: this.context.id }, 'Starting workflow');
    try {
      // Execute stages
      for (const batch of executionPlan) {
        await this.executeBatch(batch, input);
      }

      // Return final results
      return this.collectResults();
    } catch (error) {
      if (this.uncertain) throw this.uncertain;
      const failures = await this.compensateCompletedStages();
      if (failures.length) {
        this.recoveryRequired = new AggregateError(
          [error, ...failures],
          'Workflow and compensation failed; recovery is required'
        );
        throw this.recoveryRequired;
      }
      throw error;
    } finally {
      this.running = false;
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get workflow metadata from decorators
   */
  private getWorkflowMetadata(): any {
    const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, this.WorkflowClass);
    if (!metadata) {
      throw Errors.notFound('Workflow metadata', this.WorkflowClass.name);
    }
    return metadata;
  }

  /**
   * Build execution plan based on dependencies (DAG)
   */
  private buildExecutionPlan(): IWorkflowStage[][] {
    for (const stage of this.stages.values()) {
      if (!Number.isSafeInteger(stage.retries ?? 0) || (stage.retries ?? 0) < 0)
        throw Errors.badRequest(`Invalid retry count for stage '${stage.name}'`);
      if (!Number.isSafeInteger(stage.timeout ?? 0) || (stage.timeout ?? 0) < 0 || (stage.timeout ?? 0) > 2_147_483_647)
        throw Errors.badRequest(`Invalid timeout for stage '${stage.name}'`);
    }
    return dependencyBatches([...this.stages.values()], {
      name: (stage) => stage.name,
      dependencies: (stage) => this.getDependencies(stage),
    });
  }

  /**
   * Get stage dependencies
   */
  private getDependencies(stage: IWorkflowStage): string[] {
    if (!stage.dependsOn) return [];

    return Array.isArray(stage.dependsOn) ? stage.dependsOn : [stage.dependsOn];
  }

  /**
   * Execute a batch of stages
   */
  private async executeBatch(batch: IWorkflowStage[], input: any): Promise<void> {
    const promises = batch.map((stage) => this.executeStage(stage, input));
    // A failed sibling must not compensate resources while another sibling still uses them.
    const results = await Promise.allSettled(promises);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  /**
   * Execute a single stage
   */
  private async executeStage(stage: IWorkflowStage, input: any): Promise<void> {
    const result: IStageResult = {
      stage: stage.name,
      status: 'pending',
      startTime: Date.now(),
    };

    this.stageResults.set(stage.name, result);

    try {
      result.status = 'running';
      this.logger.debug({ stage: stage.name }, 'Executing workflow stage');

      // Get input for stage
      const stageInput = this.getStageInput(stage, input);

      // Execute with timeout and retries
      const output = await this.executeWithRetries(stage, stageInput);

      result.status = 'completed';
      result.result = output;
      result.endTime = Date.now();

      this.logger.debug({ stage: stage.name, duration: result.endTime - result.startTime! }, 'Stage completed');
    } catch (error) {
      result.status = error instanceof WorkflowStageUncertainError ? 'unknown' : 'failed';
      result.error = error as Error;
      result.endTime = Date.now();

      this.logger.error({ error, stage: stage.name }, 'Stage failed');

      // Don't run compensation here, it will be handled at the workflow level
      throw error;
    }
  }

  /**
   * Get input for a stage based on dependencies
   */
  private getStageInput(stage: IWorkflowStage, initialInput: any): any {
    const deps = this.getDependencies(stage);

    if (deps.length === 0) {
      return initialInput;
    }

    // Collect outputs from dependencies
    const depOutputs: any = {};
    for (const dep of deps) {
      const depResult = this.stageResults.get(dep);
      if (depResult?.result !== undefined) {
        depOutputs[dep] = depResult.result;
      }
    }

    // If single dependency, pass its output directly
    if (deps.length === 1 && deps[0]) {
      return depOutputs[deps[0]];
    }

    // Otherwise pass all dependency outputs
    return depOutputs;
  }

  /**
   * Execute stage with retries
   */
  private async executeWithRetries(stage: IWorkflowStage, input: any): Promise<any> {
    const maxRetries = stage.retries || 0;
    const timeout = stage.timeout || 0;

    let lastError: Error | undefined;

    // Bind the handler to the workflow instance if it exists
    const boundHandler = this.workflowInstance ? stage.handler.bind(this.workflowInstance) : stage.handler;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (timeout > 0) {
          return await this.executeWithTimeout(stage, boundHandler, input, timeout);
        } else {
          return await boundHandler(input);
        }
      } catch (error) {
        if (error instanceof WorkflowStageUncertainError) throw error;
        lastError = error as Error;
        this.logger.warn(
          { error, stage: stage.name, attempt },
          attempt < maxRetries ? 'Stage execution failed, retrying' : 'Stage execution failed'
        );

        if (attempt < maxRetries) {
          await this.delay(Math.pow(2, attempt) * 1000); // Exponential backoff
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute with timeout.
   *
   * T#60: the setTimeout is captured and cleared on the race-win path.
   * Pre-T#60 each stage execution left its timeout timer alive even
   * after the handler resolved — a multi-stage workflow accumulated
   * one pending timer per completed stage, stalling clean shutdown
   * for the full slowest-stage-timeout interval.
   */
  private async executeWithTimeout(
    stage: IWorkflowStage,
    handler: WorkflowHandler,
    input: any,
    timeout: number
  ): Promise<any> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const uncertain = new WorkflowStageUncertainError(this.context.id, stage.name, timeout);
        this.uncertain ??= uncertain;
        reject(uncertain);
      }, timeout);
    });
    try {
      return await Promise.race([handler(input), timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  /**
   * Run compensation for a failed stage
   */
  private async runCompensation(stage: IWorkflowStage): Promise<void> {
    const compensate = stage.compensate;
    if (!compensate) return;

    this.logger.info({ stage: stage.name }, 'Running compensation');

    const stageResult = this.stageResults.get(stage.name);
    try {
      // Bind the compensation handler to the workflow instance
      const boundCompensate = this.workflowInstance ? compensate.bind(this.workflowInstance) : compensate;
      await boundCompensate(stageResult?.result);
      if (stageResult) stageResult.compensation = { status: 'completed' };
    } catch (error) {
      if (stageResult) stageResult.compensation = { status: 'failed', error: error as Error };
      this.logger.error({ error, stage: stage.name }, 'Compensation failed');
      throw error;
    }
  }

  /**
   * Compensate all completed stages in reverse order
   */
  private async compensateCompletedStages(): Promise<unknown[]> {
    const completedStages: IWorkflowStage[] = [];

    // Collect all completed stages
    for (const [name, result] of this.stageResults) {
      if (result.status === 'completed') {
        const stage = this.stages.get(name);
        if (stage) {
          completedStages.push(stage);
        }
      }
    }

    // Run compensations in reverse order
    const failures: unknown[] = [];
    for (const stage of completedStages.reverse()) {
      try {
        await this.runCompensation(stage);
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  }

  /**
   * Collect final results from all stages
   */
  private collectResults(): any {
    // Always return all stage results for better observability and testing
    const results: any = {};
    for (const [name, result] of this.stageResults) {
      if (result.status === 'completed') {
        results[name] = result.result;
      }
    }

    return results;
  }

  /**
   * Generate workflow ID
   */
  private generateId(): string {
    return `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
