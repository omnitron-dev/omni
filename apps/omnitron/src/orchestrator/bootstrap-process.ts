/**
 * Bootstrap Process — @Process-compatible class for PM worker-runtime
 *
 * Wraps a full Titan Application bootstrap inside a PM-managed process.
 * Worker-runtime creates an instance, calls init(bootstrapPath, portOffset),
 * and this class internally creates and starts the Titan Application.
 *
 * Two Netron instances coexist:
 *   1. PM worker-runtime's Netron — management plane (health, metrics, shutdown)
 *   2. Application's own Netron — data plane (HTTP API serving)
 *
 * Topology: Children connect to the daemon's Netron Unix socket and use
 * queryInterface() to get transparent proxies to sibling services.
 */

import 'reflect-metadata';
import path from 'node:path';
import { Application } from '@omnitron-dev/titan';
import { createToken } from '@omnitron-dev/titan/nexus';
import { HttpTransport } from '@omnitron-dev/titan/netron/transport/http';
import { WebSocketTransport } from '@omnitron-dev/titan/netron/transport/websocket';
import { loadBootstrapConfig } from './bootstrap-loader.js';
import type { IAppDefinition, IProcessEntry } from '../config/types.js';

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

function HealthCheck(): MethodDecorator {
  return (target: any, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const m = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, target, propertyKey) || {};
    m.healthCheck = true;
    m.public = true;
    Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, m, target, propertyKey);
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

// Topology DI token prefix — apps use createToken('topology:{processName}')
const TOPOLOGY_TOKEN_PREFIX = 'topology:';

@Process({ name: 'BootstrapApp', allMethodsPublic: true })
class BootstrapProcess {
  private definition: IAppDefinition | null = null;
  private entry: IProcessEntry | null = null;
  private app: Application | null = null;
  private port: number | null = null;

