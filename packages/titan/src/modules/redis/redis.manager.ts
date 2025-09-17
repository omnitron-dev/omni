import { Redis, Cluster } from 'ioredis';

import { RedisClient, RedisClientOptions, RedisModuleOptions } from './redis.types.js';
import {
  mergeOptions,
  createRedisClient,
  waitForConnection,
  generateScriptSha,
  loadScriptContent,
  getClientNamespace,
  createRetryStrategy,
} from './redis.utils.js';

interface Logger {
  log(message: string): void;
  error(message: string, error?: any): void;
  warn(message: string): void;
  debug(message: string): void;
}

class SimpleLogger implements Logger {
  constructor(private readonly context: string) { }

  log(message: string): void {
    console.log(`[${this.context}] ${message}`);
  }

  error(message: string, error?: any): void {
    console.error(`[${this.context}] ${message}`, error);
  }

  warn(message: string): void {
    console.warn(`[${this.context}] ${message}`);
  }

  debug(message: string): void {
    console.debug(`[${this.context}] ${message}`);
  }
}

export class RedisManager {
  private readonly logger: Logger = new SimpleLogger('RedisManager');
  private readonly clients = new Map<string, RedisClient>();
  private readonly scripts = new Map<string, Map<string, string>>();
  private readonly options: RedisModuleOptions;
  private readonly connectionPromises = new Map<string, Promise<void>>();

  constructor(options: RedisModuleOptions, logger?: Logger) {
    this.options = options;
    if (logger) {
      this.logger = logger;
    }
  }

  async init(): Promise<void> {
    await this.initializeClients();
    await this.loadScripts();
  }

  async destroy(): Promise<void> {
    await this.closeAllClients();
  }

  // NestJS lifecycle methods
  async onModuleInit(): Promise<void> {
    await this.init();
  }

  async onModuleDestroy(): Promise<void> {
    await this.destroy();
  }

  private async initializeClients(): Promise<void> {
    const clientConfigs: RedisClientOptions[] = [];

    if (this.options.config) {
      clientConfigs.push(this.options.config);
    }

    if (this.options.clients) {
      clientConfigs.push(...this.options.clients);
    }

    if (clientConfigs.length === 0) {
      clientConfigs.push({});
    }

    const initPromises = clientConfigs.map(async (config) => {
      const mergedOptions = mergeOptions(this.options.commonOptions, config);
      await this.createAndRegisterClient(mergedOptions);
    });

    await Promise.all(initPromises);
  }

  private async createAndRegisterClient(options: RedisClientOptions): Promise<RedisClient> {
    const namespace = getClientNamespace(options);

    // If client already exists, destroy it first (last one wins)
    if (this.clients.has(namespace)) {
      await this.destroyClient(namespace);
    }

    if (!options.retryStrategy && !options.cluster?.options?.clusterRetryStrategy) {
      options.retryStrategy = createRetryStrategy();
    }

    const client = createRedisClient(options);

    this.setupEventListeners(client, namespace);
    this.clients.set(namespace, client);

    const connectionPromise = this.connectClient(client, namespace, options);
    this.connectionPromises.set(namespace, connectionPromise);

    await connectionPromise;

    return client;
  }

  private async connectClient(
    client: RedisClient,
    namespace: string,
    options: RedisClientOptions
  ): Promise<void> {
    try {
      // Only connect if lazyConnect is true (which is default)
      if ((client as Redis).options?.lazyConnect !== false || (client as Cluster).options?.lazyConnect !== false) {
        await client.connect();
      }

      // Wait for connection to be ready
      await waitForConnection(client, this.options.healthCheck?.timeout || 5000);

      if (this.options.readyLog !== false) {
        this.logger.log(`Redis client "${namespace}" connected successfully`);
      }

      if (options.onClientCreated) {
        options.onClientCreated(client);
      }

      if (this.options.onClientCreated) {
        this.options.onClientCreated(client);
      }
    } catch (error) {
      this.logger.error(`Failed to connect Redis client "${namespace}":`, error);
      throw error;
    }
  }

  private setupEventListeners(client: RedisClient, namespace: string): void {
    client.on('error', (error) => {
      if (this.options.errorLog !== false) {
        this.logger.error(`Redis client "${namespace}" error:`, error);
      }

      if (this.options.onError) {
        this.options.onError(error, client);
      }
    });

    client.on('connect', () => {
      this.logger.debug(`Redis client "${namespace}" connecting`);
    });

    client.on('ready', () => {
      this.logger.debug(`Redis client "${namespace}" ready`);
    });

    client.on('reconnecting', (delay: number) => {
      this.logger.warn(`Redis client "${namespace}" reconnecting in ${delay}ms`);
    });

    client.on('close', () => {
      this.logger.debug(`Redis client "${namespace}" connection closed`);
    });

    client.on('end', () => {
      this.logger.debug(`Redis client "${namespace}" connection ended`);
    });
  }

