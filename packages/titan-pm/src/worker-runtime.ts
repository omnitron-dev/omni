/**
 * Worker Runtime Implementation - File-based Architecture
 *
 * This runtime executes in spawned processes and loads process classes
 * from their default exports. Integrates with Netron for RPC.
 */

import 'reflect-metadata';
import { parentPort as _workerParentPort, workerData as _workerData } from 'worker_threads';
import { getHeapStatistics } from 'v8';
import pino, { Logger as PinoLogger } from 'pino';
import { Netron } from '@omnitron-dev/titan/netron';
import { Errors } from '@omnitron-dev/titan/errors';
import type { ILogger, LogLevel } from '@omnitron-dev/titan/module/logger';
import { MetricsCollector, MetricsRegistry } from '@omnitron-dev/titan-metrics';
import type { MetricSample } from '@omnitron-dev/titan-metrics';

// Worker configuration from parent
interface WorkerConfig {
  processId: string;
  processPath: string; // Path to the process file
  transport: {
    type: 'tcp' | 'unix' | 'ws';
    host?: string;
    port?: number;
    path?: string;
    url?: string;
  };
  options?: any;
  dependencies?: Record<string, any>;
}

// In worker_threads mode, parentPort/workerData come from the module.
// In child_process (fork) mode, fork-worker.ts sets them as globals.
const parentPort = _workerParentPort ?? (globalThis as any).parentPort ?? null;
const workerData = _workerData ?? (globalThis as any).workerData ?? null;

const config = workerData as WorkerConfig;

/**
 * Create an ILogger-compatible wrapper around a pino instance.
 */
function createLoggerFromPino(pinoInstance: PinoLogger): ILogger {
  return {
    trace: (objOrMsg: any, ...args: any[]) => pinoInstance.trace(objOrMsg, ...args),
    debug: (objOrMsg: any, ...args: any[]) => pinoInstance.debug(objOrMsg, ...args),
    info: (objOrMsg: any, ...args: any[]) => pinoInstance.info(objOrMsg, ...args),
    warn: (objOrMsg: any, ...args: any[]) => pinoInstance.warn(objOrMsg, ...args),
    error: (objOrMsg: any, ...args: any[]) => pinoInstance.error(objOrMsg, ...args),
    fatal: (objOrMsg: any, ...args: any[]) => pinoInstance.fatal(objOrMsg, ...args),
    child: (bindings: object) => createLoggerFromPino(pinoInstance.child(bindings)),
    time: (label?: string) => {
      const start = Date.now();
      return () => pinoInstance.info({ duration: Date.now() - start, label }, 'Timer completed');
    },
    isLevelEnabled: (level: LogLevel) => pinoInstance.isLevelEnabled(level),
    setLevel: (level: LogLevel) => {
      pinoInstance.level = level;
    },
    getLevel: () => pinoInstance.level as LogLevel,
  };
}

// Optional logger for worker runtime
let logger: ILogger | undefined;

// ---------------------------------------------------------------------------
// RPC Metrics Instrumentation — shared by module and legacy paths
// ---------------------------------------------------------------------------

/**
 * Define standard RPC metrics on a registry so counters/histograms route correctly.
 */
function defineRpcMetrics(registry: MetricsRegistry): void {
  registry.define({ name: 'rpc_requests_total', type: 'counter', help: 'Total RPC requests' });
  registry.define({ name: 'rpc_errors_total', type: 'counter', help: 'Total RPC errors' });
  registry.define({ name: 'rpc_request_duration_seconds', type: 'histogram', help: 'RPC request duration in seconds' });
}

/**
 * Create an instrumented wrapper for a service method that records RPC metrics.
 *
 * Feeds two data paths:
 * 1. Rich MetricSample[] into collector's drain buffer → daemon querySeries (time-series charts)
 * 2. Aggregate counters in state → __getProcessMetrics snapshot (gauge cards)
 *
 * The `enabled` ref allows runtime toggle with zero overhead when disabled.
 */
