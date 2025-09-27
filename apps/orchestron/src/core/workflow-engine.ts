/**
 * Workflow Automation Engine for Orchestron
 * Phase 9: Continuous Development Cycle
 */

import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import { Storage } from '../storage/interface.js';
import {
  TaskNode,
  TaskStatus,
  NodeId,
  DevelopmentNodeType
} from './types.js';
import { TaskManager } from './task-manager.js';
import { MLPredictor } from './ml-predictor.js';

export interface WorkflowTrigger {
  type: 'task_status_change' | 'time_based' | 'event' | 'manual' | 'checkpoint_complete';
  condition?: (context: any) => boolean;
  schedule?: string; // Cron expression
  event?: string;
  data?: any;
}

export interface WorkflowAction {
  type: 'update_task' | 'create_task' | 'notify' | 'execute_command' | 'collect_feedback';
  params: any;
  onSuccess?: WorkflowAction[];
  onFailure?: WorkflowAction[];
}

export interface WorkflowStage {
  name: string;
  description?: string;
  triggers: WorkflowTrigger[];
  actions: WorkflowAction[];
  conditions?: {
    pre?: (context: any) => boolean;
    post?: (context: any) => boolean;
  };
  timeout?: number; // ms
  retries?: number;
}

export interface DevelopmentWorkflow {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  triggers: WorkflowTrigger[];
  stages: WorkflowStage[];
  metadata?: {
    createdAt: Date;
    updatedAt: Date;
    author: string;
    version: string;
  };
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  currentStage?: string;
  completedStages: string[];
  context: any;
  errors?: Error[];
}

export interface WorkflowEvents {
  'workflow:started': (execution: WorkflowExecution) => void;
  'workflow:completed': (execution: WorkflowExecution) => void;
  'workflow:failed': (execution: WorkflowExecution, error: Error) => void;
  'stage:started': (execution: WorkflowExecution, stage: WorkflowStage) => void;
  'stage:completed': (execution: WorkflowExecution, stage: WorkflowStage) => void;
  'action:executed': (action: WorkflowAction, result: any) => void;
}

export class WorkflowEngine extends EventEmitter<WorkflowEvents> {
  private workflows: Map<string, DevelopmentWorkflow> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private taskManager: TaskManager;
  private mlPredictor: MLPredictor;
  private storage: Storage;

  // Common workflow patterns
  private readonly BUILT_IN_WORKFLOWS = {
    TASK_PROGRESS_TRACKING: this.createProgressTrackingWorkflow(),
    AUTO_STATUS_TRANSITION: this.createStatusTransitionWorkflow(),
    QUALITY_GATES: this.createQualityGateWorkflow(),
    SPRINT_AUTOMATION: this.createSprintAutomationWorkflow(),
  };

  constructor(
    storage: Storage,
    taskManager: TaskManager,
    mlPredictor: MLPredictor
  ) {
    super();
    this.storage = storage;
    this.taskManager = taskManager;
    this.mlPredictor = mlPredictor;
    this.initializeBuiltInWorkflows();
  }

  private initializeBuiltInWorkflows(): void {
    for (const [key, workflow] of Object.entries(this.BUILT_IN_WORKFLOWS)) {
      this.workflows.set(workflow.id, workflow);
    }
  }

  /**
   * Create a workflow for automatic progress tracking
   */
  private createProgressTrackingWorkflow(): DevelopmentWorkflow {
    return {
      id: 'progress-tracking',
      name: 'Automatic Progress Tracking',
      description: 'Updates task progress based on checkpoint completion',
      enabled: true,
      triggers: [{
        type: 'checkpoint_complete'
      }],
      stages: [{
        name: 'update_progress',
        description: 'Calculate and update task progress',
        triggers: [],
        actions: [{
          type: 'update_task',
          params: {
            updateType: 'progress',
            calculateFrom: 'checkpoints'
          }
        }]
      }]
    };
  }

  /**
   * Create workflow for automatic status transitions
   */
  private createStatusTransitionWorkflow(): DevelopmentWorkflow {
    return {
      id: 'status-transitions',
      name: 'Automatic Status Transitions',
      description: 'Transitions task status based on rules',
      enabled: true,
      triggers: [{
        type: 'event',
        event: 'task:progress:updated'
      }],
      stages: [{
        name: 'check_transition_rules',
        triggers: [],
        actions: [{
          type: 'update_task',
          params: {
            updateType: 'status',
            rules: [
              { from: TaskStatus.TODO, to: TaskStatus.IN_PROGRESS, when: (t: TaskNode) => t.payload.progress! > 0 },
              { from: TaskStatus.IN_PROGRESS, to: TaskStatus.IN_REVIEW, when: (t: TaskNode) => t.payload.progress! >= 90 },
              { from: TaskStatus.IN_REVIEW, to: TaskStatus.DONE, when: (t: TaskNode) => t.payload.progress! === 100 }
            ]
          }
        }]
      }]
    };
  }

