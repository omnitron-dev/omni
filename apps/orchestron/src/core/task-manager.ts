import { v4 as uuidv4 } from 'uuid';
import { CSPEngine } from './engine';
import {
  NodeId,
  TaskNode,
  TaskStatus,
  Priority,
  DevelopmentNodeType,
  Author,
  DevelopmentEdgeType,
  Checkpoint,
  TimeEntry,
  TimesheetEntry,
} from './types';

export class TaskManager {
  private engine: CSPEngine;
  private activeTimers: Map<NodeId, TimeEntry>;

  constructor(engine: CSPEngine) {
    this.engine = engine;
    this.activeTimers = new Map();
  }

  // Task CRUD operations
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
    component?: string;
  }): Promise<TaskNode> {
    const validTaskTypes = [
      DevelopmentNodeType.EPIC,
      DevelopmentNodeType.STORY,
      DevelopmentNodeType.TASK,
      DevelopmentNodeType.SUBTASK,
      DevelopmentNodeType.TODO,
    ] as const;

    const nodeType = params.type && validTaskTypes.includes(params.type as any)
      ? params.type as typeof validTaskTypes[number]
      : DevelopmentNodeType.TASK;
    const nodeId = uuidv4();

    const taskNode: TaskNode = {
      nodeId,
      author: Author.HUMAN,
      timestamp: new Date(),
      parentIds: params.parent ? [params.parent] : [],
      nodeType,
      payload: {
        title: params.title,
        description: params.description,
        status: TaskStatus.TODO,
        priority: params.priority || Priority.MEDIUM,
        assignee: params.assignee,
        dueDate: params.dueDate,
        labels: params.labels || [],
        estimatedHours: params.estimatedHours,
        component: params.component,
        progress: 0,
        checkpoints: [],
        blockedBy: [],
        blocking: [],
        subtasks: [],
      },
      metadata: {
        priority: params.priority || Priority.MEDIUM,
        status: TaskStatus.TODO,
        timeEstimate: params.estimatedHours,
      },
    };

    // Create node
    await this.engine.commit({
      nodes: [taskNode],
      edges: params.parent
        ? [
            {
              sourceNodeId: params.parent,
              targetNodeId: nodeId,
              edgeType: DevelopmentEdgeType.PARENT_OF,
            },
          ]
        : [],
      message: `Created task: ${params.title}`,
    });

    return taskNode;
  }

  async updateTaskStatus(taskId: NodeId, status: TaskStatus): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Check if transition is valid
    if (!this.isValidStatusTransition(task.payload.status, status)) {
      throw new Error(
        `Invalid status transition from ${task.payload.status} to ${status}`
      );
    }

    // Update task
    task.payload.status = status;
    task.metadata.status = status;

    if (status === TaskStatus.DONE) {
      task.payload.completedDate = new Date();
      task.payload.progress = 100;
    } else if (status === TaskStatus.IN_PROGRESS && !task.payload.startDate) {
      task.payload.startDate = new Date();
    }

    // Create update node
    await this.engine.commit({
      nodes: [
        {
          ...task,
          parentIds: [taskId],
        },
      ],
      edges: [],
      message: `Updated task status to ${status}`,
    });

    // Check for blocked/blocking tasks
    await this.updateBlockedTasks(taskId, status);
  }

  async updateTask(
    taskId: NodeId,
    updates: Partial<TaskNode['payload']>
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Apply updates
    Object.assign(task.payload, updates);

    // Commit the updated task
    await this.engine.commit({
      nodes: [{
        ...task,
        parentIds: [taskId],
      }],
      edges: [],
      message: `Update task: ${task.payload.title}`,
    });
  }

  async updateTaskProgress(
    taskId: NodeId,
    progress: number,
    checkpoint?: string
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.payload.progress = Math.min(100, Math.max(0, progress));

    // Add checkpoint if provided
    if (checkpoint) {
      const checkpointObj: Checkpoint = {
        name: checkpoint,
        completed: true,
        timestamp: new Date(),
      };
      task.payload.checkpoints = task.payload.checkpoints || [];
      task.payload.checkpoints.push(checkpointObj);
    }

    // Auto-update status based on progress
    if (progress === 100 && task.payload.status !== TaskStatus.DONE) {
      task.payload.status = TaskStatus.TESTING;
    } else if (progress > 0 && task.payload.status === TaskStatus.TODO) {
      task.payload.status = TaskStatus.IN_PROGRESS;
    }

    await this.engine.commit({
      nodes: [
        {
          ...task,
          parentIds: [taskId],
        },
      ],
      edges: [],
      message: `Updated progress to ${progress}%${checkpoint ? ` - ${checkpoint}` : ''}`,
    });
  }

  async assignTask(taskId: NodeId, assignee: string): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.payload.assignee = assignee;

    await this.engine.commit({
      nodes: [
        {
          ...task,
          parentIds: [taskId],
        },
      ],
      edges: [
        {
          sourceNodeId: taskId,
          targetNodeId: assignee,
          edgeType: DevelopmentEdgeType.ASSIGNED_TO,
        },
      ],
      message: `Assigned task to ${assignee}`,
    });
  }

  // TODO management
  async addTodo(text: string, context?: string): Promise<TaskNode> {
    return this.createTask({
      type: DevelopmentNodeType.TODO,
      title: text,
      priority: Priority.LOW,
      component: context,
    });
  }

  async convertTodoToTask(
    todoId: NodeId,
    taskDetails: Partial<TaskNode['payload']>
  ): Promise<TaskNode> {
    const todo = await this.getTask(todoId);
    if (!todo) {
      throw new Error(`TODO ${todoId} not found`);
    }

    const task: TaskNode = {
      ...todo,
      nodeId: uuidv4(),
      nodeType: DevelopmentNodeType.TASK,
      timestamp: new Date(),
      parentIds: [todoId],
      payload: {
        ...todo.payload,
        ...taskDetails,
        status: TaskStatus.TODO,
      },
    };

    await this.engine.commit({
      nodes: [task],
      edges: [
        {
          sourceNodeId: todoId,
          targetNodeId: task.nodeId,
          edgeType: DevelopmentEdgeType.SUPERSEDES,
        },
      ],
      message: `Converted TODO to task: ${task.payload.title}`,
    });

    return task;
  }

  async getTodos(filter?: {
    context?: string;
    assignee?: string;
  }): Promise<TaskNode[]> {
    const nodes = await this.engine.queryByType(DevelopmentNodeType.TODO);

    return nodes.filter((node) => {
      const task = node as TaskNode;
      if (filter?.context && task.payload.component !== filter.context) {
        return false;
      }
      if (filter?.assignee && task.payload.assignee !== filter.assignee) {
        return false;
      }
      return task.payload.status !== TaskStatus.DONE;
    }) as TaskNode[];
  }

  // Dependencies
  async addDependency(taskId: NodeId, dependsOn: NodeId): Promise<void> {
    const task = await this.getTask(taskId);
    const dependency = await this.getTask(dependsOn);

    if (!task || !dependency) {
      throw new Error('Task or dependency not found');
    }

    task.payload.blockedBy = task.payload.blockedBy || [];
    task.payload.blockedBy.push(dependsOn);

    dependency.payload.blocking = dependency.payload.blocking || [];
    dependency.payload.blocking.push(taskId);

    // Update task status if needed
    if (
      dependency.payload.status !== TaskStatus.DONE &&
      task.payload.status !== TaskStatus.BLOCKED
    ) {
      task.payload.status = TaskStatus.BLOCKED;
    }

    await this.engine.commit({
      nodes: [
        {
          ...task,
          nodeId: taskId,
          parentIds: [taskId],
        },
        {
          ...dependency,
          nodeId: dependsOn,
          parentIds: [dependsOn],
        },
      ],
      edges: [
        {
          sourceNodeId: dependsOn,
          targetNodeId: taskId,
          edgeType: DevelopmentEdgeType.BLOCKS,
        },
      ],
      message: `Added dependency: ${taskId} depends on ${dependsOn}`,
    });
  }

  async removeDependency(taskId: NodeId, dependency: NodeId): Promise<void> {
    const task = await this.getTask(taskId);
    const dep = await this.getTask(dependency);

    if (!task || !dep) {
      throw new Error('Task or dependency not found');
    }

    task.payload.blockedBy = (task.payload.blockedBy || []).filter(
      (id) => id !== dependency
    );
    dep.payload.blocking = (dep.payload.blocking || []).filter(
      (id) => id !== taskId
    );

    // Check if task can be unblocked
    if (
      task.payload.status === TaskStatus.BLOCKED &&
      task.payload.blockedBy.length === 0
    ) {
      task.payload.status = TaskStatus.TODO;
    }

    await this.engine.commit({
      nodes: [
        {
          ...task,
          parentIds: [taskId],
        },
      ],
      edges: [],
      message: `Removed dependency: ${taskId} no longer depends on ${dependency}`,
    });
  }

  async getBlockedTasks(): Promise<TaskNode[]> {
    const allNodes = await this.engine.getAllNodes();
    return allNodes.filter(node => {
      const taskNode = node as TaskNode;
      return taskNode.payload && taskNode.payload.status === TaskStatus.BLOCKED;
    }) as TaskNode[];
  }

  async getCriticalPath(taskId: NodeId): Promise<NodeId[]> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Build dependency graph starting from the given task
    const graph = new Map<NodeId, Set<NodeId>>();
    const visited = new Set<NodeId>();

    // Recursively build graph of all connected tasks
    const buildGraph = async (nodeId: NodeId) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = await this.getTask(nodeId);
      if (!node) return;

      const dependentIds = new Set<NodeId>();

      // Use the blocking array directly from the task payload
      if (node.payload.blocking && node.payload.blocking.length > 0) {
        for (const blockedTaskId of node.payload.blocking) {
          dependentIds.add(blockedTaskId);
          await buildGraph(blockedTaskId);
        }
      }

      graph.set(nodeId, dependentIds);
    };

    await buildGraph(taskId);

    // Find longest path from the starting task
    const criticalPath = this.findLongestPathForward(graph, taskId);

    return criticalPath;
  }

  // Time tracking
  startTimer(taskId: NodeId, assignee: string): void {
    if (this.activeTimers.has(taskId)) {
      throw new Error(`Timer already running for task ${taskId}`);
    }

    this.activeTimers.set(taskId, {
      taskId,
      startTime: new Date(),
      assignee,
    });
  }

  async stopTimer(taskId: NodeId): Promise<number> {
    const timer = this.activeTimers.get(taskId);
    if (!timer) {
      throw new Error(`No active timer for task ${taskId}`);
    }

    const endTime = new Date();
    const duration =
      (endTime.getTime() - timer.startTime.getTime()) / 1000 / 60 / 60; // hours

    await this.logTime(taskId, duration, timer.startTime);

    this.activeTimers.delete(taskId);

    return duration;
  }

  async logTime(
    taskId: NodeId,
    hours: number,
    date?: Date
  ): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.payload.actualHours = (task.payload.actualHours || 0) + hours;
    task.metadata.timeSpent = task.payload.actualHours;

    await this.engine.commit({
      nodes: [
        {
          ...task,
          parentIds: [taskId],
        },
      ],
      edges: [],
      message: `Logged ${hours.toFixed(2)} hours`,
    });
  }

  async getTimesheet(
    assignee: string,
    period: { from: Date; to: Date }
  ): Promise<TimesheetEntry[]> {
    const allTasks = await this.engine.getAllNodes();
    const tasks = allTasks.filter(node => {
      const taskNode = node as TaskNode;
      return taskNode.payload && taskNode.payload.assignee === assignee;
    });
    const timesheet = new Map<string, TimesheetEntry>();

    for (const task of tasks as TaskNode[]) {
      if (!task.payload.actualHours) continue;

      const date = task.timestamp;
      if (date < period.from || date > period.to) continue;

      const dateKey = date.toISOString().split('T')[0];

      if (!timesheet.has(dateKey)) {
        timesheet.set(dateKey, {
          date,
          entries: [],
          totalHours: 0,
        });
      }

      const entry = timesheet.get(dateKey)!;
      entry.entries.push({
        taskId: task.nodeId,
        startTime: date,
        duration: task.payload.actualHours,
        assignee,
      });
      entry.totalHours += task.payload.actualHours;
    }

    return Array.from(timesheet.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
  }

  // Bulk operations
  async bulkUpdateStatus(
    taskIds: NodeId[],
    status: TaskStatus
  ): Promise<void> {
    for (const taskId of taskIds) {
      await this.updateTaskStatus(taskId, status);
    }
  }

  async bulkAssign(taskIds: NodeId[], assignee: string): Promise<void> {
    for (const taskId of taskIds) {
      await this.assignTask(taskId, assignee);
    }
  }

  // Helper methods
  async getTask(taskId: NodeId): Promise<TaskNode | null> {
    try {
      const node = await this.engine.getNode(taskId);
      if (this.isTaskNode(node)) {
        return node as TaskNode;
      }
    } catch (error) {
      // Node not found
    }
    return null;
  }

  private isTaskNode(node: any): node is TaskNode {
    return (
      node &&
      [
        DevelopmentNodeType.EPIC,
        DevelopmentNodeType.STORY,
        DevelopmentNodeType.TASK,
        DevelopmentNodeType.SUBTASK,
        DevelopmentNodeType.TODO,
      ].includes(node.nodeType)
    );
  }

  private isValidStatusTransition(from: TaskStatus, to: TaskStatus): boolean {
    const transitions: Record<TaskStatus, TaskStatus[]> = {
      [TaskStatus.BACKLOG]: [TaskStatus.TODO, TaskStatus.IN_PROGRESS],
      [TaskStatus.TODO]: [
        TaskStatus.IN_PROGRESS,
        TaskStatus.BLOCKED,
        TaskStatus.CANCELLED,
      ],
      [TaskStatus.IN_PROGRESS]: [
        TaskStatus.IN_REVIEW,
        TaskStatus.BLOCKED,
        TaskStatus.TODO,
        TaskStatus.CANCELLED,
        TaskStatus.DONE, // Allow direct completion
        TaskStatus.TESTING, // Allow direct to testing
      ],
      [TaskStatus.IN_REVIEW]: [
        TaskStatus.TESTING,
        TaskStatus.IN_PROGRESS,
        TaskStatus.CANCELLED,
        TaskStatus.DONE, // Allow direct completion after review
      ],
      [TaskStatus.TESTING]: [
        TaskStatus.DONE,
        TaskStatus.IN_PROGRESS,
        TaskStatus.IN_REVIEW, // Allow back to review
        TaskStatus.CANCELLED,
      ],
      [TaskStatus.DONE]: [],
      [TaskStatus.CANCELLED]: [TaskStatus.TODO, TaskStatus.BACKLOG],
      [TaskStatus.BLOCKED]: [
        TaskStatus.TODO,
        TaskStatus.IN_PROGRESS,
        TaskStatus.CANCELLED,
      ],
    };

    return transitions[from]?.includes(to) || false;
  }

  private async updateBlockedTasks(
    taskId: NodeId,
    newStatus: TaskStatus
  ): Promise<void> {
    if (newStatus === TaskStatus.DONE) {
      const task = await this.getTask(taskId);
      if (task?.payload.blocking) {
        for (const blockedId of task.payload.blocking) {
          const blocked = await this.getTask(blockedId);
          if (blocked) {
            blocked.payload.blockedBy = (
              blocked.payload.blockedBy || []
            ).filter((id) => id !== taskId);

            if (
              blocked.payload.blockedBy.length === 0 &&
              blocked.payload.status === TaskStatus.BLOCKED
            ) {
              await this.updateTaskStatus(blockedId, TaskStatus.TODO);
            }
          }
        }
      }
    }
  }

  private async getTasksInEpic(epicId: NodeId): Promise<TaskNode[]> {
    const tasks: TaskNode[] = [];
    const queue = [epicId];
    const visited = new Set<NodeId>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const task = await this.getTask(current);
      if (task) {
        tasks.push(task);
        if (task.payload.subtasks) {
          queue.push(...task.payload.subtasks);
        }
      }
    }

    return tasks;
  }

  private findLongestPath(
    graph: Map<NodeId, Set<NodeId>>,
    start: NodeId
  ): NodeId[] {
    const memo = new Map<NodeId, NodeId[]>();

    const dfs = (node: NodeId): NodeId[] => {
      if (memo.has(node)) {
        return memo.get(node)!;
      }

      const dependencies = graph.get(node) || new Set();
      if (dependencies.size === 0) {
        memo.set(node, [node]);
        return [node];
      }

      let longestPath: NodeId[] = [];
      for (const dep of dependencies) {
        const path = dfs(dep);
        if (path.length > longestPath.length) {
          longestPath = path;
        }
      }

      const result = [...longestPath, node];
      memo.set(node, result);
      return result;
    };

    return dfs(start);
  }

  private findLongestPathForward(
    graph: Map<NodeId, Set<NodeId>>,
    start: NodeId
  ): NodeId[] {
    const memo = new Map<NodeId, NodeId[]>();

    const dfs = (node: NodeId): NodeId[] => {
      if (memo.has(node)) {
        return memo.get(node)!;
      }

      const dependents = graph.get(node) || new Set();
      if (dependents.size === 0) {
        memo.set(node, [node]);
        return [node];
      }

      let longestPath: NodeId[] = [];
      for (const dep of dependents) {
        const path = dfs(dep);
        if (path.length > longestPath.length) {
          longestPath = path;
        }
      }

      const result = [node, ...longestPath];
      memo.set(node, result);
      return result;
    };

    return dfs(start);
  }

  // Statistics
  async getTaskStatistics(): Promise<{
    total: number;
    byStatus: Record<TaskStatus, number>;
    byPriority: Record<Priority, number>;
    overdue: number;
    completedToday: number;
  }> {
    // Get all task-like nodes (TASK, EPIC, STORY, SUBTASK)
    const taskTypes = [
      DevelopmentNodeType.TASK,
      DevelopmentNodeType.EPIC,
      DevelopmentNodeType.STORY,
      DevelopmentNodeType.SUBTASK,
    ];

    const allTasks = [];
    for (const taskType of taskTypes) {
      const tasksOfType = await this.engine.queryByType(taskType);
      allTasks.push(...tasksOfType);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = {
      total: 0,
      byStatus: {} as Record<TaskStatus, number>,
      byPriority: {} as Record<Priority, number>,
      overdue: 0,
      completedToday: 0,
    };

    for (const node of allTasks) {
      const task = node as TaskNode;
      stats.total++;

      // By status
      stats.byStatus[task.payload.status] =
        (stats.byStatus[task.payload.status] || 0) + 1;

      // By priority
      stats.byPriority[task.payload.priority] =
        (stats.byPriority[task.payload.priority] || 0) + 1;

      // Overdue
      if (
        task.payload.dueDate &&
        new Date(task.payload.dueDate) < new Date() &&
        task.payload.status !== TaskStatus.DONE
      ) {
        stats.overdue++;
      }

      // Completed today
      if (
        task.payload.completedDate &&
        new Date(task.payload.completedDate) >= today
      ) {
        stats.completedToday++;
      }
    }

    return stats;
  }

}