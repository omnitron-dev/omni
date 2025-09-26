import { Injectable } from '../../nexus/index.js';
import { Redis } from 'ioredis';
import { NotificationService, NotificationPayload, Recipient, SendOptions } from './notifications.service.js';
import { generateUuid, sleep } from './utils.js';

export interface WorkflowOptions {
  enabled?: boolean;
  storage?: 'redis' | 'database';
  maxConcurrent?: number;
}

export interface NotificationWorkflow {
  id: string;
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  onError?: 'stop' | 'continue' | 'retry';
  maxRetries?: number;
  category?: string;
  tags?: string[];
  version?: number;
}

export interface WorkflowTrigger {
  type: 'manual' | 'event' | 'schedule' | 'condition';
  config?: any;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: 'notification' | 'wait' | 'condition' | 'parallel' | 'batch';
  config: any;
  conditions?: StepCondition[];
  delay?: number;
  onError?: 'stop' | 'continue' | 'retry';
  retryAttempts?: number;
  retryDelay?: number;
}

export interface StepCondition {
  field: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'greaterThan' | 'lessThan';
  value: any;
}

export interface WorkflowContext {
  [key: string]: any;
}

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  workflow: NotificationWorkflow;
  context: WorkflowContext;
  state: 'pending' | 'running' | 'completed' | 'failed';
  currentStep?: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  data?: any;
  error?: string;
  timestamp: number;
}

export interface WorkflowResult {
  instanceId: string;
  success: boolean;
  steps: StepResult[];
  errors?: Error[];
  startedAt: number;
  completedAt: number;
}

@Injectable()
export class WorkflowEngine {
  private workflows = new Map<string, NotificationWorkflow>();
  private runningWorkflows = new Map<string, WorkflowInstance>();
  private storageKeyPrefix = 'notifications:workflow:';

  constructor(
    private notificationService: NotificationService,
    private redis: Redis,
    private options?: WorkflowOptions
  ) {
    this.loadDefaultWorkflows();
  }

  /**
   * Load default workflows
   */
  private loadDefaultWorkflows(): void {
    // Register welcome workflow
    this.defineWorkflow({
      id: 'welcome-series',
      name: 'Welcome Email Series',
      description: 'Onboarding email series for new users',
      trigger: { type: 'manual' },
      steps: [
        {
          id: 'welcome',
          name: 'Send welcome email',
          type: 'notification',
          config: {
            notification: {
              type: 'info',
              title: 'Welcome!',
              body: 'Thank you for joining us!'
            },
            channels: ['email', 'inApp']
          }
        },
        {
          id: 'wait-1-day',
          name: 'Wait 1 day',
          type: 'wait',
          config: {
            duration: 86400000 // 24 hours
          }
        },
        {
          id: 'tips',
          name: 'Send tips email',
          type: 'notification',
          config: {
            notification: {
              type: 'info',
              title: 'Getting Started Tips',
              body: 'Here are some tips to help you get started...'
            },
            channels: ['email']
          }
        }
      ]
    });
  }


  /**
   * Execute a notification workflow
   */
  async execute(
    workflowId: string,
    context: WorkflowContext
  ): Promise<WorkflowResult> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const instance = this.createInstance(workflow, context);
    this.runningWorkflows.set(instance.id, instance);

