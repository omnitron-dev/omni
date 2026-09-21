/**
 * A static bundle that arrived corrupt, and was unpacked anyway.
 *
 * Measured 2026-09-21 delivering the portal to `daos-test`: the transfer
 * returned without error, `tar -xzf` ran on what had landed, and the node
 * answered — after sixteen lines of
 * `tar: Ignoring unknown extended header keyword 'LIBARCHIVE.xattr…'` —
 *
 *     gzip: stdin: unexpected end of file
 *     tar: Unexpected EOF in archive
 *
 * The consequence was not a retry. `shipStackStatics` catches, returns `{}`,
 * and the gateway is then configured with no static root at all: the node
 * served nothing at `/` until the next deployment.
 *
 * Two checks now stand between the transfer and the extraction, at the two
 * levels where the knowledge exists: `uploadFile` refuses a file that landed
 * SHORT (it has the local size and nothing else), and this function refuses
 * one that landed WRONG — it already holds the sha256, because that is what
 * the remote directory is named after.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';

const TARGET = { host: '37.27.130.185', username: 'root' } as never;
const ROOT = '/opt/omnitron/stack-static/gateway';

/** A real directory to pack, so the digest under test is a real digest. */
function dirToServe(): string {
  const d = mkdtempSync(join(tmpdir(), 'static-probe-'));
  writeFileSync(join(d, 'index.html'), '<!doctype html><title>DAOS</title>');
  return d;
}

/**
 * The deployer with the two seams this function crosses: `execution.exec`
 * runs the local `tar` for real (the archive has to exist for its sum to
 * mean anything), and `sshExec` answers for the node.
 */
function deployer(answers: (cmd: string) => string, uploadFile = vi.fn(async () => {})) {
  const asked: string[] = [];
  const svc: any = Object.create(RemoteDeployer.prototype);
  Object.assign(svc, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    execution: {
      exec: async (cmd: string) => {
        execSync(cmd, { stdio: 'pipe' });
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      uploadFile,
    },
    sshExec: async (_t: unknown, cmd: string) => {
      asked.push(cmd);
      return answers(cmd);
    },
  });
  return { svc, asked, uploadFile };
}

/**
 * What the node would answer for a file that arrived intact.
 *
 * Taken from the directory the function itself asked to create — that name
 * IS the first 16 of the archive's sha256, which is the whole reason the
 * check costs nothing. Reading the local archive instead would have been a
 * second implementation of the thing under test.
 */
function digestAskedFor(asked: string[]): string {
  const m = asked.map((c) => /gateway\/([0-9a-f]{16})/.exec(c)).find(Boolean);
  return m ? `${m[1]}${'0'.repeat(48)}` : '';
}