  /**
   * Create workflow for quality gates
   */
  private createQualityGateWorkflow(): DevelopmentWorkflow {
    return {
      id: 'quality-gates',
      name: 'Quality Gate Checks',
      description: 'Enforces quality standards before task completion',
      enabled: true,
      triggers: [{
        type: 'task_status_change',
        condition: (ctx) => ctx.newStatus === TaskStatus.IN_REVIEW
      }],
      stages: [
        {
          name: 'run_tests',
          triggers: [],
          actions: [{
            type: 'execute_command',
            params: { command: 'npm test' },
            onFailure: [{
              type: 'update_task',
              params: { status: TaskStatus.IN_PROGRESS, comment: 'Tests failed' }
            }]
          }]
        },
        {
          name: 'check_coverage',
          triggers: [],
          conditions: {
            pre: (ctx) => ctx.testsPass === true
          },
          actions: [{
            type: 'execute_command',
            params: { command: 'npm run test:coverage' }
          }]
        },
        {
          name: 'code_quality',
          triggers: [],
          actions: [{
            type: 'execute_command',
            params: { command: 'npm run lint' }
          }]
        }
      ]
    };
  }

  /**
   * Create workflow for sprint automation
   */
  private createSprintAutomationWorkflow(): DevelopmentWorkflow {
    return {
      id: 'sprint-automation',
      name: 'Sprint Process Automation',
      description: 'Automates sprint ceremonies and tracking',
      enabled: true,
      triggers: [{
        type: 'time_based',
        schedule: '0 9 * * 1' // Every Monday at 9am
      }],
      stages: [
        {
          name: 'sprint_planning',
          triggers: [],
          actions: [{
            type: 'collect_feedback',
            params: { type: 'velocity_metrics' }
          }, {
            type: 'create_task',
            params: {
              type: DevelopmentNodeType.PLANNING,
              title: 'Sprint Planning Session'
            }
          }]
        },
        {
          name: 'update_burndown',
          triggers: [{
            type: 'time_based',
            schedule: '0 17 * * *' // Daily at 5pm
          }],
          actions: [{
            type: 'execute_command',
            params: { command: 'orchestron sprint burndown --update' }
          }]
        }
      ]
    };
  }

  /**
   * Register a new workflow
   */
  async registerWorkflow(workflow: DevelopmentWorkflow): Promise<void> {
    workflow.metadata = {
      createdAt: workflow.metadata?.createdAt || new Date(),
      updatedAt: new Date(),
      author: workflow.metadata?.author || 'system',
      version: workflow.metadata?.version || '1.0.0'
    };

    this.workflows.set(workflow.id, workflow);

    // Persist workflow
    if (this.storage.saveData) {
      await this.storage.saveData(
        `workflow:${workflow.id}`,
        JSON.stringify(workflow)
      );
    }
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    context: any = {}
  ): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    if (!workflow.enabled) {
      throw new Error(`Workflow ${workflowId} is disabled`);
    }

    const execution: WorkflowExecution = {
      id: uuidv4(),
      workflowId,
      startTime: new Date(),
      status: 'running',
      completedStages: [],
      context
    };

    this.executions.set(execution.id, execution);
    this.emit('workflow:started', execution);

    try {
      for (const stage of workflow.stages) {
        execution.currentStage = stage.name;
        await this.executeStage(stage, execution);
        execution.completedStages.push(stage.name);
      }

      execution.status = 'completed';
      execution.endTime = new Date();
      this.emit('workflow:completed', execution);
    } catch (error) {
      execution.status = 'failed';
      execution.endTime = new Date();
      execution.errors = execution.errors || [];
      execution.errors.push(error as Error);
      this.emit('workflow:failed', execution, error as Error);
      throw error;
    }

