/**
 * The gateway reached the container beside it through the host, and on a node
 * that road is closed.
 *
 * `resolveGateway` takes `redisConfig` — host, port, db, password — and used
 * three of the four. The host was the literal `'host.docker.internal'`, and
 * both callers passed that same literal with the HOST-published port, so
 * nothing in the signature hinted that the value was ignored or that it was
 * wrong.
 *
 * It works on a developer's Mac, where `host.docker.internal` reaches the
 * host's loopback. It cannot work on a Linux node: `host-gateway` resolves to
 * the docker0 bridge address, and omnitron publishes every managed port on
 * `127.0.0.1` — deliberately, so nothing is reachable from the LAN. The
 * hardening that bound the ports closed the path the gateway was using, and
 * the only evidence was a warning nobody read.
 *
 * Measured on the test node, where the two containers are two addresses on
 * one network — gateway 172.19.0.2, redis 172.19.0.4:
 *
 *     [error] lua tcp socket connect timed out, upstream: 172.17.0.1:6379
 *     [warn]  maintenance_check: Redis connect failed: timeout (172.17.0.1:6379)
 *
 * — on **every request the gateway served**, static assets included, at about
 * 200ms each, with the maintenance check failing open each time. So the
 * control that decides whether the platform is in maintenance had not been
 * able to answer once since the ports were bound, and the page still loaded,
 * which is why it went unnoticed.
 *
 * `networkName`'s own docblock states the mechanism this should have used:
 * "Inter-service DNS-by-name only works on named networks, so apps that need
 * to reach `postgres:5432` from another container can do so without leaking
 * host ports."
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  resolveGateway,
  containerEndpoint,
  setContainerPrefix,
  REDIS_CONTAINER_PORT,
} from '../../src/infrastructure/service-resolver.js';

describe('one container reaches another by name', () => {
  beforeEach(() => {
    setContainerPrefix('daos', 'test');
  });

  it('answers with the container name and the container port', () => {
    expect(containerEndpoint('redis', REDIS_CONTAINER_PORT)).toEqual({
      host: 'daos-test-redis',
      port: 6379,
    });
  });

  it('carries the stack prefix, so two stacks on one host do not collide', () => {
    setContainerPrefix('daos', 'dev');
    expect(containerEndpoint('redis', REDIS_CONTAINER_PORT).host).toBe('daos-dev-redis');
  });

  it('gives the port inside the container, not the one published on the host', () => {
    // The pair is one decision. A stack whose redis is published on 6380
    // still listens on 6379 inside, so a correct name on the published port
    // is a connection to nothing — the same shape as the container name that
    // once travelled without its volume.
    const endpoint = containerEndpoint('redis', REDIS_CONTAINER_PORT);
    expect(endpoint.port).toBe(REDIS_CONTAINER_PORT);
    expect(endpoint.host).not.toContain('host.docker.internal');
  });
});

describe('the gateway is configured with the Redis it was given', () => {
  beforeEach(() => {
    setContainerPrefix('daos', 'test');
  });

  const gateway = (host: string) =>
    resolveGateway(
      { port: 8080, configDir: 'infra/nginx' },
      { host, port: 6379, db: 1 },
      '/opt/omnitron/stack-config/daos/test/gateway',
    );

  it('uses the host from the config rather than a literal', () => {
    // The assertion the defect fails. Every other field of `redisConfig` was
    // read; this one was overwritten with a constant.
    expect(gateway('daos-test-redis').environment?.['REDIS_HOST']).toBe('daos-test-redis');
  });

  it('does not reach for the host bridge on its own', () => {
    const env = gateway('daos-test-redis').environment ?? {};
    expect(env['REDIS_HOST']).not.toBe('host.docker.internal');
  });

  it('still honours an explicit host, for a Redis that is genuinely elsewhere', () => {
    // A stack may declare Redis `external`, on another machine entirely.
    // Reading the parameter is what makes that expressible; hard-coding the
    // bridge is what made it impossible.
    expect(gateway('10.0.0.9').environment?.['REDIS_HOST']).toBe('10.0.0.9');
  });

  it('keeps the rest of the connection intact', () => {
    const env = gateway('daos-test-redis').environment ?? {};
    expect(env['REDIS_PORT']).toBe('6379');
    expect(env['REDIS_DB']).toBe('1');
  });
});