function createInstrumentedMethod(
  original: Function,
  methodName: string,
  target: object,
  state: { requestCount: number; errorCount: number },
  collector: MetricsCollector,
  appName: string,
  enabled: { value: boolean },
): (...args: any[]) => Promise<any> {
  return async (...args: any[]) => {
    if (!enabled.value) return original.apply(target, args);

    const start = performance.now();
    try {
      const result = await original.apply(target, args);
      const dur = (performance.now() - start) / 1_000;
      const now = Date.now();
      collector.record({ name: 'rpc_requests_total', value: 1, timestamp: now, labels: { app: appName, method: methodName, status: 'success' } });
      collector.record({ name: 'rpc_request_duration_seconds', value: dur, timestamp: now, labels: { app: appName, method: methodName } });
      state.requestCount++;
      return result;
    } catch (err: any) {
      const dur = (performance.now() - start) / 1_000;
      const now = Date.now();
      collector.record({ name: 'rpc_requests_total', value: 1, timestamp: now, labels: { app: appName, method: methodName, status: 'error' } });
      collector.record({ name: 'rpc_errors_total', value: 1, timestamp: now, labels: { app: appName, method: methodName, error: err?.constructor?.name ?? 'Error' } });
      collector.record({ name: 'rpc_request_duration_seconds', value: dur, timestamp: now, labels: { app: appName, method: methodName } });
      state.requestCount++;
      state.errorCount++;
      throw err;
    }
  };
}

/**
 * Initialize a module-based worker — full Titan DI via Application.create().
 *
 * The module's exported @Service is discovered and exposed on a PM management
 * Netron instance. Health checks, metrics, and shutdown are handled by the
 * Titan Application lifecycle.
 *
 * This eliminates the need for manual Redis/PG/Logger setup in workers.
 */
