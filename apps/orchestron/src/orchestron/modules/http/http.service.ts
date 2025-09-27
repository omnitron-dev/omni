/**
 * HTTP Service
 * Main HTTP server for Orchestron dashboard and API
 */

import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { ApiRouter } from './api.router.js';
import { WebSocketService } from './websocket.service.js';
import * as path from 'path';
import * as fs from 'fs';

export class HttpService {
  private server: FastifyInstance;
  private port: number;
  private host: string;
  private isRunning: boolean = false;

  constructor(
    private configService: any,
    private apiRouter: ApiRouter,
    private websocketService: WebSocketService,
    private logger: any
  ) {
    this.port = configService?.get('port') || 3001;
    this.host = configService?.get('host') || '0.0.0.0';

    // Create Fastify instance
    this.server = fastify({
      logger: false, // We use our own logger
      trustProxy: true
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger?.warn('HTTP server is already running');
      return;
    }

    try {
      // Register CORS
      await this.server.register(cors, {
        origin: true,
        credentials: true
      });

      // Serve static files (dashboard)
      const dashboardPath = path.join(__dirname, '../../../../web');
      if (fs.existsSync(dashboardPath)) {
        await this.server.register(fastifyStatic, {
          root: dashboardPath,
          prefix: '/'
        });
        this.logger?.info('Dashboard static files registered', { path: dashboardPath });
      } else {
        this.logger?.warn('Dashboard directory not found', { path: dashboardPath });
      }

      // Register API routes
      this.registerApiRoutes();

      // Health check endpoint
      this.server.get('/health', async (request, reply) => {
        reply.send({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: '3.0.0'
        });
      });

      // Start the server
      await this.server.listen({ port: this.port, host: this.host });
      this.isRunning = true;

      this.logger?.info('HTTP server started', {
        port: this.port,
        host: this.host,
        url: `http://localhost:${this.port}`
      });

      // Set up WebSocket upgrade
      this.setupWebSocketUpgrade();
    } catch (error) {
      this.logger?.error('Failed to start HTTP server', { error });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.server.close();
      this.isRunning = false;
      this.logger?.info('HTTP server stopped');
    } catch (error) {
      this.logger?.error('Failed to stop HTTP server', { error });
      throw error;
    }
  }

  private registerApiRoutes(): void {
    // Dashboard API routes
    this.server.get('/api/dashboard', async (request, reply) => {
      const data = await this.apiRouter.getDashboardData();
      reply.send(data);
    });

    this.server.get('/api/stats', async (request, reply) => {
      const stats = await this.apiRouter.getStatistics();
      reply.send(stats);
    });

    // Task routes
    this.server.get('/api/tasks', async (request, reply) => {
      const tasks = await this.apiRouter.getTasks(request.query as any);
      reply.send(tasks);
    });

    this.server.get('/api/tasks/:id', async (request: any, reply) => {
      const task = await this.apiRouter.getTask(request.params.id);
      if (task) {
        reply.send(task);
      } else {
        reply.status(404).send({ error: 'Task not found' });
      }
    });

    this.server.patch('/api/tasks/:id/status', async (request: any, reply) => {
      const updated = await this.apiRouter.updateTaskStatus(
        request.params.id,
        request.body.status
      );
      reply.send(updated);
    });

    // Sprint routes
    this.server.get('/api/sprints', async (request, reply) => {
      const sprints = await this.apiRouter.getSprints();
      reply.send(sprints);
    });

    this.server.get('/api/sprints/active', async (request, reply) => {
      const sprint = await this.apiRouter.getActiveSprint();
      if (sprint) {
        reply.send(sprint);
      } else {
        reply.status(404).send({ error: 'No active sprint' });
      }
    });

    this.server.get('/api/sprints/:id/burndown', async (request: any, reply) => {
      const data = await this.apiRouter.getSprintBurndown(request.params.id);
      reply.send(data);
    });

    // Analysis routes
    this.server.get('/api/bottlenecks', async (request, reply) => {
      const bottlenecks = await this.apiRouter.getBottlenecks();
      reply.send(bottlenecks);
    });

    this.server.get('/api/activity', async (request, reply) => {
      const limit = parseInt((request.query as any).limit) || 20;
      const activity = await this.apiRouter.getRecentActivity(limit);
      reply.send(activity);
    });

    // Claude routes
    this.server.get('/api/claude/projects', async (request, reply) => {
      const projects = await this.apiRouter.getClaudeProjects();
      reply.send(projects);
    });

    this.server.get('/api/claude/projects/:id/sessions', async (request: any, reply) => {
      const sessions = await this.apiRouter.getProjectSessions(request.params.id);
      reply.send(sessions);
    });

    this.server.get('/api/claude/sessions/:projectId/:sessionId', async (request: any, reply) => {
      const history = await this.apiRouter.getSessionHistory(
        request.params.projectId,
        request.params.sessionId
      );
      reply.send(history);
    });

    this.server.post('/api/claude/execute', async (request: any, reply) => {
      const { projectPath, prompt, model, resume, continue: cont } = request.body;
      const sessionId = await this.apiRouter.executeClaude(projectPath, prompt, {
        model,
        resume,
        continue: cont
      });
      reply.send({ sessionId });
    });

    this.server.post('/api/claude/cancel', async (request: any, reply) => {
      await this.apiRouter.cancelClaude(request.body.sessionId);
      reply.send({ success: true });
    });

    this.server.get('/api/claude/running', async (request, reply) => {
      const sessions = await this.apiRouter.getRunningSessions();
      reply.send(sessions);
    });

    this.server.get('/api/claude/version', async (request, reply) => {
      const version = await this.apiRouter.checkClaudeVersion();
      reply.send(version);
    });

    // Settings routes
    this.server.get('/api/settings', async (request, reply) => {
      const settings = await this.apiRouter.getSettings();
      reply.send(settings);
    });

    this.server.post('/api/settings', async (request: any, reply) => {
      await this.apiRouter.saveSettings(request.body);
      reply.send({ success: true });
    });

    // System prompt routes
    this.server.get('/api/system-prompt', async (request, reply) => {
      const prompt = await this.apiRouter.getSystemPrompt();
      reply.send({ content: prompt });
    });

    this.server.post('/api/system-prompt', async (request: any, reply) => {
      await this.apiRouter.saveSystemPrompt(request.body.content);
      reply.send({ success: true });
    });

    // Command execution
    this.server.post('/api/command', async (request: any, reply) => {
      const { command, args } = request.body;
      const result = await this.apiRouter.executeCommand(command, args);
      reply.send(result);
    });

    // File operations
    this.server.get('/api/files', async (request, reply) => {
      const { path: dirPath } = request.query as any;
      const files = await this.apiRouter.listDirectory(dirPath);
      reply.send(files);
    });

    this.server.get('/api/files/search', async (request, reply) => {
      const { path: basePath, query } = request.query as any;
      const results = await this.apiRouter.searchFiles(basePath, query);
      reply.send(results);
    });

    // Timers
    this.server.post('/api/timers/start', async (request: any, reply) => {
      const { taskId } = request.body;
      const result = await this.apiRouter.startTimer(taskId);
      reply.send(result);
    });

    this.server.post('/api/timers/stop', async (request, reply) => {
      const result = await this.apiRouter.stopTimer();
      reply.send(result);
    });

    // Workflows
    this.server.get('/api/workflows', async (request, reply) => {
      const workflows = await this.apiRouter.getWorkflows();
      reply.send(workflows);
    });

    this.logger?.info('API routes registered');
  }

  private setupWebSocketUpgrade(): void {
    // Set up WebSocket upgrade handling
    this.server.server.on('upgrade', (request, socket, head) => {
      // Check if this is a WebSocket upgrade request
      if (request.url === '/ws' || request.url === '/api/ws') {
        this.websocketService.handleUpgrade(request, socket as any, head);
      } else {
        socket.destroy();
      }
    });

    this.logger?.info('WebSocket upgrade handler registered');
  }
}