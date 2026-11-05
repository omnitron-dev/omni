import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupStorageObjects, restoreStorageObjects } from '../../src/services/backup-storage.js';

// Explicit opt-in to a cached image. No host ports, network, application volumes or registry downloads.
const image = process.env.OMNITRON_TEST_MINIO_IMAGE;
const exec = promisify(execFile);
describe.skipIf(!image)('storage backup through a real MinIO with tmpfs', () => {
  const name = `omnitron-backup-test-${randomUUID()}`;
  const accessKey = `proof${randomUUID().replaceAll('-', '')}`;
  const secretKey = randomUUID() + randomUUID();
  const env = { ...process.env, MINIO_ROOT_USER: accessKey, MINIO_ROOT_PASSWORD: secretKey };
  let directory: string;
  let container: string;
  let started = false;
  async function docker(args: string[]) {
    try { return (await exec('docker', args, { env, timeout: 15_000, maxBuffer: 1024 * 1024 })).stdout; }
    catch (error) {
      throw new Error(String((error as Error).message).split(accessKey).join('[redacted]').split(secretKey).join('[redacted]'));
    }
  }
  const shell = (script: string) => docker(['exec', '-e', 'MINIO_ROOT_USER', '-e', 'MINIO_ROOT_PASSWORD', container, 'sh', '-c', script]);
  const target = () => ({ container, accessKey, secretKey, bucket: 'proof-bucket' });
  const file = (name: string) => path.join(directory, name + '.tar.gz');
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-backup-test-'));
    container = (await docker(['run', '--detach', '--init', '--pull=never', '--name', name,
      '--label', `omnitron.backup-test=${name}`, '--network', 'none', '--cpus', '0.5', '--memory', '512m', '--pids-limit', '128',
      '--read-only', '--tmpfs', '/data:rw,size=134217728', '--tmpfs', '/tmp:rw,size=67108864,mode=1777',
      '-e', 'MINIO_ROOT_USER', '-e', 'MINIO_ROOT_PASSWORD', '-e', 'MINIO_BROWSER=off', image!, 'server', '/data'])).trim();
    started = true;
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await shell('export MC_CONFIG_DIR=/tmp/proof-client; mc alias set proof http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null');
        ready = true; break;
      } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    expect(ready).toBe(true);
    await shell('export MC_CONFIG_DIR=/tmp/proof-client; mc mb proof/proof-bucket >/dev/null; ' +
      'printf "native backup\\n" | mc pipe proof/proof-bucket/sub/object.txt >/dev/null; ' +
      'printf "" | mc pipe proof/proof-bucket/empty >/dev/null');
  }, 90_000);
  afterAll(async () => {
    if (started) {
      expect((await docker(['inspect', container, '--format', '{{ index .Config.Labels "omnitron.backup-test" }}'])).trim()).toBe(name);
      await docker(['rm', '--force', container]);
      expect((await docker(['ps', '-aq', '--filter', `label=omnitron.backup-test=${name}`])).trim()).toBe('');
    }
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });
  it('restores exact nested and empty object bytes', async () => {
    await backupStorageObjects(target(), file('objects'));
    await shell('export MC_CONFIG_DIR=/tmp/proof-client; mc rm proof/proof-bucket/sub/object.txt proof/proof-bucket/empty >/dev/null');
    await restoreStorageObjects(target(), file('objects'));
    expect(await shell('export MC_CONFIG_DIR=/tmp/proof-client; mc cat proof/proof-bucket/sub/object.txt')).toBe('native backup\n');
    expect(await shell('export MC_CONFIG_DIR=/tmp/proof-client; mc cat proof/proof-bucket/empty')).toBe('');
  }, 60_000);
  it('isolates concurrent copies and credentials, including cleanup', async () => {
    await Promise.all([backupStorageObjects(target(), file('a')), backupStorageObjects(target(), file('b'))]);
    expect((await shell('for item in /tmp/omnitron-backup-*; do if test -e "$item"; then printf "%s\\n" "$item"; fi; done')).trim()).toBe('');
    expect((await fs.readdir(directory)).filter(name => name.startsWith('.storage-') || name.endsWith('.partial'))).toEqual([]);
  }, 60_000);
  it('refuses absent buckets and invalid credentials without publishing an archive', async () => {
    await expect(backupStorageObjects({ ...target(), bucket: 'missing-bucket' }, file('missing'))).rejects.toThrow();
    await expect(backupStorageObjects({ ...target(), secretKey: 'incorrect-proof-secret' }, file('auth'))).rejects.toThrow();
    for (const name of ['missing', 'auth']) await expect(fs.stat(file(name))).rejects.toThrow();
  }, 60_000);
});
