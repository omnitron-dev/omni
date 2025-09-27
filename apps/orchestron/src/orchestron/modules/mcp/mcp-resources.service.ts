/**
 * MCPResourcesService - Provides resources for MCP clients
 */

import { Injectable, Inject } from '@omnitron-dev/titan/nexus';
import { UnifiedOrchestron } from '../core/core.module.js';

interface ResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

@Injectable()
export class MCPResourcesService {

  constructor(
    @Inject(UnifiedOrchestron) private readonly orchestron: UnifiedOrchestron
  ) {}

  /**
   * Get all available resources
   */
  async getResources(): Promise<ResourceDefinition[]> {
    return [
      {
        uri: 'orchestron://dashboard',
        name: 'Dashboard',
        description: 'Complete dashboard data including stats, tasks, and sprints',
        mimeType: 'application/json'
      },
      {
        uri: 'orchestron://stats',
        name: 'Statistics',
        description: 'Current project statistics',
        mimeType: 'application/json'
      },
      {
        uri: 'orchestron://tasks',
        name: 'Tasks',
        description: 'All tasks in the system',
        mimeType: 'application/json'
      },
      {
        uri: 'orchestron://sprints',
        name: 'Sprints',
        description: 'All sprints',
        mimeType: 'application/json'
      },
      {
        uri: 'orchestron://context',
        name: 'Current Context',
        description: 'Current session context',
        mimeType: 'application/json'
      },
      {
        uri: 'orchestron://activity',
        name: 'Recent Activity',
        description: 'Recent activity log',
        mimeType: 'application/json'
      },
      {
        uri: 'orchestron://bottlenecks',
        name: 'Bottlenecks',
        description: 'Identified project bottlenecks',
        mimeType: 'application/json'
      },
      {
        uri: 'orchestron://predictions',
        name: 'ML Predictions',
        description: 'Machine learning predictions and insights',
        mimeType: 'application/json'
      },
      {
        uri: 'orchestron://workflows',
        name: 'Workflows',
        description: 'Defined automation workflows',
        mimeType: 'application/json'
      },
      {
        uri: 'orchestron://handoff',
        name: 'Session Handoff',
        description: 'Prepared handoff information for session continuity',
        mimeType: 'application/json'
      }
    ];
  }

  /**
   * Read a resource by URI
   */
  async readResource(uri: string): Promise<any> {
    // Debug: Reading resource: ${uri}

    // Parse the URI
    const resourcePath = uri.replace('orchestron://', '');

    switch (resourcePath) {
      case 'dashboard':
        return await this.getDashboardData();

      case 'stats':
        return await this.orchestron.getStats();

      case 'tasks':
        return await this.orchestron.searchTasks({});

      case 'sprints':
        return await this.orchestron.getAllSprints();

      case 'context':
        return await this.orchestron.getCurrentContext();

      case 'activity':
        return await this.orchestron.getRecentActivity(20);

      case 'bottlenecks':
        return await this.orchestron.identifyBottlenecks();

      case 'predictions':
        return await this.getPredictions();

      case 'workflows':
        return await this.orchestron.listWorkflows();

      case 'handoff':
        return await this.getHandoffInfo();

      default:
        // Check if it's a specific resource with ID
        if (resourcePath.startsWith('tasks/')) {
          const taskId = resourcePath.substring(6);
          return await this.orchestron.getTask(taskId);
        }
        if (resourcePath.startsWith('sprints/')) {
          const sprintId = resourcePath.substring(8);
          return await this.orchestron.getSprint(sprintId);
        }

        throw new Error(`Unknown resource: ${uri}`);
    }
  }

  /**
   * Get complete dashboard data
   */
  private async getDashboardData(): Promise<any> {
    const [stats, activeSprint, recentTasks, bottlenecks] = await Promise.all([
      this.orchestron.getStats(),
      this.orchestron.getActiveSprint(),
      this.orchestron.searchTasks({}),
      this.orchestron.identifyBottlenecks()
    ]);

    return {
      stats,
      activeSprint,
      recentTasks,
      bottlenecks,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get ML predictions
   */
  private async getPredictions(): Promise<any> {
    const tasks = await this.orchestron.searchTasks({
      status: 'IN_PROGRESS' as any
    });

    const predictions = await Promise.all(
      tasks.map(async (task) => ({
        taskId: task.nodeId,
        title: task.payload.title,
        prediction: await this.orchestron.predictCompletion(task.nodeId)
      }))
    );

    return {
      predictions,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get session handoff information
   */
  private async getHandoffInfo(): Promise<any> {
    const currentSession = await this.orchestron.getCurrentSession();
    if (!currentSession) {
      return {
        hasActiveSession: false,
        message: 'No active session to handoff'
      };
    }

    const context = await this.orchestron.getCurrentContext();
    const activeTasks = await this.orchestron.searchTasks({
      status: 'IN_PROGRESS' as any,
      assignee: currentSession.agentId
    });

    return {
      hasActiveSession: true,
      session: currentSession,
      context: {
        summary: context,
        activeTasks: activeTasks.map(t => ({
          id: t.nodeId,
          title: t.payload.title,
          progress: t.payload.progress || 0
        })),
        nextSteps: await this.suggestNextSteps(activeTasks)
      },
      handoffInstructions: this.generateHandoffInstructions(context, activeTasks)
    };
  }

  /**
   * Suggest next steps based on active tasks
   */
  private async suggestNextSteps(activeTasks: any[]): Promise<string[]> {
    const suggestions: string[] = [];

    for (const task of activeTasks) {
      if (task.payload.progress === 0) {
        suggestions.push(`Start working on: ${task.payload.title}`);
      } else if (task.payload.progress < 50) {
        suggestions.push(`Continue: ${task.payload.title} (${task.payload.progress}% complete)`);
      } else if (task.payload.progress < 100) {
        suggestions.push(`Complete: ${task.payload.title} (${task.payload.progress}% complete)`);
      }
    }

    if (suggestions.length === 0) {
      suggestions.push('Pick a new task from the backlog');
    }

    return suggestions;
  }

  /**
   * Generate handoff instructions
   */
  private generateHandoffInstructions(context: any, activeTasks: any[]): string {
    const instructions: string[] = [
      '## Session Handoff Instructions',
      '',
      '### Current Context',
      `- Branch: ${context.currentBranch}`,
      `- Tasks in progress: ${activeTasks.length}`,
      '',
      '### Active Tasks'
    ];

    for (const task of activeTasks) {
      instructions.push(`- ${task.payload.title} (${task.payload.progress || 0}% complete)`);
      if (task.payload.description) {
        instructions.push(`  - ${task.payload.description}`);
      }
    }

    instructions.push('', '### Next Steps', '1. Load the context using context_load tool');
    instructions.push('2. Review active tasks');
    instructions.push('3. Continue from where the previous session left off');

    return instructions.join('\n');
  }
}