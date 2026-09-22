/**
 * Every app was handed a hostname whose first address refuses connections.
 *
 * `localhost` resolves to two addresses, and Node tries them in the order the
 * resolver returns them — `::1` first on this machine. Docker publishes the
 * stand's infrastructure on IPv4 only:
 *
 *     daos-dev-redis      127.0.0.1:6379->6379/tcp
 *     daos-dev-postgres   127.0.0.1:5432->5432/tcp
 *
 * so the first attempt of every new connection is refused, and the client
 * reaches the service on the second. Measured here, five connects each:
 *
 *     redis     localhost   0.91–3.76 ms      postgres  localhost   0.74–1.79 ms
 *     redis     127.0.0.1   0.35–0.75 ms      postgres  127.0.0.1   0.24–0.70 ms
 *     redis     ::1         ECONNREFUSED      postgres  ::1         ECONNREFUSED
 *
 * The cost in time is a couple of milliseconds. The cost in the log is not:
 * about 3 500 ERROR records on the dev stand across the `default`, `sessions`,
 * `rotif` and `priceverse` clients, each an `AggregateError [ECONNREFUSED]`
 * whose own `message` is empty and whose `aggregateErrors` carry
 * `connect ECONNREFUSED ::1:6379`, followed a moment later by
 * «Redis client "default" connected successfully». A refusal that is always
 * followed by a success teaches an operator to read past refusals.
 *
 * The address of infrastructure this daemon provisioned itself is not a name
 * to be resolved — it is the interface the container publishes on. A NODE's
 * address stays a name: `stackConfig.nodes[].host` is whatever the operator
 * wrote, and this does not touch it.
 */

import { describe, it, expect } from 'vitest';

import { resolveStack, resolvedConfigToEnv } from '../../src/project/config-resolver.js';
import type { IEcosystemConfig, IStackConfig, IAppDefinition } from '../../src/config/types.js';

const definition = (name: string): IAppDefinition => ({
  name,
  version: '1.0.0',
  processes: [{ name: 'http', module: `apps/${name}/src/http.ts` }],
  omnitronConfig: { redis: true, database: true, s3: true },
});

function envOf(stackConfig: IStackConfig) {
  const config: IEcosystemConfig = { project: 'hosts', apps: [{ name: 'alpha' }] };
  const resolved = resolveStack(
    config,
    'hosts',
    'dev',
    stackConfig,
    new Map([['alpha', definition('alpha')]]),
  );
  return resolvedConfigToEnv(resolved.appConfigs.get('alpha')!, 'alpha', 'dev');
}

describe('a name that resolved to a closed door', () => {
  it('local infrastructure is addressed by the interface it is published on', () => {
    const env = envOf({ type: 'local', apps: 'all' });

    for (const key of ['REDIS_URL', 'DATABASE_URL', 'S3_ENDPOINT']) {
      expect(env[key], `${key} is missing from the environment`).toBeTruthy();
      expect(
        env[key],
        `${key} names a host whose first address refuses the connection`,
      ).not.toMatch(/localhost/);
      expect(env[key]).toMatch(/127\.0\.0\.1/);
    }
  });

  it("a node's address is a name the operator wrote, and stays one", () => {
    // Control: only the address of infrastructure this daemon provisioned is
    // an interface. A remote stack points at a host, and that host is
    // whatever it was configured to be.
    const env = envOf({
      type: 'remote',
      apps: 'all',
      nodes: [{ name: 'node-1', host: 'db.internal' }],
    } as IStackConfig);

    expect(env['DATABASE_URL'], 'a configured hostname must survive').toMatch(/db\.internal/);
  });
});