async function initializeModuleWorker(ModuleClass: any, workerConfig: WorkerConfig): Promise<void> {
  // Dynamic import — titan is an optional dependency (zero coupling)
  const { Application } = await import('@omnitron-dev/titan');

  const processName = workerConfig.options?.name || ModuleClass.name || 'worker';
  const processVersion = workerConfig.options?.version || '1.0.0';

  // Create full Titan Application with worker's @Module
  const app = await Application.create(ModuleClass, {
    name: processName,
    version: processVersion,
  });

  // Register PM management transport on Application's Netron BEFORE app.start().
  // app.start() calls netron.start() which starts all registered transport servers.
  // Single Netron instance serves both PM management plane and app data plane.
  const transportUrl = workerConfig.transport.url || '';
  if (app.netron) {
    const tt = workerConfig.transport.type;
    if (tt === 'unix') {
      const { UnixSocketTransport } = await import('@omnitron-dev/titan/netron/transport/unix');
      app.netron.registerTransport('unix', () => new UnixSocketTransport());
    } else if (tt === 'tcp') {
      const { TcpTransport } = await import('@omnitron-dev/titan/netron/transport/tcp');
      app.netron.registerTransport('tcp', () => new TcpTransport());
    } else if (tt === 'ws') {
      const { WebSocketTransport } = await import('@omnitron-dev/titan/netron/transport/websocket');
      app.netron.registerTransport('ws', () => new WebSocketTransport());
    }

    const serverOptions: Record<string, unknown> = {};
    if (workerConfig.transport.host) serverOptions['host'] = workerConfig.transport.host;
    if (workerConfig.transport.port) serverOptions['port'] = workerConfig.transport.port;
    if (workerConfig.transport.path) serverOptions['path'] = workerConfig.transport.path;

    app.netron.registerTransportServer(tt, { name: tt, options: serverOptions });
  }

  // Start the application — resolves all DI, connects Redis/PG/etc., starts Netron
  await app.start();

  // Discover the @Service-decorated provider for Netron RPC exposure
  const SERVICE_METADATA_KEY = Symbol.for('netron:service');
  const workerService = discoverWorkerService(app, SERVICE_METADATA_KEY);
  const serviceName = Reflect.getMetadata(SERVICE_METADATA_KEY, workerService.constructor)?.name ?? processName;

  const workerPino = pino({
    level: workerConfig.options?.logLevel || 'info',
    base: { pid: process.pid, processId: workerConfig.processId, processName },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    serializers: pino.stdSerializers,
  });
  const pmLogger = createLoggerFromPino(workerPino);
  logger = pmLogger;

  const netron = app.netron!;

  // Child-local MetricsCollector — produces rich MetricSample[] for parent to drain
  const childRegistry = new MetricsRegistry();
  defineRpcMetrics(childRegistry);
  const childCollector = new MetricsCollector(childRegistry, processName, {
    enabled: true,
    interval: 5_000,
    process: true,
    system: false,
    rpc: true,
    custom: true,
  }, null);
  childCollector.start();

  // RPC instrumentation state — aggregate counters for snapshot + runtime toggle
  const rpcState = { requestCount: 0, errorCount: 0 };
  const metricsEnabled = { value: true };

  // Build service wrapper: public methods from @Service + PM internal methods
  const serviceWrapper: any = {};
  const proto = Object.getPrototypeOf(workerService);

  // Expose all non-private methods with automatic RPC instrumentation
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor' || name.startsWith('_')) continue;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') continue;

    serviceWrapper[name] = createInstrumentedMethod(
      desc.value, name, workerService, rpcState, childCollector, processName, metricsEnabled,
    );
  }

  const { getHeapStatistics: getHeap } = await import('v8');

  // PM internal: metrics — process stats with real RPC counters
  serviceWrapper.__getProcessMetrics = async () => {
    const cpu = process.cpuUsage();
    const mem = process.memoryUsage();
    const heap = getHeap();
    return {
      cpu: (cpu.user + cpu.system) / 1_000_000,
      memory: mem.heapUsed,
      memoryRss: mem.rss,
      memoryExternal: mem.external,
      heapLimit: heap.heap_size_limit,
      heapUsedRatio: mem.heapUsed / heap.heap_size_limit,
      requests: rpcState.requestCount,
      errors: rpcState.errorCount,
      uptime: process.uptime(),
      latency: { last: 0 },
    };
  };

  // PM internal: drain rich MetricSample[] (push-via-pull pattern)
  serviceWrapper.__drainMetrics = async (): Promise<MetricSample[]> => {
    return childCollector.drain();
  };

  // PM internal: runtime metrics toggle
  serviceWrapper.__setMetricsEnabled = async (data: { enabled: boolean }) => {
    metricsEnabled.value = data.enabled;
    if (data.enabled) childCollector.start(); else childCollector.stop();
    return { enabled: metricsEnabled.value };
  };

  // PM internal: health — delegates to service.checkHealth() if present
  serviceWrapper.__getProcessHealth = async () => {
    if (typeof workerService.checkHealth === 'function') {
      try {
        const result = await workerService.checkHealth();
        return {
          status: result?.status ?? 'healthy',
          checks: result?.checks ?? [],
          timestamp: Date.now(),
        };
      } catch (err: any) {
        return { status: 'unhealthy', checks: [{ name: 'checkHealth', status: 'fail', message: err.message }], timestamp: Date.now() };
      }
    }
    return { status: 'healthy', checks: [], timestamp: Date.now() };
  };

  // PM internal: shutdown — Application.stop() handles Netron shutdown automatically
  serviceWrapper.__shutdown = async () => {
    childCollector.stop();
    try { await app.stop(); } catch { /* best-effort */ }
    process.exit(0);
  };

  // Register PM management service on Application's Netron
  class ServiceWrapperClass {}
  Object.assign(ServiceWrapperClass.prototype, serviceWrapper);
  const wrapperInstance = Object.create(ServiceWrapperClass.prototype);
  Object.assign(wrapperInstance, serviceWrapper);

  const methods: Record<string, { type: string; arguments: unknown[] }> = {};
  for (const key of Object.keys(serviceWrapper)) {
    if (typeof serviceWrapper[key] === 'function') {
      methods[key] = { type: 'void', arguments: [] };
    }
  }

  Reflect.defineMetadata('netron:service', { name: serviceName, version: processVersion, methods, properties: {} }, ServiceWrapperClass);
  await netron.peer.exposeService(wrapperInstance);

  // Signal ready
  parentPort?.postMessage({ type: 'ready', processId: workerConfig.processId, transportUrl, serviceName, serviceVersion: processVersion });

  // Listen for shutdown — Application handles SIGTERM/SIGINT via setupSignalHandlers()
  parentPort?.on('message', async (msg: any) => { if (msg.type === 'shutdown') await serviceWrapper.__shutdown(); });

  pmLogger.info({ processId: workerConfig.processId, serviceName, serviceVersion: processVersion, transportUrl, mode: 'module' }, 'Module worker initialized');
}

/**
 * Discover the @Service-decorated class from a Titan Application container.
 * Scans module exports for the first provider with netron:service metadata.
 */
