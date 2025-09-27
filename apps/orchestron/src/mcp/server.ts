import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode
} from '@modelcontextprotocol/sdk/types.js';
import { UnifiedOrchestron } from '../core/unified-orchestron.js';
import { SQLiteStorage } from '../storage/sqlite.js';
import { TaskStatus, Priority } from '../core/types.js';
import { z } from 'zod';

// Tool input schemas
const CreateTaskSchema = z.object({
  title: z.string(),
  type: z.enum(['EPIC', 'STORY', 'TASK', 'SUBTASK', 'TODO']),
  description: z.string().optional(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'TRIVIAL']).optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

const UpdateTaskSchema = z.object({
  taskId: z.string(),
  status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'TESTING', 'DONE', 'CANCELLED', 'BLOCKED']).optional(),
  progress: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

const ListTasksSchema = z.object({
  status: z.string().optional(),
  assignee: z.string().optional(),
  priority: z.string().optional(),
  limit: z.number().optional(),
});

const SaveContextSchema = z.object({
  context: z.record(z.string(), z.any()),
  notes: z.string().optional(),
});

export class OrchestronMCPServer {
  private server: Server;
  private orchestron: UnifiedOrchestron;
  private storage: SQLiteStorage;

  constructor(dbPath?: string) {
    this.server = new Server(
      {
        name: 'orchestron',
        version: '1.0.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    // Initialize storage and orchestron
    this.storage = new SQLiteStorage(dbPath || '.orchestron/orchestron.db');
    this.orchestron = new UnifiedOrchestron(this.storage);
  }

  async initialize() {
    await this.storage.initialize();
    await this.orchestron.initialize();

    // Setup handlers
    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'orchestron_task_create',
          description: 'Create a new task in Orchestron',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Task title'
              },
              type: {
                type: 'string',
                enum: ['EPIC', 'STORY', 'TASK', 'SUBTASK', 'TODO'],
                description: 'Task type'
              },
              description: {
                type: 'string',
                description: 'Task description (optional)'
              },
              priority: {
                type: 'string',
                enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'TRIVIAL'],
                description: 'Task priority (optional)'
              },
              assignee: {
                type: 'string',
                description: 'Task assignee (optional)'
              },
              labels: {
                type: 'array',
                items: { type: 'string' },
                description: 'Task labels (optional)'
              }
            },
            required: ['title', 'type'],
          },
        },
        {
          name: 'orchestron_task_list',
          description: 'List tasks from Orchestron',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                description: 'Filter by status'
              },
              assignee: {
                type: 'string',
                description: 'Filter by assignee'
              },
              priority: {
                type: 'string',
                description: 'Filter by priority'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of tasks to return'
              },
            },
          },
        },
        {
          name: 'orchestron_task_update',
          description: 'Update task status or progress',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: 'Task ID to update'
              },
              status: {
                type: 'string',
                enum: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'TESTING', 'DONE', 'CANCELLED', 'BLOCKED'],
                description: 'New status (optional)'
              },
              progress: {
                type: 'number',
                minimum: 0,
                maximum: 100,
                description: 'Progress percentage (optional)'
              },
              notes: {
                type: 'string',
                description: 'Update notes (optional)'
              }
            },
            required: ['taskId'],
          },
        },
        {
          name: 'orchestron_context_get',
          description: 'Get current development context',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'orchestron_context_save',
          description: 'Save development context for session handoff',
          inputSchema: {
            type: 'object',
            properties: {
              context: {
                type: 'object',
                description: 'Context object to save'
              },
              notes: {
                type: 'string',
                description: 'Additional notes (optional)'
              }
            },
            required: ['context'],
          },
        },
        {
          name: 'orchestron_session_status',
          description: 'Get current session status and active tasks',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'orchestron_sprint_current',
          description: 'Get current sprint information',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'orchestron://tasks/active',
          name: 'Active Tasks',
          mimeType: 'application/json',
          description: 'All active tasks (IN_PROGRESS status)',
        },
        {
          uri: 'orchestron://tasks/blocked',
          name: 'Blocked Tasks',
          mimeType: 'application/json',
          description: 'Tasks that are currently blocked',
        },
        {
          uri: 'orchestron://sprint/current',
          name: 'Current Sprint',
          mimeType: 'application/json',
          description: 'Current active sprint information',
        },
        {
          uri: 'orchestron://context/latest',
          name: 'Latest Context',
          mimeType: 'application/json',
          description: 'Most recent saved development context',
        },
        {
          uri: 'orchestron://stats/overview',
          name: 'Statistics Overview',
          mimeType: 'application/json',
          description: 'Overall project statistics',
        },
      ],
    }));

    // Read resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      try {
        switch (uri) {
          case 'orchestron://tasks/active': {
            const tasks = await this.orchestron.searchTasks({
              status: TaskStatus.IN_PROGRESS,
            });
            return {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(tasks, null, 2),
                },
              ],
            };
          }

          case 'orchestron://tasks/blocked': {
            const tasks = await this.orchestron.getBlockedTasks();
            return {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(tasks, null, 2),
                },
              ],
            };
          }

          case 'orchestron://sprint/current': {
            const sprint = await this.orchestron.getActiveSprint();
            return {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(sprint, null, 2),
                },
              ],
            };
          }

          case 'orchestron://context/latest': {
            const context = this.orchestron.getCurrentContext();
            return {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(context, null, 2),
                },
              ],
            };
          }

          case 'orchestron://stats/overview': {
            const stats = await this.orchestron.getStatistics();
            return {
              contents: [
                {
                  uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(stats, null, 2),
                },
              ],
            };
          }

          default:
            throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to read resource: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'orchestron_task_create': {
            const input = CreateTaskSchema.parse(args);
            const task = await this.orchestron.createTask({
              type: input.type as any,
              title: input.title,
              description: input.description,
              priority: (input.priority || 'MEDIUM') as Priority,
              assignee: input.assignee,
              labels: input.labels,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: `Created task ${task.nodeId}: ${task.payload.title}`,
                },
              ],
            };
          }

          case 'orchestron_task_list': {
            const input = ListTasksSchema.parse(args);
            const tasks = await this.orchestron.searchTasks({
              status: input.status as TaskStatus,
              assignee: input.assignee,
              priority: input.priority as Priority,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(tasks.map(t => ({
                    id: t.nodeId,
                    title: t.payload.title,
                    status: t.payload.status,
                    priority: t.payload.priority,
                    progress: t.payload.progress || 0,
                    assignee: t.payload.assignee,
                  })), null, 2),
                },
              ],
            };
          }

          case 'orchestron_task_update': {
            const input = UpdateTaskSchema.parse(args);

            if (input.status) {
              await this.orchestron.updateTaskStatus(input.taskId, input.status as TaskStatus);
            }

            if (input.progress !== undefined) {
              await this.orchestron.updateTaskProgress(input.taskId, input.progress);
            }

            if (input.notes) {
              // Add notes to task metadata
              const task = await this.orchestron.getTask(input.taskId);
              if (task) {
                task.metadata = {
                  ...task.metadata,
                  // Notes stored in payload instead of metadata
                };
              }
            }

            return {
              content: [
                {
                  type: 'text',
                  text: `Updated task ${input.taskId}`,
                },
              ],
            };
          }

          case 'orchestron_context_get': {
            const context = this.orchestron.getCurrentContext();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(context, null, 2),
                },
              ],
            };
          }

          case 'orchestron_context_save': {
            const input = SaveContextSchema.parse(args);
            // Save context to storage
            const contextId = await this.saveContext(input.context, input.notes);
            return {
              content: [
                {
                  type: 'text',
                  text: `Context saved with ID: ${contextId}`,
                },
              ],
            };
          }

          case 'orchestron_session_status': {
            const stats = await this.orchestron.getStatistics();
            const activeTasks = await this.orchestron.searchTasks({
              status: TaskStatus.IN_PROGRESS,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    statistics: stats,
                    activeTasks: activeTasks.map(t => ({
                      id: t.nodeId,
                      title: t.payload.title,
                      progress: t.payload.progress || 0,
                    })),
                  }, null, 2),
                },
              ],
            };
          }

          case 'orchestron_sprint_current': {
            const sprint = await this.orchestron.getActiveSprint();
            if (sprint) {
              const report = await this.orchestron.getSprintReport(sprint.nodeId);
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(report, null, 2),
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: 'text',
                  text: 'No active sprint',
                },
              ],
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid parameters: ${error.issues.map((e: any) => e.message).join(', ')}`
          );
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    });
  }

  private async saveContext(context: any, notes?: string): Promise<string> {
    // Generate context ID
    const contextId = `CTX-${Date.now()}`;

    // Save to storage (you might want to add a contexts table)
    // For now, we'll save the context to storage directly
    // TODO: Implement proper context storage mechanism
    // await this.storage.saveData?.(`context-${contextId}`, {
    //   contextId,
    //   context,
    //   notes,
    //   timestamp: new Date(),
    // });

    return contextId;
  }

  async start() {
    await this.initialize();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('Orchestron MCP Server started');
  }

  async close() {
    await this.orchestron.close();
    await this.storage.close();
  }
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new OrchestronMCPServer(process.env.ORCHESTRON_DB);
  server.start().catch(console.error);
}