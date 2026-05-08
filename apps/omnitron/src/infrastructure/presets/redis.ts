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
    // The naive `redis-cli ping` exits 0 even when redis is still
    // loading its RDB and replies "LOADING Redis is loading the dataset
    // in memory" — Docker's HEALTHCHECK then marks the container healthy
    // and apps that try to connect get told their commands aren't
    // accepted yet. The grep below requires the literal "PONG" reply,
    // which redis only sends once it has fully loaded.
    type: 'command',
    target: 'sh -c "redis-cli ping | grep -q PONG"',
    interval: '3s',
    timeout: '3s',
    retries: 30,
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
