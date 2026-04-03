/**
 * Docker Testing Utilities
 *
 * Generic Docker container management for tests with no framework dependencies.
 * Supports PostgreSQL, MySQL, Redis (standalone, cluster, sentinel), and custom containers.
 *
 * @example
 * ```typescript
 * import { DockerTestManager, DatabaseTestManager, RedisTestManager } from '@omnitron-dev/testing/docker';
 *
 * // Custom container
 * const manager = DockerTestManager.getInstance();
 * const container = await manager.createContainer({
 *   image: 'nginx:alpine',
 *   ports: { 80: 'auto' },
 * });
 *
 * // PostgreSQL
 * await DatabaseTestManager.withPostgres(async (container, connStr) => {
 *   // Run tests...
 * });
 *
 * // Redis Cluster
 * await RedisTestManager.withRedisCluster(async (cluster) => {
 *   // Run tests...
 * });
 * ```
 *
 * @module @omnitron-dev/testing/docker
 */

// Re-export all types
export type {
  DockerContainer,
  DockerContainerStatus,
  DockerTestManagerOptions,
  ContainerOptions,
  RedisContainerOptions,
  RedisClusterOptions,
  RedisClusterContainers,
  RedisSentinelOptions,
  RedisSentinelContainers,
} from './types.js';

// Re-export main classes
export { DockerTestManager } from './docker-test-manager.js';
export { DatabaseTestManager } from './database-manager.js';
export { RedisTestManager } from './redis-manager.js';