  private async loadScripts(): Promise<void> {
    if (!this.options.scripts || this.options.scripts.length === 0) {
      return;
    }

    const loadPromises = this.options.scripts.map(async (script) => {
      const content = script.content || loadScriptContent(script.path!);
      const sha = generateScriptSha(content);

      for (const [namespace, client] of this.clients) {
        if (!this.scripts.has(namespace)) {
          this.scripts.set(namespace, new Map());
        }

        const scriptMap = this.scripts.get(namespace)!;

        try {
          const [exists] = await client.script('EXISTS', sha) as [number];

          if (!exists) {
            const loadedSha = await client.script('LOAD', content) as string;
            scriptMap.set(script.name, loadedSha);
          } else {
            scriptMap.set(script.name, sha);
          }

          this.logger.debug(`Loaded script "${script.name}" for client "${namespace}"`);
        } catch (error) {
          this.logger.error(`Failed to load script "${script.name}" for client "${namespace}":`, error);
          throw error;
        }
      }
    });

    await Promise.all(loadPromises);
  }

  getClient(namespace?: string): RedisClient {
    const ns = namespace || 'default';
    const client = this.clients.get(ns);

    if (!client) {
      throw new Error(`Redis client with namespace "${ns}" not found`);
    }

    return client;
  }

  getClients(): Map<string, RedisClient> {
    return new Map(this.clients);
  }

  hasClient(namespace?: string): boolean {
    return this.clients.has(namespace || 'default');
  }

  async createClient(options: RedisClientOptions): Promise<RedisClient> {
    const namespace = getClientNamespace(options);

    if (this.clients.has(namespace)) {
      throw new Error(`Redis client with namespace "${namespace}" already exists`);
    }

    const mergedOptions = mergeOptions(this.options.commonOptions, options);
    return this.createAndRegisterClient(mergedOptions);
  }

  async destroyClient(namespace: string): Promise<void> {
    const client = this.clients.get(namespace);

    if (!client) {
      return;
    }

    try {
      if (client.status !== 'end') {
        await client.quit();
      }

      this.clients.delete(namespace);
      this.scripts.delete(namespace);
      this.connectionPromises.delete(namespace);

      if (this.options.onClientDestroyed) {
        this.options.onClientDestroyed(namespace);
      }

      this.logger.log(`Redis client "${namespace}" destroyed`);
    } catch (error) {
      this.logger.error(`Error destroying Redis client "${namespace}":`, error);
      throw error;
    }
  }

  async isHealthy(namespace?: string): Promise<boolean> {
    try {
      const client = this.getClient(namespace);

      if (client.status !== 'ready') {
        return false;
      }

      const result = await client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<Record<string, { healthy: boolean; latency: number }>> {
    const results: Record<string, { healthy: boolean; latency: number }> = {};

    const checks = Array.from(this.clients.keys()).map(async (namespace) => {
      const start = Date.now();
      const healthy = await this.isHealthy(namespace);
      const latency = Date.now() - start;
      results[namespace] = { healthy, latency };
    });

    await Promise.all(checks);
    return results;
  }

  getScriptSha(scriptName: string, namespace?: string): string | undefined {
    const ns = namespace || 'default';
    return this.scripts.get(ns)?.get(scriptName);
  }

  async runScript<T = any>(
    scriptName: string,
    keys: string[],
    args: (string | number)[],
    namespace?: string,
  ): Promise<T> {
    const ns = namespace || 'default';
    const client = this.getClient(ns);
    const sha = this.getScriptSha(scriptName, ns);

    if (!sha) {
      throw new Error(`Script "${scriptName}" not loaded for client "${ns}"`);
    }

    try {
      return await client.evalsha(sha, keys.length, ...keys, ...args) as T;
    } catch (error: any) {
      if (error.message?.includes('NOSCRIPT')) {
        const script = this.options.scripts?.find(s => s.name === scriptName);
        if (!script) {
          throw new Error(`Script "${scriptName}" not found in configuration`);
        }

        const content = script.content || loadScriptContent(script.path!);
        const result = await client.eval(content, keys.length, ...keys, ...args) as T;

        const newSha = await client.script('LOAD', content) as string;
        this.scripts.get(ns)?.set(scriptName, newSha);

        return result;
      }
      throw error;
    }
  }

  private async closeAllClients(): Promise<void> {
    if (this.options.closeClient === false) {
      return;
    }

    const closePromises = Array.from(this.clients.entries()).map(async ([namespace, client]) => {
      try {
        if (client.status !== 'end') {
          await client.quit();
        }
        this.logger.log(`Redis client "${namespace}" closed`);
      } catch (error) {
        this.logger.error(`Error closing Redis client "${namespace}":`, error);
      }
    });

    await Promise.all(closePromises);

    this.clients.clear();
    this.scripts.clear();
    this.connectionPromises.clear();
  }
}