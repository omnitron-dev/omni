import { v4 as uuidv4 } from 'uuid';
import { CSPEngine } from './engine';
import { TaskManager } from './task-manager';
import {
  NodeId,
  SprintNode,
  TaskNode,
  DevelopmentNodeType,
  Author,
  DevelopmentEdgeType,
  TaskStatus,
  BurndownData,
  SprintMetrics,
} from './types';

export interface SprintReport {
  sprint: SprintNode;
  completedTasks: TaskNode[];
  incompleteTasks: TaskNode[];
  burndown: BurndownData;
  velocity: number;
  completionRate: number;
  averageCycleTime: number;
  blockers: TaskNode[];
}

export interface ChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    color?: string;
  }>;
}

export class SprintManager {
  private engine: CSPEngine;
  private taskManager: TaskManager;
  private activeSprint: NodeId | null = null;

  constructor(engine: CSPEngine, taskManager: TaskManager) {
    this.engine = engine;
    this.taskManager = taskManager;
  }

  // Sprint lifecycle
  async createSprint(params: {
    name: string;
    goal: string;
    startDate: Date;
    duration: number; // days
    velocity?: number;
    capacity?: number;
  }): Promise<SprintNode> {
    const nodeId = uuidv4();
    const endDate = new Date(params.startDate);
    endDate.setDate(endDate.getDate() + params.duration);

    const sprintNode: SprintNode = {
      nodeId,
      author: Author.HUMAN,
      timestamp: new Date(),
      parentIds: [],
      nodeType: DevelopmentNodeType.SPRINT,
      payload: {
        name: params.name,
        goal: params.goal,
        startDate: params.startDate,
        endDate,
        velocity: params.velocity,
        capacity: params.capacity,
        committedTasks: [],
        completedTasks: [],
        carryOverTasks: [],
        burndown: this.initializeBurndown(params.startDate, endDate),
        metrics: {
          plannedPoints: 0,
          completedPoints: 0,
          velocityTrend: [],
          scopeChangeCount: 0,
          defectCount: 0,
          cycleTime: 0,
        },
      },
      metadata: {},
    };

    await this.engine.commit({
      nodes: [sprintNode],
      edges: [],
      message: `Created sprint: ${params.name}`,
    });

    return sprintNode;
  }

