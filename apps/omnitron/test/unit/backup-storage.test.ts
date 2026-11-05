import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { create } from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ root: '', fail: '', inventory: '', calls: [] as Array<{ args: string[]; env: NodeJS.ProcessEnv }> }));
vi.mock('node:child_process', async importOriginal => {
  const real = await importOriginal<typeof import('node:child_process')>();
  return { ...real, spawn: (file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    if (file !== 'docker' || !args.includes('mc')) throw new Error('Unexpected streamed subprocess');
    fixture.calls.push({ args, env: options.env });
    return real.spawn(path.join(fixture.root, 'bin/mc'), args.slice(args.indexOf('mc') + 1), {
      ...options, env: { ...options.env, FAKE_OBJECTS: path.join(fixture.root, 'objects'), FAKE_MC_FAIL: fixture.fail },
    });
  }, execFile: (file: string, args: string[], options: { env: NodeJS.ProcessEnv }, callback: (error: Error | null, stdout?: string, stderr?: string) => void) => {
    if (file !== 'docker') throw new Error('Unexpected subprocess');
    fixture.calls.push({ args, env: options.env });
    // The actual shell and mc status propagate; only Docker's filesystem boundary is simulated.
    const remotePath = (name: string) => path.join(fixture.root, 'container', name);
    if (args[0] === 'exec' && args.includes('sh')) {
      const env = { ...options.env, PATH: path.join(fixture.root, 'bin') + ':' + process.env.PATH,
        OMNI_BACKUP_STAGE: remotePath(options.env.OMNI_BACKUP_STAGE!), FAKE_OBJECTS: path.join(fixture.root, 'objects'),
        FAKE_MC_FAIL: fixture.fail, FAKE_INVENTORY: fixture.inventory, FAKE_NODE: process.execPath };
      return real.execFile('/bin/sh', ['-c', args[args.length - 1]!], { ...options, env }, callback);
    }
    void (async () => {
      if (args[0] === 'exec' && args[2] === 'rm') await fs.rm(remotePath(args[4]!), { recursive: true, force: true });
      else throw new Error('Unexpected Docker operation');
    })().then(() => callback(null), error => callback(error));
  } };
});

const { backupStorageObjects, restoreStorageObjects, validateStorageArchive } = await import('../../src/services/backup-storage.js');
const target = { container: 'a'.repeat(64), accessKey: "access ' key", secretKey: "secret ' $(echo BAD) `echo BAD`", bucket: 'storage' };
beforeEach(async () => {
  fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), 'bk-objects-'));
  fixture.fail = ''; fixture.inventory = ''; fixture.calls.length = 0;
  for (const name of ['bin', 'objects', 'container/tmp', 'backups']) await fs.mkdir(path.join(fixture.root, name), { recursive: true });
  await fs.writeFile(path.join(fixture.root, 'objects', 'hello $ and space'), 'actual object\nsecond line');
  await fs.writeFile(path.join(fixture.root, 'bin/mc'), `#!/bin/sh
set -eu
if [ "$1" = "$FAKE_MC_FAIL" ]; then printf '%s\\n' 'fixture source failed' >&2; exit 7; fi
case "$1" in
  alias) mkdir -p "$MC_CONFIG_DIR"; printf '%s' "$MC_SK" > "$MC_CONFIG_DIR/secret" ;;
  stat) test -d "$FAKE_OBJECTS" ;;
  ls) "$FAKE_NODE" -e 'if(process.env.FAKE_INVENTORY){console.log(process.env.FAKE_INVENTORY);process.exit(0)};const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");for(const key of fs.readdirSync(process.env.FAKE_OBJECTS)){const bytes=fs.readFileSync(path.join(process.env.FAKE_OBJECTS,key));console.log(JSON.stringify({status:"success",type:"file",key,size:bytes.length,etag:crypto.createHash("md5").update(bytes).digest("hex")}))}' ;;
  cat) key="\${2#omniBackup/storage/}"; cat "$FAKE_OBJECTS/$key" ;;
  pipe) key="\${2#omniBackup/storage/}"; cat > "$FAKE_OBJECTS/$key" ;;
  *) exit 19 ;;
esac
`, { mode: 0o700 });
});
afterEach(async () => { await fs.rm(fixture.root, { recursive: true, force: true }); });
const destination = () => path.join(fixture.root, 'backups', "objects ' $.tar.gz");
const leftovers = async () => ({
  host: (await fs.readdir(path.join(fixture.root, 'backups'))).filter(name => name.startsWith('.') || name.endsWith('.partial')),
  container: await fs.readdir(path.join(fixture.root, 'container/tmp')),
});

