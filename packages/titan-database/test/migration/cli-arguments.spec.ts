import { describe, expect, it } from 'vitest';
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
      await writeFile(join(directory, '001_first.js'), "export const checksum = '" + 'a'.repeat(64) + "'; export async function up() {} export async function down() {}");
      await writeFile(join(directory, '003_ignored.test.js'), 'throw new Error("test file must not be imported")');
      const migrations = await loadMigrationFiles(directory);
      expect(migrations.map(m => m.name)).toEqual(['001_first', '002_second']);
      expect(migrations[0]?.checksum).toBe('a'.repeat(64));
      expect(migrations[1]?.checksum).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
