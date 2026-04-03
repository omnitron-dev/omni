/**
 * Redis Test Manager
 *
 * Provides specialized helpers for creating and managing Redis containers
 * in tests. Supports standalone Redis, Redis Cluster, and Redis Sentinel.
 */

import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { DockerTestManager } from './docker-test-manager.js';
import type {
  DockerContainer,
  RedisContainerOptions,
  RedisClusterOptions,
  RedisClusterContainers,
  RedisSentinelOptions,
  RedisSentinelContainers,
} from './types.js';

/**
 * Redis Test Manager
 *
 * Provides convenient methods for creating Redis containers with various
 * configurations: standalone, cluster, and sentinel.
 *
 * @example
 * ```typescript
 * // Standalone Redis
 * const redis = await RedisTestManager.createRedisContainer();
 *
 * // Redis Cluster
 * const cluster = await RedisTestManager.createRedisCluster({
 *   masterCount: 3,
 *   replicasPerMaster: 1,
 * });
 *
 * // Redis Sentinel
 * const sentinel = await RedisTestManager.createRedisSentinel({
 *   replicaCount: 2,
 *   sentinelCount: 3,
 * });
 * ```
 */
export class RedisTestManager {
  private static _dockerManager: DockerTestManager | null = null;

  /**
   * Get the Docker manager instance
   * @private
   */
  private static getDockerManager(): DockerTestManager {
    if (!RedisTestManager._dockerManager) {
      RedisTestManager._dockerManager = DockerTestManager.getInstance();
    }
    return RedisTestManager._dockerManager;
  }

  /**
   * Create a standalone Redis container
   *
   * @param options - Redis configuration options
   * @returns Promise resolving to DockerContainer
   *
   * @example
   * ```typescript
   * const container = await RedisTestManager.createRedisContainer({
   *   password: 'mypass',
   *   maxMemory: '512mb',
   * });
   *
   * const port = container.ports.get(6379)!;
   * const connStr = `redis://:mypass@localhost:${port}/0`;
   * ```
   */
  static async createRedisContainer(options?: RedisContainerOptions): Promise<DockerContainer> {
    const port = options?.port || 'auto';
    const password = options?.password;
    const _database = options?.database ?? 0;
    const maxMemory = options?.maxMemory || '256mb';
    const requirePass = options?.requirePass ?? Boolean(password);

    const environment: Record<string, string> = {};
    const command: string[] = ['redis-server'];

    // Configure Redis settings
    command.push('--maxmemory', maxMemory);
    command.push('--maxmemory-policy', 'allkeys-lru');
    command.push("--save ''"); // Disable RDB snapshots for tests
    command.push('--appendonly', 'no'); // Disable AOF for tests

    if (requirePass && password) {
      command.push('--requirepass', password);
    }

    return RedisTestManager.getDockerManager().createContainer({
      name: options?.name,
      image: 'redis:7-alpine',
      ports: { 6379: port },
      environment,
      command: command.join(' '),
      healthcheck: {
        test: password ? ['CMD', 'redis-cli', '-a', password, 'ping'] : ['CMD', 'redis-cli', 'ping'],
        interval: '1s',
        timeout: '3s',
        retries: 20,
        startPeriod: '2s',
      },
      waitFor: {
        healthcheck: true,
        timeout: 30000,
      },
    });
  }

