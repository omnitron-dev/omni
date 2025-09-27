import { EventEmitter } from 'eventemitter3';
import { OrchestronEngine } from './engine';
import { TaskManager } from './task-manager';
import { SprintManager } from './sprint-manager';
import { Analytics } from './analytics';
import { MLPredictor } from './ml-predictor';
import { Storage } from '../storage/interface';
import {
  AgentIdentityManager,
  SharedMemoryManager,
  TaskCoordinator,
  KnowledgeSynthesizer,
  ConflictResolver
} from '../multi-agent';
import {
  NodeId,
  TaskNode,
  SprintNode,
  TaskStatus,
  Priority,
  SearchOptions,
  Statistics,
  Context,
  NavigationHistory,
  Bookmark,
  WorkflowDefinition,
  Dashboard,
  Node,
  DevelopmentNodeType,
  FileChange,
  CommitResponse,
  DevelopmentMetadata,
} from './types';

/**
 * Unified Orchestron System - Single interface for all development management
 */
export class UnifiedOrchestron extends EventEmitter {
  private engine: OrchestronEngine;
  private taskManager: TaskManager;
  private sprintManager: SprintManager;
  private analytics: Analytics;
  private mlPredictor: MLPredictor;

  // Multi-agent components (Phase 7)
  private agentManager: AgentIdentityManager;
  private sharedMemory: SharedMemoryManager;
  private taskCoordinator: TaskCoordinator;
  private knowledgeSynthesizer: KnowledgeSynthesizer;
  private conflictResolver: ConflictResolver;

  // Navigation state
  private navigationHistory: NavigationHistory;
  private bookmarks: Map<string, Bookmark>;
  private context: Context;

  // Workflow state
  private workflows: Map<string, WorkflowDefinition>;
  private activeWorkflows: Set<string>;

  // File watchers
  private fileWatchers: Map<string, any>;

  constructor(storage: Storage) {
    super();

    // Initialize core components
    this.engine = new CSPEngine(storage);
    this.taskManager = new TaskManager(this.engine);
    this.sprintManager = new SprintManager(this.engine, this.taskManager);
    this.analytics = new Analytics(
      this.engine,
      this.taskManager,
      this.sprintManager
    );
    this.mlPredictor = new MLPredictor(this.engine);

    // Initialize multi-agent components (Phase 7)
    this.agentManager = new AgentIdentityManager();
    this.sharedMemory = new SharedMemoryManager();
    this.taskCoordinator = new TaskCoordinator(this.agentManager, this.sharedMemory);
    this.knowledgeSynthesizer = new KnowledgeSynthesizer();
    this.conflictResolver = new ConflictResolver();

    // Initialize navigation
    this.navigationHistory = {
      back: [],
      forward: [],
      current: null,
    };
    this.bookmarks = new Map();

    // Initialize context
    this.context = {
      currentBranch: 'main',
      currentNode: null,
      currentTask: null,
      currentSprint: this.sprintManager.getActiveSprint(),
      workingDirectory: process.cwd(),
    };

    // Initialize workflows
    this.workflows = new Map();
    this.activeWorkflows = new Set();
    this.fileWatchers = new Map();

    this.setupEventHandlers();
  }

  async initialize(): Promise<void> {
    await this.engine.ensureInitialized();
  }

  // ============= Task Management =============

  async getTask(taskId: NodeId): Promise<TaskNode | null> {
    return this.taskManager.getTask(taskId);
  }

  async createTask(params: {
    type?: DevelopmentNodeType;
    title: string;
    description?: string;
    priority?: Priority;
    assignee?: string;
    dueDate?: Date;
    labels?: string[];
    parent?: NodeId;
    estimatedHours?: number;
  }): Promise<TaskNode> {
    const task = await this.taskManager.createTask(params);
    this.emit('task:created', task);
    return task;
  }

  async updateTaskStatus(
    taskId: NodeId,
    status: TaskStatus
  ): Promise<void> {
    await this.taskManager.updateTaskStatus(taskId, status);
    this.emit('task:status-changed', { taskId, status });
  }

