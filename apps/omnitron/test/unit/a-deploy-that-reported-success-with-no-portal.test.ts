/**
 * A deployment that reported success and left the portal answering 504.
 *
 * Test, 2026-09-22, release daos-202609221949-23dce2f6: the static bundle was
 * packed, summed, sent, checked against its sum — and failed on the node,
 *
 *     gzip: stdin: unexpected end of file
 *     tar: Unexpected EOF in archive
 *
 * The sum matched because it was the sum of the short archive: the packing
 * pipeline's status is gzip's alone, and `exec` never throws, so a `tar` that
 * stopped halfway was read as done. `shipStackStatics` then returned `{}`,
 * the node was provisioned with no static root, its gateway was recreated
 * without `/var/www/portal`, fell back to proxying `/` to a Vite that is not
 * there, and answered 504 after 60 s to every page for 8½ minutes — under a
 * deployment that printed «6/6 apps online» and exited 0.
 *
 * Three rules, one per layer:
 *   - an archive is judged whole before it is summed, and not sent otherwise;
 *   - a delivery that fails is tried once more, from nothing;
 *   - a delivery that fails twice ends the deployment before the node changes.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import { RemoteDeployer, wholeTarGz } from '../../src/services/remote-deployer.service.js';
import { FrontendNotDeliveredError, ProjectService } from '../../src/services/project.service.js';

function servedDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'portal-probe-'));
  writeFileSync(join(d, 'index.html'), '<!doctype html><title>DAOS</title>');
  writeFileSync(join(d, 'app.js'), 'x'.repeat(40_000));
  return d;
}

function archiveOf(dir: string): Buffer {
  return execSync(`COPYFILE_DISABLE=1 tar -cf - -C '${dir}' . | gzip -n`);
}

describe('an archive is judged whole before it is summed', () => {
  it('knows a whole archive, a cut gzip stream and a tar cut inside a gzip that finished', () => {
    const whole = archiveOf(servedDir());
    const tar = gunzipSync(whole);

    expect(wholeTarGz(whole)).toBe(true);
    expect(wholeTarGz(whole.subarray(0, Math.floor(whole.length / 2)))).toMatch(/gzip stream is broken/);
    // `tar` killed mid-file, `gzip` still closing its own stream properly.
    expect(wholeTarGz(gzipSync(tar.subarray(0, 12_345)))).toMatch(/not whole blocks/);
    // Cut on a block boundary: whole blocks, but no end-of-archive marker.
    expect(wholeTarGz(gzipSync(tar.subarray(0, 1536)))).toMatch(/no end-of-archive marker/);
  });

  function deployer(pack: (cmd: string) => { exitCode: number; stderr: string }) {
    const uploadFile = vi.fn(async () => {});
    const sshExec = vi.fn(async () => 'no');
    const svc: any = Object.create(RemoteDeployer.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      execution: { exec: async (cmd: string) => ({ stdout: '', ...pack(cmd) }), uploadFile },
      sshExec,
    });
    return { svc, uploadFile, sshExec };
  }

  it('sends nothing when the packing failed, and says how', async () => {
    const { svc, uploadFile, sshExec } = deployer(() => ({ exitCode: 1, stderr: 'tar: ./app.js: Read error' }));

    await expect(svc.uploadStaticBundle({ host: 'n' }, servedDir(), '/opt/x')).rejects.toThrow(
      /exit 1.*tar: \.\/app\.js: Read error.*nothing was sent/,
    );
    expect(uploadFile).not.toHaveBeenCalled();
    expect(sshExec).not.toHaveBeenCalled();
  });

  it('sends nothing when the packing «succeeded» and left a short archive — the case that shipped', async () => {
    const { svc, uploadFile } = deployer((cmd) => {
      // What happened: exit 0 from gzip, half an archive on disk.
      const out = /> '([^']+)'$/.exec(cmd)![1]!;
      const full = archiveOf(servedDir());
      writeFileSync(out, full.subarray(0, Math.floor(full.length / 2)));
      return { exitCode: 0, stderr: '' };
    });

    await expect(svc.uploadStaticBundle({ host: 'n' }, servedDir(), '/opt/x')).rejects.toThrow(/gzip stream is broken/);
    expect(uploadFile).not.toHaveBeenCalled();
  });
});

describe('a delivery that fails', () => {
  function project(upload: () => Promise<{ remoteDir: string; bytes: number }>) {
    const svc: any = Object.create(ProjectService.prototype);
    const uploadStaticBundle = vi.fn(upload);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      deployer: { uploadStaticBundle },
      targetForStackNode: async () => ({ host: '37.27.130.185' }),
    });
    return { svc, uploadStaticBundle };
  }
  const infra = { services: { gateway: { config: { staticDir: './apps/portal/dist' } } } };
  const node = { host: '37.27.130.185', role: 'app' };

  it('is tried once more, from nothing, and a second success is a delivery', async () => {
    let calls = 0;
    const { svc, uploadStaticBundle } = project(async () => {
      calls += 1;
      if (calls === 1) throw new Error('gzip: stdin: unexpected end of file');
      return { remoteDir: '/opt/omnitron/stack-static/gateway/3b4dbc9cf7db675b', bytes: 19_317_630 };
    });

    const roots = await svc.shipStackStatics(infra, '/p', node, '/releases/r/statics');

    expect(uploadStaticBundle).toHaveBeenCalledTimes(2);
    expect(roots).toEqual({ gateway: '/opt/omnitron/stack-static/gateway/3b4dbc9cf7db675b' });
  });

  it('twice is the end of the deployment, not a gateway with no web root', async () => {
    const { svc, uploadStaticBundle } = project(async () => {
      throw new Error('gzip: stdin: unexpected end of file');
    });

    await expect(svc.shipStackStatics(infra, '/p', node, '/releases/r/statics')).rejects.toBeInstanceOf(
      FrontendNotDeliveredError,
    );
    expect(uploadStaticBundle).toHaveBeenCalledTimes(2);
  });

  it('is not logged and deployed past by the node step, which never provisions the node', async () => {
    const { svc } = project(async () => {
      throw new Error('gzip: stdin: unexpected end of file');
    });
    svc.readStackConfigFiles = async () => ({});
    const invokeOnSlave = vi.fn(async () => ({ ready: true }));
    const connector = { addSlave: async () => {}, waitUntilConnected: async () => true, invokeOnSlave };

    await expect(
      svc.provisionNodeInfrastructure(connector, node, infra, {}, undefined, '/p', '/releases/r/statics'),
    ).rejects.toThrow(/Nothing on the node was changed/);
    expect(invokeOnSlave).not.toHaveBeenCalled();
  });
});
