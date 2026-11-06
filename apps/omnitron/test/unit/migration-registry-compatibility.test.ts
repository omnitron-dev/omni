import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { compareMigrationChecksumMetadata } from '../../src/database/migration-registry-compatibility.js';
import { assertBackendMigrationsCompatible } from '../../src/daemon/backend-candidate.js';

const digest = 'a'.repeat(64), other = 'b'.repeat(64);
const oldRegistry = `import * as first from './001_initial.js';
import * as second from './002_next.js';
export const SLAVE_MIGRATIONS = [
  { name: '001_initial', up: first.up, down: first.down },
  second.migration,
];`;
const nextRegistry = oldRegistry.replace("name: '001_initial',", `name: '001_initial', checksum: '${digest}',`);
const compare = (left: string, right: string) => compareMigrationChecksumMetadata(left, right, 'SLAVE_MIGRATIONS');

it('admits explicit checksums and their rollback while preserving every execution node', () => {
  expect(compare(oldRegistry, '// Checksums apply only to new executions.\n' + nextRegistry)).toEqual([
    { name: '001_initial', before: null, after: digest },
  ]);
  expect(compare(nextRegistry, oldRegistry)).toEqual([{ name: '001_initial', before: digest, after: null }]);
});

it('never replaces an already declared checksum', () => {
  expect(() => compare(nextRegistry, nextRegistry.replace(digest, other))).toThrow('checksum changed');
});

it.each([
  ['up binding', nextRegistry.replace('up: first.up', 'up: second.up')],
  ['down binding', nextRegistry.replace('down: first.down', 'down: second.down')],
  ['removed rollback', nextRegistry.replace(', down: first.down', '')],
  ['changed name', nextRegistry.replace("name: '001_initial'", "name: '002_next'")],
  ['removed migration', nextRegistry.replace('  second.migration,', '')],
  ['extra execution', nextRegistry + '\nglobalThis.executeMigration = true;'],
  ['extra import', nextRegistry + "\nimport './side-effect.js';"],
  ['import path', nextRegistry.replace("'./001_initial.js'", "'../001_initial.js'")],
  ['dynamic array', nextRegistry.replace('second.migration,', '...loadMigrations(),')],
  ['dynamic migration', nextRegistry.replace('second.migration,', 'loadMigration(),')],
  ['duplicate name', nextRegistry.replace('second.migration,', "{ name: '001_initial', up: first.up },")],
  ['duplicate checksum', nextRegistry.replace(`checksum: '${digest}',`, `checksum: '${digest}', checksum: '${digest}',`)],
  ['getter', nextRegistry.replace(`checksum: '${digest}'`, `get checksum() { return '${digest}'; }`)],
  ['computed checksum', nextRegistry.replace('checksum:', "['checksum']: ")],
  ['dynamic checksum', nextRegistry.replace(`'${digest}'`, 'calculateChecksum()')],
  ['invalid digest', nextRegistry.replace(digest, 'not-a-sha256')],
  ['null checksum', nextRegistry.replace(`'${digest}'`, 'null')],
  ['object spread', nextRegistry.replace('up: first.up', '...first')],
  ['unsupported property', nextRegistry.replace('up: first.up', 'up: first.up, transaction: false')],
  ['wrapper', nextRegistry.replace('up: first.up', 'up: db => first.up(db)')],
  ['syntax error', nextRegistry + '\nexport const = ;'],
])('refuses %s without executing the registry', (_reason, changed) => {
  expect(() => compare(oldRegistry, changed)).toThrow();
});

it('does not remove checksum-looking text from SQL strings or comments', () => {
  const prefix = `export const sql = "name: '001_initial', checksum: '${digest}', up: first.up";\n`;
  expect(() => compare(prefix + oldRegistry, prefix.replace(digest, other) + nextRegistry)).toThrow('execution changed');
  expect(() => compare(oldRegistry, oldRegistry + `\n// checksum: '${digest}'`)).toThrow('not a checksum metadata');
});

it('keeps the declared ordering of procedural and SQL migrations', () => {
  const reversed = nextRegistry.replace('export const SLAVE_MIGRATIONS = [', 'export const SLAVE_MIGRATIONS = [second.migration,')
    .replace('\n  second.migration,', '');
  expect(() => compare(oldRegistry, reversed)).toThrow('execution changed');
});

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-registry-')); roots.push(root);
  const before = path.join(root, 'before'), after = path.join(root, 'after');
  for (const [dist, source] of [[before, oldRegistry], [after, nextRegistry]] as const) {
    for (const [dir, registry] of [['migrations', 'OMNITRON_MIGRATIONS'], ['slave-migrations', 'SLAVE_MIGRATIONS']]) {
      const directory = path.join(dist, 'database', dir!);
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'index.js'), source.replace('SLAVE_MIGRATIONS', registry!));
      // Importing this body would fail the inspection. Compatibility is static.
      await fs.writeFile(path.join(directory, '001_initial.js'), 'throw Error("Migration body was executed");');
      await fs.writeFile(path.join(directory, '002_next.js'), 'export const migration = {};');
    }
  }
  return { before, after };
}

it.each(['all', 'node'] as const)('admits only registry metadata with exact immutable files (%s)', async scope => {
  const { before, after } = await fixture();
  const result = await assertBackendMigrationsCompatible(before, after, scope);
  expect(result.kind).toBe('checksum-metadata');
  if (result.kind === 'checksum-metadata') expect(result.changes).toHaveLength(scope === 'all' ? 2 : 1);
  await expect(assertBackendMigrationsCompatible(after, before, scope)).resolves.toMatchObject({ kind: 'checksum-metadata' });
});

it.each(['body', 'helper', 'missing', 'extra', 'symlink', 'directory'] as const)('refuses changed migration files: %s', async change => {
  const { before, after } = await fixture();
  const directory = path.join(after, 'database/slave-migrations');
  if (change === 'body') await fs.appendFile(path.join(directory, '001_initial.js'), '\n// even a body comment is immutable');
  if (change === 'helper') {
    await fs.writeFile(path.join(before, 'database/slave-migrations/helper.js'), 'export const value = 1;');
    await fs.writeFile(path.join(directory, 'helper.js'), 'export const value = 2;');
  }
  if (change === 'missing') {
    // A declared body absent from BOTH trees must not qualify through a matching file count.
    await fs.unlink(path.join(before, 'database/slave-migrations/001_initial.js'));
    await fs.unlink(path.join(directory, '001_initial.js'));
  }
  if (change === 'extra') await fs.writeFile(path.join(directory, '003_extra.js'), 'export const up = () => {};');
  if (change === 'directory') await fs.mkdir(path.join(directory, 'changed'));
  if (change === 'symlink') {
    await fs.unlink(path.join(directory, '001_initial.js'));
    await fs.symlink(path.join(before, 'database/slave-migrations/001_initial.js'), path.join(directory, '001_initial.js'));
  }
  await expect(assertBackendMigrationsCompatible(before, after, 'node')).rejects.toThrow();
});
