/**
 * Netron HTTP Service
 * HTTP server implementation using Titan's Netron transport
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { OrchestronApiService } from './orchestron-api.service.js';
import * as path from 'path';
import * as fs from 'fs';
import { createReadStream } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';

@Service('orchestron-http@1.0.0')
export class NetronHttpService {
  private port: number;
  private host: string;
  private isRunning: boolean = false;
  private httpServer: any;
  private dashboardPath: string;

  constructor(
    private configService: any,
    private netronService: any,
    private apiService: OrchestronApiService,
    private eventsService: any,
    private logger: any
  ) {
    this.port = configService?.get('port') || configService?.get('orchestron.port') || 3001;
    this.host = configService?.get('host') || configService?.get('orchestron.host') || '0.0.0.0';

    // Set dashboard path relative to web directory
    this.dashboardPath = path.join(__dirname, '../../../../web');

    // Alternative dashboard path (production build)
    const altDashboardPath = path.join(__dirname, '../../../../../../web');
    if (!fs.existsSync(this.dashboardPath) && fs.existsSync(altDashboardPath)) {
      this.dashboardPath = altDashboardPath;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger?.warn('HTTP server is already running');
      return;
    }

    try {
      // Get the Netron instance
      if (!this.netronService) {
        throw new Error('Netron service not available');
      }

      // Get the HTTP server from Netron's transport server
      const transportServer = this.netronService.netron?.transportServer;
      if (!transportServer) {
        this.logger?.warn('No transport server available, creating standalone HTTP server');
        // Create standalone HTTP server if Netron doesn't have one
        await this.createStandaloneServer();
      } else {
        // Use existing transport server
        this.httpServer = (transportServer as any).server;
        this.registerRoutes();
      }

      this.isRunning = true;
      this.logger?.info('Netron HTTP server started', {
        port: this.port,
        host: this.host,
        url: `http://localhost:${this.port}`,
        dashboardPath: this.dashboardPath
      });

      // Set up WebSocket for events
      this.setupWebSocket();
    } catch (error) {
      this.logger?.error('Failed to start Netron HTTP server', { error });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.httpServer && this.httpServer.close) {
        await new Promise((resolve) => {
          this.httpServer.close(resolve);
        });
      }
      this.isRunning = false;
      this.logger?.info('Netron HTTP server stopped');
    } catch (error) {
      this.logger?.error('Failed to stop Netron HTTP server', { error });
      throw error;
    }
  }

  private async createStandaloneServer(): Promise<void> {
    const http = await import('http');

    this.httpServer = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer.listen(this.port, this.host, () => {
        resolve();
      });
      this.httpServer.on('error', reject);
    });

    this.registerRoutes();
  }

  private registerRoutes(): void {
    // Routes are handled in handleRequest method
    this.logger?.info('HTTP routes registered');
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method || 'GET';

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle OPTIONS requests
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // API Routes
      if (pathname.startsWith('/api/')) {
        await this.handleApiRoute(pathname, method, req, res);
        return;
      }

      // Health check
      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: '3.0.0'
        }));
        return;
      }

      // Static files (dashboard)
      await this.serveStaticFile(pathname, res);
    } catch (error) {
      this.logger?.error('Request handler error', { error, pathname, method });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private async handleApiRoute(
    pathname: string,
    method: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    let body = '';

    // Parse request body if needed
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      body = await new Promise<string>((resolve) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
      });
    }

    const query = new URL(req.url || '/', `http://${req.headers.host}`).searchParams;
    let result: any;

    // Route handling
    switch (pathname) {
      case '/api/dashboard':
        if (method === 'GET') {
          result = await this.apiService.getDashboardData();
        }
        break;

      case '/api/stats':
        if (method === 'GET') {
          result = await this.apiService.getStatistics();
        }
        break;

      case '/api/tasks':
        if (method === 'GET') {
          const filters: any = {};
          for (const [key, value] of query.entries()) {
            filters[key] = value;
          }
          result = await this.apiService.getTasks(filters);
        }
        break;

      case '/api/sprints':
        if (method === 'GET') {
          result = await this.apiService.getSprints();
        }
        break;

      case '/api/sprints/active':
        if (method === 'GET') {
          result = await this.apiService.getActiveSprint();
        }
        break;

      case '/api/bottlenecks':
        if (method === 'GET') {
          result = await this.apiService.getBottlenecks();
        }
        break;

      case '/api/workflows':
        if (method === 'GET') {
          result = await this.apiService.getWorkflows();
        }
        break;

      case '/api/command':
        if (method === 'POST') {
          const data = JSON.parse(body);
          result = await this.apiService.executeCommand(data);
        }
        break;

      default:
        // Handle dynamic routes (e.g., /api/tasks/:id)
        if (pathname.startsWith('/api/tasks/')) {
          const parts = pathname.split('/');
          const taskId = parts[3];

          if (parts.length === 4 && method === 'GET') {
            result = await this.apiService.getTask(taskId);
          } else if (parts[4] === 'status' && method === 'PATCH') {
            const data = JSON.parse(body);
            result = await this.apiService.updateTaskStatus(taskId, data.status);
          }
        } else if (pathname.startsWith('/api/sprints/') && pathname.endsWith('/burndown')) {
          const sprintId = pathname.split('/')[3];
          result = await this.apiService.getSprintBurndown(sprintId);
        }
        break;
    }

    if (result !== undefined) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private async serveStaticFile(pathname: string, res: ServerResponse): Promise<void> {
    // Default to index.html for root
    if (pathname === '/') {
      pathname = '/index.html';
    }

    const filePath = path.join(this.dashboardPath, pathname);

    // Security: Prevent directory traversal
    if (!filePath.startsWith(this.dashboardPath)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      // For SPA, serve index.html for non-existent routes
      const indexPath = path.join(this.dashboardPath, 'index.html');
      if (fs.existsSync(indexPath) && !pathname.includes('.')) {
        this.sendFile(indexPath, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      }
      return;
    }

    // Check if it's a directory
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      if (fs.existsSync(indexPath)) {
        this.sendFile(indexPath, res);
      } else {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Directory listing forbidden');
      }
      return;
    }

    // Serve the file
    this.sendFile(filePath, res);
  }

  private sendFile(filePath: string, res: ServerResponse): void {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });

    const stream = createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', (error) => {
      this.logger?.error('Error serving file', { error, filePath });
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    });
  }

  private setupWebSocket(): void {
    if (!this.httpServer) {
      this.logger?.warn('No HTTP server available for WebSocket');
      return;
    }

    // Import WebSocket and set up event streaming
    import('ws').then(({ WebSocketServer }) => {
      const wss = new WebSocketServer({
        server: this.httpServer,
        path: '/ws'
      });

      wss.on('connection', (ws) => {
        this.logger?.info('WebSocket client connected');

        // Send initial connection message
        ws.send(JSON.stringify({
          type: 'connection',
          message: 'Connected to Orchestron WebSocket'
        }));

        // Subscribe to events and forward to WebSocket
        const eventHandler = (data: any) => {
          ws.send(JSON.stringify({
            type: 'event',
            ...data
          }));
        };

        // Subscribe to various events
        this.eventsService?.on('task:*', eventHandler);
        this.eventsService?.on('sprint:*', eventHandler);
        this.eventsService?.on('workflow:*', eventHandler);

        ws.on('close', () => {
          this.logger?.info('WebSocket client disconnected');
          // Unsubscribe from events
          this.eventsService?.off('task:*', eventHandler);
          this.eventsService?.off('sprint:*', eventHandler);
          this.eventsService?.off('workflow:*', eventHandler);
        });

        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message.toString());
            this.logger?.debug('WebSocket message received', { data });
            // Handle client messages if needed
          } catch (error) {
            this.logger?.error('Invalid WebSocket message', { error, message });
          }
        });
      });

      this.logger?.info('WebSocket server initialized');
    }).catch(error => {
      this.logger?.error('Failed to set up WebSocket', { error });
    });
  }

  // Netron service methods (exposed via HTTP)
  @Public()
  async getDashboard(): Promise<any> {
    return this.apiService.getDashboardData();
  }

  @Public()
  async getStats(): Promise<any> {
    return this.apiService.getStatistics();
  }

  @Public()
  async getTasks(filters?: any): Promise<any> {
    return this.apiService.getTasks(filters);
  }

  @Public()
  async getSprints(): Promise<any> {
    return this.apiService.getSprints();
  }
}