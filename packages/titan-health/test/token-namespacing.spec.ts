/**
 * DI-1 regression — titan-health DI tokens must be namespaced. The bare
 * 'HealthService' name collided in practice: paysys had to define its own
 * 'AppHealthService' token to avoid clobbering it (createToken caches by name
 * in a global Symbol.for registry).
 */

import { describe, it, expect } from 'vitest';
import { createToken } from '@omnitron-dev/titan/nexus';
import { HEALTH_SERVICE_TOKEN, HEALTH_RPC_SERVICE_TOKEN, REDIS_HEALTH_INDICATOR_TOKEN } from '../src/health.tokens.js';

describe('titan-health token namespacing (DI-1)', () => {
  it('does not collide with bare global token names', () => {
    expect(HEALTH_SERVICE_TOKEN.id).not.toBe(createToken('HealthService').id);
    expect(HEALTH_RPC_SERVICE_TOKEN.id).not.toBe(createToken('HealthRpcService').id);
    expect(REDIS_HEALTH_INDICATOR_TOKEN.id).not.toBe(createToken('RedisHealthIndicator').id);
  });

  it('uses the TitanHealth: namespace', () => {
    expect(HEALTH_SERVICE_TOKEN.id).toBe(Symbol.for('nexus:token:TitanHealth:Service'));
    expect(HEALTH_RPC_SERVICE_TOKEN.id).toBe(Symbol.for('nexus:token:TitanHealth:RpcService'));
  });
});
