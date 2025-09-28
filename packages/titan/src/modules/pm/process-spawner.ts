/**
 * Process Spawner
 *
 * Responsible for spawning new processes as Worker threads or child processes
 * and setting up Netron communication channels
 */

import { Worker } from 'worker_threads';
import { fork, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

import { NetronClient } from './netron-client.js';
import type { ILogger } from '../logger/logger.types.js';
import type { IProcessOptions, IProcessManagerConfig } from './types.js';
import { PROCESS_METHOD_METADATA_KEY } from './decorators.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Process spawner for creating new process instances
 */
export class ProcessSpawner {
  private tempModules = new Map<string, string>();

  constructor(
    private readonly logger: ILogger,
    private readonly config: IProcessManagerConfig = {}
  ) {}

  /**
   * Spawn a new process
   */
  async spawn(
    ProcessClass: new (...args: any[]) => any,
    processId: string,
    options: IProcessOptions
  ): Promise<{ worker: Worker | ChildProcess; netron: NetronClient; transportUrl: string }> {
    // Determine transport and port for Netron
    const netronConfig = this.getNetronConfig(processId, options);

    // Get module path and class name
    const { modulePath, className } = await this.getClassInfo(ProcessClass, processId);

    // Spawn based on isolation level
    const isolation = options.security?.isolation || 'none';

    switch (isolation) {
      case 'vm':
        return this.spawnInVM(ProcessClass, processId, options, netronConfig, modulePath, className);
      case 'container':
        return this.spawnInContainer(ProcessClass, processId, options, netronConfig, modulePath, className);
      default:
        return this.spawnAsWorker(ProcessClass, processId, options, netronConfig, modulePath, className);
    }
  }

  /**
   * Clean up temporary modules
   */
  async cleanup(processId: string): Promise<void> {
    const tempPath = this.tempModules.get(processId);
    if (tempPath) {
      await fs.unlink(tempPath).catch(() => {});
      this.tempModules.delete(processId);
    }
  }

  /**
   * Get Netron configuration for the process
   */
  private getNetronConfig(processId: string, options: IProcessOptions): any {
    const transport = options.netron?.transport || this.config.netron?.transport || 'websocket';
    const port = options.netron?.port === 'auto' ? this.getRandomPort() : (options.netron?.port || this.getRandomPort());

    return {
      id: processId,
      transport,
      listenHost: options.netron?.host || 'localhost',
      listenPort: port,
      discoveryEnabled: !!this.config.netron?.discovery,
      discoveryUrl: options.netron?.discoveryUrl
    };
  }

  /**
   * Get class information for spawning
   */
  private async getClassInfo(ProcessClass: any, processId: string): Promise<{ modulePath: string; className: string }> {
    const className = ProcessClass.name;

    // Try to get module path from metadata or create temp module
    let modulePath = '';

    // Check if class has module path attached
    if (ProcessClass.__filename) {
      modulePath = ProcessClass.__filename;
    } else if (ProcessClass.__modulePath) {
      modulePath = ProcessClass.__modulePath;
    } else {
      // For test classes or inline classes, create a temporary module
      modulePath = await this.createTempModule(ProcessClass, processId);
    }

    return { modulePath, className };
  }

  /**
   * Create temporary module for inline classes (e.g., test classes)
   */
  private async createTempModule(
    ProcessClass: new (...args: any[]) => any,
    processId: string
  ): Promise<string> {
    const tempDir = path.join(__dirname, '.temp');
    await fs.mkdir(tempDir, { recursive: true });

    const tempFile = path.join(tempDir, `temp-${processId}.js`);

    // Extract metadata from the class
    const metadata = Reflect.getMetadata(Symbol.for('process:metadata'), ProcessClass);
    const methods: string[] = [];

    // Get all methods from the prototype
    const prototype = ProcessClass.prototype;
    const propertyNames = Object.getOwnPropertyNames(prototype);

    for (const propertyName of propertyNames) {
      if (propertyName === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (descriptor && typeof descriptor.value === 'function') {
        // Check if method has metadata
        const methodMetadata = Reflect.getMetadata(
          Symbol.for('process:method:metadata'),
          prototype,
          propertyName
        );

        methods.push(`
  ${propertyName}: ${descriptor.value.toString()},
  __${propertyName}_metadata: ${JSON.stringify(methodMetadata || {})}`);
      }
    }

    // Create a module that exports the class with metadata
    const moduleContent = `
import 'reflect-metadata';

// Recreate the class with its methods and metadata
export class ${ProcessClass.name} {
  constructor() {
    ${ProcessClass.prototype.constructor?.toString().match(/\{([\s\S]*)\}/)?.[1] || ''}
  }

${methods.join(',\n')}
}

// Apply metadata
const PROCESS_METADATA_KEY = Symbol.for('process:metadata');
const PROCESS_METHOD_METADATA_KEY = Symbol.for('process:method:metadata');

Reflect.defineMetadata(PROCESS_METADATA_KEY, ${JSON.stringify(metadata || {})}, ${ProcessClass.name});

// Apply method metadata
${propertyNames.filter(name => name !== 'constructor').map(name => {
  const methodMetadata = Reflect.getMetadata(
    Symbol.for('process:method:metadata'),
    prototype,
    name
  );
  if (methodMetadata) {
    return `Reflect.defineMetadata(PROCESS_METHOD_METADATA_KEY, ${JSON.stringify(methodMetadata)}, ${ProcessClass.name}.prototype, '${name}');`;
  }
  return '';
}).filter(Boolean).join('\n')}
`;

    await fs.writeFile(tempFile, moduleContent);
    this.tempModules.set(processId, tempFile);
    return tempFile;
  }

  /**
   * Spawn process as Worker thread
   */
  private async spawnAsWorker(
    ProcessClass: new (...args: any[]) => any,
    processId: string,
    options: IProcessOptions,
    netronConfig: any,
    modulePath: string,
    className: string
  ): Promise<{ worker: Worker; netron: NetronClient; transportUrl: string }> {
    // Get the path to the worker runtime script
    const workerScriptPath = path.join(__dirname, 'worker-runtime.js');

    const workerData = {
      processId,
      className,
      modulePath,
      netron: netronConfig,
      serviceName: options.name,
      version: options.version,
      options
    };

    const worker = new Worker(workerScriptPath, {
      workerData,
      env: process.env,
      resourceLimits: options.memory?.limit ? {
        maxOldGenerationSizeMb: this.parseMemoryLimit(options.memory.limit)
      } : undefined
    });

    // Wait for worker to be ready and get transport URL
    const transportUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker initialization timeout'));
      }, 30000);

      const handleMessage = (message: any) => {
        if (message.type === 'ready') {
          clearTimeout(timeout);
          resolve(message.transportUrl || `ws://${netronConfig.listenHost}:${netronConfig.listenPort}`);
        } else if (message.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(`Worker error: ${message.error}`));
        }
      };

      worker.once('message', handleMessage);

      worker.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Create Netron client to connect to the worker
    const netron = new NetronClient(processId, this.logger);
    await netron.start();

    // Connect to the worker's service
    await netron.connect(transportUrl);

    return { worker, netron, transportUrl };
  }

  /**
   * Spawn process in VM isolation
   */
  private async spawnInVM(
    ProcessClass: new (...args: any[]) => any,
    processId: string,
    options: IProcessOptions,
    netronConfig: any,
    modulePath: string,
    className: string
  ): Promise<{ worker: ChildProcess; netron: NetronClient; transportUrl: string }> {
    // Create a fork script
    const forkScriptPath = path.join(__dirname, 'fork-worker.js');

    // Use child_process.fork with VM options
    const child = fork(forkScriptPath, [], {
      env: {
        ...process.env,
        WORKER_DATA: JSON.stringify({
          processId,
          className,
          modulePath,
          netron: netronConfig,
          serviceName: options.name,
          version: options.version,
          options
        })
      },
      execArgv: ['--experimental-vm-modules'],
      silent: false
    });

    // Wait for child to be ready
    const transportUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Child process initialization timeout'));
      }, 30000);

      const handleMessage = (message: any) => {
        if (message.type === 'ready') {
          clearTimeout(timeout);
          resolve(message.transportUrl || `ws://${netronConfig.listenHost}:${netronConfig.listenPort}`);
        } else if (message.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(message.error));
        }
      };

      child.once('message', handleMessage);

      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Create Netron client
    const netron = new NetronClient(processId, this.logger);
    await netron.start();
    await netron.connect(transportUrl);

    return { worker: child, netron, transportUrl };
  }

  /**
   * Spawn process in container isolation
   */
  private async spawnInContainer(
    ProcessClass: new (...args: any[]) => any,
    processId: string,
    options: IProcessOptions,
    netronConfig: any,
    modulePath: string,
    className: string
  ): Promise<{ worker: ChildProcess; netron: NetronClient; transportUrl: string }> {
    // This would use Docker or another container runtime
    // For now, fallback to VM isolation
    this.logger.warn('Container isolation not yet implemented, using VM isolation');
    return this.spawnInVM(ProcessClass, processId, options, netronConfig, modulePath, className);
  }

  /**
   * Get a random available port
   */
  private getRandomPort(): number {
    return Math.floor(Math.random() * (65535 - 10000) + 10000);
  }

  /**
   * Parse memory limit string to MB
   */
  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+)([KMGT]?)B?$/i);
    if (!match) return 512; // Default 512MB

    const [, value, unit] = match;
    if (!value) return 512;
    const num = parseInt(value, 10);

    switch (unit?.toUpperCase()) {
      case 'K': return num / 1024;
      case 'M': return num;
      case 'G': return num * 1024;
      case 'T': return num * 1024 * 1024;
      default: return num;
    }
  }
}