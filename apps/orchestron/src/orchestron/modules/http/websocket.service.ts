/**
 * WebSocket Service
 * Handles real-time communication with dashboard clients
 */

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Socket } from 'net';

export class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private port: number = 3002;

  constructor(
    private eventsService: any,
    private logger: any
  ) {}

  async start(port: number = 3002): Promise<void> {
    this.port = port;

    // Create WebSocket server
    this.wss = new WebSocketServer({ noServer: true });

    // Handle connections
    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      this.handleConnection(ws, request);
    });

    // Subscribe to events for broadcasting
    this.setupEventListeners();

    this.logger?.info('WebSocket server started', { port: this.port });
  }

  async stop(): Promise<void> {
    // Close all client connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Close the server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    this.logger?.info('WebSocket server stopped');
  }

  handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): void {
    if (!this.wss) {
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss?.emit('connection', ws, request);
    });
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    this.clients.add(ws);
    this.logger?.info('WebSocket client connected', {
      clientCount: this.clients.size
    });

    // Send welcome message
    this.sendToClient(ws, {
      type: 'welcome',
      message: 'Connected to Orchestron WebSocket',
      timestamp: new Date().toISOString()
    });

    // Handle messages from client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(ws, message);
      } catch (error) {
        this.logger?.error('Failed to parse WebSocket message', { error });
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      this.clients.delete(ws);
      this.logger?.info('WebSocket client disconnected', {
        clientCount: this.clients.size
      });
    });

    // Handle errors
    ws.on('error', (error) => {
      this.logger?.error('WebSocket client error', { error });
      this.clients.delete(ws);
    });
  }

  private handleClientMessage(ws: WebSocket, message: any): void {
    this.logger?.debug('Received WebSocket message', { type: message.type });

    switch (message.type) {
      case 'ping':
        this.sendToClient(ws, { type: 'pong' });
        break;

      case 'subscribe':
        // Handle event subscription
        this.handleSubscription(ws, message.events);
        break;

      case 'command':
        // Handle command execution
        this.handleCommand(ws, message.command, message.args);
        break;

      default:
        this.logger?.warn('Unknown WebSocket message type', { type: message.type });
    }
  }

  private handleSubscription(ws: WebSocket, events: string[]): void {
    // Store subscription info on the WebSocket object
    (ws as any).subscriptions = events;
    this.logger?.info('Client subscribed to events', { events });
  }

  private async handleCommand(ws: WebSocket, command: string, args: any): Promise<void> {
    // Execute command and send result
    this.logger?.info('Executing WebSocket command', { command, args });

    // This would integrate with the command system
    this.sendToClient(ws, {
      type: 'command-result',
      command,
      result: { success: true }
    });
  }

  private setupEventListeners(): void {
    if (!this.eventsService) return;

    // Task events
    this.eventsService.on('task:created', (data: any) => {
      this.broadcast({ type: 'task:created', data });
    });

    this.eventsService.on('task:updated', (data: any) => {
      this.broadcast({ type: 'task:updated', data });
    });

    this.eventsService.on('task:completed', (data: any) => {
      this.broadcast({ type: 'task:completed', data });
    });

    // Sprint events
    this.eventsService.on('sprint:started', (data: any) => {
      this.broadcast({ type: 'sprint:started', data });
    });

    this.eventsService.on('sprint:ended', (data: any) => {
      this.broadcast({ type: 'sprint:ended', data });
    });

    // Claude events
    this.eventsService.on('claude:output', (data: any) => {
      this.broadcast({ type: 'claude:output', data });
    });

    this.eventsService.on('claude:error', (data: any) => {
      this.broadcast({ type: 'claude:error', data });
    });

    this.eventsService.on('claude:complete', (data: any) => {
      this.broadcast({ type: 'claude:complete', data });
    });

    // Timer events
    this.eventsService.on('timer:started', (data: any) => {
      this.broadcast({ type: 'timer:started', data });
    });

    this.eventsService.on('timer:stopped', (data: any) => {
      this.broadcast({ type: 'timer:stopped', data });
    });

    // Workflow events
    this.eventsService.on('workflow:triggered', (data: any) => {
      this.broadcast({ type: 'workflow:triggered', data });
    });

    this.logger?.info('WebSocket event listeners configured');
  }

  private broadcast(message: any): void {
    const data = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        // Check if client is subscribed to this event type
        const subscriptions = (client as any).subscriptions;
        if (!subscriptions || subscriptions.includes('*') || subscriptions.includes(message.type)) {
          client.send(data);
        }
      }
    }
  }

  private sendToClient(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}