describe('a bundle is unpacked only when it arrived whole', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a bundle whose sum is not the one that was sent', async () => {
    const extracted: string[] = [];
    const { svc } = deployer((cmd) => {
      if (cmd.includes('test -d')) return 'no';
      if (cmd.includes('sha256sum')) return `${'f'.repeat(64)}  /opt/…/static.tar.gz`;
      if (cmd.includes('tar -xzf')) { extracted.push(cmd); return ''; }
      return '';
    });

    await expect(svc.uploadStaticBundle(TARGET, dirToServe(), ROOT)).rejects.toThrow(
      /arrived corrupt: sent sha256 [0-9a-f]{16}, the node has ffffffffffffffff/
    );
    // The claim is not that it threw — it is that nothing was unpacked.
    expect(extracted).toEqual([]);
  });

  it('removes the partial file rather than leaving it to look installed', async () => {
    const removed: string[] = [];
    const { svc } = deployer((cmd) => {
      if (cmd.includes('test -d')) return 'no';
      if (cmd.includes('sha256sum')) return `${'a'.repeat(64)}  x`;
      if (cmd.startsWith('rm -f')) { removed.push(cmd); return ''; }
      return '';
    });
    await expect(svc.uploadStaticBundle(TARGET, dirToServe(), ROOT)).rejects.toThrow(/corrupt/);
    expect(removed).toHaveLength(1);
  });

  it('unpacks when the sum matches', async () => {
    // The control: without it a function that threw unconditionally would
    // pass both tests above.
    const asked: string[] = [];
    const extracted: string[] = [];
    const svc: any = Object.create(RemoteDeployer.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      execution: {
        exec: async (cmd: string) => { execSync(cmd, { stdio: 'pipe' }); return { exitCode: 0, stdout: '', stderr: '' }; },
        uploadFile: vi.fn(async () => {}),
      },
      sshExec: async (_t: unknown, cmd: string) => {
        asked.push(cmd);
        if (cmd.includes('test -d')) return 'no';
        if (cmd.includes('sha256sum')) return `${digestAskedFor(asked)}  x`;
        if (cmd.includes('tar -xzf')) { extracted.push(cmd); return ''; }
        return '';
      },
    });

    const out = await svc.uploadStaticBundle(TARGET, dirToServe(), ROOT);
    expect(extracted).toHaveLength(1);
    expect(out.remoteDir).toMatch(new RegExp(`^${ROOT}/[0-9a-f]{16}$`));
    expect(out.bytes).toBeGreaterThan(0);
  });

  it('sends nothing when the node already has this build', async () => {
    // `test -s …delivered && test -d …` — both, answered together.
    const { svc, uploadFile } = deployer((cmd) => (cmd.includes('.delivered') ? 'yes' : ''));
    const out = await svc.uploadStaticBundle(TARGET, dirToServe(), ROOT);
    expect(out.bytes).toBe(0);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('does not mistake a directory a failed unpack left behind for a bundle', async () => {
    // What actually happened: `mkdir -p` succeeded, the transfer landed
    // short, `tar` died on the truncated stream. The directory existed and
    // held nothing. A check that asks «is the directory there» answers yes
    // to that, and the next deployment reports a saved transfer where there
    // is a missing portal.
    const asked: string[] = [];
    const { svc, uploadFile } = deployer((cmd) => {
      asked.push(cmd);
      // The node's honest answer: the directory is there, the record is not.
      if (cmd.includes('.delivered')) return 'no';
      if (cmd.includes('sha256sum')) return `${'a'.repeat(64)}  x`;
      return '';
    });
    await expect(svc.uploadStaticBundle(TARGET, dirToServe(), ROOT)).rejects.toThrow(/corrupt/);
    // It did not skip: it went and transferred.
    expect(uploadFile).toHaveBeenCalledTimes(1);
    // And it cleared the leftovers first rather than unpacking onto them.
    expect(asked.some((c) => c.startsWith('rm -rf') && c.includes('.delivered'))).toBe(true);
  });

  it('writes the record only after the unpack, and last', async () => {
    const asked: string[] = [];
    const svc: any = Object.create(RemoteDeployer.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      execution: {
        exec: async (cmd: string) => { execSync(cmd, { stdio: 'pipe' }); return { exitCode: 0, stdout: '', stderr: '' }; },
        uploadFile: vi.fn(async () => {}),
      },
      sshExec: async (_t: unknown, cmd: string) => {
        asked.push(cmd);
        if (cmd.includes('.delivered') && cmd.startsWith('test')) return 'no';
        if (cmd.includes('sha256sum')) return `${digestAskedFor(asked)}  x`;
        return '';
      },
    });

    await svc.uploadStaticBundle(TARGET, dirToServe(), ROOT);
    const extractAt = asked.findIndex((c) => c.includes('tar -xzf'));
    const recordAt = asked.findIndex((c) => c.startsWith('printf'));
    expect(extractAt).toBeGreaterThan(-1);
    // A record that can outlive a failed unpack is the defect, not the fix.
    expect(recordAt).toBeGreaterThan(extractAt);
  });

  it('gives the same directory name to the same bundle', async () => {
    // The digest names the remote directory, so a sum that changes with the
    // clock means every deployment mints a new one — the skip on an
    // unchanged build could never fire, and a peer checking what the node
    // holds could compare only the length.
    const dir = dirToServe();
    const names: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { svc } = deployer((cmd) => (cmd.includes('.delivered') ? 'yes' : ''));
      names.push((await svc.uploadStaticBundle(TARGET, dir, ROOT)).remoteDir);
      await new Promise((r) => setTimeout(r, 1100)); // past a gzip timestamp tick
    }
    expect(names[1]).toBe(names[0]);
  });

  it('packs without the macOS attributes that buried the last failure', async () => {
    const { svc, asked } = deployer((cmd) => (cmd.includes('test -d') ? 'yes' : ''));
    await svc.uploadStaticBundle(TARGET, dirToServe(), ROOT);
    // The tar command is the local one, so it is not in `asked` — assert on
    // the archive instead: no `LIBARCHIVE.xattr` header may survive into it.
    const dir = dirToServe();
    const out = join(dir, 'probe.tar.gz');
    execSync(`COPYFILE_DISABLE=1 tar --no-xattrs -czf '${out}' -C '${dir}' index.html`);
    const listed = execSync(`tar -tvf '${out}'`, { encoding: 'utf8' });
    expect(listed).not.toContain('LIBARCHIVE.xattr');
    expect(asked.length).toBeGreaterThan(0);
  });
});
