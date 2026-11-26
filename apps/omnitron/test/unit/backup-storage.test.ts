import type { Command } from '@xec-sh/core';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { create } from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExecutionOutcomeUnknownError } from '@xec-sh/core';
import { testExecution } from '../fixtures/execution.js';

const fixture = { root: '', fail: '', inventory: '', versioning: '', calls: [] as Array<{ args: string[]; env: NodeJS.ProcessEnv }> };
// This MinIO double runs inside the real Xec child process. Only the Docker
// and object-store boundaries are substituted, including streamed stdin/stdout.
const mcFixture = `mc() {
  if [ "$FAKE_MC_FAIL" = credentials ] && [ "$1" = alias ]; then printf '%s %s\\n' "$MC_AK" "$MC_SK" >&2; return 7; fi
  if [ "$1" = "$FAKE_MC_FAIL" ]; then echo 'fixture source failed' >&2; return 7; fi
  case "$1" in
    alias) mkdir -p "$MC_CONFIG_DIR" && printf '%s' "$MC_SK" > "$MC_CONFIG_DIR/secret" ;;
    stat) test -d "$FAKE_OBJECTS" ;;
    version) printf '{"status":"success","url":"%s","versioning":{"status":"%s"}}\\n' "$4" "$FAKE_VERSIONING" ;;
    ls) printf '%s\\n' "$FAKE_INVENTORY" ;;
    cat) cat "$FAKE_OBJECTS/\${2#omniBackup/storage/}" ;;
    pipe) cat > "$FAKE_OBJECTS/\${2#omniBackup/storage/}" ;;
    *) return 19 ;;
  esac
}
`;

async function storedObjects(directory: string) {
  const inventory = await Promise.all((await fs.readdir(directory)).map(async key => {
    const bytes = await fs.readFile(path.join(directory, key));
    return JSON.stringify({ status: 'success', type: 'file', key, size: bytes.length,
      etag: createHash('md5').update(bytes).digest('hex') });
  }));
  return inventory.join('\n');
}

const execution = { async execute(command: Command) {
  if (command.command !== 'docker' || !command.args) throw new Error('Unexpected storage command');
  const args = command.args, env = command.env ?? {};
  fixture.calls.push({ args, env });
  const remotePath = (name: string) => path.join(fixture.root, 'container', name);
  const objects = path.join(fixture.root, 'objects');
  const fixtureEnv = { ...env, FAKE_OBJECTS: objects, FAKE_MC_FAIL: fixture.fail, FAKE_VERSIONING: fixture.versioning };
  if (args.includes('mc')) return testExecution.execute({ ...command,
    command: '/bin/sh', args: ['-c', mcFixture + 'mc "$@"', 'fixture-mc', ...args.slice(args.indexOf('mc') + 1)], env: fixtureEnv,
  });
  if (args[0] === 'exec' && args.includes('sh')) {
    const script = args[args.length - 1]!;
    return testExecution.execute({ ...command,
      command: '/bin/sh', args: ['-c', mcFixture + script],
      env: { ...fixtureEnv, OMNI_BACKUP_STAGE: remotePath(env['OMNI_BACKUP_STAGE']!),
        FAKE_INVENTORY: script.includes('mc ls ') ? fixture.inventory || await storedObjects(objects) : '' },
    });
  }
  if (args[0] === 'exec' && args[2] === 'rm') return testExecution.execute({ ...command,
    command: '/bin/rm', args: ['-rf', remotePath(args[4]!)],
  });
  throw new Error('Unexpected Docker operation');
} };

const { backupStorageObjects, restoreStorageObjects, validateStorageArchive } = await import('../../src/services/backup-storage.js');
const target = { container: 'a'.repeat(64), accessKey: "access ' key", secretKey: "secret ' $(echo BAD) `echo BAD`", bucket: 'storage' };
beforeEach(async () => {
  fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-objects-'));
  fixture.fail = ''; fixture.inventory = ''; fixture.versioning = ''; fixture.calls.length = 0;
  for (const name of ['objects', 'container/tmp', 'backups']) await fs.mkdir(path.join(fixture.root, name), { recursive: true });
  await fs.writeFile(path.join(fixture.root, 'objects', 'hello $ and space'), 'actual object\nsecond line');
});
afterEach(async () => { await fs.rm(fixture.root, { recursive: true, force: true }); });
const destination = () => path.join(fixture.root, 'backups', "objects ' $.tar.gz");
const leftovers = async () => ({
  host: (await fs.readdir(path.join(fixture.root, 'backups'))).filter(name => name.startsWith('.') || name.endsWith('.partial')),
  container: await fs.readdir(path.join(fixture.root, 'container/tmp')),
});

