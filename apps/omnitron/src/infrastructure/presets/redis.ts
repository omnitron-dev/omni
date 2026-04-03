/**
 * Redis/Valkey/KeyDB Service Preset
 *
 * Works with Redis, Valkey, KeyDB, Dragonfly — any Redis-compatible store.
 * Override `image` for alternative implementations: { preset: 'redis', image: 'valkey/valkey:8' }
 */

import type { IServicePreset } from './types.js';

export const redisPreset: IServicePreset = {
  name: 'redis',
  type: 'cache',
  defaultImage: 'redis:7-alpine',
  defaultPorts: { main: 6379 },
  defaultSecrets: {},

  defaultHealthCheck: {
    type: 'command',
    target: 'redis-cli ping',
    interval: '5s',
    timeout: '5s',
    retries: 5,
  },

  defaultDocker: {
    command: ['redis-server', '--appendonly', 'yes', '--maxmemory-policy', 'allkeys-lru'],
    volumes: {
      data: { target: '/data', source: '' },
    },
  },

  generateEnvTemplates(): Record<string, string> {
    return {
      REDIS_URL: 'redis://${host}:${port:main}/0',
    };
  },
};
