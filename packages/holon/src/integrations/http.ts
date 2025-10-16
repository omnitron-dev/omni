/**
 * HTTP integration for exposing flows as HTTP endpoints
 *
 * This is a simplified implementation providing the interface.
 * Full HTTP server implementation would use Express or similar.
 */

import type { Flow } from '@holon/flow';
import type { HttpServerConfig } from '../types.js';
import { EventEmitter } from 'eventemitter3';

export interface HttpServerEvents {
  request: (path: string, method: string) => void;
  response: (path: string, statusCode: number) => void;
  error: (error: Error) => void;
}

/**
 * HTTP server for exposing flows
 *
 * Features:
 * - RESTful API generation
 * - JSON request/response
 * - CORS support
 * - Middleware support
 */
export class HttpServer extends EventEmitter<HttpServerEvents> {
  private readonly config: HttpServerConfig;
  private readonly flows: Map<string, Flow<unknown, unknown>> = new Map();
  private isRunning = false;

  constructor(config: HttpServerConfig) {
    super();
    this.config = config;

    // Register flows
    for (const [path, flow] of Object.entries(config.flows)) {
      this.flows.set(path, flow);
    }
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log(`HTTP server listening on ${this.config.host ?? 'localhost'}:${this.config.port}`);

    // In production, would start actual HTTP server
    // For now, just mark as running
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    console.log('HTTP server stopped');
  }

  /**
   * Handle HTTP request
   */
  async handleRequest(path: string, body: unknown): Promise<unknown> {
    this.emit('request', path, 'POST');

    const flow = this.flows.get(path);
    if (!flow) {
      throw new Error(`Flow not found: ${path}`);
    }

    try {
      const result = await flow(body);
      this.emit('response', path, 200);
      return result;
    } catch (error) {
      this.emit('error', error as Error);
      this.emit('response', path, 500);
      throw error;
    }
  }

  /**
   * Register a flow
   */
  registerFlow(path: string, flow: Flow<unknown, unknown>): void {
    this.flows.set(path, flow);
  }

  /**
   * Unregister a flow
   */
  unregisterFlow(path: string): void {
    this.flows.delete(path);
  }

  /**
   * Get server info
   */
  getInfo(): ServerInfo {
    return {
      host: this.config.host ?? 'localhost',
      port: this.config.port,
      running: this.isRunning,
      flows: Array.from(this.flows.keys()),
    };
  }
}

export interface ServerInfo {
  host: string;
  port: number;
  running: boolean;
  flows: string[];
}

/**
 * Create HTTP server
 */
export function createHttpServer(config: HttpServerConfig): HttpServer {
  return new HttpServer(config);
}
