/**
 * Generic Worker Script for Process Manager
 *
 * This worker script is used by all spawned processes to:
 * - Load the process class dynamically
 * - Set up Netron service exposure
 * - Handle communication with the parent process
 */

import { parentPort, workerData } from 'worker_threads';
import { Netron, LocalPeer } from '../../netron/index.js';
import { Errors } from '../../errors/index.js';
import 'reflect-metadata';

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
    discoveryUrl?: string;
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
      throw Errors.notFound('Class', `${config.className} in module ${config.modulePath}`);
    }

    // Create process instance
    const processInstance = new ProcessClass();

    // Initialize Netron for this process
    const netron = new Netron(console as any, {
      id: config.netron.id,
      ...(config.netron.discoveryEnabled && config.netron.discoveryUrl
        ? { discoveryUrl: config.netron.discoveryUrl }
        : {}),
    });

    // Create local peer for service exposure
    const peer = new LocalPeer(netron);

    // Configure transport based on configuration
    let transportUrl = '';
    let transportName = 'ws'; // default
    const transportOptions: any = {
      host: config.netron.listenHost,
      port: config.netron.listenPort,
    };

    switch (config.netron.transport) {
      case 'unix':
        transportUrl = `unix:///tmp/titan-pm-${config.processId}.sock`;
        transportName = 'unix';
        transportOptions.path = transportUrl;
        break;
      case 'tcp':
        transportUrl = `tcp://${config.netron.listenHost}:${config.netron.listenPort}`;
        transportName = 'tcp';
        break;
      case 'http':
        transportUrl = `http://${config.netron.listenHost}:${config.netron.listenPort}`;
        transportName = 'http';
        break;
      case 'websocket':
      case 'ws':
        transportUrl = `ws://${config.netron.listenHost}:${config.netron.listenPort}`;
        transportName = 'ws';
        break;
      default:
        transportUrl = `ws://${config.netron.listenHost}:${config.netron.listenPort}`;
        transportName = 'ws';
    }

    // Register and start transport server through Netron
    // Note: Transports are typically registered during application setup
    // For worker processes, we'll register the server configuration
    netron.registerTransportServer(transportName, {
      name: transportName,
      options: transportOptions,
    });

    // Start the Netron instance (this will start all registered transport servers)
    await netron.start();

    // Get process metadata for method exposure
    const PROCESS_METHOD_METADATA_KEY = Symbol.for('process:method:metadata');
    const prototype = Object.getPrototypeOf(processInstance);
    const methodNames = Object.getOwnPropertyNames(prototype);

    // Create service interface from public methods
    const serviceInterface: any = {};

    for (const methodName of methodNames) {
      if (methodName === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      // Check if method is marked as public
      const metadata = Reflect.getMetadata(PROCESS_METHOD_METADATA_KEY, prototype, methodName);
      if (metadata?.public) {
        serviceInterface[methodName] = descriptor.value.bind(processInstance);
      }
    }

    // Add internal methods for health and metrics
    serviceInterface.__getProcessMetrics = async () => ({
      cpu: process.cpuUsage().user / 1000000,
      memory: process.memoryUsage().heapUsed,
      requests: (processInstance as any).__requestCount || 0,
      errors: (processInstance as any).__errorCount || 0,
      uptime: process.uptime(),
    });

    serviceInterface.__getProcessHealth = async () => {
      // Call checkHealth if it exists and is marked with @HealthCheck
      const healthMethod = (processInstance as any).checkHealth;
      if (typeof healthMethod === 'function') {
        try {
          return await healthMethod.call(processInstance);
        } catch (error: any) {
          return {
            status: 'unhealthy' as const,
            error: error.message,
            timestamp: Date.now(),
          };
        }
      }

      return {
        status: 'healthy' as const,
        checks: [],
        timestamp: Date.now(),
      };
    };

    serviceInterface.__shutdown = async () => {
      // Call onShutdown if it exists
      const shutdownMethod = (processInstance as any).onShutdown;
      if (typeof shutdownMethod === 'function') {
        await shutdownMethod.call(processInstance);
      }
      // Stop Netron and close all transports
      await netron.stop();
      process.exit(0);
    };

    // Expose the service via Netron - the service interface needs to be decorated with @Service
    // For now, we'll create a simple service wrapper
    const ServiceClass = class {
      constructor() {
        Object.assign(this, serviceInterface);
      }
    };

    // Copy metadata from process class to service class
    const processMetadata = Reflect.getMetadata('netron:service', ProcessClass) || {};
    Reflect.defineMetadata(
      'netron:service',
      {
        ...processMetadata,
        name: config.serviceName || config.className,
        version: config.version || '1.0.0',
      },
      ServiceClass
    );

    // Create service instance and expose
    const service = new ServiceClass();
    await peer.exposeService(service);

    // Notify parent that we're ready
    parentPort?.postMessage({
      type: 'ready',
      processId: config.processId,
      transportUrl,
    });

    // Handle messages from parent
    parentPort?.on('message', async (message) => {
      switch (message.type) {
        case 'shutdown':
          await serviceInterface.__shutdown();
          break;
        case 'ping':
          parentPort?.postMessage({ type: 'pong' });
          break;
        default:
          break;
      }
    });

    // Handle process termination
    process.on('SIGTERM', async () => {
      await serviceInterface.__shutdown();
    });

    process.on('SIGINT', async () => {
      await serviceInterface.__shutdown();
    });
  } catch (error: any) {
    console.error('Failed to initialize worker:', error);
    parentPort?.postMessage({
      type: 'error',
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

// Initialize the worker
initialize().catch((error) => {
  console.error('Worker initialization failed:', error);
  process.exit(1);
});
