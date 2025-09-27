/**
 * Orchestron API Service
 * Contains all API endpoint logic
 */

import { Service } from '@omnitron-dev/titan/decorators';
import type { UnifiedOrchestron } from '../../../core/unified-orchestron.js';

@Service('orchestron-api@1.0.0')
export class OrchestronApiService {
  constructor(
    private unifiedOrchestron: UnifiedOrchestron | undefined,
    private claudeService: any,
    private projectService: any,
    private sessionService: any,
    private logger: any
  ) { }

  /**
   * Get comprehensive dashboard data
   */
  async getDashboardData(): Promise<any> {
    if (!this.unifiedOrchestron) {
      return {
        error: 'Orchestron not initialized',
        stats: {},
        tasks: [],
        sprints: []
      };
    }

    try {
      const stats = await this.getStatistics();
      const tasks = await this.getTasks({ limit: 10 });
      const sprints = await this.getSprints();
      const activeSprint = sprints.find((s: any) => s.status === 'active');
      const bottlenecks = await this.getBottlenecks();
      const activity = await this.getRecentActivity();

      return {
        stats,
        tasks,
        activeSprint,
        bottlenecks,
        activity,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger?.error('Failed to get dashboard data', { error });
      return {
        error: 'Failed to fetch dashboard data',
        stats: {},
        tasks: [],
        sprints: []
      };
    }
  }

  /**
   * Get project statistics
   */
  async getStatistics(): Promise<any> {
    if (!this.unifiedOrchestron) {
      return { error: 'Orchestron not initialized' };
    }

    try {
      const stats = this.unifiedOrchestron.getStatistics();
      return stats;
    } catch (error) {
      this.logger?.error('Failed to get statistics', { error });
      return { error: 'Failed to fetch statistics' };
    }
  }

  /**
   * Get tasks with optional filters
   */
  async getTasks(filters?: any): Promise<any[]> {
    if (!this.unifiedOrchestron) {
      return [];
    }

    try {
      const tasks = await this.unifiedOrchestron.searchTasks(filters || {});

      // Map tasks to API format
      return tasks.map((task: any) => ({
        id: task.nodeId,
        title: task.payload.title,
        description: task.payload.description,
        status: task.payload.status,
        priority: task.payload.priority,
        assignee: task.payload.assignee,
        progress: task.payload.progress || 0,
        estimatedHours: task.payload.estimatedHours,
        actualHours: task.payload.actualHours,
        dueDate: task.payload.dueDate,
        labels: task.payload.labels || [],
        sprint: task.payload.sprint,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      }));
    } catch (error) {
      this.logger?.error('Failed to get tasks', { error });
      return [];
    }
  }

  /**
   * Get specific task by ID
   */
  async getTask(taskId: string): Promise<any> {
    if (!this.unifiedOrchestron) {
      return null;
    }

    try {
      const task = await this.unifiedOrchestron.getTask(taskId);
      if (!task) return null;

      return {
        id: task.nodeId,
        title: task.payload.title,
        description: task.payload.description,
        status: task.payload.status,
        priority: task.payload.priority,
        assignee: task.payload.assignee,
        progress: task.payload.progress || 0,
        estimatedHours: task.payload.estimatedHours,
        actualHours: task.payload.actualHours,
        dueDate: task.payload.dueDate,
        labels: task.payload.labels || [],
        sprint: task.payload.sprint,
        checkpoints: task.payload.checkpoints || [],
        blockedBy: task.payload.blockedBy || [],
        blocking: task.payload.blocking || []
      };
    } catch (error) {
      this.logger?.error('Failed to get task', { error, taskId });
      return null;
    }
  }

  /**
   * Update task status
   */
  async updateTaskStatus(taskId: string, status: string): Promise<any> {
    if (!this.unifiedOrchestron) {
      return { error: 'Orchestron not initialized' };
    }

    try {
      await this.unifiedOrchestron.updateTaskStatus(taskId, status as any);
      return { success: true, taskId, status };
    } catch (error) {
      this.logger?.error('Failed to update task status', { error, taskId, status });
      return { error: 'Failed to update task status' };
    }
  }

  /**
   * Get all sprints
   */
  async getSprints(): Promise<any[]> {
    if (!this.unifiedOrchestron) {
      return [];
    }

    try {
      const sprints = await this.unifiedOrchestron.getAllSprints();

      return sprints.map((sprint: any) => ({
        id: sprint.nodeId,
        name: sprint.payload.name,
        goal: sprint.payload.goal,
        startDate: sprint.payload.startDate,
        endDate: sprint.payload.endDate,
        status: sprint.payload.status || 'planned',
        velocity: sprint.payload.velocity,
        capacity: sprint.payload.capacity,
        committedTasks: sprint.payload.committedTasks || [],
        completedTasks: sprint.payload.completedTasks || [],
        progress: this.calculateSprintProgress(sprint)
      }));
    } catch (error) {
      this.logger?.error('Failed to get sprints', { error });
      return [];
    }
  }

  /**
   * Get active sprint
   */
  async getActiveSprint(): Promise<any> {
    if (!this.unifiedOrchestron) {
      return null;
    }

    try {
      const sprint = await this.unifiedOrchestron.getActiveSprint();
      if (!sprint) return null;

      return {
        id: sprint.nodeId,
        name: sprint.payload.name,
        goal: sprint.payload.goal,
        startDate: sprint.payload.startDate,
        endDate: sprint.payload.endDate,
        status: 'active',
        velocity: sprint.payload.velocity,
        capacity: sprint.payload.capacity,
        committedTasks: sprint.payload.committedTasks || [],
        completedTasks: sprint.payload.completedTasks || [],
        progress: this.calculateSprintProgress(sprint),
        burndown: sprint.payload.burndown
      };
    } catch (error) {
      this.logger?.error('Failed to get active sprint', { error });
      return null;
    }
  }

  /**
   * Get sprint burndown data
   */
  async getSprintBurndown(sprintId: string): Promise<any> {
    if (!this.unifiedOrchestron) {
      return null;
    }

    try {
      const burndown = this.unifiedOrchestron.getBurndownData(sprintId);
      return burndown;
    } catch (error) {
      this.logger?.error('Failed to get sprint burndown', { error, sprintId });
      return null;
    }
  }

  /**
   * Get identified bottlenecks
   */
  async getBottlenecks(): Promise<any[]> {
    if (!this.unifiedOrchestron) {
      return [];
    }

    try {
      const bottlenecks = this.unifiedOrchestron.identifyBottlenecks();
      return bottlenecks;
    } catch (error) {
      this.logger?.error('Failed to get bottlenecks', { error });
      return [];
    }
  }

  /**
   * Get workflows
   */
  async getWorkflows(): Promise<any[]> {
    if (!this.unifiedOrchestron) {
      return [];
    }

    try {
      const workflows = await this.unifiedOrchestron.listWorkflows();
      return workflows.map((w: any) => ({
        name: w.name,
        enabled: w.enabled,
        triggers: w.triggers,
        actions: w.actions.length,
        lastTriggered: w.lastTriggered
      }));
    } catch (error) {
      this.logger?.error('Failed to get workflows', { error });
      return [];
    }
  }

  /**
   * Get recent activity
   */
  async getRecentActivity(limit: number = 20): Promise<any[]> {
    if (!this.unifiedOrchestron) {
      return [];
    }

    try {
      const nodes = await this.unifiedOrchestron.getRecentNodes(limit);

      return nodes.map((node: any) => ({
        id: node.id,
        type: node.nodeType,
        author: node.author,
        message: this.getNodeMessage(node),
        timestamp: node.createdAt,
        payload: node.payload
      }));
    } catch (error) {
      this.logger?.error('Failed to get recent activity', { error });
      return [];
    }
  }

  /**
   * Execute command (for command interface)
   */
  async executeCommand(command: any): Promise<any> {
    if (!this.unifiedOrchestron) {
      return { error: 'Orchestron not initialized' };
    }

    try {
      const { command: cmd, args } = command;
      const result = await this.unifiedOrchestron.executeCommand(cmd, args);
      return { success: true, result };
    } catch (error) {
      this.logger?.error('Failed to execute command', { error, command });
      return { error: 'Failed to execute command', details: error };
    }
  }

  /**
   * Start task timer
   */
  async startTimer(taskId: string): Promise<any> {
    if (!this.unifiedOrchestron) {
      return { error: 'Orchestron not initialized' };
    }

    try {
      await this.unifiedOrchestron.startTimer(taskId, 'unknown');
      return { success: true, taskId, action: 'timer_started' };
    } catch (error) {
      this.logger?.error('Failed to start timer', { error, taskId });
      return { error: 'Failed to start timer' };
    }
  }

  /**
   * Stop task timer
   */
  async stopTimer(taskId: string): Promise<any> {
    if (!this.unifiedOrchestron) {
      return { error: 'Orchestron not initialized' };
    }

    try {
      this.unifiedOrchestron.stopTimer(taskId);
      return { success: true, taskId, action: 'timer_stopped' };
    } catch (error) {
      this.logger?.error('Failed to stop timer', { error, taskId });
      return { error: 'Failed to stop timer' };
    }
  }

  /**
   * Claude service integration
   */
  async getClaudeProjects(): Promise<any[]> {
    if (!this.claudeService) {
      return [];
    }

    try {
      const projects = await this.claudeService.listProjects();
      return projects;
    } catch (error) {
      this.logger?.error('Failed to get Claude projects', { error });
      return [];
    }
  }

  async getClaudeSessions(): Promise<any[]> {
    if (!this.sessionService) {
      return [];
    }

    try {
      const sessions = await this.sessionService.getSessions();
      return sessions;
    } catch (error) {
      this.logger?.error('Failed to get Claude sessions', { error });
      return [];
    }
  }

  async getActiveSession(): Promise<any> {
    if (!this.sessionService) {
      return null;
    }

    try {
      const session = this.sessionService.getActiveSession();
      return session;
    } catch (error) {
      this.logger?.error('Failed to get active session', { error });
      return null;
    }
  }

  // Helper methods
  private calculateSprintProgress(sprint: any): number {
    const completed = sprint.payload.completedTasks?.length || 0;
    const total = sprint.payload.committedTasks?.length || 0;

    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
  }

  private getNodeMessage(node: any): string {
    switch (node.nodeType) {
      case 'TASK':
        return `Task created: ${node.payload.title}`;
      case 'SPRINT':
        return `Sprint created: ${node.payload.name}`;
      case 'FEATURE':
        return `Feature: ${node.payload.title || node.payload.name}`;
      case 'BUG':
        return `Bug reported: ${node.payload.title}`;
      case 'FIX':
        return `Fix applied: ${node.payload.description}`;
      default:
        return node.payload.message || node.payload.title || 'Activity';
    }
  }
}