  async assignTask(taskId: NodeId, assignee: string): Promise<void> {
    await this.taskManager.assignTask(taskId, assignee);
    this.emit('task:assigned', { taskId, assignee });
  }

  // TODO Management
  async addTodo(text: string, context?: string): Promise<TaskNode> {
    const todo = await this.taskManager.addTodo(text, context);
    this.emit('todo:added', todo);
    return todo;
  }

  async getTodos(): Promise<TaskNode[]> {
    return this.taskManager.getTodos();
  }

  // ============= Sprint Management =============

  async getAllSprints(): Promise<SprintNode[]> {
    return this.sprintManager.getAllSprints();
  }

  async getSprintReport(sprintId: NodeId): Promise<any> {
    return this.sprintManager.getSprintReport(sprintId);
  }

  async createSprint(params: {
    name: string;
    goal: string;
    startDate: Date;
    duration: number;
  }): Promise<SprintNode> {
    const sprint = await this.sprintManager.createSprint(params);
    this.emit('sprint:created', sprint);
    return sprint;
  }

  async startSprint(sprintId: NodeId): Promise<void> {
    await this.sprintManager.startSprint(sprintId);
    this.context.currentSprint = sprintId;
    this.emit('sprint:started', sprintId);
  }

  async endSprint(sprintId: NodeId): Promise<void> {
    await this.sprintManager.endSprint(sprintId);
    this.context.currentSprint = null;
    this.emit('sprint:ended', sprintId);
  }

  async addToSprint(taskId: NodeId, sprintId: NodeId): Promise<void> {
    await this.sprintManager.addToSprint(taskId, sprintId);
    this.emit('sprint:task-added', { taskId, sprintId });
  }

  // ============= Navigation & Search =============

  async goto(query: string): Promise<Node | null> {
    // Parse query
    if (query.startsWith('task:')) {
      const taskId = query.substring(5);
      return this.gotoTask(taskId);
    } else if (query.startsWith('file:')) {
      const filePath = query.substring(5);
      return this.gotoFile(filePath);
    } else {
      // Smart search
      const results = await this.search(query);
      if (results.length > 0) {
        return this.gotoNode(results[0].nodeId);
      }
    }
    return null;
  }

  async gotoTask(taskId: NodeId): Promise<TaskNode | null> {
    const task = await this.engine.getNode(taskId);
    if (task) {
      this.navigate(taskId);
      this.context.currentTask = taskId;
      this.emit('navigation:task', task);
      return task as TaskNode;
    }
    return null;
  }

  async gotoFile(filePath: string): Promise<Node | null> {
    const nodes = await this.engine.queryByMetadata({
      filesModified: [filePath],
    });

    if (nodes.length > 0) {
      this.navigate(nodes[0].nodeId);
      this.emit('navigation:file', filePath);
      return nodes[0];
    }
    return null;
  }

  async gotoNode(nodeId: NodeId): Promise<Node | null> {
    const node = await this.engine.getNode(nodeId);
    if (node) {
      this.navigate(nodeId);
      this.emit('navigation:node', node);
      return node;
    }
    return null;
  }

  async search(
    query: string,
    options?: SearchOptions
  ): Promise<Node[]> {
    const results = await this.engine.search(query, options);
    return results;
  }

  async searchTasks(filter: {
    status?: TaskStatus;
    priority?: Priority;
    assignee?: string;
  }): Promise<TaskNode[]> {
    const tasks = await this.engine.queryByType(DevelopmentNodeType.TASK);
    return tasks.filter((task) => {
      const t = task as TaskNode;
      if (filter.status && t.payload.status !== filter.status) return false;
      if (filter.priority && t.payload.priority !== filter.priority)
        return false;
      if (filter.assignee && t.payload.assignee !== filter.assignee)
        return false;
      return true;
    }) as TaskNode[];
  }

