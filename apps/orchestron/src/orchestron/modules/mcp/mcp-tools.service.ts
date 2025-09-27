/**
 * MCPToolsService - Defines and executes MCP tools for Orchestron
 */

import { Injectable, Inject } from '@omnitron-dev/titan/nexus';
import { UnifiedOrchestron } from '../core/core.module.js';
import { TaskStatus, Priority } from '../../../core/types.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

@Injectable()
export class MCPToolsService {

  constructor(
    @Inject(UnifiedOrchestron) private readonly orchestron: UnifiedOrchestron
  ) {}

  /**
   * Get all available tools
   */
  async getTools(): Promise<ToolDefinition[]> {
    return [
      // Task Management Tools
      {
        name: 'task_create',
        description: 'Create a new task in Orchestron',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Task title' },
            description: { type: 'string', description: 'Task description' },
            type: {
              type: 'string',
              enum: ['EPIC', 'STORY', 'TASK', 'SUBTASK', 'TODO'],
              description: 'Task type'
            },
            priority: {
              type: 'string',
              enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'TRIVIAL'],
              default: 'MEDIUM'
            },
            assignee: { type: 'string', description: 'Assigned to' },
            dueDate: { type: 'string', format: 'date', description: 'Due date' },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Task labels'
            }
          },
          required: ['title', 'type']
        }
      },
      {
        name: 'task_update',
        description: 'Update an existing task',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID' },
            status: {
              type: 'string',
              enum: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'TESTING', 'DONE', 'CANCELLED', 'BLOCKED']
            },
            progress: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: 'Progress percentage'
            },
            comment: { type: 'string', description: 'Update comment' }
          },
          required: ['taskId']
        }
      },
      {
        name: 'task_list',
        description: 'List tasks with optional filters',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            assignee: { type: 'string' },
            priority: { type: 'string' },
            limit: { type: 'number', default: 10 }
          }
        }
      },
      {
        name: 'task_get',
        description: 'Get details of a specific task',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID' }
          },
          required: ['taskId']
        }
      },

      // Sprint Management Tools
      {
        name: 'sprint_create',
        description: 'Create a new sprint',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Sprint name' },
            goal: { type: 'string', description: 'Sprint goal' },
            startDate: { type: 'string', format: 'date' },
            duration: { type: 'number', description: 'Duration in days', default: 14 }
          },
          required: ['name', 'goal']
        }
      },
      {
        name: 'sprint_active',
        description: 'Get the active sprint',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },

      // Session Management Tools
      {
        name: 'session_start',
        description: 'Start a new Orchestron session',
        inputSchema: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Agent identifier' }
          },
          required: ['agentId']
        }
      },
      {
        name: 'session_end',
        description: 'End the current session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID' }
          },
          required: ['sessionId']
        }
      },
      {
        name: 'context_save',
        description: 'Save context for session handoff',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            context: { type: 'object', description: 'Context to save' }
          },
          required: ['sessionId', 'context']
        }
      },
      {
        name: 'context_load',
        description: 'Load context from previous session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to load from' }
          }
        }
      },

      // Analytics Tools
      {
        name: 'stats_get',
        description: 'Get current statistics',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'bottlenecks_identify',
        description: 'Identify current bottlenecks',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'predict_completion',
        description: 'Predict task completion',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'Task ID' }
          },
          required: ['taskId']
        }
      },

      // Navigation Tools
      {
        name: 'goto',
        description: 'Navigate to a specific item',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query or ID' }
          },
          required: ['query']
        }
      },
      {
        name: 'recent',
        description: 'Get recent items',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', default: 10 }
          }
        }
      }
    ];
  }

  /**
   * Execute a tool by name with given arguments
   */
  async executeTool(name: string, args: any): Promise<any> {
    // Debug: Executing tool: ${name}

    switch (name) {
      // Task Management
      case 'task_create':
        return await this.orchestron.createTask({
          type: args.type,
          title: args.title,
          description: args.description,
          priority: args.priority || Priority.MEDIUM,
          assignee: args.assignee,
          dueDate: args.dueDate,
          labels: args.labels
        });

      case 'task_update':
        if (args.status) {
          await this.orchestron.updateTaskStatus(args.taskId, args.status);
        }
        if (args.progress !== undefined) {
          await this.orchestron.updateTaskProgress(args.taskId, args.progress);
        }
        return { success: true, taskId: args.taskId };

      case 'task_list':
        return await this.orchestron.searchTasks({
          status: args.status || undefined,
          assignee: args.assignee,
          priority: args.priority || undefined
        });

      case 'task_get':
        const task = await this.orchestron.getTask(args.taskId);
        if (!task) {
          throw new Error(`Task not found: ${args.taskId}`);
        }
        return task;

      // Sprint Management
      case 'sprint_create':
        return await this.orchestron.createSprint({
          name: args.name,
          goal: args.goal,
          startDate: args.startDate ? new Date(args.startDate) : new Date(),
          duration: args.duration || 14
        });

      case 'sprint_active':
        return await this.orchestron.getActiveSprint();

      // Session Management
      case 'session_start':
        return await this.orchestron.startSession(args.agentId);

      case 'session_end':
        await this.orchestron.endSession(args.sessionId);
        return { success: true };

      case 'context_save':
        await this.orchestron.saveContext(args.sessionId, args.context);
        return { success: true };

      case 'context_load':
        return await this.orchestron.loadContext(args.sessionId);

      // Analytics
      case 'stats_get':
        return await this.orchestron.getStats();

      case 'bottlenecks_identify':
        return await this.orchestron.identifyBottlenecks();

      case 'predict_completion':
        return await this.orchestron.predictCompletion(args.taskId);

      // Navigation
      case 'goto':
        return await this.orchestron.goto(args.query);

      case 'recent':
        return await this.orchestron.getRecentNodes(args.limit || 10);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}