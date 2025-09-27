import fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import path from 'path';
import { UnifiedOrchestron } from '../core/unified-orchestron';
import { SQLiteStorage } from '../storage/sqlite';
import { Priority, TaskStatus } from '../core/types';
import { z } from 'zod';

const server = fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

const PORT = parseInt(process.env.ORCHESTRON_DASHBOARD_PORT || '3001');
const HOST = process.env.ORCHESTRON_DASHBOARD_HOST || '0.0.0.0';

let csp: UnifiedOrchestron;
let wss: WebSocketServer;

// Request schemas using Zod
const TaskQuerySchema = z.object({
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(Priority).optional(),
  assignee: z.string().optional(),
});

const UpdateStatusSchema = z.object({
  status: z.nativeEnum(TaskStatus),
});

const TimerSchema = z.object({
  taskId: z.string(),
  user: z.string().optional(),
});

const ActivityQuerySchema = z.object({
  limit: z.string().transform(val => parseInt(val)).optional(),
});

// Initialize Orchestron
async function initializeOrchestron() {
  const dbPath = path.join(process.cwd(), '.orchestron', 'orchestron.db');
  const storage = new SQLiteStorage(dbPath);
  await storage.initialize();
  csp = new UnifiedOrchestron(storage);
  await csp.initialize();
  return csp;
}

// Register plugins
async function registerPlugins() {
  await server.register(cors, {
    origin: true,
    credentials: true,
  });

  await server.register(fastifyStatic, {
    root: path.join(__dirname, '../../public'),
    prefix: '/',
  });
}

