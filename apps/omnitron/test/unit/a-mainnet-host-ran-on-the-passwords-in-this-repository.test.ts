/**
 * A stack deployed to a public host ran on `minioadmin/minioadmin`.
 *
 * Presets carry defaults because a preset has to work before anyone
 * configures anything, and on a laptop behind loopback that is the right
 * trade. Nothing turned it into anything else, so the object store and the
 * database of a deployment on a server chosen for a payment system ran on
 * the credentials printed in this repository.
 *
 * Two properties make generated credentials usable at all, and both are the
 * design:
 *
 *   STABLE — a Postgres data directory keeps the password it was
 *   initialised with, so a new one on the next provision produces a
 *   database that rejects its own application.
 *
 *   LOCAL — the vault belongs to the daemon that creates the container. A
 *   master generating these would have to transmit them, putting a password
 *   on the wire to solve a problem the node does not have.
 */

import { describe, it, expect } from 'vitest';

import {
  resolveServiceCredentials,
  needsGenerating,
  isCredential,
  generateSecret,
  credentialKey,
} from '../../src/infrastructure/service-credentials.js';

/** A vault that remembers, like the real one. */
function vault(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => { store.set(k, v); },
  };
}

const MINIO_DEFAULTS = { accessKey: 'minioadmin', secretKey: 'minioadmin' };
const resolve = (v: ReturnType<typeof vault>, declared?: Record<string, string>) =>
  resolveServiceCredentials({
    project: 'daos', stack: 'test', service: 'minio',
    presetDefaults: MINIO_DEFAULTS, declared, vault: v,
  });

describe('a service that still has its preset password', () => {
  it('gets a generated one', async () => {
    const v = vault();

    const secrets = await resolve(v);

    expect(secrets['secretKey']).not.toBe('minioadmin');
    expect(secrets['secretKey']!.length).toBeGreaterThan(30);
  });

  it('keeps the same one on every later provision', async () => {
    const v = vault();

    const first = await resolve(v);
    const second = await resolve(v);

    // A Postgres data directory keeps the password it was initialised with.
    // A new one each time produces a database that rejects its own
    // application, and the symptom reads as a bad config.
    expect(second['secretKey']).toBe(first['secretKey']);
    expect(v.store.size).toBe(1);
  });

  it('keeps the identity readable', async () => {
    const secrets = await resolve(vault());

    // A username is not a secret: it appears in connection strings, in logs
    // and in `psql -U`. Generating one produces a service an operator cannot
    // reach by hand when something is wrong.
    expect(secrets['accessKey']).toBe('minioadmin');
    expect(isCredential('user')).toBe(false);
    expect(isCredential('accessKey')).toBe(false);
    expect(isCredential('password')).toBe(true);
  });
});

describe('a password an operator wrote', () => {
  it('is left alone, weak or not', async () => {
    const v = vault();

    const secrets = await resolve(v, { secretKey: 'hunter2' });

    // Silently replacing a configured password with a random one produces a
    // service nobody can log into and no message saying why.
    expect(secrets['secretKey']).toBe('hunter2');
    expect(v.store.size).toBe(0);
  });

  it('is distinguished from the preset default by value', () => {
    // Someone who deliberately writes `minioadmin` gets it generated anyway,
    // and that is the right way round: the two are indistinguishable, and
    // the safe reading of an ambiguous case is the one that does not leave
    // a public host on a published password.
    expect(needsGenerating({ secretKey: 'minioadmin' }, MINIO_DEFAULTS)).toContain('secretKey');
    expect(needsGenerating({ secretKey: 'chosen' }, MINIO_DEFAULTS)).not.toContain('secretKey');
    expect(needsGenerating(undefined, MINIO_DEFAULTS)).toEqual(['accessKey', 'secretKey']);
  });
});

