import { Redis, Cluster } from 'ioredis';
import { Errors } from '../../errors/index.js';
import type { ILogger } from '../logger/logger.types.js';

import {
  RedisClient,
  RedisClientOptions,
  RedisModuleOptions,
  isClientReady,
  isClientConnecting,
  isClientAlive,
} from './redis.types.js';
import {
  mergeOptions,
  createRedisClient,
  waitForConnection,
  generateScriptSha,
  loadScriptContent,
  getClientNamespace,
  createRetryStrategy,
} from './redis.utils.js';

export class RedisManager {
  private readonly logger: ILogger;
  private readonly clients = new Map<string, RedisClient>();
  private readonly scripts = new Map<string, Map<string, string>>();
  private readonly options: RedisModuleOptions;
  private readonly connectionPromises = new Map<string, Promise<void>>();

  constructor(options: RedisModuleOptions, logger: ILogger) {
    this.options = options;
    this.logger = logger.child({ module: 'RedisManager' });
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

  private async connectClient(client: RedisClient, namespace: string, options: RedisClientOptions): Promise<void> {
    try {
      // Only connect if lazyConnect is false (not lazy) and client is not already connected
      // When lazyConnect is true, we should NOT connect immediately
      const isLazyConnect = (client as Redis).options?.lazyConnect ?? (client as Cluster).options?.lazyConnect ?? true;
      if (!isLazyConnect) {
        // Wait for connection to be ready - increase timeout for tests
        const timeout = this.options.healthCheck?.timeout || (process.env['NODE_ENV'] === 'test' ? 10000 : 5000);

        // If already ready, skip connection wait
        if (isClientReady(client)) {
          this.logger.debug(`Redis client "${namespace}" already ready`);
        } else {
          // Check if already connected/connecting
          if (!isClientConnecting(client)) {
            await client.connect();
          }

          const connected = await waitForConnection(client, timeout);
          if (!connected) {
            throw Errors.timeout(`Redis client "${namespace}" connection`, timeout);
          }
        }

        if (this.options.readyLog !== false) {
          this.logger.info(`Redis client "${namespace}" connected successfully`);
        }
      } else {
        this.logger.debug(`Redis client "${namespace}" initialized with lazy connect`);
      }

      if (options.onClientCreated) {
        options.onClientCreated(client);
      }

      if (this.options.onClientCreated) {
        this.options.onClientCreated(client);
      }
    } catch (error) {
      this.logger.error({ error }, `Failed to connect Redis client "${namespace}"`);
      throw error;
    }
  }

  private setupEventListeners(client: RedisClient, namespace: string): void {
    client.on('error', (error) => {
      if (this.options.errorLog !== false) {
        this.logger.error({ error }, `Redis client "${namespace}" error`);
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
          // For lazy-connected clients, force connection to load scripts
          // This ensures scripts are validated even with lazyConnect
          const [exists] = (await client.script('EXISTS', sha)) as [number];

          if (!exists) {
            const loadedSha = (await client.script('LOAD', content)) as string;
            scriptMap.set(script.name, loadedSha);
          } else {
            scriptMap.set(script.name, sha);
          }

          this.logger.debug(`Loaded script "${script.name}" for client "${namespace}"`);
        } catch (error) {
          this.logger.error({ error }, `Failed to load script "${script.name}" for client "${namespace}"`);
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
      throw Errors.notFound(`Redis client with namespace "${ns}"`);
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
      throw Errors.conflict(`Redis client with namespace "${namespace}" already exists`);
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
      if (isClientAlive(client)) {
        await client.quit();
      }

      this.clients.delete(namespace);
      this.scripts.delete(namespace);
      this.connectionPromises.delete(namespace);

      if (this.options.onClientDestroyed) {
        this.options.onClientDestroyed(namespace);
      }

      this.logger.info(`Redis client "${namespace}" destroyed`);
    } catch (error) {
      this.logger.error({ error }, `Error destroying Redis client "${namespace}"`);
      throw error;
    }
  }

  async isHealthy(namespace?: string): Promise<boolean> {
    try {
      const client = this.getClient(namespace);

      // For lazy-connected clients, try to ping (which will trigger connection)
      // If not ready and not connecting, the ping will handle connection
      const result = await client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async ping(namespace?: string): Promise<string> {
    const client = this.getClient(namespace);
    return client.ping();
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
    namespace?: string
  ): Promise<T> {
    const ns = namespace || 'default';
    const client = this.getClient(ns);
    const sha = this.getScriptSha(scriptName, ns);

    if (!sha) {
      throw Errors.notFound(`Script "${scriptName}" for client`, ns);
    }

    try {
      return (await client.evalsha(sha, keys.length, ...keys, ...args)) as T;
    } catch (error: any) {
      if (error.message?.includes('NOSCRIPT')) {
        const script = this.options.scripts?.find((s) => s.name === scriptName);
        if (!script) {
          throw Errors.notFound(`Script "${scriptName}" in configuration`, '');
        }

        const content = script.content || loadScriptContent(script.path!);
        const result = (await client.eval(content, keys.length, ...keys, ...args)) as T;

        const newSha = (await client.script('LOAD', content)) as string;
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
        if (isClientAlive(client)) {
          await client.quit();
        }
        this.logger.info(`Redis client "${namespace}" closed`);
      } catch (error) {
        this.logger.error({ error }, `Error closing Redis client "${namespace}"`);
      }
    });

    await Promise.all(closePromises);

    this.clients.clear();
    this.scripts.clear();
    this.connectionPromises.clear();
  }
}