  /**
   * Initialize the bootstrap process by loading config and starting the Application.
   *
   * Called by worker-runtime: processInstance.init(config.dependencies)
   *
   * @param deps - Structured dependencies from orchestrator
   */
  async init(deps: {
    bootstrapPath: string;
    processName?: string;
    portOffset?: number;
    bundledModulePath?: string;
    __daemonSocketUrl?: string;
    __topologyConnects?: string[];
  }): Promise<void> {
    const {
      bootstrapPath,
      processName: resolvedProcessName,
      portOffset: resolvedPortOffset,
      bundledModulePath,
      __daemonSocketUrl: daemonSocketUrl,
      __topologyConnects: topologyAccess,
    } = deps;

    // Prefer bundled module path (esbuild pre-built) over tsx runtime
    const hasTsx = !bundledModulePath && (process.execArgv ?? []).some((a) => a.includes('tsx'));
    this.definition = await loadBootstrapConfig(bootstrapPath, { devMode: hasTsx || !!bundledModulePath });

    // Find this process's entry in the topology.
    if (resolvedProcessName) {
      this.entry = this.definition.processes.find((p) => p.name === resolvedProcessName) ?? null;
      if (!this.entry) {
        throw new Error(
          `Process '${resolvedProcessName}' not found in bootstrap topology: ${bootstrapPath}`
        );
      }
    } else {
      this.entry = this.definition.processes[0] ?? null;
      if (!this.entry) {
        throw new Error(`No processes defined in bootstrap: ${bootstrapPath}`);
      }
    }

    // Resolve hooks: process-level overrides app-level
    const hooks = this.entry.hooks ?? this.definition.hooks;

    // beforeCreate hook
    if (hooks?.beforeCreate) {
      await hooks.beforeCreate();
    }

    // Import the module — prefer pre-bundled .mjs from BuildService,
    // fall back to resolving from bootstrap directory (tsx or dist/)
    const modulePath = bundledModulePath ?? path.resolve(path.dirname(bootstrapPath), this.entry.module);
    const moduleFile = await import(modulePath);
    // Resolve module class: prefer default export, then first named export (class),
    // then the module namespace itself (for compatibility with non-standard modules).
    let ModuleClass = moduleFile.default;
    if (!ModuleClass) {
      // Find the first exported class (e.g., `export class AppModule {}`)
      for (const key of Object.keys(moduleFile)) {
        if (typeof moduleFile[key] === 'function') {
          ModuleClass = moduleFile[key];
          break;
        }
      }
    }
    if (!ModuleClass) {
      ModuleClass = moduleFile;
    }

    // Create Titan Application
    this.app = await Application.create(ModuleClass, {
      name: this.definition.name,
      version: this.definition.version,
    });

    // afterCreate hook
    if (hooks?.afterCreate) {
      await hooks.afterCreate(this.app);
    }

    // Inject topology proxies via Netron-native connection to daemon.
    // topology.access contains Netron service names (e.g., 'OhlcvAggregatorWorker')
    // that this process is permitted to query from the daemon's Netron.
    if (daemonSocketUrl && topologyAccess && topologyAccess.length > 0) {
      await this.injectTopologyProxies(topologyAccess, daemonSocketUrl);
    }

    // Resolve auth: process-level overrides app-level (false = explicitly disabled)
    const auth = this.entry.auth !== undefined
      ? (this.entry.auth === false ? undefined : this.entry.auth)
      : this.definition.auth;

    // Register HTTP transport if configured on this process entry
    if (this.entry.transports?.http && this.app.netron) {
      this.app.netron.registerTransport('http', () => new HttpTransport());

      const httpConfig = this.entry.transports.http;
      const basePort = httpConfig.port;
      this.port = resolvedPortOffset ? basePort + resolvedPortOffset : basePort;

      const transportOptions: Record<string, unknown> = {
        port: this.port,
        host: httpConfig.host ?? '0.0.0.0',
        cors: httpConfig.cors ?? true,
        requestTimeout: httpConfig.requestTimeout ?? 120_000,
        keepAliveTimeout: httpConfig.keepAliveTimeout ?? 65_000,
        headersTimeout: httpConfig.headersTimeout ?? 60_000,
      };

      if (httpConfig.maxRequestSize) {
        transportOptions['maxRequestSize'] = httpConfig.maxRequestSize;
      }

      // Wire auth invocationWrapper
      if (auth?.invocationWrapper) {
        transportOptions['invocationWrapper'] = auth.invocationWrapper;
      }

      // Wire custom routes from process entry
      if (this.entry.customRoutes && this.entry.customRoutes.length > 0) {
        transportOptions['customRoutes'] = this.entry.customRoutes.map((r) => r.handler);
      }

      this.app.netron.registerTransportServer('http', {
        name: 'http',
        options: transportOptions,
      });
    }

    // Register WebSocket transport if configured on this process entry
    if (this.entry.transports?.websocket && this.app.netron) {
      this.app.netron.registerTransport('websocket', () => new WebSocketTransport());

      const wsConfig = this.entry.transports.websocket;
      const wsPort = resolvedPortOffset ? wsConfig.port + resolvedPortOffset : wsConfig.port;

      const wsOptions: Record<string, unknown> = {
        port: wsPort,
        host: wsConfig.host ?? '0.0.0.0',
        ...(wsConfig.path && { pathPrefix: wsConfig.path }),
        ...(wsConfig.keepAlive && { keepAlive: { enabled: true, ...wsConfig.keepAlive } }),
      };

      // Wire auth invocationWrapper for WebSocket too
      if (auth?.invocationWrapper) {
        wsOptions['invocationWrapper'] = auth.invocationWrapper;
      }

      this.app.netron.registerTransportServer('websocket', {
        name: 'websocket',
        options: wsOptions,
      });
    }

    // beforeStart hook
    if (hooks?.beforeStart) {
      await hooks.beforeStart(this.app);
    }

    // Start the application
    await this.app.start();

    // afterStart hook
    if (hooks?.afterStart) {
      await hooks.afterStart(this.app);
    }
  }

