/**
 * DI-1 regression — titan-discovery DI tokens must be namespaced so they do not
 * collide with bare generic token names. createToken() caches by name in a
 * global Symbol.for registry, so before this fix `createToken('DiscoveryService')`
 * in omnitron (a different, unrelated service) resolved to the SAME token as
 * titan-discovery's DISCOVERY_SERVICE_TOKEN.
 */

import { describe, it, expect } from 'vitest';
import { createToken } from '@omnitron-dev/titan/nexus';
import { DISCOVERY_SERVICE_TOKEN, REDIS_TOKEN, DISCOVERY_OPTIONS_TOKEN } from '../src/types.js';

describe('titan-discovery token namespacing (DI-1)', () => {
  it('does not collide with bare global token names', () => {
    expect(DISCOVERY_SERVICE_TOKEN.id).not.toBe(createToken('DiscoveryService').id);
    expect(REDIS_TOKEN.id).not.toBe(createToken('Redis').id);
    expect(DISCOVERY_OPTIONS_TOKEN.id).not.toBe(createToken('DiscoveryOptions').id);
  });

  it('uses the TitanDiscovery: namespace', () => {
    expect(DISCOVERY_SERVICE_TOKEN.id).toBe(Symbol.for('nexus:token:TitanDiscovery:Service'));
    expect(REDIS_TOKEN.id).toBe(Symbol.for('nexus:token:TitanDiscovery:Redis'));
    expect(DISCOVERY_OPTIONS_TOKEN.id).toBe(Symbol.for('nexus:token:TitanDiscovery:Options'));
  });
});
