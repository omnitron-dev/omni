/**
 * Six apps were given `postgres:postgres` against a generated secret.
 *
 * The config a master writes onto a node listed the apps, their bootstrap
 * paths and the stack to run them in — and no `infrastructure` block, because
 * the master has nothing to put there: `provisionStack` runs
 * `withGeneratedCredentials` against the NODE's vault, so a stack that
 * declares no password has none for the master to know.
 *
 * `resolveStackAddresses` reads that block and nothing else when it builds
 * `DATABASE_URL`, `REDIS_URL` and the S3 variables, and its fallback for an
 * absent one is not an error:
 *
 *     const defaultPgPassword =
 *       infra?.postgres?.password ?? getEnv().POSTGRES_PASSWORD ?? 'postgres';
 *
 * Measured on the test node, all six apps at once:
 *
 *     Database connection default failed after 5 retries:
 *     password authentication failed for user "postgres" (28P01)
 *
 * — against `daos-test-postgres`, whose own 43-character generated password
 * answers over TCP. On a laptop that same fallback is CORRECT: a local stack
 * with no declared password really does use `postgres`. That is why nothing
 * caught it until a stack with generated credentials ran somewhere else, and
 * why the fix is to fill the block rather than to remove the fallback.
 *
 * Two halves of one description, each authoritative for its own: the master
 * decides WHAT the stack is, the node decides what the SECRETS are.
 */

import { describe, it, expect } from 'vitest';

import { overlayCredentials } from '../../src/infrastructure/node-credentials.js';
import { renderNodeAppConfig } from '../../src/project/node-app-config.js';

const GENERATED = 'Xk3p9QzR7tLmN2vB8cF4wJ6hY1sD5gA0eU-iO_pT3qZ';

describe('the node knows the secrets and the master knows the shape', () => {
  it('takes the password from the node and the port from the stack', () => {
    const out = overlayCredentials(
      { postgres: { port: 5432, user: 'postgres', password: 'postgres', databases: { geo: { migrate: true } } } },
      { postgres: { host: 'localhost', port: 9999, user: 'postgres', password: GENERATED } },
    ) as { postgres: Record<string, unknown> };

    expect(out.postgres['password']).toBe(GENERATED);
    // The node's port is NOT taken: it carried out the stack's decision and
    // letting its answer win would make a node's drift authoritative.
    expect(out.postgres['port']).toBe(5432);
    expect(out.postgres['databases']).toEqual({ geo: { migrate: true } });
  });

  it('takes both of minio\'s secrets and neither of its addresses', () => {
    const out = overlayCredentials(
      { minio: { ports: { api: 9000 }, accessKey: 'minioadmin', secretKey: 'minioadmin', buckets: ['storage'] } },
      { minio: { endpoint: 'http://localhost:9000', accessKey: 'AK' + GENERATED, secretKey: 'SK' + GENERATED } },
    ) as { minio: Record<string, unknown> };

    expect(out.minio['accessKey']).toBe('AK' + GENERATED);
    expect(out.minio['secretKey']).toBe('SK' + GENERATED);
    expect(out.minio['buckets']).toEqual(['storage']);
    expect(out.minio['ports']).toEqual({ api: 9000 });
  });

  it('leaves a service the node could not answer for exactly as declared', () => {
    const declared = { postgres: { port: 5432, password: 'declared-secret' }, redis: { port: 6379 } };
    const out = overlayCredentials(declared, { postgres: { password: GENERATED } }) as Record<
      string,
      Record<string, unknown>
    >;

    expect(out['postgres']!['password']).toBe(GENERATED);
    expect(out['redis']).toEqual({ port: 6379 });
  });

  it('does not invent a service nobody declared', () => {
    // `getConnectionInfo` answers for anything it has configured. An answer
    // about something this stack did not ask to provision is not evidence
    // that it should exist in the stack's config.
    const out = overlayCredentials({ postgres: { port: 5432 } }, { minio: { accessKey: 'AK', secretKey: 'SK' } });

    expect(Object.keys(out!)).toEqual(['postgres']);
  });

  it('refuses an empty answer rather than blanking a real secret', () => {
    const out = overlayCredentials(
      { postgres: { password: 'declared-secret' } },
      { postgres: { password: '' } },
    ) as { postgres: Record<string, unknown> };

    expect(out.postgres['password']).toBe('declared-secret');
  });

  it('does not modify what it was given', () => {
    const declared = { postgres: { port: 5432, password: 'old' } };
    overlayCredentials(declared, { postgres: { password: GENERATED } });

    expect(declared.postgres.password).toBe('old');
  });

  it('says nothing about a stack with no infrastructure at all', () => {
    expect(overlayCredentials(undefined, { postgres: { password: GENERATED } })).toBeUndefined();
  });
});

describe('the config written onto the node carries what the apps connect to', () => {
  const base = {
    project: 'daos',
    artifactRoot: '/opt/omnitron/artifacts',
    apps: [{ name: 'geo', script: 'src/main.ts' }] as never,
    artifacts: [{ app: 'geo', version: '0.0.1' }],
  };

  it('emits the infrastructure block when it has one', () => {
    const body = renderNodeAppConfig({
      ...base,
      infrastructure: { postgres: { port: 5432, user: 'postgres', password: GENERATED } },
    });

    const parsed = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
    expect(parsed.infrastructure.postgres.password).toBe(GENERATED);
    expect(parsed.infrastructure.postgres.port).toBe(5432);
  });

  it('omits it entirely rather than writing an empty one', () => {
    // An empty `infrastructure: {}` reads to `resolveStackAddresses` exactly
    // as a missing one does, and writing it would claim a decision nobody
    // made. The absence is at least honest.
    const body = renderNodeAppConfig(base);
    const parsed = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));

    expect('infrastructure' in parsed).toBe(false);
  });

  it('warns the reader that the file holds credentials', () => {
    // The file was written 0644 for as long as it has existed. That was
    // harmless only while it held nothing worth reading.
    const body = renderNodeAppConfig({ ...base, infrastructure: { postgres: { password: GENERATED } } });
    expect(body).toMatch(/CONTAINS CREDENTIALS/);
    expect(body).toMatch(/0600/);
  });

  it('still lists the apps and their stack', () => {
    const body = renderNodeAppConfig({ ...base, infrastructure: { postgres: { password: GENERATED } } });
    const parsed = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));

    expect(parsed.apps.map((a: { name: string }) => a.name)).toEqual(['geo']);
    expect(parsed.stacks.deployed.apps).toEqual(['geo']);
  });
});