  /**
   * Create a Redis Cluster (3 masters + 3 replicas by default)
   *
   * @param options - Redis Cluster configuration options
   * @returns Promise resolving to RedisClusterContainers
   *
   * @example
   * ```typescript
   * const cluster = await RedisTestManager.createRedisCluster({
   *   masterCount: 3,
   *   replicasPerMaster: 1,
   *   password: 'mypass',
   * });
   *
   * // Use cluster nodes
   * const nodes = cluster.nodes; // [{ host: '127.0.0.1', port: 12345 }, ...]
   *
   * // Cleanup when done
   * await cluster.cleanup();
   * ```
   */
  static async createRedisCluster(options?: RedisClusterOptions): Promise<RedisClusterContainers> {
    const masterCount = options?.masterCount ?? 3;
    const replicasPerMaster = options?.replicasPerMaster ?? 1;
    const password = options?.password;
    const networkName = options?.network || `redis-cluster-${randomBytes(8).toString('hex')}`;

    // Create network
    await RedisTestManager.getDockerManager()['ensureNetwork'](networkName);

    const masters: DockerContainer[] = [];
    const replicas: DockerContainer[] = [];
    const nodes: Array<{ host: string; port: number }> = [];
    const allocatedPorts: number[] = [];

    // Extract unique ID from network name to ensure container names are unique
    const networkId = networkName.split('-').pop() || randomBytes(4).toString('hex');

    try {
      // Create master nodes with dynamically allocated ports
      for (let i = 0; i < masterCount; i++) {
        // Use dynamic port allocation instead of fixed basePort to avoid conflicts
        const port = await RedisTestManager.getDockerManager()['findAvailablePort']();
        allocatedPorts.push(port);
        const name = `redis-cluster-${networkId}-master-${i}`;

        const command = [
          'redis-server',
          '--cluster-enabled',
          'yes',
          '--cluster-config-file',
          'nodes.conf',
          '--cluster-node-timeout',
          '5000',
          '--appendonly',
          'no',
          '--save',
          '',
          '--port',
          '6379',
        ];

        if (password) {
          command.push('--requirepass', password);
          command.push('--masterauth', password);
        }

        const container = await RedisTestManager.getDockerManager().createContainer({
          name,
          image: 'redis:7-alpine',
          ports: { 6379: port },
          networks: [networkName],
          command: command.join(' '),
          healthcheck: {
            test: password ? ['CMD', 'redis-cli', '-a', password, 'ping'] : ['CMD', 'redis-cli', 'ping'],
            interval: '1s',
            timeout: '5s',
            retries: 30,
            startPeriod: '10s',
          },
          waitFor: {
            healthcheck: true,
            timeout: 60000,
          },
        });

        masters.push(container);
        nodes.push({ host: container.host, port });
      }

      // Create replica nodes with dynamically allocated ports
      for (let i = 0; i < masterCount * replicasPerMaster; i++) {
        // Use dynamic port allocation
        const port = await RedisTestManager.getDockerManager()['findAvailablePort']();
        allocatedPorts.push(port);
        const name = `redis-cluster-${networkId}-replica-${i}`;

        const command = [
          'redis-server',
          '--cluster-enabled',
          'yes',
          '--cluster-config-file',
          'nodes.conf',
          '--cluster-node-timeout',
          '5000',
          '--appendonly',
          'no',
          '--save',
          '',
          '--port',
          '6379',
        ];

        if (password) {
          command.push('--requirepass', password);
          command.push('--masterauth', password);
        }

        const container = await RedisTestManager.getDockerManager().createContainer({
          name,
          image: 'redis:7-alpine',
          ports: { 6379: port },
          networks: [networkName],
          command: command.join(' '),
          healthcheck: {
            test: password ? ['CMD', 'redis-cli', '-a', password, 'ping'] : ['CMD', 'redis-cli', 'ping'],
            interval: '1s',
            timeout: '5s',
            retries: 30,
            startPeriod: '10s',
          },
          waitFor: {
            healthcheck: true,
            timeout: 60000,
          },
        });

        replicas.push(container);
        nodes.push({ host: container.host, port });
      }

      // Wait for all containers to be fully ready and connected to network
      const preInitDelay = options?.preInitDelay ?? 5000;
      await new Promise((resolve) => setTimeout(resolve, preInitDelay));

      // Verify all nodes respond to PING before initializing cluster
      const dockerPath = RedisTestManager.getDockerManager()['dockerPath'];
      const allContainers = [...masters, ...replicas];
      for (const container of allContainers) {
        const maxPingRetries = 30;
        for (let i = 0; i < maxPingRetries; i++) {
          try {
            const pingArgs = password
              ? ['exec', container.name, 'redis-cli', '-a', password, 'ping']
              : ['exec', container.name, 'redis-cli', 'ping'];
            execFileSync(dockerPath, pingArgs, { stdio: 'pipe', timeout: 5000 });
            break;
          } catch {
            if (i === maxPingRetries - 1) {
              throw new Error(
                `Container ${container.name} not responding to redis-cli ping after ${maxPingRetries} attempts`
              );
            }
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      // Initialize cluster
      await RedisTestManager.initializeCluster(masters, replicas, password);

      // Build NAT map for ioredis cluster connectivity
      // Maps internal Docker IPs to external localhost:port addresses
      const natMap: Record<string, { host: string; port: number }> = {};
      for (const container of allContainers) {
        if (container.internalIp) {
          const hostPort = container.ports.get(6379);
          if (hostPort) {
            // Map internal IP:6379 to localhost:hostPort
            natMap[`${container.internalIp}:6379`] = { host: 'localhost', port: hostPort };
          }
        }
      }

      return {
        masters,
        replicas,
        network: networkName,
        nodes,
        natMap,
        cleanup: async () => {
          // Clean up containers first
          await Promise.allSettled([...masters.map((c) => c.cleanup()), ...replicas.map((c) => c.cleanup())]);
          // Then remove the network
          try {
            await RedisTestManager.getDockerManager()['removeNetwork'](networkName);
          } catch (error) {
            // Log but don't throw - network cleanup is best effort
            console.warn(`Failed to remove network ${networkName}:`, error);
          }
        },
      };
    } catch (error) {
      // Cleanup on failure - release allocated ports and clean up containers
      allocatedPorts.forEach((port) => {
        RedisTestManager.getDockerManager()['usedPorts'].delete(port);
      });
      await Promise.allSettled([
        ...masters.map((c) =>
          c.cleanup().catch((cleanupError) => {
            // Log cleanup errors but don't fail the error flow - we're already handling a failure
            console.error(`Failed to cleanup master container ${c.name}:`, cleanupError);
          })
        ),
        ...replicas.map((c) =>
          c.cleanup().catch((cleanupError) => {
            // Log cleanup errors but don't fail the error flow - we're already handling a failure
            console.error(`Failed to cleanup replica container ${c.name}:`, cleanupError);
          })
        ),
      ]);
      // Try to remove network on failure too
      try {
        await RedisTestManager.getDockerManager()['removeNetwork'](networkName);
      } catch (networkError) {
        // Log network cleanup errors but don't fail - network might be in use or already removed
        console.error(`Failed to remove network ${networkName} during failure cleanup:`, networkError);
      }
      throw error;
    }
  }

  /**
   * Create Redis Sentinel setup (1 master + N replicas + M sentinels)
   *
   * @param options - Redis Sentinel configuration options
   * @returns Promise resolving to RedisSentinelContainers
   *
   * @example
   * ```typescript
   * const sentinel = await RedisTestManager.createRedisSentinel({
   *   masterName: 'mymaster',
   *   replicaCount: 2,
   *   sentinelCount: 3,
   *   password: 'mypass',
   * });
   *
   * // Use sentinel configuration
   * const sentinelPorts = sentinel.sentinelPorts;
   * const masterName = sentinel.masterName;
   *
   * // Cleanup when done
   * await sentinel.cleanup();
   * ```
   */
  static async createRedisSentinel(options?: RedisSentinelOptions): Promise<RedisSentinelContainers> {
    const masterName = options?.masterName || 'mymaster';
    const replicaCount = options?.replicaCount ?? 2;
    const sentinelCount = options?.sentinelCount ?? 3;
    const password = options?.password;
    const networkName = options?.network || `redis-sentinel-${randomBytes(8).toString('hex')}`;

    // Create network
    await RedisTestManager.getDockerManager()['ensureNetwork'](networkName);

    let master: DockerContainer | undefined;
    const replicas: DockerContainer[] = [];
    const sentinels: DockerContainer[] = [];
    const sentinelPorts: number[] = [];
    const allocatedPorts: number[] = [];

    try {
      // Create master with dynamic port allocation
      const masterPort = await RedisTestManager.getDockerManager()['findAvailablePort']();
      allocatedPorts.push(masterPort);
      const command = ['redis-server', '--appendonly', 'no', '--save', ''];

      if (password) {
        command.push('--requirepass', password);
        command.push('--masterauth', password);
      }

      master = await RedisTestManager.getDockerManager().createContainer({
        name: `redis-sentinel-master`,
        image: 'redis:7-alpine',
        ports: { 6379: masterPort },
        networks: [networkName],
        command: command.join(' '),
        healthcheck: {
          test: password ? ['CMD', 'redis-cli', '-a', password, 'ping'] : ['CMD', 'redis-cli', 'ping'],
          interval: '1s',
          timeout: '3s',
          retries: 5,
        },
        waitFor: {
          healthcheck: true,
          timeout: 30000,
        },
      });

      // Create replicas
      for (let i = 0; i < replicaCount; i++) {
        const replicaPort = 6380 + i;
        const replicaCommand = ['redis-server', '--appendonly', 'no', '--save', '', '--slaveof', master.name, '6379'];

        if (password) {
          replicaCommand.push('--requirepass', password);
          replicaCommand.push('--masterauth', password);
        }

        const replica = await RedisTestManager.getDockerManager().createContainer({
          name: `redis-sentinel-replica-${i}`,
          image: 'redis:7-alpine',
          ports: { 6379: replicaPort },
          networks: [networkName],
          command: replicaCommand.join(' '),
          healthcheck: {
            test: password ? ['CMD', 'redis-cli', '-a', password, 'ping'] : ['CMD', 'redis-cli', 'ping'],
            interval: '1s',
            timeout: '3s',
            retries: 5,
          },
          waitFor: {
            healthcheck: true,
            timeout: 30000,
          },
        });

        replicas.push(replica);
      }

      // Create sentinels with dynamic port allocation
      for (let i = 0; i < sentinelCount; i++) {
        const sentinelPort = await RedisTestManager.getDockerManager()['findAvailablePort']();
        allocatedPorts.push(sentinelPort);
        sentinelPorts.push(sentinelPort);

        // Create sentinel config
        const sentinelConfig = [
          `sentinel monitor ${masterName} ${master.name} 6379 2`,
          `sentinel down-after-milliseconds ${masterName} 5000`,
          `sentinel parallel-syncs ${masterName} 1`,
          `sentinel failover-timeout ${masterName} 10000`,
        ];

        if (password) {
          sentinelConfig.push(`sentinel auth-pass ${masterName} ${password}`);
        }

        const sentinelCommand = [
          'sh',
          '-c',
          `echo "${sentinelConfig.join('\\n')}" > /tmp/sentinel.conf && redis-sentinel /tmp/sentinel.conf`,
        ];

        const sentinel = await RedisTestManager.getDockerManager().createContainer({
          name: `redis-sentinel-${i}`,
          image: 'redis:7-alpine',
          ports: { 26379: sentinelPort },
          networks: [networkName],
          command: sentinelCommand.join(' '),
          healthcheck: {
            test: ['CMD', 'redis-cli', '-p', '26379', 'ping'],
            interval: '1s',
            timeout: '3s',
            retries: 5,
          },
          waitFor: {
            healthcheck: true,
            timeout: 30000,
          },
        });

        sentinels.push(sentinel);
      }

      return {
        master,
        replicas,
        sentinels,
        network: networkName,
        masterName,
        sentinelPorts,
        cleanup: async () => {
          await Promise.all(
            [master?.cleanup(), ...replicas.map((c) => c.cleanup()), ...sentinels.map((c) => c.cleanup())].filter(
              Boolean
            ) as Promise<void>[]
          );
        },
      };
    } catch (error) {
      // Cleanup on failure - release allocated ports
      allocatedPorts.forEach((port) => {
        RedisTestManager.getDockerManager()['usedPorts'].delete(port);
      });
      await Promise.all(
        [
          master?.cleanup().catch((cleanupError) => {
            // Log cleanup errors but don't fail the error flow - we're already handling a failure
            console.error(`Failed to cleanup master container ${master?.name}:`, cleanupError);
          }),
          ...replicas.map((c) =>
            c.cleanup().catch((cleanupError) => {
              // Log cleanup errors but don't fail the error flow - we're already handling a failure
              console.error(`Failed to cleanup replica container ${c.name}:`, cleanupError);
            })
          ),
          ...sentinels.map((c) =>
            c.cleanup().catch((cleanupError) => {
              // Log cleanup errors but don't fail the error flow - we're already handling a failure
              console.error(`Failed to cleanup sentinel container ${c.name}:`, cleanupError);
            })
          ),
        ].filter(Boolean)
      );
      throw error;
    }
  }

  /**
   * Helper to initialize Redis cluster
   * @private
   */
  private static async initializeCluster(
    masters: DockerContainer[],
    replicas: DockerContainer[],
    password?: string
  ): Promise<void> {
    if (masters.length === 0) {
      return;
    }

    // Build cluster create command
    // Note: Use container names as hostnames (not 127.0.0.1) because cluster init runs inside a container
    // Docker network DNS resolves container names to their IPs, and Redis listens on port 6379 internally
    const allNodes = [...masters, ...replicas];
    const nodeAddresses = allNodes.map((c) => `${c.name}:6379`);

    const clusterArgs = [
      'redis-cli',
      '--cluster',
      'create',
      ...nodeAddresses,
      '--cluster-replicas',
      String(Math.floor(replicas.length / masters.length)),
      '--cluster-yes',
    ];

    if (password) {
      clusterArgs.splice(1, 0, '-a', password);
    }

    // Execute cluster create inside the first master container
    const firstMaster = masters[0];
    if (!firstMaster) {
      throw new Error('No master nodes available to initialize cluster');
    }

    try {
      const dockerPath = DockerTestManager.getInstance()['dockerPath'];
      const verbose = DockerTestManager.getInstance()['verbose'];

      if (verbose) {
        console.log('[RedisCluster] Initializing cluster with nodes:', nodeAddresses);
        console.log('[RedisCluster] Running command:', ['exec', firstMaster.name, ...clusterArgs].join(' '));
      }

      const output = execFileSync(dockerPath, ['exec', firstMaster.name, ...clusterArgs], {
        stdio: verbose ? 'inherit' : 'pipe',
        timeout: 60000,
        encoding: 'utf8',
      });

      if (verbose && output) {
        console.log('[RedisCluster] Initialization output:', output);
      }

      // Wait for cluster to be ready - robust check
      const maxWait = 30000; // 30 seconds
      const startTime = Date.now();
      let clusterReady = false;

      while (!clusterReady && Date.now() - startTime < maxWait) {
        try {
          const clusterInfo = execFileSync(
            dockerPath,
            ['exec', firstMaster.name, 'redis-cli', ...(password ? ['-a', password] : []), 'cluster', 'info'],
            { encoding: 'utf8', stdio: 'pipe' }
          );

          if (clusterInfo.includes('cluster_state:ok')) {
            // Verify all slots are assigned
            if (
              clusterInfo.includes('cluster_slots_assigned:16384') &&
              clusterInfo.includes('cluster_slots_ok:16384')
            ) {
              clusterReady = true;
              if (verbose) {
                console.log('[RedisCluster] Cluster is ready');
              }
              break;
            }
          }
        } catch {
          // Not ready yet, continue waiting
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (!clusterReady) {
        throw new Error('Redis cluster failed to reach ready state within timeout');
      }

      if (verbose) {
        console.log('[RedisCluster] Cluster initialization complete');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize Redis cluster: ${errorMsg}`, { cause: error });
    }
  }

  /**
   * Helper: Run test with a standalone Redis container
   *
   * @param testFn - Test function that receives container and connection string
   * @param options - Redis configuration options
   * @returns Promise resolving to test function result
   *
   * @example
   * ```typescript
   * await RedisTestManager.withRedis(async (container, connectionString) => {
   *   const client = new Redis(connectionString);
   *   await client.set('key', 'value');
   *   // Run tests...
   *   await client.quit();
   * });
   * ```
   */
  static async withRedis<T>(
    testFn: (container: DockerContainer, connectionString: string) => Promise<T>,
    options?: RedisContainerOptions
  ): Promise<T> {
    const container = await RedisTestManager.createRedisContainer(options);

    const port = container.ports.get(6379)!;
    const password = options?.password;
    const database = options?.database ?? 0;

    let connectionString = `redis://`;
    if (password) {
      connectionString += `:${password}@`;
    }
    connectionString += `localhost:${port}/${database}`;

    try {
      return await testFn(container, connectionString);
    } finally {
      await container.cleanup();
    }
  }

  /**
   * Helper: Run test with Redis cluster
   *
   * @param testFn - Test function that receives cluster containers
   * @param options - Redis Cluster configuration options
   * @returns Promise resolving to test function result
   *
   * @example
   * ```typescript
   * await RedisTestManager.withRedisCluster(async (cluster) => {
   *   const client = new Redis.Cluster(cluster.nodes.map(n => ({ host: n.host, port: n.port })));
   *   await client.set('key', 'value');
   *   // Run tests...
   *   await client.quit();
   * }, { masterCount: 3, replicasPerMaster: 1 });
   * ```
   */
  static async withRedisCluster<T>(
    testFn: (cluster: RedisClusterContainers) => Promise<T>,
    options?: RedisClusterOptions
  ): Promise<T> {
    const cluster = await RedisTestManager.createRedisCluster(options);

    try {
      return await testFn(cluster);
    } finally {
      await cluster.cleanup();
    }
  }

  /**
   * Helper: Run test with Redis Sentinel
   *
   * @param testFn - Test function that receives sentinel containers
   * @param options - Redis Sentinel configuration options
   * @returns Promise resolving to test function result
   *
   * @example
   * ```typescript
   * await RedisTestManager.withRedisSentinel(async (sentinel) => {
   *   const client = new Redis({
   *     sentinels: sentinel.sentinelPorts.map(port => ({ host: '127.0.0.1', port })),
   *     name: sentinel.masterName,
   *   });
   *   await client.set('key', 'value');
   *   // Run tests...
   *   await client.quit();
   * });
   * ```
   */
  static async withRedisSentinel<T>(
    testFn: (sentinel: RedisSentinelContainers) => Promise<T>,
    options?: RedisSentinelOptions
  ): Promise<T> {
    const sentinel = await RedisTestManager.createRedisSentinel(options);

    try {
      return await testFn(sentinel);
    } finally {
      await sentinel.cleanup();
    }
  }
}