// API Routes
function registerRoutes() {
  // Health check
  server.get('/health', async () => {
    return { status: 'healthy', timestamp: new Date().toISOString() };
  });

  // Get dashboard data
  server.get('/api/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const dashboard = await csp.generateDashboard();
      return dashboard;
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to get dashboard data', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get statistics
  server.get('/api/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await csp.getStats();
      return stats;
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to get statistics', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get tasks
  server.get('/api/tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = TaskQuerySchema.parse(request.query);
      const filters: any = {};

      if (query.status) filters.status = query.status;
      if (query.priority) filters.priority = query.priority;
      if (query.assignee) filters.assignee = query.assignee;

      const tasks = await csp.searchTasks(filters);
      return tasks;
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.code(400);
        return { error: 'Invalid query parameters', details: error.issues };
      }
      reply.code(500);
      return { error: 'Failed to get tasks', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get specific task
  server.get<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    try {
      const task = await csp.getTask(request.params.id);
      if (!task) {
        reply.code(404);
        return { error: 'Task not found' };
      }
      return task;
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to get task', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Update task status
  server.patch<{ Params: { id: string }; Body: { status: TaskStatus } }>(
    '/api/tasks/:id/status',
    async (request, reply) => {
      try {
        const body = UpdateStatusSchema.parse(request.body);
        const task = await csp.updateTaskStatus(request.params.id, body.status);
        return task;
      } catch (error) {
        if (error instanceof z.ZodError) {
          reply.code(400);
          return { error: 'Invalid request body', details: error.issues };
        }
        reply.code(500);
        return { error: 'Failed to update task status', details: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
  );

  // Get sprints
  server.get('/api/sprints', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const sprints = await csp.getAllSprints();
      return sprints;
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to get sprints', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get active sprint
  server.get('/api/sprints/active', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const activeSprintId = csp.getActiveSprint();
      if (!activeSprintId) {
        reply.code(404);
        return { error: 'No active sprint' };
      }

      const sprint = await csp.getSprint(activeSprintId);
      return sprint;
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to get active sprint', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get sprint burndown
  server.get<{ Params: { id: string } }>('/api/sprints/:id/burndown', async (request, reply) => {
    try {
      const report = await csp.getSprintReport(request.params.id);
      return report.burndown;
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to get burndown data', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get bottlenecks
  server.get('/api/bottlenecks', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const bottlenecks = await csp.identifyBottlenecks();
      return bottlenecks;
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to get bottlenecks', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get recent activity
  server.get('/api/activity', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = ActivityQuerySchema.parse(request.query);
      const limit = query.limit || 20;
      const recent = await csp.getRecentNodes(limit);
      return recent;
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.code(400);
        return { error: 'Invalid query parameters', details: error.issues };
      }
      reply.code(500);
      return { error: 'Failed to get recent activity', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Start timer
  server.post('/api/timers/start', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = TimerSchema.parse(request.body);
      await csp.startTimer(body.taskId, body.user || 'dashboard-user');
      return { success: true, message: 'Timer started' };
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.code(400);
        return { error: 'Invalid request body', details: error.issues };
      }
      reply.code(500);
      return { error: 'Failed to start timer', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Stop timer
  server.post<{ Body: { taskId: string } }>('/api/timers/stop', async (request, reply) => {
    try {
      const body = z.object({ taskId: z.string() }).parse(request.body);
      const result = await csp.stopTimer(body.taskId);
      return { success: true, duration: result };
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.code(400);
        return { error: 'Invalid request body', details: error.issues };
      }
      reply.code(500);
      return { error: 'Failed to stop timer', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get workflows
  server.get('/api/workflows', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const workflows = await csp.listWorkflows();
      return workflows;
    } catch (error) {
      reply.code(500);
      return { error: 'Failed to get workflows', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Execute command
  server.post<{ Body: { command: string; args: string[] } }>('/api/command', async (request, reply) => {
    try {
      const body = z.object({
        command: z.string(),
        args: z.array(z.string()),
      }).parse(request.body);

      const result = await csp.executeCommand(body.command, body.args);
      return { success: true, result };
    } catch (error) {
      if (error instanceof z.ZodError) {
        reply.code(400);
        return { error: 'Invalid request body', details: error.issues };
      }
      reply.code(500);
      return { error: 'Failed to execute command', details: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

// Setup WebSocket server for real-time updates
function setupWebSocketServer() {
  wss = new WebSocketServer({
    port: PORT + 1,
    perMessageDeflate: false,
  });

  wss.on('connection', (ws) => {
    server.log.info('Dashboard WebSocket client connected');

    const eventHandlers = new Map<string, (...args: any[]) => void>();

    // Subscribe to Orchestron events
    const events = [
      'task:created',
      'task:updated',
      'task:completed',
      'sprint:started',
      'sprint:ended',
      'timer:started',
      'timer:stopped',
      'workflow:triggered',
    ];

    for (const event of events) {
      const handler = (data: any) => {
        ws.send(JSON.stringify({ event, data }));
      };
      eventHandlers.set(event, handler);
      csp.on(event, handler);
    }

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        server.log.debug({ msg: 'WebSocket message received', data });

        // Handle client commands if needed
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (error) {
        server.log.error({ msg: 'Failed to parse WebSocket message', error });
      }
    });

    ws.on('close', () => {
      server.log.info('Dashboard WebSocket client disconnected');
      // Unsubscribe from events
      for (const [event, handler] of eventHandlers) {
        csp.off(event, handler);
      }
    });

    ws.on('error', (error) => {
      server.log.error({ msg: 'WebSocket error', error });
    });

    // Send initial connection success message
    ws.send(JSON.stringify({
      type: 'connected',
      timestamp: Date.now(),
      message: 'Connected to Orchestron Dashboard WebSocket'
    }));
  });

  server.log.info(`WebSocket server listening on port ${PORT + 1}`);
}

// Start the server
async function start() {
  try {
    // Initialize Orchestron
    await initializeOrchestron();
    server.log.info('Orchestron initialized successfully');

    // Register plugins and routes
    await registerPlugins();
    registerRoutes();

    // Setup WebSocket server
    setupWebSocketServer();

    // Start Fastify server
    await server.listen({ port: PORT, host: HOST });

    server.log.info(`Orchestron Dashboard Server running on http://${HOST}:${PORT}`);
    server.log.info('API endpoints available:');
    server.log.info('  GET  /api/dashboard');
    server.log.info('  GET  /api/stats');
    server.log.info('  GET  /api/tasks');
    server.log.info('  GET  /api/sprints');
    server.log.info('  GET  /api/bottlenecks');
    server.log.info('  GET  /api/activity');
    server.log.info('  POST /api/command');
    server.log.info(`WebSocket server on ws://localhost:${PORT + 1}`);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

// Graceful shutdown
const closeGracefully = async (signal: string) => {
  server.log.info(`Received signal ${signal}, shutting down gracefully...`);

  // Close WebSocket server
  if (wss) {
    wss.close(() => {
      server.log.info('WebSocket server closed');
    });
  }

  // Close Orchestron
  if (csp) {
    await csp.close();
    server.log.info('Orchestron closed');
  }

  // Close Fastify server
  await server.close();
  server.log.info('Fastify server closed');

  process.exit(0);
};

process.on('SIGTERM', () => closeGracefully('SIGTERM'));
process.on('SIGINT', () => closeGracefully('SIGINT'));

// Export for testing
export { server, start };

// Start if run directly
if (require.main === module) {
  start();
}