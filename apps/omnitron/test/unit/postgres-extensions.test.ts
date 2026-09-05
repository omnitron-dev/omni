/**
 * `omnitronConfig.database.extensions` — declared everywhere, wired nowhere.
 *
 * The field was in `OmnitronAppConfig` and in the zod schema apps validate
 * their own config against, so an app could write
 * `database: { extensions: ['postgis'] }`, have it accepted by every layer
 * that looked at it, and get a plain container. The failure surfaced three
 * layers away as `$libdir/postgis-3: No such file` on the app's first
 * spatial query — a message about a shared library, not about a setting that
 * was dropped. The workaround was to override the image by hand in the stack
 * config, which is exactly why the gap survived: it read as an image problem.
 *
 * These tests follow the value the whole way — app declaration, requirements
 * scan, infrastructure config, and the SQL the provisioner runs — because
 * every one of those handoffs was a place it could be, and was, dropped.
 */

import { describe, it, expect, vi } from 'vitest';

import { buildInfraFromRequirements, type ProjectRequirements } from '../../src/project/requirements-scanner.js';
import { postgresPreset } from '../../src/infrastructure/presets/postgres.js';
import type { IPostProvisionContext } from '../../src/infrastructure/presets/types.js';

const silentLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
  child: () => silentLogger,
} as never;

/** A post-provision context that records the psql commands it is asked to run. */
function recordingContext(
  databases: Record<string, { extensions?: string[] }>,
  { failOn }: { failOn?: string } = {}
): { ctx: IPostProvisionContext; commands: string[][] } {
  const commands: string[][] = [];
  const ctx = {
    containerName: 'omni-dev-postgres',
    userConfig: { databases },
    secrets: { user: 'postgres', password: 'postgres' },
    ports: { main: 5432 },
    logger: silentLogger,
    execInContainer: async (command: string[]) => {
      commands.push(command);
      const sql = command.at(-1) ?? '';
      if (failOn && sql.includes(failOn)) throw new Error(`extension "${failOn}" is not available`);
      // "does this database exist" → no, so the CREATE DATABASE branch runs.
      return sql.startsWith('SELECT 1 FROM pg_database') ? '' : 'CREATE EXTENSION';
    },
  } as unknown as IPostProvisionContext;
  return { ctx, commands };
}

const sqlOf = (commands: string[][]) => commands.map((c) => c.at(-1) ?? '');

describe('extensions reach the infrastructure config', () => {
  function requirements(extensions?: string[]): ProjectRequirements {
    return {
      databases: [{ app: 'geo', database: 'geo', pool: undefined, extensions }],
      redis: { appCount: 0, allocations: [] },
      buckets: [],
      needsAuth: false,
    } as unknown as ProjectRequirements;
  }

  it('carries a declared extension through the requirements scan', () => {
    const infra = buildInfraFromRequirements(requirements(['postgis']));

    expect(infra.postgres?.databases['geo']).toMatchObject({ extensions: ['postgis'] });
  });

  it('leaves the key off entirely when nothing was declared', () => {
    // An empty array in the config would read as "this app was considered
    // and needs none", which is not the same as "it never said".
    const infra = buildInfraFromRequirements(requirements(undefined));

    expect(infra.postgres?.databases['geo']).not.toHaveProperty('extensions');
  });
});

describe('the provisioner creates them', () => {
  it('runs CREATE EXTENSION in the app database, not in postgres', async () => {
    // `-d geo` is the whole point: an extension created in the default
    // database is invisible to the app and the query still fails.
    const { ctx, commands } = recordingContext({ geo: { extensions: ['postgis'] } });

    await postgresPreset.postProvision!(ctx);

    const create = commands.find((c) => (c.at(-1) ?? '').includes('CREATE EXTENSION'));
    expect(create, 'no CREATE EXTENSION was issued').toBeDefined();
    expect(create).toContain('-d');
    expect(create![create!.indexOf('-d') + 1]).toBe('geo');
    expect(create!.at(-1)).toBe('CREATE EXTENSION IF NOT EXISTS "postgis"');
  });

  it('creates every declared extension', async () => {
    const { ctx, commands } = recordingContext({ main: { extensions: ['uuid-ossp', 'pg_trgm'] } });

    await postgresPreset.postProvision!(ctx);

    const sql = sqlOf(commands).join('\n');
    expect(sql).toContain('"uuid-ossp"');
    expect(sql).toContain('"pg_trgm"');
  });

  it('issues nothing extra for a database that declared none', async () => {
    const { ctx, commands } = recordingContext({ main: {} });

    await postgresPreset.postProvision!(ctx);

    expect(sqlOf(commands).some((s) => s.includes('CREATE EXTENSION'))).toBe(false);
  });

  it('keeps going when one extension is missing from the image', async () => {
    // postgres:17-alpine ships contrib but not postgis. Losing pg_trgm as
    // well because postgis failed would turn one missing feature into two.
    const { ctx, commands } = recordingContext(
      { geo: { extensions: ['postgis', 'pg_trgm'] } },
      { failOn: 'postgis' }
    );

    await postgresPreset.postProvision!(ctx);

    expect(sqlOf(commands).join('\n')).toContain('"pg_trgm"');
    expect(silentLogger.error).toHaveBeenCalled();
  });

  it('refuses a name that is not an identifier', async () => {
    // The value comes from a config file rather than a request, but it is
    // interpolated into SQL either way.
    const { ctx, commands } = recordingContext({ main: { extensions: ['x"; DROP DATABASE main; --'] } });

    await postgresPreset.postProvision!(ctx);

    expect(sqlOf(commands).some((s) => s.includes('DROP DATABASE'))).toBe(false);
  });
});
