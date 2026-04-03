/**
 * Module Worker Process — @Process-compatible class for PM worker-runtime
 *
 * Generic entry point for module-based worker topology entries.
 * Worker-runtime creates an instance, calls init(bootstrapPath, processName),
 * and this class:
 *   1. Loads the app definition from the bootstrap file (same as bootstrap-process)
 *   2. Finds the matching topology entry by processName
 *   3. Creates a Titan Application with the entry's module
 *   4. Finds the @Service-decorated provider in the module
 *   5. Dynamically exposes all service methods via Netron RPC
 *
 * This replaces the need for each worker to have its own @Process-decorated
 * entry point file. All DI, config, Redis, DB connections are handled by
 * the module's imports (ConfigModule, DatabaseModule, etc.).
 */

import 'reflect-metadata';
import path from 'node:path';
import { Application } from '@omnitron-dev/titan';
import { loadBootstrapConfig } from './bootstrap-loader.js';

// Inline PM decorator metadata — avoids importing the full PM module which
// deadlocks when loaded from source (.ts) alongside the dist-loaded worker-runtime.
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

// Netron service metadata key (used by @Service decorator)
const SERVICE_METADATA_KEY = Symbol.for('titan:service:metadata');

/**
 * Find the @Service-decorated provider in a module's providers list.
 * Walks the module metadata to find classes with @Service decoration.
 */
function findServiceProviders(ModuleClass: any): any[] {
  const moduleMetadata = Reflect.getMetadata(Symbol.for('titan:module:metadata'), ModuleClass);
  if (!moduleMetadata) return [];

  const providers = moduleMetadata.providers ?? [];
  const serviceProviders: any[] = [];

  for (const provider of providers) {
    // Handle class providers (direct class reference)
    const target = typeof provider === 'function' ? provider : provider?.useClass;
    if (target && Reflect.getMetadata(SERVICE_METADATA_KEY, target)) {
      serviceProviders.push(target);
    }
  }

  return serviceProviders;
}

@Process({ name: 'ModuleWorker', allMethodsPublic: true })
class ModuleWorkerProcess {
  private app: Application | null = null;
  private service: any = null;

  /**
   * Initialize by loading the bootstrap config and creating a Titan Application
   * with the topology entry's module.
   *
   * Called by worker-runtime with dependencies from spawnOptions:
   *   init(deps)
   *
   * @param deps - Structured dependencies from orchestrator
   */
  async init(deps: { bootstrapPath: string; processName: string }): Promise<void> {
    const { bootstrapPath, processName } = deps;
    // In dev mode (tsx loaded via --import), prefer source .ts over compiled dist/
    const hasTsx = (process.execArgv ?? []).some((a) => a.includes('tsx'));
    const definition = await loadBootstrapConfig(bootstrapPath, { devMode: hasTsx });

    // Find the matching topology entry
    const topologyEntry = definition.processes?.find((p) => p.name === processName);
    if (!topologyEntry) {
      throw new Error(`Topology entry '${processName}' not found in bootstrap: ${bootstrapPath}`);
    }

    if (!topologyEntry.module) {
      throw new Error(`Topology entry '${processName}' has no module — use script-based process instead`);
    }

    // Import the module from the entry's file path (relative to bootstrap dir)
    const modulePath = path.resolve(path.dirname(bootstrapPath), topologyEntry.module);
    const moduleFile = await import(modulePath);
    const ModuleClass = moduleFile.default ?? moduleFile;

    // Create Titan Application with the worker module
    this.app = await Application.create(ModuleClass, {
      name: `${definition.name}/${processName}`,
    });

    // Find and resolve the @Service provider from the module
    const serviceProviders = findServiceProviders(ModuleClass);
    if (serviceProviders.length > 0) {
      // Resolve the first @Service provider from the DI container
      this.service = await this.app.container.resolveAsync(serviceProviders[0]);
    } else {
      // Fallback: try to find any injectable class that isn't a built-in module
      // This handles cases where the service isn't decorated with @Service
      const moduleMetadata = Reflect.getMetadata(Symbol.for('titan:module:metadata'), ModuleClass);
      const providers = moduleMetadata?.providers ?? [];
      for (const provider of providers) {
        const target = typeof provider === 'function' ? provider : null;
        if (target) {
          try {
            this.service = await this.app.container.resolveAsync(target);
            break;
          } catch {
            // Not resolvable, skip
          }
        }
      }
    }

    if (!this.service) {
      throw new Error(`No service provider found in module: ${ModuleClass.name}`);
    }

    // Dynamically expose all service methods on this process instance
    const proto = Object.getPrototypeOf(this.service);
    for (const prop of Object.getOwnPropertyNames(proto)) {
      if (prop === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (desc && typeof desc.value === 'function') {
        if (!(prop in this)) {
          (this as any)[prop] = (...args: any[]) => this.service[prop](...args);
        }
      }
    }
  }

  @OnShutdown()
  async shutdown(): Promise<void> {
    // Call service shutdown if available
    if (this.service?.shutdown) {
      try {
        await this.service.shutdown();
      } catch {
        // Best-effort
      }
    }
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
  }
}

export default ModuleWorkerProcess;
