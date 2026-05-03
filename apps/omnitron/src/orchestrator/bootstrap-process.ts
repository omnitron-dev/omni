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

    // ────────────────────────────────────────────────────────────────────
    // Container identity guard.
    //
    // Daemon imports `@omnitron-dev/titan` from its own pnpm peer-dep tree.
    // App's bundled module imports `@omnitron-dev/titan-scheduler` etc. that
    // transitively import `@omnitron-dev/titan/nexus` from the **app's**
    // pnpm tree. If those resolve to different physical files (e.g. demon
    // running from local omni source while app uses npm-published 0.1.3),
    // the `Container` class identity differs → `Inject(Container)` cannot
    // find the auto-registered token and module init fails with the cryptic
    // "Dependency 'Container' not found".
    //
    // Detect this BEFORE Application.create() to surface a clear, actionable
    // error instead of letting Application.start() blow up on every module
    // that injects Container.
    // ────────────────────────────────────────────────────────────────────
    const moduleResolveDir = path.dirname(modulePath);
    await this.assertContainerIdentity(moduleResolveDir);
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

  /**
   * Verify that `Container` class imported by Titan modules in the app's
   * dependency tree (titan-scheduler, titan-events, etc.) has the same
   * physical identity as the daemon's `Container` class.
   *
   * The daemon resolves `@omnitron-dev/titan` from its own pnpm tree and
   * uses that to construct `Application` (which auto-registers itself as
   * the `Container` token). The app's bundled module imports titan-scheduler
   * (etc.), which transitively imports `@omnitron-dev/titan/nexus`. If those
   * two paths resolve to different physical files (e.g. monorepo dev vs
   * published version), `Container` becomes two distinct classes —
   * `Inject(Container)` then cannot find the auto-registered token and
   * every consumer fails with the misleading "Dependency 'Container' not
   * found" during module initialization.
   *
   * We detect this **before** Application.create() by resolving titan from
   * both contexts (daemon-side via static import, app-side via dynamic
   * import using the module's directory as the resolution base) and
   * comparing the realpath. On mismatch we throw a self-explanatory error.
   *
   * Resolution is best-effort: if the app does not depend on titan
   * transitively (rare for a Titan @Module bundle), we skip silently.
   */
  private async assertContainerIdentity(moduleResolveDir: string): Promise<void> {
    const { realpathSync } = await import('node:fs');
    const { createRequire } = await import('node:module');

    // Daemon-side titan path — resolved at omnitron's pnpm peer-dep level.
    let daemonTitanPath: string;
    try {
      const titan = await import('@omnitron-dev/titan/nexus');
      // The Container class file URL → physical path. Container is exported
      // from packages/titan/dist/nexus/index.js which re-exports from
      // ./container.js — both share the same titan dist directory.
      daemonTitanPath = realpathSync(new URL(import.meta.url).pathname);
      // Walk up from bootstrap-process.js to find titan's installed location.
      void titan; // ensure module is loaded
      // Resolve titan/package.json from this file's perspective.
      const daemonRequire = createRequire(import.meta.url);
      daemonTitanPath = realpathSync(daemonRequire.resolve('@omnitron-dev/titan/package.json'));
    } catch {
      // Daemon must have titan to even reach this code path; if not, abort guard.
      return;
    }

    // App-side titan path — resolved relative to the app's module bundle.
    // We use a require constructor anchored to the module's directory to
    // simulate Node's resolution as if from inside the app's dist.
    let appTitanPath: string | null = null;
    try {
      const moduleRequire = createRequire(`${moduleResolveDir}/`);
      appTitanPath = realpathSync(moduleRequire.resolve('@omnitron-dev/titan/package.json'));
    } catch {
      // App may not declare titan as a direct dependency (uses titan-scheduler/etc).
      // Try resolving via a known transitive: titan-scheduler → titan.
      try {
        const moduleRequire = createRequire(`${moduleResolveDir}/`);
        const schedPkg = moduleRequire.resolve('@omnitron-dev/titan-scheduler/package.json');
        const schedDir = realpathSync(schedPkg).replace(/[/\\]package\.json$/, '');
        const schedRequire = createRequire(`${schedDir}/`);
        appTitanPath = realpathSync(schedRequire.resolve('@omnitron-dev/titan/package.json'));
      } catch {
        // App truly does not depend on titan — nothing to compare.
        return;
      }
    }

    if (!appTitanPath || appTitanPath === daemonTitanPath) {
      return; // identities match (or could not be determined safely)
    }

    // Mismatch — produce a high-signal error.
    const msg =
      `Titan package identity mismatch detected between omnitron daemon and app '${this.definition?.name ?? '<unknown>'}'.\n\n` +
      `  Daemon resolves @omnitron-dev/titan from:\n    ${daemonTitanPath}\n\n` +
      `  App   resolves @omnitron-dev/titan from:\n    ${appTitanPath}\n\n` +
      `These are different physical installations, so the 'Container' class identity differs.\n` +
      `Provider injections like @Inject(Container) (used internally by titan-scheduler, titan-events,\n` +
      `etc.) will fail with the cryptic message "Dependency 'Container' not found".\n\n` +
      `How to fix:\n` +
      `  1. Ensure the daemon and the app are using the SAME @omnitron-dev/titan installation.\n` +
      `  2. If you are running omnitron from a local monorepo while the app installs published\n` +
      `     versions, add pnpm overrides in the app project's package.json:\n\n` +
      `       "pnpm": {\n` +
      `         "overrides": {\n` +
      `           "@omnitron-dev/titan": "link:<path-to-omni>/packages/titan",\n` +
      `           "@omnitron-dev/omnitron": "link:<path-to-omni>/apps/omnitron",\n` +
      `           "@omnitron-dev/titan-scheduler": "link:<path-to-omni>/packages/titan-scheduler",\n` +
      `           ...other @omnitron-dev/* packages used by the app\n` +
      `         }\n` +
      `       }\n\n` +
      `  3. After updating overrides run 'pnpm install' in the app project.`;
    throw new Error(msg);
  }
}

export default BootstrapProcess;