  // Navigation history
  private navigate(nodeId: NodeId): void {
    if (this.navigationHistory.current) {
      this.navigationHistory.back.push(this.navigationHistory.current);
    }
    this.navigationHistory.current = nodeId;
    this.navigationHistory.forward = [];
    this.context.currentNode = nodeId;
  }

  back(): NodeId | null {
    if (this.navigationHistory.back.length > 0) {
      const nodeId = this.navigationHistory.back.pop()!;
      if (this.navigationHistory.current) {
        this.navigationHistory.forward.push(this.navigationHistory.current);
      }
      this.navigationHistory.current = nodeId;
      this.context.currentNode = nodeId;
      // Update currentTask synchronously for navigation
      this.context.currentTask = nodeId;
      return nodeId;
    }
    return null;
  }

  forward(): NodeId | null {
    if (this.navigationHistory.forward.length > 0) {
      const nodeId = this.navigationHistory.forward.pop()!;
      if (this.navigationHistory.current) {
        this.navigationHistory.back.push(this.navigationHistory.current);
      }
      this.navigationHistory.current = nodeId;
      this.context.currentNode = nodeId;
      // Update currentTask synchronously for navigation
      this.context.currentTask = nodeId;
      return nodeId;
    }
    return null;
  }


  // Bookmarks
  addBookmark(nodeId: NodeId, name: string): void {
    const bookmark: Bookmark = {
      id: uuidv4(),
      name,
      nodeId,
      createdAt: new Date(),
    };
    this.bookmarks.set(bookmark.id, bookmark);
    this.emit('bookmark:added', bookmark);
  }

  getBookmarks(): Bookmark[] {
    return Array.from(this.bookmarks.values());
  }

  // ============= Statistics & Analytics =============

  async getStats(): Promise<Statistics> {
    return this.analytics.getStats();
  }

  async getBottlenecks(): Promise<any[]> {
    return this.analytics.identifyBottlenecks();
  }

  async predictCompletion(taskId: NodeId): Promise<Date | null> {
    return this.analytics.predictCompletion(taskId);
  }

  // ============= Machine Learning & Predictive Analytics (Phase 6) =============

  async predictTaskCompletionML(taskId: NodeId): Promise<any> {
    return this.mlPredictor.predictTaskCompletion(taskId);
  }

  async detectAnomalies(windowHours: number = 24): Promise<any[]> {
    return this.mlPredictor.detectAnomalies(windowHours);
  }

  async predictBugs(changeNodes: NodeId[]): Promise<any> {
    return this.mlPredictor.predictBugs(changeNodes);
  }

  async detectBurnoutRisk(developerName: string): Promise<any> {
    return this.mlPredictor.detectBurnoutRisk(developerName);
  }

  async optimizeSprintPlanning(
    sprintCapacity: number,
    availableTasks: NodeId[],
    teamSize: number
  ): Promise<any> {
    return this.mlPredictor.optimizeSprintPlanning(sprintCapacity, availableTasks, teamSize);
  }

  async predictCodeQuality(changeNodes: NodeId[]): Promise<any> {
    return this.mlPredictor.predictCodeQuality(changeNodes);
  }

  async generateDashboard(): Promise<Dashboard> {
    const stats = await this.getStats();
    const bottlenecks = await this.getBottlenecks();
    const sprints = await this.sprintManager.getVelocityChart(5);

    return {
      widgets: [
        {
          id: 'stats',
          type: 'stat',
          title: 'Overview',
          config: { stats },
          data: stats,
        },
        {
          id: 'velocity',
          type: 'chart',
          title: 'Sprint Velocity',
          config: { type: 'line' },
          data: sprints,
        },
        {
          id: 'bottlenecks',
          type: 'list',
          title: 'Bottlenecks',
          config: {},
          data: bottlenecks,
        },
        {
          id: 'tasks',
          type: 'list',
          title: 'Active Tasks',
          config: {},
          data: await this.sprintManager.getCurrentSprintTasks(),
        },
      ],
      layout: {
        columns: 2,
        rows: 2,
        positions: [
          { widgetId: 'stats', x: 0, y: 0, w: 1, h: 1 },
          { widgetId: 'velocity', x: 1, y: 0, w: 1, h: 1 },
          { widgetId: 'bottlenecks', x: 0, y: 1, w: 1, h: 1 },
          { widgetId: 'tasks', x: 1, y: 1, w: 1, h: 1 },
        ],
      },
      refreshInterval: 60000, // 1 minute
      filters: [],
    };
  }