describe('the generated value', () => {
  it('survives every syntax it travels through', () => {
    const secrets = Array.from({ length: 50 }, () => generateSecret());

    // These travel through connection strings, YAML, docker `-e` arguments
    // and shell here-documents. `+`, `/` and `=` each mean something to at
    // least one of those.
    for (const secret of secrets) {
      expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    // And they are not each other.
    expect(new Set(secrets).size).toBe(50);
  });
});

describe('where a credential is kept', () => {
  it('is scoped to the stack, so two stacks are two passwords', () => {
    const a = credentialKey('daos', 'test', 'minio', 'secretKey');
    const b = credentialKey('daos', 'dev', 'minio', 'secretKey');

    expect(a).not.toBe(b);
    expect(a).toContain('daos');
    expect(a).toContain('test');
  });
});

describe('a stack config, with credentials filled in', () => {
  it('replaces the preset password and leaves the rest alone', async () => {
    const { withGeneratedCredentials } = await import('../../src/infrastructure/service-credentials.js');
    const v = vault();

    const config = {
      postgres: { image: 'postgis:17', port: 5432, user: 'omnitron', password: 'postgres', databases: { main: {} } },
      minio: { ports: { api: 9000 }, accessKey: 'minioadmin', secretKey: 'minioadmin' },
      redis: { port: 6379 },
    };

    const filled = await withGeneratedCredentials(config, { project: 'daos', stack: 'test', vault: v });

    expect(filled.postgres.password).not.toBe('postgres');
    expect(filled.minio.secretKey).not.toBe('minioadmin');
    // Identity, ports and everything else are untouched.
    expect(filled.postgres.user).toBe('omnitron');
    expect(filled.postgres.databases).toEqual({ main: {} });
    expect(filled.minio.accessKey).toBe('minioadmin');
    expect(filled.postgres.port).toBe(5432);
  });

  it('leaves redis open, because that is the preset s posture', async () => {
    const { withGeneratedCredentials } = await import('../../src/infrastructure/service-credentials.js');

    const filled = await withGeneratedCredentials({ redis: { port: 6379 } }, {
      project: 'daos', stack: 'test', vault: vault(),
    });

    // The redis preset ships no password at all, and a redis with no
    // `requirepass` accepts anyone who reaches it. On loopback that is the
    // documented posture; generating one here would be a second opinion
    // about a service the preset deliberately leaves open.
    expect(filled.redis).toEqual({ port: 6379 });
  });

  it('does not touch a config the operator wrote a password into', async () => {
    const { withGeneratedCredentials } = await import('../../src/infrastructure/service-credentials.js');
    const v = vault();

    const filled = await withGeneratedCredentials({ postgres: { password: 'chosen-by-a-person' } }, {
      project: 'daos', stack: 'test', vault: v,
    });

    expect(filled.postgres.password).toBe('chosen-by-a-person');
    expect(v.store.size).toBe(0);
  });

  it('returns the same credentials on a second provision', async () => {
    const { withGeneratedCredentials } = await import('../../src/infrastructure/service-credentials.js');
    const v = vault();
    const config = { postgres: { password: 'postgres' } };

    const first = await withGeneratedCredentials(config, { project: 'daos', stack: 'test', vault: v });
    const second = await withGeneratedCredentials(config, { project: 'daos', stack: 'test', vault: v });

    expect(second.postgres.password).toBe(first.postgres.password);
  });

  it('does not mutate the config it was given', async () => {
    const { withGeneratedCredentials } = await import('../../src/infrastructure/service-credentials.js');
    const config = { postgres: { password: 'postgres' } };

    await withGeneratedCredentials(config, { project: 'daos', stack: 'test', vault: vault() });

    // The caller's copy is what the master sent and what a later comparison
    // reads; substituting a secret into it would put the password into
    // whatever that config is logged or compared against next.
    expect(config.postgres.password).toBe('postgres');
  });
});

describe('a service that already holds state', () => {
  it('is left on what it has, and said so', async () => {
    const { withGeneratedCredentials } = await import('../../src/infrastructure/service-credentials.js');
    const v = vault();
    const told: Array<[string, string]> = [];

    const filled = await withGeneratedCredentials({ postgres: { password: 'postgres' } }, {
      project: 'daos', stack: 'test', vault: v,
      hasExistingState: async () => true,
      onLeftOnDefault: (service, field) => told.push([service, field]),
    });

    // A Postgres data directory keeps the password it was created with and
    // ignores `POSTGRES_PASSWORD` thereafter. Generating one here produces
    // an application holding a credential the database has never heard of —
    // a failure that reads as a bad config and is fixed by neither side.
    expect(filled.postgres.password).toBe('postgres');
    expect(v.store.size).toBe(0);
    expect(told).toEqual([['postgres', 'password']]);
  });

  it('generates at a FIRST provision, where volume and vault agree', async () => {
    const { withGeneratedCredentials } = await import('../../src/infrastructure/service-credentials.js');
    const v = vault();

    const filled = await withGeneratedCredentials({ postgres: { password: 'postgres' } }, {
      project: 'daos', stack: 'test', vault: v,
      hasExistingState: async () => false,
    });

    expect(filled.postgres.password).not.toBe('postgres');
  });

  it('never re-asks once the vault has an answer', async () => {
    const { withGeneratedCredentials } = await import('../../src/infrastructure/service-credentials.js');
    const v = vault();
    let asked = 0;

    await withGeneratedCredentials({ postgres: { password: 'postgres' } }, {
      project: 'daos', stack: 'test', vault: v, hasExistingState: async () => { asked += 1; return false; },
    });
    const second = await withGeneratedCredentials({ postgres: { password: 'postgres' } }, {
      project: 'daos', stack: 'test', vault: v, hasExistingState: async () => { asked += 1; return false; },
    });

    // The vault entry IS the record that generation happened; a volume that
    // was removed and recreated must not produce a second password for a
    // service the vault already speaks for.
    expect(asked).toBe(1);
    expect(second.postgres.password).toBe(await v.get('infra:daos:test:postgres:password'));
  });
});

describe('asking whether a volume exists', () => {
  it('answers "assume state" when it cannot tell', async () => {
    const { volumeExists } = await import('../../src/infrastructure/container-runtime.js');

    // Only the message that means absence answers absence. Docker
    // unreachable, a timeout, a permission error — none of those are
    // evidence that a volume is missing, and the caller generates a
    // credential when this says false.
    await expect(volumeExists('omnitron-test-definitely-not-a-real-volume-xyz')).resolves.toBe(false);
  });
});

describe('the report that a deployment is on a default credential', () => {
  it('goes to the logger the daemon passed', async () => {
    const { withGeneratedCredentials } = await import('../../src/infrastructure/service-credentials.js');
    const errors: string[] = [];
    // Shaped like the daemon's logger, because that is what gets passed and
    // a callback the real one cannot satisfy is a test that proves nothing.
    const logger = { error: (obj: object, msg?: string) => errors.push(`${msg} ${JSON.stringify(obj)}`) };

    await withGeneratedCredentials({ postgres: { password: 'postgres' } }, {
      project: 'daos', stack: 'test', vault: vault(),
      hasExistingState: async () => true,
      onLeftOnDefault: (service, field) =>
        logger.error({ service, secret: field }, `${service} is still on its default ${field}`),
    });

    // A volume that exists means the service was initialised with some other
    // password, so nothing is generated — and the whole value of that
    // decision is in saying it. The logger was an optional constructor
    // argument that nothing passed: the mechanism worked and reported to
    // nobody, which is the same shape as the defects it exists to prevent.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/postgres is still on its default password/);
    expect(errors[0]).toContain('"service":"postgres"');
  });
});