    try {
      const result = await this.runWorkflow(instance);

      // Store execution history
      await this.storeExecution(instance, result);

      return result;
    } finally {
      this.runningWorkflows.delete(instance.id);
    }
  }

  /**
   * Create workflow instance
   */
  private createInstance(
    workflow: NotificationWorkflow,
    context: WorkflowContext
  ): WorkflowInstance {
    return {
      id: generateUuid(),
      workflowId: workflow.id,
      workflow,
      context,
      state: 'pending',
      startedAt: Date.now()
    };
  }

  /**
   * Run workflow steps
   */
  private async runWorkflow(instance: WorkflowInstance): Promise<WorkflowResult> {
    const results: StepResult[] = [];
    const errors: Error[] = [];

    instance.state = 'running';

    for (const step of instance.workflow.steps) {
      instance.currentStep = step.id;

      try {
        // Check conditions
        if (step.conditions && !this.evaluateConditions(step.conditions, instance.context)) {
          results.push({
            stepId: step.id,
            success: true,
            data: { skipped: true },
            timestamp: Date.now()
          });
          continue;
        }

        // Handle delay
        if (step.delay) {
          await sleep(step.delay);
        }

        // Execute step
        const stepResult = await this.executeStep(step, instance);
        results.push(stepResult);

        // Update context with step result
        instance.context[`step_${step.id}_result`] = stepResult.data;

        if (!stepResult.success) {
          if (step.onError === 'stop') {
            instance.state = 'failed';
            break;
          } else if (step.onError === 'retry') {
            const retryResult = await this.retryStep(step, instance);
            results.push(retryResult);
            if (!retryResult.success) {
              instance.state = 'failed';
              break;
            }
          }
          // 'continue' - just proceed to next step
        }
      } catch (error: any) {
        errors.push(error);
        results.push({
          stepId: step.id,
          success: false,
          error: error.message,
          timestamp: Date.now()
        });

        if (step.onError === 'stop' || !step.onError) {
          instance.state = 'failed';
          break;
        }
      }
    }

    instance.state = instance.state === 'failed' ? 'failed' : 'completed';
    instance.completedAt = Date.now();

    return {
      instanceId: instance.id,
      success: instance.state === 'completed',
      steps: results,
      errors: errors.length > 0 ? errors : undefined,
      startedAt: instance.startedAt,
      completedAt: instance.completedAt
    };
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(
    step: WorkflowStep,
    instance: WorkflowInstance
  ): Promise<StepResult> {
    switch (step.type) {
      case 'notification':
        return this.executeNotificationStep(step, instance);

      case 'wait':
        return this.executeWaitStep(step, instance);

      case 'condition':
        return this.executeConditionStep(step, instance);

      case 'parallel':
        return this.executeParallelStep(step, instance);

      case 'batch':
        return this.executeBatchStep(step, instance);

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  /**
   * Execute notification step
   */
  private async executeNotificationStep(
    step: WorkflowStep,
    instance: WorkflowInstance
  ): Promise<StepResult> {
    const config = step.config;
    const recipients = this.resolveRecipients(config.recipients, instance.context);
    const notification = this.resolveNotification(config.notification, instance.context);
    const options: SendOptions = {
      channels: config.channels,
      ...config.options
    };

    try {
      // Only send if we have recipients
      if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) {
        return {
          stepId: step.id,
          success: true,
          data: { skipped: true, reason: 'No recipients' },
          timestamp: Date.now()
        };
      }

      const result = await this.notificationService.send(
        recipients,
        notification,
        options
      );

      return {
        stepId: step.id,
        success: result.failed === 0,
        data: result,
        timestamp: Date.now()
      };
    } catch (error: any) {
      return {
        stepId: step.id,
        success: false,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Execute wait step
   */
  private async executeWaitStep(
    step: WorkflowStep,
    instance: WorkflowInstance
  ): Promise<StepResult> {
    const config = step.config;

    if (config.duration) {
      await sleep(config.duration);
    } else if (config.until) {
      const untilTime = new Date(config.until).getTime();
      const waitTime = Math.max(0, untilTime - Date.now());
      await sleep(waitTime);
    }

    return {
      stepId: step.id,
      success: true,
      timestamp: Date.now()
    };
  }

  /**
   * Execute condition step
   */
  private async executeConditionStep(
    step: WorkflowStep,
    instance: WorkflowInstance
  ): Promise<StepResult> {
    const config = step.config;

    // Support different config formats
    let conditionMet: boolean;

    if (config.if) {
      // Format: { if: condition, then: [...], else: [...] }
      conditionMet = this.evaluateCondition(config.if, instance.context);
    } else if (config.field && config.operator && 'value' in config) {
      // Format: { field, operator, value, onTrue, onFalse }
      conditionMet = this.evaluateConditionObject(config, instance.context);

      // Store result for branching
      instance.context['lastStepResult'] = conditionMet;

      // Support setContext
      if (config.setContext && conditionMet) {
        Object.assign(instance.context, config.setContext);
      }
    } else {
      // Default to true if no condition specified
      conditionMet = true;
    }

    // Execute sub-steps based on condition result
    const subSteps = config.then || config.onTrue
      ? (conditionMet ? (config.then || []) : (config.else || []))
      : [];

    if (subSteps.length > 0) {
      for (const subStep of subSteps) {
        await this.executeStep(subStep, instance);
      }
    }

    return {
      stepId: step.id,
      success: true,
      data: { conditionMet },
      timestamp: Date.now()
    };
  }

  /**
   * Evaluate condition object
   */
  private evaluateConditionObject(
    condition: any,
    context: WorkflowContext
  ): boolean {
    const field = condition.field;
    const value = this.getNestedValue(context, field);
    const expected = condition.value;

    switch (condition.operator) {
      case 'equals':
        return value === expected;
      case 'notEquals':
        return value !== expected;
      case 'contains':
        return String(value).includes(String(expected));
      case 'greaterThan':
        return value > expected;
      case 'lessThan':
        return value < expected;
      default:
        return false;
    }
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    let value = obj;
    for (const key of keys) {
      value = value?.[key];
    }
    return value;
  }

  /**
   * Execute parallel steps
   */
  private async executeParallelStep(
    step: WorkflowStep,
    instance: WorkflowInstance
  ): Promise<StepResult> {
    const config = step.config;
    const parallelSteps = config.steps || [];

    const results = await Promise.all(
      parallelSteps.map((subStep: WorkflowStep) => this.executeStep(subStep, instance))
    );

    return {
      stepId: step.id,
      success: results.every(r => r.success),
      data: results,
      timestamp: Date.now()
    };
  }

  /**
   * Execute batch step
   */
  private async executeBatchStep(
    step: WorkflowStep,
    instance: WorkflowInstance
  ): Promise<StepResult> {
    const config = step.config;
    const items = config.items || [];
    const batchSize = config.batchSize || 10;

    const results: any[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((item: any) => this.processBatchItem(item, step, instance))
      );
      results.push(...batchResults);

      // Add delay between batches
      if (i + batchSize < items.length && config.batchDelay) {
        await sleep(config.batchDelay);
      }
    }

    return {
      stepId: step.id,
      success: true,
      data: results,
      timestamp: Date.now()
    };
  }

  /**
   * Process individual batch item
   */
  private async processBatchItem(
    item: any,
    step: WorkflowStep,
    instance: WorkflowInstance
  ): Promise<any> {
    // Implementation depends on batch item type
    return item;
  }

  /**
   * Retry a failed step
   */
  private async retryStep(
    step: WorkflowStep,
    instance: WorkflowInstance
  ): Promise<StepResult> {
    const maxAttempts = step.retryAttempts || 3;
    const retryDelay = step.retryDelay || 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await sleep(retryDelay * attempt);

      const result = await this.executeStep(step, instance);
      if (result.success) {
        return result;
      }
    }

    return {
      stepId: step.id,
      success: false,
      error: 'Max retry attempts reached',
      timestamp: Date.now()
    };
  }

  /**
   * Evaluate conditions
   */
  private evaluateConditions(
    conditions: StepCondition[],
    context: WorkflowContext
  ): boolean {
    return conditions.every(condition => this.evaluateCondition(condition, context));
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(
    condition: StepCondition | any,
    context: WorkflowContext
  ): boolean {
    const value = context[condition.field];

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'notEquals':
        return value !== condition.value;
      case 'contains':
        return String(value).includes(condition.value);
      case 'greaterThan':
        return value > condition.value;
      case 'lessThan':
        return value < condition.value;
      default:
        return false;
    }
  }

  /**
   * Resolve recipients from config
   */
  private resolveRecipients(
    recipientConfig: any,
    context: WorkflowContext
  ): Recipient | Recipient[] {
    if (typeof recipientConfig === 'function') {
      return recipientConfig(context);
    }

    if (typeof recipientConfig === 'string') {
      return context[recipientConfig] || { id: recipientConfig };
    }

    return recipientConfig;
  }

  /**
   * Resolve notification from config
   */
  private resolveNotification(
    notificationConfig: any,
    context: WorkflowContext
  ): NotificationPayload {
    if (typeof notificationConfig === 'function') {
      return notificationConfig(context);
    }

    // Replace variables in notification
    const notification = { ...notificationConfig };
    if (notification.title) {
      notification.title = this.replaceVariables(notification.title, context);
    }
    if (notification.body) {
      notification.body = this.replaceVariables(notification.body, context);
    }

    return notification;
  }

  /**
   * Replace variables in text
   */
  private replaceVariables(text: string, context: WorkflowContext): string {
    return text.replace(/\{\{(\w+)\}\}/g, (match, key) => context[key] ?? match);
  }

  /**
   * Store workflow execution
   */
  private async storeExecution(
    instance: WorkflowInstance,
    result: WorkflowResult
  ): Promise<void> {
    const key = `${this.storageKeyPrefix}execution:${instance.id}`;
    const data = {
      instance,
      result,
      timestamp: Date.now()
    };

    await this.redis.setex(key, 7 * 86400, JSON.stringify(data)); // Store for 7 days
  }

  /**
   * Get all workflows
   */
  getAllWorkflows(): NotificationWorkflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Get running workflows
   */
  getRunningWorkflows(): WorkflowInstance[] {
    return Array.from(this.runningWorkflows.values());
  }

  /**
   * Cancel a running workflow
   */
  async cancelWorkflow(instanceId: string): Promise<boolean> {
    const instance = this.runningWorkflows.get(instanceId);
    if (!instance) {
      return false;
    }

    instance.state = 'failed';
    instance.error = 'Cancelled by user';
    this.runningWorkflows.delete(instanceId);

    return true;
  }

  /**
   * Get a workflow by ID
   */
  getWorkflow(workflowId: string): NotificationWorkflow | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * List all workflows
   */
  listWorkflows(): NotificationWorkflow[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Get execution history for a workflow
   */
  async getExecutionHistory(workflowId: string, limit = 100): Promise<any[]> {
    const pattern = `${this.storageKeyPrefix}execution:*`;
    const keys = await this.redis.keys(pattern);

    const executions: any[] = [];
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const execution = JSON.parse(data);
        if (execution.instance?.workflowId === workflowId) {
          executions.push({
            instanceId: execution.instance.id,
            workflowId: execution.instance.workflowId,
            success: execution.result.success,
            startedAt: execution.instance.startedAt,
            completedAt: execution.result.completedAt,
            steps: execution.result.steps
          });
        }
      }
    }

    // Sort by startedAt descending and limit
    return executions
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * Get execution details by instance ID
   */
  async getExecutionDetails(instanceId: string): Promise<any> {
    const key = `${this.storageKeyPrefix}execution:${instanceId}`;
    const data = await this.redis.get(key);

    if (data) {
      const execution = JSON.parse(data);
      return {
        instanceId: execution.instance.id,
        workflowId: execution.instance.workflowId,
        success: execution.result.success,
        startedAt: execution.instance.startedAt,
        completedAt: execution.result.completedAt,
        steps: execution.result.steps,
        context: execution.instance.context
      };
    }

    return null;
  }

  /**
   * Validate workflow structure
   */
  private validateWorkflow(workflow: NotificationWorkflow): void {
    if (!workflow.id) {
      throw new Error('Workflow ID is required');
    }
    if (!workflow.name) {
      throw new Error('Workflow name is required');
    }
    if (!workflow.trigger) {
      throw new Error('Workflow trigger is required');
    }
    if (!workflow.steps || workflow.steps.length === 0) {
      throw new Error('Workflow must have at least one step');
    }
  }

  /**
   * Redefine defineWorkflow to add validation
   */
  defineWorkflow(workflow: NotificationWorkflow): void {
    this.validateWorkflow(workflow);
    this.workflows.set(workflow.id, workflow);
  }
}