  // ============= Workflow Automation =============

  defineWorkflow(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
    if (workflow.enabled) {
      this.activateWorkflow(workflow.id);
    }
  }

  activateWorkflow(workflowId: string): void {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return;

    this.activeWorkflows.add(workflowId);
    workflow.enabled = true;

    // Set up triggers
    for (const trigger of workflow.triggers) {
      this.setupTrigger(workflowId, trigger);
    }

    this.emit('workflow:activated', workflowId);
  }

  deactivateWorkflow(workflowId: string): void {
    this.activeWorkflows.delete(workflowId);
    const workflow = this.workflows.get(workflowId);
    if (workflow) {
      workflow.enabled = false;
    }
    this.emit('workflow:deactivated', workflowId);
  }

  private setupTrigger(workflowId: string, trigger: any): void {
    switch (trigger.type) {
      case 'task_created':
        this.on('task:created', (task) => {
          this.executeWorkflow(workflowId, { task });
        });
        break;

      case 'status_change':
        this.on('task:status-changed', ({ taskId, status }) => {
          if (status === trigger.config.status) {
            this.executeWorkflow(workflowId, { taskId, status });
          }
        });
        break;

      case 'schedule':
        // Set up cron job
        const interval = trigger.config.interval || 60000;
        setInterval(() => {
          this.executeWorkflow(workflowId, {});
        }, interval);
        break;
    }
  }