describe('storage backup transfer', () => {
  it('round trips actual object bytes and cleans both private staging directories', async () => {
    await backupStorageObjects(target, destination(), execution);
    expect((await fs.stat(destination())).mode & 0o777).toBe(0o600);
    await fs.rm(path.join(fixture.root, 'objects', 'hello $ and space'));
    await restoreStorageObjects(target, destination(), execution);
    expect(await fs.readFile(path.join(fixture.root, 'objects', 'hello $ and space'), 'utf8')).toBe('actual object\nsecond line');
    expect(await leftovers()).toEqual({ host: [], container: [] });
    for (const call of fixture.calls) for (const secret of [target.accessKey, target.secretKey]) expect(call.args.join(' ')).not.toContain(secret);
  });
  it('preserves literal object names that resemble sensitive diagnostic fields', async () => {
    const key = 'token=public-object-label';
    await fs.writeFile(path.join(fixture.root, 'objects', key), 'exact object bytes');
    await backupStorageObjects(target, destination(), execution);
    await fs.rm(path.join(fixture.root, 'objects', key));
    await restoreStorageObjects(target, destination(), execution);
    expect(await fs.readFile(path.join(fixture.root, 'objects', key), 'utf8')).toBe('exact object bytes');
  });
  it('redacts credential values from a known command failure', async () => {
    fixture.fail = 'credentials';
    const error = await backupStorageObjects(target, destination(), execution).catch(error => error as Error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('[redacted]');
    for (const secret of [target.accessKey, target.secretKey]) expect(String(error)).not.toContain(secret);
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
  it.each(['Enabled', 'Suspended'])('preserves a %s bucket and distinguishes its explicit content export', async versioning => {
    fixture.versioning = versioning;
    await expect(backupStorageObjects(target, destination(), execution)).rejects.toThrow('stopped MinIO volume');
    expect(fixture.calls.some(call => call.args.includes('cat'))).toBe(false);
    await expect(fs.stat(destination())).rejects.toThrow();
    await backupStorageObjects(target, destination(), execution, 'content-export');
    await expect(restoreStorageObjects(target, destination(), execution)).rejects.toThrow('stopped MinIO volume');
    expect(fixture.calls.some(call => call.args.includes('pipe'))).toBe(false);
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
  it('refuses unknown versioning before object reads or writes', async () => {
    fixture.versioning = 'undetermined';
    await expect(backupStorageObjects(target, destination(), execution)).rejects.toThrow('versioning state');
    expect(fixture.calls.some(call => call.args.includes('cat'))).toBe(false);
  });
  it('preserves the first verified archive when a second writer targets its name', async () => {
    const results = await Promise.allSettled([backupStorageObjects(target, destination(), execution), backupStorageObjects(target, destination(), execution)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await validateStorageArchive(destination());
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
  it('preserves the shared executor unknown outcome as an error', async () => {
    const unknown = new ExecutionOutcomeUnknownError({ adapter: 'local' });
    const uncertain = { execute: (command: Command) => command.args?.includes('sh')
      ? Promise.reject(unknown) : execution.execute(command) };
    await expect(backupStorageObjects(target, destination(), uncertain)).rejects.toBe(unknown);
    await expect(fs.stat(destination())).rejects.toThrow();
  });
  it.each(['alias', 'cat'])('does not publish a successful archive after %s fails', async failure => {
    fixture.fail = failure;
    await expect(backupStorageObjects(target, destination(), execution)).rejects.toThrow('fixture source failed');
    await expect(fs.stat(destination())).rejects.toThrow();
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
  it('reports a failed restore and does not manufacture a missing destination bucket', async () => {
    await backupStorageObjects(target, destination(), execution);
    fixture.fail = 'stat';
    await expect(restoreStorageObjects(target, destination(), execution)).rejects.toThrow('fixture source failed');
    expect(fixture.calls.flatMap(call => call.args)).not.toContain('mb');
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
  it('concurrent copies never share staging or credential directories', async () => {
    await Promise.all([backupStorageObjects(target, destination(), execution), backupStorageObjects(target, destination() + '-second.tar.gz', execution)]);
    const stages = fixture.calls.filter(call => call.env['OMNI_BACKUP_STAGE']).map(call => call.env['OMNI_BACKUP_STAGE']);
    expect(new Set(stages).size).toBe(2);
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
  it.each(['../bucket', 'bad;name', '', undefined])('refuses an invalid bucket %s before any Docker call', async bucket => {
    await expect(backupStorageObjects({ ...target, bucket: bucket as string }, destination(), execution)).rejects.toThrow('bucket');
    expect(fixture.calls).toEqual([]);
  });
  it.each(['../object', 'a//b', 'a/./b', '/object', 'object/'])('refuses a source key that mc would normalize: %s', async key => {
    fixture.inventory = JSON.stringify({ status: 'success', type: 'file', key, size: 0, etag: 'fixture' });
    await expect(backupStorageObjects(target, destination(), execution)).rejects.toThrow('unsupported object key');
    expect(fixture.calls.filter(call => call.args.includes('cat'))).toEqual([]);
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
  it('does not publish when an inventoried object is unavailable', async () => {
    fixture.inventory = JSON.stringify({ status: 'success', type: 'file', key: 'missing', size: 10, etag: 'fixture' });
    await expect(backupStorageObjects(target, destination(), execution)).rejects.toThrow();
    await expect(fs.stat(destination())).rejects.toThrow();
  });
  it('rejects links and unexpected archive roots before restore can reach Docker', async () => {
    const input = path.join(fixture.root, 'malicious'); await fs.mkdir(input);
    await fs.mkdir(path.join(input, '_bk_storage'));
    await fs.symlink('/tmp', path.join(input, '_bk_storage', 'escape'));
    await create({ file: destination(), cwd: input, gzip: true }, ['_bk_storage']);
    await expect(validateStorageArchive(destination())).rejects.toThrow('Invalid storage backup archive member');
    await expect(restoreStorageObjects(target, destination(), execution)).rejects.toThrow('Invalid storage backup archive member');
    expect(fixture.calls.filter(call => call.args.includes('sh'))).toEqual([]);
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
});