describe('storage backup transfer', () => {
  it('round trips actual object bytes and cleans both private staging directories', async () => {
    await backupStorageObjects(target, destination());
    expect((await fs.stat(destination())).mode & 0o777).toBe(0o600);
    await fs.rm(path.join(fixture.root, 'objects', 'hello $ and space'));
    await restoreStorageObjects(target, destination());
    expect(await fs.readFile(path.join(fixture.root, 'objects', 'hello $ and space'), 'utf8')).toBe('actual object\nsecond line');
    expect(await leftovers()).toEqual({ host: [], container: [] });
    for (const call of fixture.calls) for (const secret of [target.accessKey, target.secretKey]) expect(call.args.join(' ')).not.toContain(secret);
  });
  it.each(['alias', 'cat'])('does not publish a successful archive after %s fails', async failure => {
    fixture.fail = failure;
    await expect(backupStorageObjects(target, destination())).rejects.toThrow('fixture source failed');
    await expect(fs.stat(destination())).rejects.toThrow();
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
  it('reports a failed restore and does not manufacture a missing destination bucket', async () => {
    await backupStorageObjects(target, destination());
    fixture.fail = 'stat';
    await expect(restoreStorageObjects(target, destination())).rejects.toThrow('fixture source failed');
    expect(fixture.calls.flatMap(call => call.args)).not.toContain('mb');
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
  it('concurrent copies never share staging or credential directories', async () => {
    await Promise.all([backupStorageObjects(target, destination()), backupStorageObjects(target, destination() + '-second.tar.gz')]);
    const stages = fixture.calls.filter(call => call.env.OMNI_BACKUP_STAGE).map(call => call.env.OMNI_BACKUP_STAGE);
    expect(new Set(stages).size).toBe(2);
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
  it.each(['../bucket', 'bad;name', '', undefined])('refuses an invalid bucket %s before any Docker call', async bucket => {
    await expect(backupStorageObjects({ ...target, bucket: bucket as string }, destination())).rejects.toThrow('bucket');
    expect(fixture.calls).toEqual([]);
  });
  it.each(['../object', 'a//b', 'a/./b', '/object', 'object/'])('refuses a source key that mc would normalize: %s', async key => {
    fixture.inventory = JSON.stringify({ status: 'success', type: 'file', key, size: 0, etag: 'fixture' });
    await expect(backupStorageObjects(target, destination())).rejects.toThrow('unsupported object key');
    expect(fixture.calls.filter(call => call.args.includes('cat'))).toEqual([]);
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
  it('does not publish when an inventoried object is unavailable', async () => {
    fixture.inventory = JSON.stringify({ status: 'success', type: 'file', key: 'missing', size: 10, etag: 'fixture' });
    await expect(backupStorageObjects(target, destination())).rejects.toThrow();
    await expect(fs.stat(destination())).rejects.toThrow();
  });
  it('rejects links and unexpected archive roots before restore can reach Docker', async () => {
    const input = path.join(fixture.root, 'malicious'); await fs.mkdir(input);
    await fs.mkdir(path.join(input, '_bk_storage'));
    await fs.symlink('/tmp', path.join(input, '_bk_storage', 'escape'));
    await create({ file: destination(), cwd: input, gzip: true }, ['_bk_storage']);
    await expect(validateStorageArchive(destination())).rejects.toThrow('Invalid storage backup archive member');
    await expect(restoreStorageObjects(target, destination())).rejects.toThrow('Invalid storage backup archive member');
    expect(fixture.calls.filter(call => call.args.includes('sh'))).toEqual([]);
    expect(await leftovers()).toEqual({ host: [], container: [] });
  });
});
