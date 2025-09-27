import { SQLiteStorage } from '../../src/storage/sqlite';
import { OrchestronEngine } from '../../src/core/engine';
import { TaskManager } from '../../src/core/task-manager';
import { SprintManager } from '../../src/core/sprint-manager';
import { Analytics } from '../../src/core/analytics';
import { UnifiedOrchestron } from '../../src/core/unified-orchestron';
import { v4 as uuidv4 } from 'uuid';
import {
  Node,
  TaskNode,
  SprintNode,
  Author,
  DevelopmentNodeType,
  TaskStatus,
  Priority,
  DevelopmentEdgeType,
  NodeId,
  BranchName,
  MergeStrategy,
} from '../../src/core/types';

// Global registry for active test contexts
const activeContexts = new Set<TestContext>();

// Create in-memory storage for testing
export async function createTestStorage(): Promise<SQLiteStorage> {
  const storage = new SQLiteStorage(':memory:');
  await storage.initialize();
  return storage;
}

// Create test engine with initialized storage
export async function createTestEngine(): Promise<OrchestronEngine> {
  const storage = await createTestStorage();
  const engine = new OrchestronEngine(storage);
  await engine.ensureInitialized();
  return engine;
}

// Create test UnifiedOrchestron instance
export async function createTestUnifiedOrchestron(): Promise<{
  csp: UnifiedOrchestron;
  storage: SQLiteStorage;
}> {
  const storage = await createTestStorage();
  const csp = new UnifiedOrchestron(storage);
  await csp.initialize();
  return { csp, storage };
}

// Create test task node
export function createTestTaskNode(overrides?: Partial<TaskNode>): TaskNode {
  const taskNode: TaskNode = {
    nodeId: uuidv4(),
    author: Author.HUMAN,
    timestamp: new Date(),
    parentIds: [],
    nodeType: DevelopmentNodeType.TASK,
    payload: {
      title: 'Test Task',
      description: 'Test task description',
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
      progress: 0,
      labels: [],
      ...overrides?.payload,
    },
    metadata: {},
    ...overrides,
  };
  return taskNode;
}

// Create test sprint node
export function createTestSprintNode(overrides?: Partial<SprintNode>): SprintNode {
  const startDate = new Date();
  const endDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

  const sprintNode: SprintNode = {
    nodeId: uuidv4(),
    author: Author.HUMAN,
    timestamp: new Date(),
    parentIds: [],
    nodeType: DevelopmentNodeType.SPRINT,
    payload: {
      name: 'Test Sprint',
      goal: 'Complete test features',
      startDate,
      endDate,
      committedTasks: [],
      completedTasks: [],
      carryOverTasks: [],
      ...overrides?.payload,
    },
    metadata: {},
    ...overrides,
  };
  return sprintNode;
}

// Wait for async operations
export async function waitFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Clean up test storage
export async function cleanupTestStorage(storage: SQLiteStorage): Promise<void> {
  await storage.clear();
  await storage.close();
}

// Comprehensive test context
export interface TestContext {
  engine: OrchestronEngine;
  taskManager: TaskManager;
  sprintManager: SprintManager;
  analytics: Analytics;
  unifiedOrchestron: UnifiedOrchestron;
  storage: SQLiteStorage;
}

export async function createTestContext(): Promise<TestContext> {
  const storage = await createTestStorage();
  const engine = new OrchestronEngine(storage);
  await engine.ensureInitialized();

  const taskManager = new TaskManager(engine);
  const sprintManager = new SprintManager(engine, taskManager);
  const analytics = new Analytics(engine, taskManager, sprintManager);
  const unifiedOrchestron = new UnifiedOrchestron(storage);
  await unifiedOrchestron.initialize();

  const context = {
    engine,
    taskManager,
    sprintManager,
    analytics,
    unifiedOrchestron,
    storage,
  };

  // Register for cleanup
  activeContexts.add(context);

  return context;
}