  async startSprint(sprintId: NodeId): Promise<void> {
    if (this.activeSprint) {
      throw new Error(
        `Sprint ${this.activeSprint} is already active. End it first.`
      );
    }

    const sprint = await this.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint ${sprintId} not found`);
    }

    this.activeSprint = sprintId;

    // Update task statuses
    for (const taskId of sprint.payload.committedTasks) {
      const task = await this.engine.getNode(taskId);
      if (task && (task as TaskNode).payload.status === TaskStatus.BACKLOG) {
        await this.taskManager.updateTaskStatus(taskId, TaskStatus.TODO);
      }
    }

    await this.engine.commit({
      nodes: [
        {
          ...sprint,
          parentIds: [sprintId],
        },
      ],
      edges: [],
      message: `Started sprint: ${sprint.payload.name}`,
    });
  }

  async endSprint(sprintId: NodeId): Promise<void> {
    const sprint = await this.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint ${sprintId} not found`);
    }

    // Identify completed and carry-over tasks
    const completedTasks: NodeId[] = [];
    const carryOverTasks: NodeId[] = [];

    for (const taskId of sprint.payload.committedTasks) {
      const task = await this.engine.getNode(taskId);
      if (task) {
        const taskNode = task as TaskNode;
        if (taskNode.payload.status === TaskStatus.DONE) {
          completedTasks.push(taskId);
        } else {
          carryOverTasks.push(taskId);
        }
      }
    }

    sprint.payload.completedTasks = completedTasks;
    sprint.payload.carryOverTasks = carryOverTasks;

    // Calculate final metrics
    sprint.payload.metrics = await this.calculateSprintMetrics(sprintId);

    // Create retrospective node
    const retroNode = {
      nodeId: uuidv4(),
      author: Author.HUMAN,
      timestamp: new Date(),
      parentIds: [sprintId],
      nodeType: DevelopmentNodeType.RETROSPECTIVE,
      payload: {
        sprint: sprintId,
        completedTasks: completedTasks.length,
        carryOverTasks: carryOverTasks.length,
        velocity: sprint.payload.metrics.completedPoints,
      },
      metadata: {},
    };

    await this.engine.commit({
      nodes: [
        {
          ...sprint,
          parentIds: [sprintId],
        },
        retroNode,
      ],
      edges: [],
      message: `Ended sprint: ${sprint.payload.name}`,
    });

    if (this.activeSprint === sprintId) {
      this.activeSprint = null;
    }
  }

  // Planning
  async addToSprint(taskId: NodeId, sprintId: NodeId): Promise<void> {
    const sprint = await this.getSprint(sprintId);
    const task = await this.engine.getNode(taskId);

    if (!sprint) {
      throw new Error(`Sprint ${sprintId} not found`);
    }
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (!sprint.payload.committedTasks.includes(taskId)) {
      sprint.payload.committedTasks.push(taskId);

      const taskNode = task as TaskNode;
      taskNode.payload.sprint = sprintId;

      // Update planned points
      const points = taskNode.payload.estimatedHours || 0;
      sprint.payload.metrics!.plannedPoints += points;

      await this.engine.commit({
        nodes: [
          {
            ...sprint,
            parentIds: [sprintId],
          },
          {
            ...taskNode,
            parentIds: [taskId],
          },
        ],
        edges: [
          {
            sourceNodeId: taskId,
            targetNodeId: sprintId,
            edgeType: DevelopmentEdgeType.IN_SPRINT,
          },
        ],
        message: `Added task ${taskId} to sprint`,
      });

      // Update burndown
      await this.updateBurndown(sprintId);
    }
  }

  async removeFromSprint(taskId: NodeId, sprintId: NodeId): Promise<void> {
    const sprint = await this.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint ${sprintId} not found`);
    }

    const index = sprint.payload.committedTasks.indexOf(taskId);
    if (index > -1) {
      sprint.payload.committedTasks.splice(index, 1);

      const task = await this.engine.getNode(taskId);
      if (task) {
        const taskNode = task as TaskNode;
        const points = taskNode.payload.estimatedHours || 0;
        sprint.payload.metrics!.plannedPoints -= points;
        sprint.payload.metrics!.scopeChangeCount++;
        delete taskNode.payload.sprint;
      }

      await this.engine.commit({
        nodes: [
          {
            ...sprint,
            parentIds: [sprintId],
          },
          task ? {
            ...task,
            parentIds: [taskId],
          } : null,
        ].filter(Boolean) as any[],
        edges: [],
        message: `Removed task ${taskId} from sprint`,
      });

      // Update burndown
      await this.updateBurndown(sprintId);
    }
  }

  async estimateCapacity(
    sprintId: NodeId,
    teamSize: number
  ): Promise<number> {
    // First try to get the sprint directly
    let sprint = await this.getSprint(sprintId);

    // If not found, check if sprintId points to a sprint that was recently created
    if (!sprint) {
      const node = await this.engine.getNode(sprintId);
      if (node && node.nodeType === DevelopmentNodeType.SPRINT) {
        sprint = node as SprintNode;
      }
    }

    if (!sprint) {
      throw new Error(`Sprint ${sprintId} not found`);
    }

    const workDays = this.getWorkDays(
      sprint.payload.startDate,
      sprint.payload.endDate
    );
    const hoursPerDay = 6; // Assuming 6 productive hours per day
    const capacity = workDays * hoursPerDay * teamSize;

    sprint.payload.capacity = capacity;

    await this.engine.commit({
      nodes: [
        {
          ...sprint,
          parentIds: [sprintId],
        },
      ],
      edges: [],
      message: `Updated capacity to ${capacity} hours`,
    });

    return capacity;
  }

  // Tracking
  async updateBurndown(sprintId: NodeId): Promise<void> {
    const sprint = await this.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint ${sprintId} not found`);
    }

    const burndown = sprint.payload.burndown!;
    const today = new Date();
    const dayIndex = this.getDayIndex(sprint.payload.startDate, today);

    if (dayIndex >= 0 && dayIndex < burndown.dates.length) {
      // Calculate remaining work
      let remainingHours = 0;
      for (const taskId of sprint.payload.committedTasks) {
        const task = await this.engine.getNode(taskId);
        if (task) {
          const taskNode = task as TaskNode;
          if (taskNode.payload.status !== TaskStatus.DONE) {
            const estimated = taskNode.payload.estimatedHours || 0;
            const spent = taskNode.payload.actualHours || 0;
            const progress = taskNode.payload.progress || 0;
            remainingHours += Math.max(
              0,
              estimated * (1 - progress / 100) - spent
            );
          }
        }
      }

      burndown.actual[dayIndex] = remainingHours;

      await this.engine.commit({
        nodes: [
          {
            ...sprint,
            parentIds: [sprintId],
          },
        ],
        edges: [],
        message: `Updated burndown`,
      });
    }
  }

  async calculateVelocity(sprintId: NodeId): Promise<number> {
    const sprint = await this.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint ${sprintId} not found`);
    }

    let completedPoints = 0;
    for (const taskId of sprint.payload.completedTasks) {
      const task = await this.engine.getNode(taskId);
      if (task) {
        const taskNode = task as TaskNode;
        completedPoints += taskNode.payload.estimatedHours || 0;
      }
    }

    const workDays = this.getWorkDays(
      sprint.payload.startDate,
      sprint.payload.endDate
    );

    const velocity = workDays > 0 ? completedPoints / workDays : 0;
    sprint.payload.velocity = velocity;

    return velocity;
  }

  // Reporting
  async getSprintReport(sprintId: NodeId): Promise<SprintReport> {
    const sprint = await this.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint ${sprintId} not found`);
    }

    const completedTasks: TaskNode[] = [];
    const incompleteTasks: TaskNode[] = [];
    const blockers: TaskNode[] = [];

    for (const taskId of sprint.payload.committedTasks) {
      const task = await this.engine.getNode(taskId);
      if (task) {
        const taskNode = task as TaskNode;
        if (taskNode.payload.status === TaskStatus.DONE) {
          completedTasks.push(taskNode);
        } else {
          incompleteTasks.push(taskNode);
          if (taskNode.payload.status === TaskStatus.BLOCKED) {
            blockers.push(taskNode);
          }
        }
      }
    }

    const velocity = await this.calculateVelocity(sprintId);
    const totalTasks = completedTasks.length + incompleteTasks.length;
    const completionRate = totalTasks > 0 ? completedTasks.length / totalTasks : 0;

    let totalCycleTime = 0;
    let cycleTimeCount = 0;
    for (const task of completedTasks) {
      if (task.payload.startDate && task.payload.completedDate) {
        const cycleTime =
          (new Date(task.payload.completedDate).getTime() -
            new Date(task.payload.startDate).getTime()) /
          (1000 * 60 * 60 * 24); // days
        totalCycleTime += cycleTime;
        cycleTimeCount++;
      }
    }
    const averageCycleTime =
      cycleTimeCount > 0 ? totalCycleTime / cycleTimeCount : 0;

    return {
      sprint,
      completedTasks,
      incompleteTasks,
      burndown: sprint.payload.burndown!,
      velocity,
      completionRate,
      averageCycleTime,
      blockers,
    };
  }

  async getVelocityChart(lastNSprints: number): Promise<ChartData> {
    const sprints = await this.engine.queryByType(DevelopmentNodeType.SPRINT);

    // Sort by start date
    const sortedSprints = (sprints as SprintNode[])
      .sort(
        (a, b) =>
          new Date(a.payload.startDate).getTime() -
          new Date(b.payload.startDate).getTime()
      )
      .slice(-lastNSprints);

    const labels: string[] = [];
    const plannedData: number[] = [];
    const actualData: number[] = [];

    for (const sprint of sortedSprints) {
      labels.push(sprint.payload.name);
      plannedData.push(sprint.payload.metrics?.plannedPoints || 0);
      actualData.push(sprint.payload.metrics?.completedPoints || 0);
    }

    return {
      labels,
      datasets: [
        {
          label: 'Planned',
          data: plannedData,
          color: '#3b82f6',
        },
        {
          label: 'Actual',
          data: actualData,
          color: '#10b981',
        },
      ],
    };
  }

  async getBurndownChart(sprintId: NodeId): Promise<ChartData> {
    const sprint = await this.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint ${sprintId} not found`);
    }

    const burndown = sprint.payload.burndown!;
    const labels = burndown.dates.map((d) =>
      new Date(d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    );

    return {
      labels,
      datasets: [
        {
          label: 'Ideal',
          data: burndown.ideal,
          color: '#6b7280',
        },
        {
          label: 'Actual',
          data: burndown.actual,
          color: '#3b82f6',
        },
      ],
    };
  }

  // Helper methods
  private async getSprint(sprintId: NodeId): Promise<SprintNode | null> {
    try {
      // First search recent nodes to get the latest version
      const recent = await this.engine.getRecentNodes(100);
      const sprintNode = recent.find(
        n => n.nodeId === sprintId && n.nodeType === DevelopmentNodeType.SPRINT
      );
      if (sprintNode) {
        return sprintNode as SprintNode;
      }

      // Fall back to direct lookup if not found in recent
      const node = await this.engine.getNode(sprintId);
      if (node?.nodeType === DevelopmentNodeType.SPRINT) {
        return node as SprintNode;
      }
    } catch (error) {
      // Node not found
    }
    return null;
  }

  private initializeBurndown(
    startDate: Date,
    endDate: Date
  ): BurndownData {
    const days = this.getWorkDays(startDate, endDate);
    const dates: Date[] = [];
    const ideal: number[] = [];
    const actual: number[] = [];

    let currentDate = new Date(startDate);
    for (let i = 0; i <= days; i++) {
      dates.push(new Date(currentDate));
      ideal.push(0); // Will be calculated when tasks are added
      actual.push(0);

      // Skip weekends
      currentDate.setDate(currentDate.getDate() + 1);
      while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    return {
      dates,
      ideal,
      actual,
      scopeChanges: [],
    };
  }

  private getWorkDays(startDate: Date, endDate: Date): number {
    let count = 0;
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) {
        // Not weekend
        count++;
      }
      current.setDate(current.getDate() + 1);
    }

    return count;
  }

  private getDayIndex(startDate: Date, targetDate: Date): number {
    let index = 0;
    const current = new Date(startDate);
    const target = new Date(targetDate);

    while (current <= target) {
      if (
        current.toDateString() === target.toDateString()
      ) {
        return index;
      }

      current.setDate(current.getDate() + 1);
      while (current.getDay() === 0 || current.getDay() === 6) {
        current.setDate(current.getDate() + 1);
      }
      index++;
    }

    return -1;
  }

  private async calculateSprintMetrics(
    sprintId: NodeId
  ): Promise<SprintMetrics> {
    const sprint = await this.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint ${sprintId} not found`);
    }

    let completedPoints = 0;
    let totalCycleTime = 0;
    let cycleTimeCount = 0;
    let defectCount = 0;

    for (const taskId of sprint.payload.committedTasks) {
      const task = await this.engine.getNode(taskId);
      if (task) {
        const taskNode = task as TaskNode;

        if (taskNode.payload.status === TaskStatus.DONE) {
          completedPoints += taskNode.payload.estimatedHours || 0;

          if (taskNode.payload.startDate && taskNode.payload.completedDate) {
            const cycleTime =
              (new Date(taskNode.payload.completedDate).getTime() -
                new Date(taskNode.payload.startDate).getTime()) /
              (1000 * 60 * 60); // hours
            totalCycleTime += cycleTime;
            cycleTimeCount++;
          }
        }

        // Count bugs as defects by checking if it's a bug node type
        const bugNodes = await this.engine.queryByType(DevelopmentNodeType.BUG);
        if (bugNodes.some(b => b.nodeId === taskNode.nodeId)) {
          defectCount++;
        }
      }
    }

    const averageCycleTime =
      cycleTimeCount > 0 ? totalCycleTime / cycleTimeCount : 0;

    // Update velocity trend
    const previousVelocity = sprint.payload.metrics?.velocityTrend || [];
    previousVelocity.push(completedPoints);

    return {
      plannedPoints: sprint.payload.metrics?.plannedPoints || 0,
      completedPoints,
      velocityTrend: previousVelocity.slice(-10), // Keep last 10
      scopeChangeCount: sprint.payload.metrics?.scopeChangeCount || 0,
      defectCount,
      cycleTime: averageCycleTime,
    };
  }

  // Get active sprint
  getActiveSprint(): NodeId | null {
    return this.activeSprint;
  }

  async getCurrentSprintTasks(): Promise<TaskNode[]> {
    if (!this.activeSprint) {
      return [];
    }

    const sprint = await this.getSprint(this.activeSprint);
    if (!sprint) {
      return [];
    }

    const tasks: TaskNode[] = [];
    for (const taskId of sprint.payload.committedTasks) {
      const task = await this.engine.getNode(taskId);
      if (task) {
        tasks.push(task as TaskNode);
      }
    }

    return tasks;
  }

  async getAllSprints(): Promise<SprintNode[]> {
    const sprints = await this.engine.queryByType(DevelopmentNodeType.SPRINT);
    return sprints.map(s => s as SprintNode);
  }

}