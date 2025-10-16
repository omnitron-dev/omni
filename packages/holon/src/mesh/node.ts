/**
 * Service mesh node with flow registration, discovery, and health checks
 */

import type { Flow } from '@holon/flow';
import type {
  MeshNodeConfig,
  ServiceRegistration,
  RouteTarget,
} from '../types.js';
import { EventEmitter } from 'eventemitter3';
import { Router } from './router.js';
import { Discovery } from './discovery.js';

export interface MeshNodeEvents {
  'service:registered': (name: string) => void;
  'service:unregistered': (name: string) => void;
  'health:check': (health: HealthStatus) => void;
  'started': () => void;
  'stopped': () => void;
}

export interface HealthStatus {
  healthy: boolean;
  timestamp: number;
  checks: HealthCheck[];
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'fail';
  message?: string;
}

/**
 * Service mesh node
 *
 * Features:
 * - Flow registration and discovery
 * - Health checks
 * - Metrics collection
 * - Request routing
 */
export class MeshNode extends EventEmitter<MeshNodeEvents> {
  private readonly config: MeshNodeConfig;
  private readonly services: Map<string, ServiceRegistration> = new Map();
  private readonly router: Router;
  private readonly discovery: Discovery;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private server: any = null; // Could be HTTP server, will implement in integrations

  constructor(config: MeshNodeConfig) {
    super();
    this.config = config;
    this.router = new Router({
      strategy: 'round-robin',
      timeout: 5000,
    });
    this.discovery = new Discovery(config.discovery ?? { type: 'static' });
  }

  /**
   * Register a flow as a service
   */
  async register<In, Out>(
    name: string,
    flow: Flow<In, Out>,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const registration: ServiceRegistration = {
      name,
      flowId: this.getFlowId(flow as Flow<unknown, unknown>),
      flow: flow as Flow<unknown, unknown>,
      metadata,
      registeredAt: Date.now(),
    };

    this.services.set(name, registration);

    // Register with discovery service
    await this.discovery.register({
      name,
      nodeId: this.config.name,
      endpoint: `http://${this.config.host ?? 'localhost'}:${this.config.port}/${name}`,
      metadata,
    });

    this.emit('service:registered', name);
  }

  /**
   * Unregister a service
   */
  async unregister(name: string): Promise<void> {
    this.services.delete(name);
    await this.discovery.unregister(name);
    this.emit('service:unregistered', name);
  }

  /**
   * Get a registered service
   */
  getService(name: string): ServiceRegistration | undefined {
    return this.services.get(name);
  }

  /**
   * Get all registered services
   */
  getAllServices(): ServiceRegistration[] {
    return Array.from(this.services.values());
  }

  /**
   * Execute a service by name
   */
  async execute<In, Out>(name: string, input: In): Promise<Out> {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: ${name}`);
    }

    return (service.flow as Flow<In, Out>)(input);
  }

  /**
   * Start the mesh node
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Start discovery
    await this.discovery.start();

    // Start health checks
    this.startHealthChecks();

    this.emit('started');
  }

  /**
   * Stop the mesh node
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Stop health checks
    this.stopHealthChecks();

    // Unregister all services
    for (const name of this.services.keys()) {
      await this.unregister(name);
    }

    // Stop discovery
    await this.discovery.stop();

    this.emit('stopped');
  }

  /**
   * Check node health
   */
  async checkHealth(): Promise<HealthStatus> {
    const checks: HealthCheck[] = [];

    // Check if node is running
    checks.push({
      name: 'node',
      status: this.isRunning ? 'pass' : 'fail',
      message: this.isRunning ? 'Node is running' : 'Node is stopped',
    });

    // Check service count
    checks.push({
      name: 'services',
      status: this.services.size > 0 ? 'pass' : 'fail',
      message: `${this.services.size} services registered`,
    });

    // Check discovery
    checks.push({
      name: 'discovery',
      status: this.discovery.isRunning() ? 'pass' : 'fail',
      message: this.discovery.isRunning() ? 'Discovery active' : 'Discovery inactive',
    });

    const healthy = checks.every((c) => c.status === 'pass');

    const status: HealthStatus = {
      healthy,
      timestamp: Date.now(),
      checks,
    };

    this.emit('health:check', status);
    return status;
  }

  /**
   * Get node metrics
   */
  getMetrics(): NodeMetrics {
    return {
      nodeId: this.config.name,
      servicesCount: this.services.size,
      uptime: this.isRunning ? Date.now() : 0,
      healthy: this.isRunning,
    };
  }

  /**
   * Start health checks
   */
  private startHealthChecks(): void {
    const interval = this.config.healthCheck?.interval ?? 30000;
    this.healthCheckInterval = setInterval(() => {
      this.checkHealth();
    }, interval);
  }

  /**
   * Stop health checks
   */
  private stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get flow identifier
   */
  private getFlowId(flow: Flow<unknown, unknown>): string {
    return (flow as any).name || flow.toString().slice(0, 50);
  }
}

export interface NodeMetrics {
  nodeId: string;
  servicesCount: number;
  uptime: number;
  healthy: boolean;
}

/**
 * Create a new mesh node
 */
export async function createMeshNode(config: MeshNodeConfig): Promise<MeshNode> {
  const node = new MeshNode(config);
  await node.start();
  return node;
}