export async function cleanupTestContext(context?: TestContext): Promise<void> {
  if (context) {
    await context.storage.clear();
    await context.storage.close();
    activeContexts.delete(context);
  } else {
    // Clean up all active contexts
    for (const ctx of activeContexts) {
      try {
        await ctx.storage.clear();
        await ctx.storage.close();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    activeContexts.clear();
  }
}

// Enhanced task creation helper
export async function createSampleTask(
  context: TestContext,
  overrides?: Partial<TaskNode['payload']>
): Promise<TaskNode> {
  const task = await context.taskManager.createTask({
    title: 'Sample Task',
    description: 'This is a sample task for testing',
    priority: Priority.MEDIUM,
    estimatedHours: 8,
    ...overrides,
  });

  // Ensure task is properly stored by waiting and verifying
  await new Promise(resolve => setTimeout(resolve, 50));

  return task;
}

// Enhanced sprint creation helper
export async function createSampleSprint(
  context: TestContext,
  overrides?: Partial<Parameters<typeof context.sprintManager.createSprint>[0]>
): Promise<SprintNode> {
  return context.sprintManager.createSprint({
    name: 'Sample Sprint',
    goal: 'Complete sample features',
    startDate: new Date(),
    duration: 14,
    ...overrides,
  });
}

// Create task with dependencies
export async function createTaskWithDependencies(context: TestContext): Promise<{
  parentTask: TaskNode;
  childTask1: TaskNode;
  childTask2: TaskNode;
}> {
  const parentTask = await createSampleTask(context, {
    title: 'Parent Task',
    priority: Priority.HIGH,
  });

  const childTask1 = await createSampleTask(context, {
    title: 'Child Task 1',
    parent: parentTask.nodeId,
  });

  const childTask2 = await createSampleTask(context, {
    title: 'Child Task 2',
    parent: parentTask.nodeId,
  });

  await context.taskManager.addDependency(childTask1.nodeId, parentTask.nodeId);
  await context.taskManager.addDependency(childTask2.nodeId, parentTask.nodeId);

  return { parentTask, childTask1, childTask2 };
}

// Create sprint with tasks
export async function createSprintWithTasks(context: TestContext): Promise<{
  sprint: SprintNode;
  tasks: TaskNode[];
}> {
  const sprint = await createSampleSprint(context);
  const tasks: TaskNode[] = [];

  for (let i = 0; i < 3; i++) {
    const task = await createSampleTask(context, {
      title: `Sprint Task ${i + 1}`,
      estimatedHours: 5,
    });
    await context.sprintManager.addToSprint(task.nodeId, sprint.nodeId);
    tasks.push(task);
  }

  return { sprint, tasks };
}

// Create sample data for analytics
export async function createSampleAnalyticsData(context: TestContext): Promise<void> {
  // Create completed tasks directly in the engine for better reliability
  const completedTasks = [];
  for (let i = 0; i < 5; i++) {
    const nodeId = `task-analytics-${i}`;
    const task = {
      nodeId,
      author: Author.HUMAN,
      timestamp: new Date(), // All completed today
      parentIds: [],
      nodeType: DevelopmentNodeType.TASK,
      payload: {
        title: `Completed Task ${i + 1}`,
        description: 'Analytics test task',
        status: TaskStatus.DONE,
        priority: Priority.MEDIUM,
        assignee: 'test-user',
        estimatedHours: 8,
        actualHours: 8,
        completedDate: new Date(), // Mark as completed today
        labels: [],
        progress: 100,
        checkpoints: [],
        blockedBy: [],
        blocking: [],
        subtasks: [],
      },
      metadata: {
        priority: Priority.MEDIUM,
        status: TaskStatus.DONE,
        timeEstimate: 8,
        actualTime: 8,
      },
    };

    completedTasks.push(task);
  }

  // Commit all tasks at once
  await context.engine.commit({
    nodes: completedTasks,
    edges: [],
    message: 'Created sample analytics data',
  });

  // Create some bugs and errors
  await context.engine.commit({
    nodes: [
      {
        author: Author.SYSTEM,
        parentIds: [],
        nodeType: DevelopmentNodeType.BUG,
        payload: {
          title: 'Sample Bug',
          description: 'Test bug for analytics',
          severity: 'HIGH',
        },
        metadata: {
          priority: Priority.HIGH,
          filesModified: ['src/test.ts'],
        },
      },
      {
        author: Author.SYSTEM,
        parentIds: [],
        nodeType: DevelopmentNodeType.ERROR,
        payload: {
          message: 'Runtime error occurred',
          component: 'test-component',
        },
        metadata: {
          errorCount: 1,
        },
      },
    ],
    edges: [],
    message: 'Created sample bugs and errors',
  });
}

// Mock date for predictable tests
export function mockDate(date: Date): () => void {
  const originalDate = Date;
  global.Date = class extends Date {
    constructor(...args: any[]) {
      if (args.length === 0) {
        super(date);
      } else {
        super(...args);
      }
    }

    static now(): number {
      return date.getTime();
    }
  } as any;

  return () => {
    global.Date = originalDate;
  };
}

// Event assertion helper
export async function assertEventEmitted(
  emitter: any,
  eventName: string,
  timeout: number = 1000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Event '${eventName}' was not emitted within ${timeout}ms`));
    }, timeout);

    emitter.once(eventName, (data: any) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// Assertion helpers
export function expectTaskToMatch(actual: TaskNode, expected: Partial<TaskNode['payload']>): void {
  if (expected.title !== undefined) {
    expect(actual.payload.title).toBe(expected.title);
  }
  if (expected.status !== undefined) {
    expect(actual.payload.status).toBe(expected.status);
  }
  if (expected.priority !== undefined) {
    expect(actual.payload.priority).toBe(expected.priority);
  }
  if (expected.assignee !== undefined) {
    expect(actual.payload.assignee).toBe(expected.assignee);
  }
  if (expected.progress !== undefined) {
    expect(actual.payload.progress).toBe(expected.progress);
  }
}

export function expectNodeToMatch(actual: Node, expected: Partial<Node>): void {
  if (expected.nodeType !== undefined) {
    expect(actual.nodeType).toBe(expected.nodeType);
  }
  if (expected.author !== undefined) {
    expect(actual.author).toBe(expected.author);
  }
  if (expected.parentIds !== undefined) {
    expect(actual.parentIds).toEqual(expected.parentIds);
  }
  if (expected.payload !== undefined) {
    expect(actual.payload).toMatchObject(expected.payload);
  }
  if (expected.metadata !== undefined) {
    expect(actual.metadata).toMatchObject(expected.metadata);
  }
}

// Test data generators
export function generateTaskNodes(count: number): Omit<TaskNode, 'nodeId' | 'timestamp'>[] {
  return Array.from({ length: count }, (_, i) => ({
    author: Author.HUMAN,
    parentIds: [],
    nodeType: DevelopmentNodeType.TASK,
    payload: {
      title: `Generated Task ${i + 1}`,
      description: `Generated task for testing - ${i + 1}`,
      status: i % 2 === 0 ? TaskStatus.TODO : TaskStatus.DONE,
      priority: [Priority.LOW, Priority.MEDIUM, Priority.HIGH][i % 3] as Priority,
      estimatedHours: 4 + (i % 8),
      progress: i % 2 === 0 ? 0 : 100,
      checkpoints: [],
      blockedBy: [],
      blocking: [],
      subtasks: [],
    },
    metadata: {
      priority: [Priority.LOW, Priority.MEDIUM, Priority.HIGH][i % 3] as Priority,
      status: i % 2 === 0 ? TaskStatus.TODO : TaskStatus.DONE,
      timeEstimate: 4 + (i % 8),
    },
  }));
}

// Performance testing helper
export class PerformanceTimer {
  private start: number = 0;
  private marks: Map<string, number> = new Map();

  startTimer(): void {
    this.start = performance.now();
  }

  mark(name: string): void {
    this.marks.set(name, performance.now() - this.start);
  }

  getElapsed(): number {
    return performance.now() - this.start;
  }

  getMark(name: string): number {
    return this.marks.get(name) || 0;
  }

  getAllMarks(): { [key: string]: number } {
    return Object.fromEntries(this.marks);
  }
}