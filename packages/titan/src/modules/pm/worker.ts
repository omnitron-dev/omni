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
      throw new Error(`Class ${config.className} not found in module ${config.modulePath}`);
    }

    // Create process instance
    const processInstance = new ProcessClass();

    // Initialize Netron for this process
    const netron = new Netron(console as any, {
      id: config.netron.id
      // discoveryUrl: config.netron.discoveryUrl  // TODO: fix this
    });

    // Create local peer for service exposure
    const peer = new LocalPeer(netron);

    // Set up transport based on configuration
    let transportUrl = '';
    switch (config.netron.transport) {
      case 'unix':
        transportUrl = `unix:///tmp/titan-pm-${config.processId}.sock`;
        break;
      case 'tcp':
      case 'websocket':
      case 'http':
        transportUrl = `${config.netron.transport}://${config.netron.listenHost}:${config.netron.listenPort}`;
        break;
      default:
        transportUrl = `ws://${config.netron.listenHost}:${config.netron.listenPort}`;
    }

    // Start listening for connections
    // await peer.listen(transportUrl);  // TODO: fix LocalPeer API

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
      uptime: process.uptime()
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

    serviceInterface.__shutdown = async () => {
      // Call onShutdown if it exists
      const shutdownMethod = (processInstance as any).onShutdown;
      if (typeof shutdownMethod === 'function') {
        await shutdownMethod.call(processInstance);
      }
      // await peer.stop();  // TODO: fix LocalPeer API
      process.exit(0);
    };

    // Expose the service via Netron
    // await peer.expose(serviceInterface, {  // TODO: fix LocalPeer API
    //   name: config.serviceName || config.className,
    //   version: config.version || '1.0.0'
    // });

    // Notify parent that we're ready
    parentPort?.postMessage({
      type: 'ready',
      processId: config.processId,
      transportUrl
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