  private async executeWorkflow(
    workflowId: string,
    context: any
  ): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow || !workflow.enabled) return;

    // Check conditions
    if (workflow.conditions) {
      for (const condition of workflow.conditions) {
        if (!this.evaluateCondition(condition, context)) {
          return;
        }
      }
    }

    // Execute actions
    for (const action of workflow.actions) {
      await this.executeAction(action, context);
    }

    workflow.lastRun = new Date();
    workflow.runCount = (workflow.runCount || 0) + 1;

    this.emit('workflow:executed', { workflowId, context });
  }

  private evaluateCondition(condition: any, context: any): boolean {
    // Simple condition evaluation
    if (condition.type === 'if' && condition.expression) {
      // Parse simple expressions like 'priority === "HIGH"'
      if (condition.expression.includes('priority === "HIGH"')) {
        return context.task?.payload?.priority === Priority.HIGH;
      }
    }
    return true;
  }

  private async executeAction(action: any, context: any): Promise<void> {
    switch (action.type) {
      case 'create_task':
        await this.createTask(action.config);
        break;

      case 'update_status':
        if (context.taskId) {
          await this.updateTaskStatus(context.taskId, action.config.status);
        }
        break;

      case 'assign':
        const taskId = context.taskId || context.task?.nodeId;
        if (taskId) {
          await this.assignTask(taskId, action.config.assignee);
        }
        break;

      case 'notify':
        this.emit('notification', {
          message: action.config.message,
          recipients: action.config.recipients,
        });
        break;
    }
  }

  // ============= Additional Task Management Methods =============

  async updateTaskProgress(taskId: NodeId, progress: number, checkpoint?: string): Promise<void> {
    await this.taskManager.updateTaskProgress(taskId, progress, checkpoint);
    this.emit('task:progress-updated', { taskId, progress });
  }

  async addDependency(taskId: NodeId, dependsOn: NodeId): Promise<void> {
    await this.taskManager.addDependency(taskId, dependsOn);
    this.emit('task:dependency-added', { taskId, dependsOn });
  }

  async convertTodoToTask(todoId: NodeId, details: Partial<TaskNode['payload']>): Promise<TaskNode> {
    const task = await this.taskManager.convertTodoToTask(todoId, details);
    this.emit('todo:converted', { todoId, task });
    return task;
  }

  async startTimer(taskId: NodeId, assignee: string): Promise<void> {
    this.taskManager.startTimer(taskId, assignee);
    this.emit('timer:started', taskId);
  }

  async stopTimer(taskId: NodeId): Promise<void> {
    await this.taskManager.stopTimer(taskId);
    this.emit('timer:stopped', taskId);
  }

  async completeCheckpoint(taskId: NodeId, checkpointName: string): Promise<void> {
    const task = await this.engine.getNode(taskId);
    if (task) {
      const taskNode = task as TaskNode;
      const currentProgress = taskNode.payload.progress || 0;
      await this.taskManager.updateTaskProgress(taskId, currentProgress, checkpointName);
    }
    this.emit('checkpoint:completed', { taskId, checkpointName });
  }

  // ============= Additional Sprint Methods =============

  getActiveSprint(): NodeId | null {
    return this.sprintManager.getActiveSprint();
  }

  async getBurndownChart(sprintId: NodeId): Promise<any> {
    return this.sprintManager.getBurndownChart(sprintId);
  }

  async getVelocityChart(lastNSprints: number): Promise<any> {
    return this.sprintManager.getVelocityChart(lastNSprints);
  }

  // ============= Additional Analytics Methods =============

  async getMetricData(metric: string, period: any): Promise<any> {
    return this.analytics.getMetricData(metric, period);
  }

  async identifyBottlenecks(): Promise<any[]> {
    return this.analytics.identifyBottlenecks();
  }

  async getSprint(sprintId: NodeId): Promise<SprintNode | null> {
    const node = await this.engine.getNode(sprintId);
    if (node && node.nodeType === DevelopmentNodeType.SPRINT) {
      return node as SprintNode;
    }
    return null;
  }

  // ============= Additional Navigation Methods =============

  async getRecentNodes(limit: number): Promise<Node[]> {
    return this.engine.getRecentNodes(limit);
  }

  // ============= Workflow Methods =============

  async createWorkflow(workflow: WorkflowDefinition): Promise<void> {
    this.defineWorkflow(workflow);
    this.emit('workflow:created', workflow);
  }

  async listWorkflows(): Promise<WorkflowDefinition[]> {
    return Array.from(this.workflows.values());
  }

  async enableWorkflow(workflowId: string): Promise<void> {
    this.activateWorkflow(workflowId);
  }

  // ============= Reporting Methods =============

  async generateReport(format: 'html' | 'json' | 'markdown'): Promise<string> {
    const stats = await this.getStats();
    const tasks = await this.searchTasks({});
    const sprints = await this.sprintManager.getAllSprints();

    // Generate report based on format
    if (format === 'json') {
      return JSON.stringify({ stats, tasks, sprints }, null, 2);
    } else if (format === 'markdown') {
      return `# Development Report

## Statistics
- Total Tasks: ${stats.totalTasks}
- In Progress: ${stats.inProgress}
- Completed Today: ${stats.completedToday}
- Velocity: ${stats.velocity}

## Active Tasks
${tasks.map(t => `- ${t.payload.title} (${t.payload.status})`).join('\\n')}
`;
    } else {
      return `<html><body><h1>Development Report</h1></body></html>`;
    }
  }

  async generateGraph(options?: any): Promise<any> {
    const nodes = await this.engine.getAllNodes();
    const edges = await this.engine.getAllEdges();
    return { nodes, edges };
  }

  async generateTimeline(component?: string): Promise<any> {
    const nodes = component
      ? await this.engine.queryByMetadata({ component })
      : await this.engine.getAllNodes();

    return nodes.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // ============= Code Management =============

  async commitCode(params: {
    type: DevelopmentNodeType;
    files: FileChange[];
    message: string;
    metrics?: DevelopmentMetadata;
  }): Promise<CommitResponse> {
    return this.engine.commitCode(params);
  }

  // ============= File System Integration =============

  watchFiles(patterns: string[]): void {
    const fs = require('fs');
    const path = require('path');
    const glob = require('glob');

    for (const pattern of patterns) {
      const files = glob.sync(pattern);
      for (const file of files) {
        if (!this.fileWatchers.has(file)) {
          const watcher = fs.watch(file, async (eventType: string) => {
            if (eventType === 'change') {
              await this.handleFileChange(file);
            }
          });
          this.fileWatchers.set(file, watcher);
        }
      }
    }
  }

  private async handleFileChange(file: string): Promise<void> {
    // Auto-detect what happened
    const fs = require('fs').promises;

    try {
      const stats = await fs.stat(file);
      const content = await fs.readFile(file, 'utf-8');

      // Check if it's a test file
      if (file.includes('.test.') || file.includes('.spec.')) {
        await this.handleTestFileChange(file, content);
      }

      // Check if it's a source file
      else if (file.endsWith('.ts') || file.endsWith('.rs')) {
        await this.handleSourceFileChange(file, content);
      }

      this.emit('file:changed', { file, stats });
    } catch (error) {
      this.emit('file:error', { file, error });
    }
  }

  private async handleTestFileChange(
    file: string,
    content: string
  ): Promise<void> {
    // Create a test node
    await this.engine.commit({
      nodes: [
        {
          author: Author.SYSTEM,
          parentIds: [],
          nodeType: DevelopmentNodeType.TEST,
          payload: {
            file,
            content: content.substring(0, 1000), // First 1000 chars
          },
          metadata: {
            filesModified: [file],
          },
        },
      ] as any,
      edges: [],
      message: `Test file updated: ${file}`,
    });
  }

  private async handleSourceFileChange(
    file: string,
    content: string
  ): Promise<void> {
    // Try to detect what changed
    const lines = content.split('\n');
    const linesAdded = lines.length; // Simplified

    await this.engine.commit({
      nodes: [
        {
          author: Author.SYSTEM,
          parentIds: [],
          nodeType: DevelopmentNodeType.MODULE,
          payload: {
            file,
            summary: `File modified: ${file}`,
          },
          metadata: {
            filesModified: [file],
            linesAdded,
            linesRemoved: 0,
          },
        },
      ] as any,
      edges: [],
      message: `Source file updated: ${file}`,
    });
  }

  // ============= Context Management =============

  getCurrentContext(): Context {
    return { ...this.context };
  }

  async switchBranch(branchName: string): Promise<void> {
    await this.engine.checkoutBranch(branchName);
    this.context.currentBranch = branchName;
    this.emit('context:branch-changed', branchName);
  }

  // ============= CLI Interface Support =============

  async executeCommand(command: string, args: string[]): Promise<any> {
    switch (command) {
      case 'task':
        return this.executeTaskCommand(args[0], args.slice(1));
      case 'todo':
        return this.executeTodoCommand(args[0], args.slice(1));
      case 'sprint':
        return this.executeSprintCommand(args[0], args.slice(1));
      case 'goto':
        return this.goto(args[0]);
      case 'stats':
        return this.getStats();
      case 'dashboard':
        return this.generateDashboard();
      case 'predict':
        return this.executePredictCommand(args[0], args.slice(1));
      case 'anomaly':
        return this.detectAnomalies(parseInt(args[0] || '24'));
      case 'burnout':
        return this.detectBurnoutRisk(args[0] || 'me');
      case 'optimize-sprint':
        return this.optimizeSprintPlanning(
          parseInt(args[0] || '80'),
          args.slice(1),
          parseInt(args[args.length - 1] || '3')
        );
      case 'agent':
        return this.executeAgentCommand(args[0], args.slice(1));
      case 'memory':
        return this.getSharedMemoryStats();
      case 'synthesize':
        return this.executeSynthesizeCommand(args);
      case 'resolve':
        return this.resolveConflict(args[0], args[1] || 'voting');
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  private async executeTaskCommand(
    subcommand: string,
    args: string[]
  ): Promise<any> {
    switch (subcommand) {
      case 'create':
        const priorityMap: Record<string, Priority> = {
          'CRITICAL': Priority.CRITICAL,
          'HIGH': Priority.HIGH,
          'MEDIUM': Priority.MEDIUM,
          'LOW': Priority.LOW,
          'TRIVIAL': Priority.TRIVIAL,
        };
        return this.createTask({
          title: args[0],
          priority: priorityMap[args[1]] || Priority.MEDIUM,
        });
      case 'list':
        return this.searchTasks({});
      case 'update':
        return this.updateTaskStatus(args[0], args[1] as TaskStatus);
      case 'assign':
        return this.assignTask(args[0], args[1]);
      default:
        throw new Error(`Unknown task command: ${subcommand}`);
    }
  }

  private async executeTodoCommand(
    subcommand: string,
    args: string[]
  ): Promise<any> {
    switch (subcommand) {
      case 'add':
        return this.addTodo(args.join(' '));
      case 'list':
        return this.getTodos();
      default:
        // If no recognized subcommand, treat entire input as todo text
        if (subcommand) {
          return this.addTodo([subcommand, ...args].join(' '));
        } else {
          return this.addTodo(args.join(' '));
        }
    }
  }

  private async executeSprintCommand(
    subcommand: string,
    args: string[]
  ): Promise<any> {
    switch (subcommand) {
      case 'create':
        return this.createSprint({
          name: args[0],
          goal: args[1],
          startDate: new Date(),
          duration: parseInt(args[2]) || 14,
        });
      case 'start':
        return this.startSprint(args[0]);
      case 'end':
        return this.endSprint(args[0]);
      case 'add':
        return this.addToSprint(args[0], args[1]);
      default:
        throw new Error(`Unknown sprint command: ${subcommand}`);
    }
  }

  private async executePredictCommand(
    subcommand: string,
    args: string[]
  ): Promise<any> {
    switch (subcommand) {
      case 'task':
      case 'completion':
        return this.predictTaskCompletionML(args[0]);
      case 'bugs':
      case 'bug':
        return this.predictBugs(args);
      case 'quality':
        return this.predictCodeQuality(args);
      default:
        throw new Error(`Unknown predict command: ${subcommand}`);
    }
  }

  // ============= Event Handlers =============

  private setupEventHandlers(): void {
    // Forward engine events
    this.engine.on('commit', (response) => {
      this.emit('csp:commit', response);
    });

    this.engine.on('error', (error) => {
      this.emit('csp:error', error);
    });

    // Auto-update context
    this.on('task:created', (task) => {
      if (!this.context.currentTask) {
        this.context.currentTask = task.nodeId;
      }
    });
  }

  private async executeAgentCommand(subcommand: string, args: string[]): Promise<any> {
    switch (subcommand) {
      case 'register':
        return this.registerAgent({
          id: args[0],
          model: args[1] || 'claude-opus-4.1',
          specialization: args.slice(2),
          capabilities: [],
          preferences: {
            maxConcurrentTasks: parseInt(args[3] || '3'),
            preferredTaskTypes: [],
            contextWindowSize: 200000
          },
          reputation: { score: 0.8, totalTasks: 0, successfulTasks: 0, failedTasks: 0 },
          sessionHistory: []
        });
      case 'list':
        return this.getAvailableAgents();
      case 'assign':
        return this.assignTaskToAgent(args[0], args[1]);
      case 'handoff':
        return this.createAgentHandoff({
          fromAgent: args[0],
          toAgent: args[1],
          taskId: args[2],
          reason: args[3] || 'Manual handoff'
        });
      case 'session':
        if (args[0] === 'start') {
          return this.startAgentSession(args[1]);
        } else if (args[0] === 'end') {
          return this.endAgentSession(args[1]);
        }
        throw new Error('Invalid session command');
      default:
        throw new Error(`Unknown agent subcommand: ${subcommand}`);
    }
  }

  private async executeSynthesizeCommand(args: string[]): Promise<any> {
    // Parse contributions from args
    const contributions = args.map((arg, index) => ({
      agentId: `agent-${index}`,
      contribution: arg,
      timestamp: new Date(),
      confidence: 0.8,
      evidence: []
    }));

    return this.synthesizeKnowledge(contributions);
  }

  // ============= Multi-Agent Operations (Phase 7) =============

  async registerAgent(params: any): Promise<any> {
    return this.agentManager.registerAgent(params);
  }

  async getAgent(agentId: string): Promise<any> {
    return this.agentManager.getAgent(agentId);
  }

  async startAgentSession(agentId: string): Promise<any> {
    return this.agentManager.startSession(agentId);
  }

  async endAgentSession(sessionId: string): Promise<any> {
    return this.agentManager.endSession(sessionId);
  }

  async getAvailableAgents(): Promise<any[]> {
    return this.agentManager.getAvailableAgents();
  }

  async assignTaskToAgent(taskId: NodeId, strategy?: string): Promise<any> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    return this.taskCoordinator.assignTask({
      taskId: taskId,
      type: task.metadata?.component || 'general',
      requirements: {
        requiredSpecialization: task.metadata?.component ? [task.metadata.component] : [],
        preferredReputation: 0.7
      }
    });
  }

  async distributeTasksToAgents(taskIds: NodeId[], strategy: string = 'expertise'): Promise<any> {
    const tasks = await Promise.all(
      taskIds.map(async (id) => {
        const task = await this.getTask(id);
        return {
          taskId: id,
          type: task?.metadata?.component || 'general',
          requirements: {
            requiredSpecialization: task?.metadata?.component ? [task.metadata.component] : []
          }
        };
      })
    );

    return this.taskCoordinator.distributeTasks(
      tasks.filter(t => t !== null),
      strategy as any
    );
  }

  async createAgentHandoff(params: {
    fromAgent: string;
    toAgent: string;
    taskId: string;
    reason: string;
    context?: any;
  }): Promise<any> {
    return this.agentManager.createHandoff({
      fromAgent: params.fromAgent,
      toAgent: params.toAgent,
      task: params.taskId,
      context: {
        currentProgress: 0,
        completedSteps: [],
        remainingWork: [],
        sharedKnowledge: params.context || {},
        warnings: []
      },
      reason: params.reason
    });
  }

  async addInsight(insight: any): Promise<void> {
    return this.sharedMemory.addInsight(insight);
  }

  async addPattern(pattern: any): Promise<void> {
    return this.sharedMemory.addPattern(pattern);
  }

  async synthesizeKnowledge(contributions: any[]): Promise<any> {
    return this.knowledgeSynthesizer.synthesize(contributions);
  }

  async resolveConflict(conflictId: string, strategy: string): Promise<any> {
    const conflict = await this.sharedMemory.getConflict(conflictId);
    if (!conflict) {
      throw new Error('Conflict not found');
    }

    switch (strategy) {
      case 'voting':
        return this.conflictResolver.resolveByVoting(conflict);
      case 'expertise':
        return this.conflictResolver.resolveByExpertise(conflict, new Map());
      case 'consensus':
        return this.conflictResolver.buildConsensus(conflict, {
          method: 'discussion',
          rounds: 3,
          threshold: 0.67
        });
      case 'compromise':
        return this.conflictResolver.resolveByCompromise(conflict);
      default:
        throw new Error(`Unknown resolution strategy: ${strategy}`);
    }
  }

  async getSharedMemoryStats(): Promise<any> {
    return {
      insights: await this.sharedMemory.search(''),
      patterns: await this.sharedMemory.search(''),
      pendingDecisions: await this.sharedMemory.getPendingDecisions()
    };
  }

  // ============= Cleanup =============

  async close(): Promise<void> {
    // Stop file watchers
    for (const watcher of this.fileWatchers.values()) {
      watcher.close();
    }
    this.fileWatchers.clear();

    // Deactivate workflows
    for (const workflowId of this.activeWorkflows) {
      this.deactivateWorkflow(workflowId);
    }

    await this.engine.close();
  }
}

// Helper function
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

import { Author } from './types';