function discoverWorkerService(app: any, serviceMetadataKey: symbol): any {
  const container = app.container;

  // Walk the container registrations to find @Service-decorated classes
  const registrations = container.getRegistrations?.() ?? [];
  for (const [token] of registrations) {
    try {
      const instance = container.resolve(token);
      if (instance && instance.constructor && Reflect.getMetadata(serviceMetadataKey, instance.constructor)) {
        return instance;
      }
    } catch {
      // Skip unresolvable tokens
    }
  }

  // Fallback: try resolving known service patterns
  throw new Error(
    `Worker module must export at least one @Service-decorated class. ` +
    `Ensure your worker module has a provider with @Service() decorator in its exports.`
  );
}

/**
 * Initialize the worker process
 */
async function initialize() {
  try {
    // Dynamic import of the process module
    const ProcessModule = await import(config.processPath);

    // Get the default export (process class or module)
    const ProcessClass = ProcessModule.default;

    if (!ProcessClass) {
      throw Errors.notFound('Default export', config.processPath);
    }

    // Detect if the export is a Titan @Module (has MODULE_METADATA_KEY)
    // vs a legacy @Process class. @Module workers get full Titan DI via Application.create().
    // Detect @Module: Titan uses 'nexus:module' metadata key (set by @Module decorator)
    const isModule = !!Reflect.getMetadata('nexus:module', ProcessClass);

    if (isModule) {
      await initializeModuleWorker(ProcessClass, config);
      return;
    }

    // Legacy @Process path — bare constructor + init()
    const processInstance = new ProcessClass();

    if (typeof processInstance.init === 'function') {
      await processInstance.init(config.dependencies ?? {});
    }

    // Get process metadata if available
    const PROCESS_METADATA_KEY = Symbol.for('process:metadata');
    const processMetadata = Reflect.getMetadata(PROCESS_METADATA_KEY, ProcessClass) || {};

    const serviceName = processMetadata.name || ProcessClass.name || 'UnnamedService';
    const serviceVersion = processMetadata.version || '1.0.0';

    // Initialize Netron for this process
    const netronOptions: any = {
      id: config.processId,
      allowServiceEvents: true,
    };

    const workerPino = pino({
      level: config.options?.logLevel || 'info',
      base: {
        pid: process.pid,
        processId: config.processId,
        processName: config.options?.name || 'worker',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      messageKey: 'msg',
      serializers: pino.stdSerializers,
    });

    logger = createLoggerFromPino(workerPino);

    const netron = new Netron(logger!, netronOptions);

    // Register transport server BEFORE netron.start() so that startTransportServer()
    // properly wires up the handshake protocol (ID exchange + peer.init()).
    const transportUrl = config.transport.url || '';
    {
      const transportType = config.transport.type;

      // Register transport factory with this netron instance
      if (transportType === 'unix') {
        const { UnixSocketTransport } = await import('@omnitron-dev/titan/netron/transport/unix');
        netron.registerTransport('unix', () => new UnixSocketTransport());
      } else if (transportType === 'tcp') {
        const { TcpTransport } = await import('@omnitron-dev/titan/netron/transport/tcp');
        netron.registerTransport('tcp', () => new TcpTransport());
      } else if (transportType === 'ws') {
        const { WebSocketTransport } = await import('@omnitron-dev/titan/netron/transport/websocket');
        netron.registerTransport('ws', () => new WebSocketTransport());
      }

      // Register transport server config — netron.start() will call startTransportServer()
      const serverOptions: Record<string, unknown> = {};
      if (config.transport.host) serverOptions['host'] = config.transport.host;
      if (config.transport.port) serverOptions['port'] = config.transport.port;
      if (config.transport.path) serverOptions['path'] = config.transport.path;

      netron.registerTransportServer(transportType, {
        name: transportType,
        options: serverOptions,
      });
    }

    // Start Netron — this starts the transport server with proper handshake wiring
    await netron.start();

    // Child-local MetricsCollector — produces rich MetricSample[] for parent to drain
    const legacyProcessName = config.options?.name || 'worker';
    const legacyChildRegistry = new MetricsRegistry();
    defineRpcMetrics(legacyChildRegistry);
    const legacyChildCollector = new MetricsCollector(legacyChildRegistry, legacyProcessName, {
      enabled: true,
      interval: 5_000,
      process: true,
      system: false,
      rpc: true,
      custom: true,
    }, null);
    legacyChildCollector.start();

    // RPC instrumentation state — aggregate counters + runtime toggle
    const legacyRpcState = { requestCount: 0, errorCount: 0 };
    const legacyMetricsEnabled = { value: true };

    // Create service wrapper with public methods
    const serviceWrapper: any = {
      __instance: processInstance,
    };

    // Get process method metadata and expose public methods with instrumentation
    const PROCESS_METHOD_METADATA_KEY = Symbol.for('process:method:metadata');
    const prototype = Object.getPrototypeOf(processInstance);
    const propertyNames = Object.getOwnPropertyNames(prototype);

    for (const propertyName of propertyNames) {
      if (propertyName === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      // Check if method is marked as public
      const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
      if (metadata?.public) {
        serviceWrapper[propertyName] = createInstrumentedMethod(
          descriptor.value, propertyName, processInstance,
          legacyRpcState, legacyChildCollector, legacyProcessName, legacyMetricsEnabled,
        );
      }
    }

    // If allMethodsPublic is enabled (via @Process decorator or spawn options),
    // expose all remaining public methods
    const allPublic = processMetadata.allMethodsPublic || config.options?.allMethodsPublic;
    if (allPublic) {
      for (const propertyName of propertyNames) {
        if (propertyName === 'constructor') continue;
        if (propertyName.startsWith('_')) continue; // Skip private by convention
        if (serviceWrapper[propertyName]) continue; // Already exposed

        const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
        if (!descriptor || typeof descriptor.value !== 'function') continue;

        serviceWrapper[propertyName] = createInstrumentedMethod(
          descriptor.value, propertyName, processInstance,
          legacyRpcState, legacyChildCollector, legacyProcessName, legacyMetricsEnabled,
        );
      }
    }

    // Memory monitoring state for graceful degradation
    let memoryWarningEmitted = false;
    const MEMORY_WARNING_THRESHOLD = 0.8; // 80% of max heap
    const MEMORY_CRITICAL_THRESHOLD = 0.95; // 95% of max heap

    // PM internal: metrics — process stats with real RPC counters
    serviceWrapper.__getProcessMetrics = async () => {
      const usage = process.cpuUsage();
      const memUsage = process.memoryUsage();
      const v8HeapStats = getHeapStatistics();

      // Calculate memory pressure
      const heapUsedRatio = memUsage.heapUsed / v8HeapStats.heap_size_limit;

      // Emit memory warnings for proactive management
      if (heapUsedRatio > MEMORY_CRITICAL_THRESHOLD && !memoryWarningEmitted) {
        memoryWarningEmitted = true;
        parentPort?.postMessage({
          type: 'memory_critical',
          processId: config.processId,
          heapUsed: memUsage.heapUsed,
          heapLimit: v8HeapStats.heap_size_limit,
          ratio: heapUsedRatio,
        });

        // Attempt to trigger GC if available (V8 flag --expose-gc required)
        if (global.gc) {
          global.gc();
        }
      } else if (heapUsedRatio > MEMORY_WARNING_THRESHOLD && !memoryWarningEmitted) {
        parentPort?.postMessage({
          type: 'memory_warning',
          processId: config.processId,
          heapUsed: memUsage.heapUsed,
          heapLimit: v8HeapStats.heap_size_limit,
          ratio: heapUsedRatio,
        });
      } else if (heapUsedRatio < MEMORY_WARNING_THRESHOLD * 0.9) {
        memoryWarningEmitted = false; // Reset warning flag when memory is back to normal
      }

      return {
        cpu: (usage.user + usage.system) / 1000000, // Convert to seconds
        memory: memUsage.heapUsed,
        memoryRss: memUsage.rss,
        memoryExternal: memUsage.external,
        heapLimit: v8HeapStats.heap_size_limit,
        heapUsedRatio,
        requests: legacyRpcState.requestCount,
        errors: legacyRpcState.errorCount,
        uptime: process.uptime(),
        latency: { last: 0 },
      };
    };

    // PM internal: drain rich MetricSample[] (push-via-pull pattern)
    serviceWrapper.__drainMetrics = async (): Promise<MetricSample[]> => {
      return legacyChildCollector.drain();
    };

    // PM internal: runtime metrics toggle
    serviceWrapper.__setMetricsEnabled = async (data: { enabled: boolean }) => {
      legacyMetricsEnabled.value = data.enabled;
      if (data.enabled) legacyChildCollector.start(); else legacyChildCollector.stop();
      return { enabled: legacyMetricsEnabled.value };
    };

    serviceWrapper.__getProcessHealth = async () => {
      // Look for method decorated with @HealthCheck
      const healthCheckMethods = [];

      for (const propertyName of propertyNames) {
        const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
        if (metadata?.healthCheck) {
          healthCheckMethods.push(propertyName);
        }
      }

      // Call health check methods
      const checks = [];
      let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

      for (const methodName of healthCheckMethods) {
        try {
          const result = await (processInstance as any)[methodName]();
          if (result) {
            if (result.status === 'unhealthy') overallStatus = 'unhealthy';
            else if (result.status === 'degraded' && overallStatus === 'healthy') {
              overallStatus = 'degraded';
            }
            checks.push({
              name: methodName,
              status:
                result.status === 'unhealthy'
                  ? ('fail' as const)
                  : result.status === 'degraded'
                    ? ('warn' as const)
                    : ('pass' as const),
              message: result.message,
            });
          }
        } catch (error: any) {
          overallStatus = 'unhealthy';
          checks.push({
            name: methodName,
            status: 'fail' as const,
            message: error.message,
          });
        }
      }

      return {
        status: overallStatus,
        checks,
        timestamp: Date.now(),
      };
    };

    serviceWrapper.__shutdown = async () => {
      legacyChildCollector.stop();
      // Look for methods decorated with @OnShutdown
      for (const propertyName of propertyNames) {
        const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
        if (metadata?.onShutdown) {
          try {
            await (processInstance as any)[propertyName]();
          } catch (error: any) {
            logger?.error({ err: error, method: propertyName }, 'Error during shutdown');
          }
        }
      }

      await netron.stop();
      process.exit(0);
    };

    // Apply service metadata to wrapper's constructor for Netron.
    // getServiceMetadata reads from instance.constructor, so we need a proper class.
    class ServiceWrapperClass {}
    Object.assign(ServiceWrapperClass.prototype, serviceWrapper);
    const wrapperInstance = Object.create(ServiceWrapperClass.prototype);
    Object.assign(wrapperInstance, serviceWrapper);

    // Build methods map from all exposed functions on the serviceWrapper.
    // Netron's Interface proxy requires meta.methods to be a valid object with
    // entries for every callable method — without this, queryInterface fails with
    // "Cannot read properties of undefined (reading 'then')" because the proxy
    // handler tries to access meta.methods[prop] on a meta that has no methods field.
    const methods: Record<string, { type: string; arguments: unknown[] }> = {};
    for (const key of Object.keys(serviceWrapper)) {
      if (typeof serviceWrapper[key] === 'function') {
        methods[key] = { type: 'void', arguments: [] };
      }
    }

    Reflect.defineMetadata(
      'netron:service',
      {
        name: serviceName,
        version: serviceVersion,
        methods,
        properties: {},
      },
      ServiceWrapperClass
    );

    // Expose the service via Netron
    await netron.peer.exposeService(wrapperInstance);

    // Notify parent that we're ready
    parentPort?.postMessage({
      type: 'ready',
      processId: config.processId,
      transportUrl,
      serviceName,
      serviceVersion,
    });

    // Listen for parent messages
    parentPort?.on('message', async (message: any) => {
      if (message.type === 'shutdown') {
        await serviceWrapper.__shutdown();
      }
    });

    // Handle process termination
    process.on('SIGTERM', async () => {
      await serviceWrapper.__shutdown();
    });

    process.on('SIGINT', async () => {
      await serviceWrapper.__shutdown();
    });

    // Log successful initialization
    logger?.info({ processId: config.processId, serviceName, serviceVersion, transportUrl }, 'Process initialized');
  } catch (error: any) {
    logger?.error({ err: error, processId: config.processId }, 'Worker initialization failed');

    // Notify parent of failure
    parentPort?.postMessage({
      type: 'error',
      processId: config.processId,
      error: {
        message: error.message,
        stack: error.stack,
      },
    });

    // Exit with error code
    process.exit(1);
  }
}

// Start initialization
initialize().catch((error) => {
  logger?.error({ err: error }, 'Failed to initialize worker');
  process.exit(1);
});
