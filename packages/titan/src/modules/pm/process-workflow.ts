/**
 * Process Workflow Implementation
 *
 * Implements workflow orchestration for complex multi-stage processes
 * with DAG (Directed Acyclic Graph) support for parallel execution
 */

import { Errors } from '../../errors/index.js';
import type { ILogger } from '../logger/logger.types.js';
import type { IWorkflowStage, IWorkflowContext, IStageResult, IProcessManager } from './types.js';
import type { WorkflowHandler } from './common-types.js';

import { WORKFLOW_METADATA_KEY } from './decorators.js';

/**
 * DAG node for workflow execution
 */
interface IDAGNode {
  stage: IWorkflowStage;
  dependencies: string[];
  dependents: string[];
  level: number;
}

/**
 * Process workflow orchestrator
 */
export class ProcessWorkflow<T> {
  private stages = new Map<string, IWorkflowStage>();
  private stageResults = new Map<string, IStageResult>();
  private context: IWorkflowContext;
  private workflowInstance?: T;

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
    this.logger.info({ workflow: this.WorkflowClass.name }, 'Starting workflow');

    // Build execution plan
    const executionPlan = this.buildExecutionPlan();

    try {
      // Execute stages
      for (const batch of executionPlan) {
        await this.executeBatch(batch, input);
      }

      // Return final results
      return this.collectResults();
    } catch (error) {
      // On failure, run compensations for all completed stages in reverse order
      await this.compensateCompletedStages();
      throw error;
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
    // Build DAG structure
    const dag = this.buildDAG();

    // Detect cycles
    if (this.hasCycle(dag)) {
      throw Errors.badRequest('Circular dependency detected in workflow');
    }

    // Topological sort with level assignment
    const levels = this.topologicalSort(dag);

    // Group stages by level for parallel execution
    const plan: IWorkflowStage[][] = [];
    const maxLevel = Math.max(...Array.from(dag.values()).map((n) => n.level));

    for (let level = 0; level <= maxLevel; level++) {
      const batch = Array.from(dag.values())
        .filter((node) => node.level === level)
        .map((node) => node.stage);

      if (batch.length > 0) {
        plan.push(batch);
      }
    }

    return plan;
  }

  /**
   * Build DAG structure from stages
   */
  private buildDAG(): Map<string, IDAGNode> {
    const dag = new Map<string, IDAGNode>();

    // Initialize nodes
    for (const stage of this.stages.values()) {
      const deps = this.getDependencies(stage);
      dag.set(stage.name, {
        stage,
        dependencies: deps,
        dependents: [],
        level: 0,
      });
    }

    // Build dependents lists
    for (const node of dag.values()) {
      for (const dep of node.dependencies) {
        const depNode = dag.get(dep);
        if (depNode) {
          depNode.dependents.push(node.stage.name);
        }
      }
    }

    return dag;
  }

  /**
   * Check if DAG has cycles
   */
  private hasCycle(dag: Map<string, IDAGNode>): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycleUtil = (nodeName: string): boolean => {
      visited.add(nodeName);
      recursionStack.add(nodeName);

      const node = dag.get(nodeName);
      if (!node) return false;

      for (const dependent of node.dependents) {
        if (!visited.has(dependent)) {
          if (hasCycleUtil(dependent)) return true;
        } else if (recursionStack.has(dependent)) {
          return true;
        }
      }

      recursionStack.delete(nodeName);
      return false;
    };

    for (const nodeName of dag.keys()) {
      if (!visited.has(nodeName)) {
        if (hasCycleUtil(nodeName)) return true;
      }
    }

    return false;
  }

  /**
   * Perform topological sort and assign levels
   */
  private topologicalSort(dag: Map<string, IDAGNode>): Map<string, IDAGNode> {
    const inDegree = new Map<string, number>();
    const queue: string[] = [];

    // Calculate in-degrees
    for (const [name, node] of dag.entries()) {
      inDegree.set(name, node.dependencies.length);
      if (node.dependencies.length === 0) {
        queue.push(name);
        node.level = 0;
      }
    }

    // Process nodes level by level
    while (queue.length > 0) {
      const nodeName = queue.shift()!;
      const node = dag.get(nodeName)!;

      for (const dependentName of node.dependents) {
        const dependent = dag.get(dependentName)!;
        const currentInDegree = inDegree.get(dependentName)! - 1;
        inDegree.set(dependentName, currentInDegree);

        // Update level
        dependent.level = Math.max(dependent.level, node.level + 1);

        if (currentInDegree === 0) {
          queue.push(dependentName);
        }
      }
    }

    return dag;
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
    await Promise.all(promises);
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
      result.status = 'failed';
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
          return await this.executeWithTimeout(boundHandler, input, timeout);
        } else {
          return await boundHandler(input);
        }
      } catch (error) {
        lastError = error as Error;
        this.logger.warn({ error, stage: stage.name, attempt }, 'Stage execution failed, retrying');

        if (attempt < maxRetries) {
          await this.delay(Math.pow(2, attempt) * 1000); // Exponential backoff
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout(handler: WorkflowHandler, input: any, timeout: number): Promise<any> {
    return Promise.race([
      handler(input),
      new Promise((_, reject) => setTimeout(() => reject(Errors.timeout('Stage', timeout)), timeout)),
    ]);
  }

  /**
   * Run compensation for a failed stage
   */
  private async runCompensation(stage: IWorkflowStage): Promise<void> {
    const compensate = (stage as any).compensate;
    if (!compensate) return;

    this.logger.info({ stage: stage.name }, 'Running compensation');

    try {
      const stageResult = this.stageResults.get(stage.name);
      // Bind the compensation handler to the workflow instance
      const boundCompensate = this.workflowInstance ? compensate.bind(this.workflowInstance) : compensate;
      await boundCompensate(stageResult?.result);
    } catch (error) {
      this.logger.error({ error, stage: stage.name }, 'Compensation failed');
    }
  }

  /**
   * Compensate all completed stages in reverse order
   */
  private async compensateCompletedStages(): Promise<void> {
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
    for (const stage of completedStages.reverse()) {
      await this.runCompensation(stage);
    }
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
    return `workflow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
