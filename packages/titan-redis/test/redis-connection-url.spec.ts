/**
 * `url` is documented as "Connection string URL (overrides other connection
 * options)" and was read by nothing — not by createRedisClient, and not even
 * carried through toInternalClientOptions.
 *
 * The failure is worse than inert. createRedisClient falls back to
 * `host: options.host || 'localhost'` and `port: options.port || 6379`, so a
 * client configured with `redis://user:pass@prod-host:6380/3` connected to
 * localhost:6379 — and on any machine with a local Redis running, that
 * connection SUCCEEDS. Wrong server, wrong database, no error.
 *
 * These assert on the client's resolved options rather than on traffic:
 * lazyConnect keeps them offline, and where the connection points is exactly
 * what was wrong.
 */

import { describe, it, expect } from 'vitest';

import { createRedisClient } from '../src/redis.utils.js';
import { toInternalClientOptions } from '../src/redis.types.js';

describe('connection string', () => {
  it('decides host, port and database', async () => {
    const client = createRedisClient({
      url: 'redis://127.0.0.1:6399/7',
      lazyConnect: true,
    }) as unknown as { options: { host: string; port: number; db: number }; disconnect: () => void };

    try {
      expect(client.options.host, 'the connection string did not set the host').toBe('127.0.0.1');
      expect(client.options.port, 'the connection string did not set the port').toBe(6399);
      expect(client.options.db, 'the connection string did not select the database').toBe(7);
    } finally {
      client.disconnect();
    }
  });

  it('carries credentials from the string', () => {
    const client = createRedisClient({
      url: 'redis://someuser:somepass@127.0.0.1:6399',
      lazyConnect: true,
    }) as unknown as { options: { username?: string; password?: string }; disconnect: () => void };

    try {
      expect(client.options.username).toBe('someuser');
      expect(client.options.password).toBe('somepass');
    } finally {
      client.disconnect();
    }
  });

  it('overrides host and port given alongside it', () => {
    // "overrides other connection options" is the documented contract.
    const client = createRedisClient({
      url: 'redis://127.0.0.1:6399/2',
      host: 'ignored-host',
      port: 1111,
      lazyConnect: true,
    }) as unknown as { options: { host: string; port: number }; disconnect: () => void };

    try {
      expect(client.options.host).toBe('127.0.0.1');
      expect(client.options.port).toBe(6399);
    } finally {
      client.disconnect();
    }
  });

  it('still applies options the string cannot carry', () => {
    const client = createRedisClient({
      url: 'redis://127.0.0.1:6399',
      connectionName: 'named-by-options',
      lazyConnect: true,
    } as never) as unknown as { options: { connectionName?: string }; disconnect: () => void };

    try {
      expect(client.options.connectionName).toBe('named-by-options');
    } finally {
      client.disconnect();
    }
  });

  it('survives the public-to-internal conversion', () => {
    // The conversion rebuilds the options field by field; `url` was not in the
    // list, so it never reached createRedisClient from a module config at all.
    const internal = toInternalClientOptions({ url: 'redis://127.0.0.1:6399/4' });
    expect(internal.url, 'url was dropped converting the public options').toBe('redis://127.0.0.1:6399/4');
  });

  it('falls back to host and port when no string is given', () => {
    const client = createRedisClient({
      host: '127.0.0.1',
      port: 6399,
      lazyConnect: true,
    }) as unknown as { options: { host: string; port: number }; disconnect: () => void };

    try {
      expect(client.options.host).toBe('127.0.0.1');
      expect(client.options.port).toBe(6399);
    } finally {
      client.disconnect();
    }
  });
});
