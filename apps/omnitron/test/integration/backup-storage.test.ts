import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupStorageObjects, restoreStorageObjects } from '../../src/services/backup-storage.js';
import { ensureImage } from '../../src/infrastructure/container-runtime.js';
import { minioPreset } from '../../src/infrastructure/presets/minio.js';
import { testExecution } from '../fixtures/execution.js';

// CI exercises fresh preset provisioning. An explicitly supplied image must already be cached.
const cachedImage = process.env['OMNITRON_TEST_MINIO_IMAGE'];
const usePreset = !cachedImage && process.env['OMNITRON_TEST_MINIO_PRESET'] === '1';
const image = cachedImage ?? (usePreset ? minioPreset.defaultImage : undefined);
const exec = promisify(execFile);
describe.skipIf(!image)('storage backup through a real MinIO with tmpfs', () => {
  const name = `omnitron-backup-test-${randomUUID()}`;
  const accessKey = `proof${randomUUID().replaceAll('-', '')}`;
  const secretKey = randomUUID() + randomUUID();
  const env = { ...process.env, MINIO_ROOT_USER: accessKey, MINIO_ROOT_PASSWORD: secretKey };
  let directory: string;
  let container: string;
  let imageId: string;
  const provisionTimeout = 180_000;
  async function docker(args: string[], timeout = 15_000) {
    try { return (await exec('docker', args, { env, timeout, maxBuffer: 1024 * 1024 })).stdout; }
    catch (error) {
      const failure = error as Error & { stdout?: string };
      throw new Error((failure.message + '\n' + (failure.stdout ?? '').slice(-2048))
        .split(accessKey).join('[redacted]').split(secretKey).join('[redacted]'));
    }
  }
  const shell = (script: string) => docker(['exec', '-e', 'MINIO_ROOT_USER', '-e', 'MINIO_ROOT_PASSWORD', container, 'sh', '-c', script]);
  const target = () => ({ container, accessKey, secretKey, bucket: 'proof-bucket' });
  const file = (name: string) => path.join(directory, name + '.tar.gz');
  async function ownedContainer() {
    const id = (await docker(['ps', '-aq', '--no-trunc', '--filter', `label=omnitron.backup-test=${name}`])).trim();
    if (!id) return;
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    const fields = '{{.Id}} {{.Name}} {{.Image}} {{.HostConfig.NetworkMode}} {{.HostConfig.ReadonlyRootfs}}';
    expect((await docker(['inspect', '--type', 'container', '--format', fields, id])).trim())
      .toBe(`${id} /${name} ${imageId} none true`);
    const mounts: Array<{ Type: string }> = JSON.parse(await docker(['inspect', '--format', '{{json .Mounts}}', id]));
    expect(mounts.every(mount => mount.Type === 'tmpfs')).toBe(true);
    return id;
  }
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-backup-test-'));
    if (usePreset) await ensureImage(minioPreset.defaultImage);
    imageId = (await docker(['image', 'inspect', '--format', '{{.Id}}', image!])).trim();
    expect(imageId).toMatch(/^sha256:[a-f0-9]{64}$/);
    try {
      container = (await docker(['create', '--init', '--pull=never', '--name', name,
        '--label', `omnitron.backup-test=${name}`, '--network', 'none', '--cpus', '1', '--memory', '1g', '--pids-limit', '128',
        '--read-only', '--tmpfs', '/data:rw,size=134217728', '--tmpfs', '/tmp:rw,size=67108864,mode=1777',
        '-e', 'MINIO_ROOT_USER', '-e', 'MINIO_ROOT_PASSWORD', '-e', 'MINIO_BROWSER=off', '-e', 'GOMEMLIMIT=96MiB',
        imageId, 'server', '/data'], provisionTimeout)).trim();
    } catch (error) {
      const observed = await ownedContainer();
      if (!observed) throw error;
      container = observed;
    }
    expect(await ownedContainer()).toBe(container);
    try {
      await docker(['start', container], provisionTimeout);
    } catch (error) {
      if ((await docker(['inspect', '--format', '{{.State.Running}}', container])).trim() !== 'true') throw error;
    }
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        await shell('export MC_CONFIG_DIR=/tmp/proof-client; mc alias set proof http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null');
        ready = true; break;
      } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    expect(ready).toBe(true);
    await shell('set -eu; export MC_CONFIG_DIR=/tmp/proof-client; mc mb proof/proof-bucket; ' +
      'printf "native backup\\n" | mc pipe proof/proof-bucket/sub/object.txt; ' +
      'printf "" | mc pipe proof/proof-bucket/empty');
  }, 2 * provisionTimeout + 90_000 + (usePreset ? 600_000 : 0));
  afterAll(async () => {
    try {
      const id = imageId && await ownedContainer();
      if (id) {
        await docker(['rm', '--force', id]);
        expect(await ownedContainer()).toBeUndefined();
      }
    } finally {
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it('restores exact nested and empty object bytes', async () => {
    await backupStorageObjects(target(), file('objects'), testExecution);
    await shell('export MC_CONFIG_DIR=/tmp/proof-client; mc rm proof/proof-bucket/sub/object.txt proof/proof-bucket/empty >/dev/null');
    await restoreStorageObjects(target(), file('objects'), testExecution);
    expect(await shell('export MC_CONFIG_DIR=/tmp/proof-client; mc cat proof/proof-bucket/sub/object.txt')).toBe('native backup\n');
    expect(await shell('export MC_CONFIG_DIR=/tmp/proof-client; mc cat proof/proof-bucket/empty')).toBe('');
  }, 60_000);
  it('isolates concurrent copies and credentials, including cleanup', async () => {
    await Promise.all([backupStorageObjects(target(), file('a'), testExecution), backupStorageObjects(target(), file('b'), testExecution)]);
    expect((await shell('for item in /tmp/omnitron-backup-*; do if test -e "$item"; then printf "%s\\n" "$item"; fi; done')).trim()).toBe('');
    expect((await fs.readdir(directory)).filter(name => name.startsWith('.storage-') || name.endsWith('.partial'))).toEqual([]);
  }, 60_000);
  it('refuses absent buckets and invalid credentials without publishing an archive', async () => {
    await expect(backupStorageObjects({ ...target(), bucket: 'missing-bucket' }, file('missing'), testExecution)).rejects.toThrow();
    await expect(backupStorageObjects({ ...target(), secretKey: 'incorrect-proof-secret' }, file('auth'), testExecution)).rejects.toThrow();
    for (const name of ['missing', 'auth']) await expect(fs.stat(file(name))).rejects.toThrow();
  }, 60_000);

  it('keeps both historical versions and their metadata when a body export is offered for recovery', async () => {
    const history = { ...target(), bucket: 'history-proof' };
    const client = 'set -eu; export MC_CONFIG_DIR=/tmp/proof-client; ';
    await shell(client + 'mc mb proof/history-proof >/dev/null; mc version enable proof/history-proof >/dev/null; ' +
      'printf first | mc pipe --attr "Content-Type=text/plain;x-amz-meta-fixture=version-one" proof/history-proof/item >/dev/null; ' +
      'printf second | mc pipe proof/history-proof/item >/dev/null');
    const versions = () => shell(client + 'mc ls --versions --json proof/history-proof');
    const prior = await versions();
    const ids = prior.trim().split('\n').map(line => JSON.parse(line).versionId as string);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const inspect = () => Promise.all(ids.map(id =>
      shell(client + 'mc stat --json --version-id ' + id + ' proof/history-proof/item; ' +
        'mc cat --version-id ' + id + ' proof/history-proof/item')));
    const metadataAndBytes = await inspect();
    expect(metadataAndBytes.some(value => value.includes('version-one') && value.endsWith('first'))).toBe(true);
    await expect(backupStorageObjects(history, file('history'), testExecution)).rejects.toThrow('stopped MinIO volume');
    await backupStorageObjects(history, file('current-bodies'), testExecution, 'content-export');
    await expect(restoreStorageObjects(history, file('current-bodies'), testExecution)).rejects.toThrow('stopped MinIO volume');
    expect(await versions()).toBe(prior);
    expect(await inspect()).toEqual(metadataAndBytes);
  }, 60_000);
});
