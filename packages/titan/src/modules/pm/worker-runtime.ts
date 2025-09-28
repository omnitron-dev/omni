/**
 * Worker Runtime Implementation
 *
 * This is the actual runtime that executes in spawned processes.
 * It properly integrates with Netron for service exposure.
 */

import 'reflect-metadata';
import { parentPort, workerData } from 'worker_threads';
import { Netron } from '../../netron/index.js';

// Worker configuration from parent
interface WorkerConfig {
  processId: string;
  className: string;
  modulePath: string;
  netron: {
    id: string;
    transport: string;
    listenHost: string;
    listenPort: number;
    discoveryEnabled?: boolean;
  };
  serviceName?: string;
  version?: string;
  options?: any;
}

const config = workerData as WorkerConfig;

/**
 * Initialize the worker process
 */
async function initialize() {
  try {
    // Dynamic import of the module containing the process class
    const module = await import(config.modulePath);
    const ProcessClass = module[config.className];

    if (!ProcessClass) {
      throw new Error(`Class ${config.className} not found in module ${config.modulePath}`);
    }

    // Create process instance
    const processInstance = new ProcessClass();

    // Initialize Netron for this process
    const netronOptions: any = {
      id: config.netron.id,
      allowServiceEvents: true
    };

    const netron = new Netron(console as any, netronOptions);

    // Start Netron
    await netron.start();

    // Decorate the instance as a Service if not already
    const serviceName = config.serviceName || config.className;
    const serviceVersion = config.version || '1.0.0';

    // Check if instance already has service metadata
    const existingMeta = Reflect.getMetadata('netron:service', processInstance);
    if (!existingMeta) {
      // Apply Service decorator metadata manually
      Reflect.defineMetadata('netron:service', {
        name: serviceName,
        version: serviceVersion
      }, processInstance);
    }

    // Get process method metadata and create service wrapper
    const PROCESS_METHOD_METADATA_KEY = Symbol.for('process:method:metadata');
    const prototype = Object.getPrototypeOf(processInstance);
    const propertyNames = Object.getOwnPropertyNames(prototype);

    // Create a service wrapper with public methods
    const serviceWrapper: any = {
      __instance: processInstance
    };

    for (const propertyName of propertyNames) {
      if (propertyName === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      // Check if method is marked as public
      const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, propertyName);
      if (metadata?.public) {
        serviceWrapper[propertyName] = descriptor.value.bind(processInstance);
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
        uptime: process.uptime()
      };
    };

    serviceWrapper.__getProcessHealth = async () => {
      // Call checkHealth if it exists
      const healthMethod = (processInstance as any).checkHealth;
      if (typeof healthMethod === 'function') {
        try {
          return await healthMethod.call(processInstance);
        } catch (error: any) {
          return {
            status: 'unhealthy' as const,
            error: error.message,
            timestamp: Date.now()
          };
        }
      }

      return {
        status: 'healthy' as const,
        checks: [],
        timestamp: Date.now()
      };
    };

    serviceWrapper.__shutdown = async () => {
      // Call onShutdown if it exists
      const shutdownMethod = (processInstance as any).onShutdown;
      if (typeof shutdownMethod === 'function') {
        await shutdownMethod.call(processInstance);
      }
      await netron.stop();
      process.exit(0);
    };

    // Apply service metadata to wrapper
    Reflect.defineMetadata('netron:service', {
      name: serviceName,
      version: serviceVersion
    }, serviceWrapper);

    // Expose the service via Netron
    await netron.peer.exposeService(serviceWrapper);

    // Get transport URL based on configuration
    let transportUrl = '';
    switch (config.netron.transport) {
      case 'unix':
        transportUrl = `unix:///tmp/titan-pm-${config.processId}.sock`;
        break;
      case 'tcp':
        transportUrl = `tcp://${config.netron.listenHost}:${config.netron.listenPort}`;
        break;
      case 'websocket':
      case 'ws':
        transportUrl = `ws://${config.netron.listenHost}:${config.netron.listenPort}`;
        break;
      case 'http':
        transportUrl = `http://${config.netron.listenHost}:${config.netron.listenPort}`;
        break;
      default:
        transportUrl = `ws://${config.netron.listenHost}:${config.netron.listenPort}`;
    }

    // Setup transport server if needed
    if (config.netron.listenPort) {
      const { getTransportForAddress } = await import('../../netron/transport/index.js');
      const transport = getTransportForAddress(transportUrl);

      if (!transport) {
        throw new Error(`No transport available for URL: ${transportUrl}`);
      }

      // Create server if transport supports it
      if (transport.createServer) {
        const server = await transport.createServer({
          host: config.netron.listenHost,
          port: config.netron.listenPort
        });

        // Start listening
        await server.listen();

        // Store reference
        (netron as any).transportServer = server;

        // Server will handle connections internally through Netron's transport layer
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

    // Handle messages from parent
    parentPort?.on('message', async (message) => {
      switch (message.type) {
        case 'shutdown':
          await serviceWrapper.__shutdown();
          break;
        case 'ping':
          parentPort?.postMessage({ type: 'pong' });
          break;
      }
    });

    // Handle process termination
    process.on('SIGTERM', async () => {
      await serviceWrapper.__shutdown();
    });

    process.on('SIGINT', async () => {
      await serviceWrapper.__shutdown();
    });

  } catch (error: any) {
    console.error('Failed to initialize worker:', error);
    parentPort?.postMessage({
      type: 'error',
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Initialize the worker
initialize().catch((error) => {
  console.error('Worker initialization failed:', error);
  process.exit(1);
});