  /**
   * Health check — delegates to definition hook if present.
   */
  @HealthCheck()
  async checkHealth(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }> {
    const hooks = this.entry?.hooks ?? this.definition?.hooks;
    if (hooks?.onHealthCheck) {
      return hooks.onHealthCheck();
    }

    return {
      status: this.app ? 'healthy' : 'unhealthy',
    };
  }

  /**
   * Graceful shutdown — runs lifecycle hooks and stops the Application.
   */
  @OnShutdown()
  async shutdown(): Promise<void> {
    const hooks = this.entry?.hooks ?? this.definition?.hooks;

    if (hooks?.beforeStop && this.app) {
      try {
        await hooks.beforeStop(this.app);
      } catch {
        /* ignore hook errors during shutdown */
      }
    }

    if (this.app) {
      try {
        await this.app.stop();
      } catch {
        /* ignore stop errors */
      }
    }

    if (hooks?.afterStop) {
      try {
        await hooks.afterStop();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Returns the resolved HTTP port (useful for pool instances on offset ports).
   */
  getPort(): number | null {
    return this.port;
  }

  /**
   * Returns the app name from the loaded definition.
   */
  getName(): string | null {
    return this.definition?.name ?? null;
  }

  /**
   * Returns metadata of all @Service-exposed services on this process's Netron.
   * Used by orchestrator to auto-discover pool service methods for ServiceRouter.
   */
  getExposedServices(): Array<{ name: string; version?: string; methods: string[] }> {
    if (!this.app?.netron) return [];
    return this.app.netron.getServiceMetadata();
  }

  /**
   * Connect to daemon's Netron and queryInterface() for sibling services.
   *
   * Uses the Application's own Netron instance (this.app.netron) to connect
   * to the daemon's Unix socket — no separate Netron instance needed.
   * Application.stop() handles disconnection automatically.
   */
  private async injectTopologyProxies(
    serviceNames: string[],
    daemonSocketUrl: string
  ): Promise<void> {
    if (!this.app?.netron) return;

    const { UnixSocketTransport } = await import('@omnitron-dev/titan/netron/transport/unix');

    // Register Unix transport on the app's Netron for outgoing client connections
    this.app.netron.registerTransport('unix', () => new UnixSocketTransport());

    // Connect with timeout — fail fast if daemon socket is unavailable
    const connectTimeout = 10_000;
    const daemonPeer = await Promise.race([
      this.app.netron.connect(daemonSocketUrl),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Daemon socket connection timeout (${connectTimeout}ms): ${daemonSocketUrl}`)), connectTimeout)
      ),
    ]);

    for (const serviceName of serviceNames) {
      try {
        const proxy = await daemonPeer.queryInterface(serviceName);
        // Register under topology:{ServiceName} — consumers inject via
        // createToken('topology:OhlcvAggregatorWorker')
        const token = createToken(`${TOPOLOGY_TOKEN_PREFIX}${serviceName}`);
        this.app.container.register(token, { useValue: proxy } as any);
      } catch (err) {
        const entry = JSON.stringify({
          level: 40,
          time: new Date().toISOString(),
          pid: process.pid,
          msg: `[topology] Failed to query service '${serviceName}' from daemon: ${(err as Error).message}`,
        });
        process.stderr.write(entry + '\n');

        // Register an error-throwing proxy so callers get a clear error at call-time
        // instead of a cryptic "token not found" DI error.
        const errorProxy = new Proxy({}, {
          get: (_target, prop) => {
            if (typeof prop === 'symbol' || prop === 'then') return undefined;
            return () => { throw new Error(`Topology service '${serviceName}' unavailable: ${(err as Error).message}`); };
          },
        });
        const token = createToken(`${TOPOLOGY_TOKEN_PREFIX}${serviceName}`);
        this.app!.container.register(token, { useValue: errorProxy } as any);
      }
    }
  }
}

export default BootstrapProcess;
