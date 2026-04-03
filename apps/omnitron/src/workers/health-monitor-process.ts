/**
 * Health Monitor Worker Process — PM-managed background health checker
 *
 * Thin @Process wrapper that delegates to HealthMonitorService.
 * Runs as a dedicated child process via SystemWorkerManager.
 *
 * The service handles all health checking logic:
 *   - Periodic ping/SSH/omnitron checks on all nodes
 *   - Writing results to PostgreSQL
 *   - Sending IPC status batches to the master daemon
 *
 * Uses inline @Process decorator to avoid dual-package hazard (same pattern
 * as bootstrap-process.ts).
 */

import 'reflect-metadata';
import { Application } from '@omnitron-dev/titan';
import { HealthMonitorModule } from './health-monitor.module.js';
import { HealthMonitorService } from './health-monitor.service.js';
import type { INodeHealthSummary, IHealthCheckResult } from './types.js';

// =============================================================================
// Inline PM decorators (avoid dual-package hazard with Symbol.for)
// =============================================================================

const PROCESS_METADATA_KEY = Symbol.for('process:metadata');
const PROCESS_METHOD_METADATA_KEY = Symbol.for('process:method:metadata');

function Process(options: { name?: string; allMethodsPublic?: boolean } = {}): ClassDecorator {
  return (target: any) => {
    const metadata = { ...options, target, isProcess: true, methods: new Map() };
    Reflect.defineMetadata(PROCESS_METADATA_KEY, metadata, target);
    const prototype = target.prototype;
    for (const prop of Object.getOwnPropertyNames(prototype)) {
      if (prop === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(prototype, prop);
      if (!desc || typeof desc.value !== 'function') continue;
      let m = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, prop);
      if (options.allMethodsPublic && !m) {
        m = { public: true };
        Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, m, prototype, prop);
      }
      if (m) {
        if (options.allMethodsPublic) m.public = true;
        metadata.methods.set(prop, m);
      }
    }
    return target;
  };
}

function OnShutdown(): MethodDecorator {
  return (target: any, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const m = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, target, propertyKey) || {};
    m.onShutdown = true;
    m.public = true;
    Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, m, target, propertyKey);
  };
}

// =============================================================================
// Health Monitor Process — thin @Process wrapper
// =============================================================================

@Process({ name: 'HealthMonitor', allMethodsPublic: true })
class HealthMonitorProcess {
  private app: Application | null = null;
  private service: HealthMonitorService | null = null;

  /**
   * Initialize the worker. Called by PM worker-runtime with dependencies object.
   * Dependencies: { configJson: string, nodesJson: string }
   */
  async init(deps: { configJson: string; nodesJson: string }): Promise<void> {
    const { configJson, nodesJson } = deps;
    // Create Titan Application with the HealthMonitorModule
    this.app = await Application.create(HealthMonitorModule, {
      name: 'health-monitor',
    });
    await this.app.start();

    // Resolve HealthMonitorService directly from DI container
    this.service = await this.app.container.resolveAsync(HealthMonitorService) as HealthMonitorService;

    // Delegate initialization to the service
    await this.service.init(configJson, nodesJson);
  }

  /** Master calls this when nodes are added/updated/removed */
  updateNodes(nodesJson: string): void {
    this.service!.updateNodes(nodesJson);
  }

  /** On-demand check for a specific node or all nodes */
  async triggerCheck(nodeId?: string): Promise<INodeHealthSummary[]> {
    return this.service!.triggerCheck(nodeId);
  }

  /** Get current in-memory status summaries */
  getStatusSummaries(): INodeHealthSummary[] {
    return this.service!.getStatusSummaries();
  }

  /** Get check history from PG */
  async getCheckHistory(nodeId: string, limit?: number): Promise<IHealthCheckResult[]> {
    return this.service!.getCheckHistory(nodeId, limit);
  }

  /** Update config at runtime */
  updateConfig(configJson: string): void {
    this.service!.updateConfig(configJson);
  }

  @OnShutdown()
  async shutdown(): Promise<void> {
    if (this.service) {
      await this.service.shutdown();
    }
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
  }
}

export default HealthMonitorProcess;
