import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// Optional entry points must remain usable without drivers, DI or a migrator.
vi.mock('pg', () => { throw Error('readiness imported a database driver'); });
vi.mock('mysql2', () => { throw Error('readiness imported a database driver'); });
vi.mock('better-sqlite3', () => { throw Error('readiness imported a database driver'); });
vi.mock('@kysera/migrations', () => { throw Error('readiness imported migration execution'); });
vi.mock('@omnitron-dev/titan', () => { throw Error('readiness imported application DI'); });

it('imports the public readiness entry without creating connections or loading optional drivers', async () => {
  const entry = await import('../src/exports/readiness.js');
  expect(entry.requirePostgresSchema).toBeTypeOf('function');
  expect(entry.SchemaReadinessError).toBeTypeOf('function');
  const error = new entry.SchemaReadinessError('consumer', ['items.id: required column shape']);
  expect(error.code).toBe('database_schema_incompatible');
  expect(error.component).toBe('consumer');
  expect(error.message).toContain('items.id');
});

it('publishes matching type/runtime entry points and keeps the root independent', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.exports['./readiness']).toEqual({
    types: './dist/exports/readiness.d.ts', default: './dist/exports/readiness.js',
  });
  expect(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')).not.toMatch(/from ['"].*readiness/);
  const omni = JSON.parse(readFileSync(new URL('../../../apps/omnitron/package.json', import.meta.url), 'utf8'));
  expect(omni.exports['./readiness']).toEqual({ types: './dist/readiness.d.ts', default: './dist/readiness.js' });
});

it('refuses unbounded or invalid timeouts before acquiring a connection', async () => {
  const { requirePostgresSchema } = await import('../src/exports/readiness.js');
  const pool = { options: {}, connect: vi.fn(), end: vi.fn() };
  for (const invalid of [0, -1, Number.POSITIVE_INFINITY, 1.5, 2_147_483_648]) {
    await expect(requirePostgresSchema(pool, { name: 'fixture', tables: {} }, { statementTimeoutMs: invalid })).rejects.toThrow('positive PostgreSQL timeout');
  }
  expect(pool.connect).not.toHaveBeenCalled();
});
