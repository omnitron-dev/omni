/**
 * Worker Runtime Implementation - File-based Architecture
 *
 * This runtime executes in spawned processes and loads process classes
 * from their default exports. Integrates with Netron for RPC.
 */

import 'reflect-metadata';
import { parentPort, workerData } from 'worker_threads';
import { Netron } from '../../netron/index.js';

// Worker configuration from parent
interface WorkerConfig {
  processId: string;
  processPath: string;  // Path to the process file
  transport: {
    type: 'tcp' | 'unix' | 'ws' | 'ipc';
    host?: string;
    port?: number;
    path?: string;
    url?: string;
  };
  options?: any;
  dependencies?: Record<string, any>;
}

const config = workerData as WorkerConfig;

/**
 * Initialize the worker process
 */
async function initialize() {
  try {
    // Dynamic import of the process module
    const ProcessModule = await import(config.processPath);

    // Get the default export (process class)
    const ProcessClass = ProcessModule.default;

    if (!ProcessClass) {
      throw new Error(`No default export found in ${config.processPath}`);
    }

    // Create process instance
    const processInstance = new ProcessClass();

    // Initialize dependencies if provided
    if (config.dependencies && typeof processInstance.init === 'function') {
      await processInstance.init(...Object.values(config.dependencies));
    }

    // Get process metadata if available
    const PROCESS_METADATA_KEY = Symbol.for('process:metadata');
    const processMetadata = Reflect.getMetadata(PROCESS_METADATA_KEY, ProcessClass) || {};

    const serviceName = processMetadata.name || ProcessClass.name || 'UnnamedService';
    const serviceVersion = processMetadata.version || '1.0.0';

    // Initialize Netron for this process
    const netronOptions: any = {
      id: config.processId,
      allowServiceEvents: true
    };

    const netron = new Netron(console as any, netronOptions);

    // Start Netron
    await netron.start();

    // Create service wrapper with public methods
    const serviceWrapper: any = {
      __instance: processInstance
    };

    // Get process method metadata and expose public methods
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
        // Wrap method to track metrics
        const originalMethod = descriptor.value;
        serviceWrapper[propertyName] = async function (...args: any[]) {
          const startTime = Date.now();
          try {
            const result = await originalMethod.apply(processInstance, args);
            // Track success metrics
            (processInstance as any).__requestCount = ((processInstance as any).__requestCount || 0) + 1;
            return result;
          } catch (error) {
            // Track error metrics
            (processInstance as any).__errorCount = ((processInstance as any).__errorCount || 0) + 1;
            throw error;
          } finally {
            // Track latency
            const duration = Date.now() - startTime;
            (processInstance as any).__lastLatency = duration;
          }
        };
      }
    }

    // Add internal methods for health and metrics
    serviceWrapper.__getProcessMetrics = async () => {
      const usage = process.cpuUsage();
      return {
        cpu: (usage.user + usage.system) / 1000000, // Convert to seconds
        memory: process.memoryUsage().heapUsed,
        requests: (processInstance as any).__requestCount || 0,
        errors: (processInstance as any).__errorCount || 0,
        uptime: process.uptime(),
        latency: {
          last: (processInstance as any).__lastLatency || 0
        }
      };
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
            return result; // Return first health check result
          }
        } catch (error: any) {
          overallStatus = 'unhealthy';
          checks.push({
            name: methodName,
            status: 'fail' as const,
            message: error.message
          });
        }
      }

      return {
        status: overallStatus,
        checks,
        timestamp: Date.now()
      };
    };

    serviceWrapper.__shutdown = async () => {
      // Look for methods decorated with @OnShutdown
      for (const propertyName of propertyNames) {
        const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
        if (metadata?.onShutdown) {
          try {
            await (processInstance as any)[propertyName]();
          } catch (error: any) {
            console.error(`Error during shutdown: ${error.message}`);
          }
        }
      }

      await netron.stop();
      process.exit(0);
    };

    // Apply service metadata to wrapper for Netron
    Reflect.defineMetadata('netron:service', {
      name: serviceName,
      version: serviceVersion
    }, serviceWrapper);

    // Expose the service via Netron
    await netron.peer.exposeService(serviceWrapper);

    // Setup transport server based on configuration
    const transportUrl = config.transport.url || '';

    if (config.transport.type !== 'ipc') {
      const { getTransportForAddress } = await import('../../netron/transport/index.js');
      const transport = getTransportForAddress(transportUrl);

      if (!transport) {
        throw new Error(`No transport available for URL: ${transportUrl}`);
      }

      // Create server if transport supports it
      if (transport.createServer) {
        const serverOptions: any = {};

        if (config.transport.host) serverOptions.host = config.transport.host;
        if (config.transport.port) serverOptions.port = config.transport.port;
        if (config.transport.path) serverOptions.path = config.transport.path;

        const server = await transport.createServer(serverOptions);

        // Start listening
        await server.listen();

        // Store reference
        (netron as any).transportServer = server;
      }
    }

    // Notify parent that we're ready
    parentPort?.postMessage({
      type: 'ready',
      processId: config.processId,
      transportUrl,
      serviceName,
      serviceVersion
    });

    // Listen for parent messages
    parentPort?.on('message', async (message) => {
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
    console.log(`Process ${config.processId} (${serviceName}@${serviceVersion}) initialized at ${transportUrl}`);

  } catch (error: any) {
    console.error('Worker initialization failed:', error);

    // Notify parent of failure
    parentPort?.postMessage({
      type: 'error',
      processId: config.processId,
      error: {
        message: error.message,
        stack: error.stack
      }
    });

    // Exit with error code
    process.exit(1);
  }
}

// Start initialization
initialize().catch(error => {
  console.error('Failed to initialize worker:', error);
  process.exit(1);
});