    return execution;
  }

  /**
   * Execute a workflow stage
   */
  private async executeStage(
    stage: WorkflowStage,
    execution: WorkflowExecution
  ): Promise<void> {
    this.emit('stage:started', execution, stage);

    // Check pre-conditions
    if (stage.conditions?.pre && !stage.conditions.pre(execution.context)) {
      console.log(`Skipping stage ${stage.name}: pre-conditions not met`);
      return;
    }

    // Execute actions with retry logic
    for (const action of stage.actions) {
      let retries = stage.retries || 0;
      let success = false;

      while (retries >= 0 && !success) {
        try {
          await this.executeAction(action, execution);
          success = true;
        } catch (error) {
          retries--;
          if (retries < 0) {
            // Execute failure actions if defined
            if (action.onFailure) {
              for (const failureAction of action.onFailure) {
                await this.executeAction(failureAction, execution);
              }
            }
            throw error;
          }
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Execute success actions if defined
      if (success && action.onSuccess) {
        for (const successAction of action.onSuccess) {
          await this.executeAction(successAction, execution);
        }
      }
    }

    // Check post-conditions
    if (stage.conditions?.post && !stage.conditions.post(execution.context)) {
      throw new Error(`Stage ${stage.name}: post-conditions not met`);
    }

    this.emit('stage:completed', execution, stage);
  }

  /**
   * Execute a single action
   */
  private async executeAction(
    action: WorkflowAction,
    execution: WorkflowExecution
  ): Promise<any> {
    let result: any;

    switch (action.type) {
      case 'update_task':
        result = await this.executeUpdateTask(action.params, execution);
        break;

      case 'create_task':
        result = await this.executeCreateTask(action.params, execution);
        break;

      case 'notify':
        result = await this.executeNotification(action.params, execution);
        break;

      case 'execute_command':
        result = await this.executeCommand(action.params, execution);
        break;

      case 'collect_feedback':
        result = await this.collectFeedback(action.params, execution);
        break;

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }

    this.emit('action:executed', action, result);
    return result;
  }

  private async executeUpdateTask(params: any, execution: WorkflowExecution): Promise<void> {
    const { taskId, status, progress, comment } = params;

    if (status) {
      await this.taskManager.updateTaskStatus(
        taskId || execution.context.taskId,
        status
      );
    }

    if (progress !== undefined) {
      await this.taskManager.updateTaskProgress(
        taskId || execution.context.taskId,
        progress
      );
    }
  }

  private async executeCreateTask(params: any, execution: WorkflowExecution): Promise<TaskNode> {
    return await this.taskManager.createTask(params);
  }

  private async executeNotification(params: any, execution: WorkflowExecution): Promise<void> {
    // Emit notification event for external handlers
    this.emit('workflow:notification' as any, {
      ...params,
      execution,
      timestamp: new Date()
    });
  }

  private async executeCommand(params: any, execution: WorkflowExecution): Promise<any> {
    // This would integrate with actual command execution
    // For now, just log and store
    console.log(`Executing command: ${params.command}`);
    execution.context.lastCommand = params.command;
    execution.context.commandOutput = 'Command execution simulated';
    return execution.context.commandOutput;
  }

  private async collectFeedback(params: any, execution: WorkflowExecution): Promise<any> {
    // Collect metrics and feedback
    const feedback = {
      type: params.type,
      timestamp: new Date(),
      metrics: await this.gatherMetrics(params.type)
    };

    execution.context.feedback = execution.context.feedback || [];
    execution.context.feedback.push(feedback);

    return feedback;
  }

  private async gatherMetrics(type: string): Promise<any> {
    // Gather relevant metrics based on type
    switch (type) {
      case 'velocity_metrics':
        return {
          averageVelocity: 25,
          lastSprintVelocity: 28,
          trend: 'improving'
        };
      default:
        return {};
    }
  }

  /**
   * List all workflows
   */
  getWorkflows(): DevelopmentWorkflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Enable/disable workflow
   */
  async toggleWorkflow(workflowId: string, enabled: boolean): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    workflow.enabled = enabled;
    await this.registerWorkflow(workflow);
  }

  /**
   * Get execution history
   */
  getExecutions(workflowId?: string): WorkflowExecution[] {
    const executions = Array.from(this.executions.values());
    if (workflowId) {
      return executions.filter(e => e.workflowId === workflowId);
    }
    return executions;
  }

  /**
   * Cancel a running execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'running') {
      throw new Error(`Cannot cancel execution ${executionId}`);
    }

    execution.status = 'cancelled';
    execution.endTime = new Date();
    this.emit('workflow:cancelled' as any, execution);
  }
}