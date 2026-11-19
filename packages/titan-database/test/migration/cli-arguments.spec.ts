import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMigrationFiles, parseMigrationCliArgs } from '../../src/migration/cli.js';

describe('migration command safety', () => {
  it.each([['--down', '-1'], ['--down', '1.5'], ['--down', '9007199254740992'],
    ['--status', '--down'], ['--unknown'], ['up', '--status'], ['--verify', 'extra']])(
    'rejects unsupported arguments before connecting: %j', (...args) => {
      expect(() => parseMigrationCliArgs(args)).toThrow();
    },
  );
  it('preserves explicit read-only and zero-rollback commands', () => {
    expect(parseMigrationCliArgs(['--verify']).kind).toBe('verify');
    expect(parseMigrationCliArgs(['--', '--verify']).kind).toBe('verify');
    expect(parseMigrationCliArgs(['--down', '0'])).toMatchObject({ kind: 'down', steps: 0 });
    expect(parseMigrationCliArgs(['--no-checksums', '--status'])).toMatchObject({ kind: 'status', enforceChecksums: false });
  });
  it('shares ordered file discovery and preserves explicitly exported content digests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-files-'));
    try {
      await writeFile(join(directory, 'package.json'), '{"type":"module"}');
      await writeFile(join(directory, '002_second.migration.js'), 'export async function up() {} export async function down() {}');
      const helper = new URL('../../src/migration/postgres.ts', import.meta.url).href;
      const sql = (table: string) => [`CREATE TABLE ${table} (id bigint PRIMARY KEY)`, `DROP TABLE ${table}`];
      for (const [name, table] of [['001_first', 'notes'], ['004_last', 'labels']] as const) {
        await writeFile(join(directory, `${name}.js`), [
          `import { defineSqlMigration } from ${JSON.stringify(helper)};`,
          `export const { up, down, checksum } = defineSqlMigration(${JSON.stringify(name)}, ...${JSON.stringify(sql(table))});`,
        ].join('\n'));
      }
      await writeFile(join(directory, '003_ignored.test.js'), 'throw new Error("test file must not be imported")');
      const migrations = await loadMigrationFiles(directory);
      expect(migrations.map(m => m.name)).toEqual(['001_first', '002_second', '004_last']);
      const sqlDigest = (table: string) => createHash('sha256').update(JSON.stringify(sql(table))).digest('hex');
      expect(migrations.map(m => m.checksum)).toEqual([sqlDigest('notes'), undefined, sqlDigest('labels')]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
