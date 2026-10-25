/** A canonical remote path is replaced only after complete bytes and SHA256 agree. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ExecutionService } from '../../src/execution/execution.service.js';
const dirs: string[] = [];
const target = { host: 'test.invalid', username: 'root' };
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(upload: (source: string, temporary: string, attempt: number) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'verified-upload-'));
  dirs.push(dir);
  const source = join(dir, 'source'),
    remote = join(dir, 'remote');
  writeFileSync(source, 'checked replacement', { mode: 0o600 });
  writeFileSync(remote, 'prior content');
  const dispose = vi.fn(async () => {});
  let attempt = 0;
  const svc: any = Object.create(ExecutionService.prototype);
  Object.assign(svc, {
    logger: { warn: vi.fn() },
    getEngine: async () => {
      throw Error('Bulk upload must not use the control pool');
    },
    createTransferEngine: vi.fn(async () => {
      const own = ++attempt;
      return { ssh: () => ({ uploadFile: (s: string, t: string) => upload(s, t, own) }), dispose };
    }),
    ssh: vi.fn(async (_: unknown, command: string) => {
      try {
        return {
          exitCode: 0,
          stdout: execFileSync('sh', ['-c', command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
          stderr: '',
        };
      } catch {
        return { exitCode: 1, stdout: '', stderr: 'transport command failed' };
      }
    }),
  });
  return { dir, source, remote, svc, dispose };
}
describe('a verified upload is atomically promoted', () => {
  it('keeps the previous path intact during a real temporary-file transfer, including private mode', async () => {
    const f = fixture(async (source, temporary) => {
      expect(readFileSync(f.remote, 'utf8')).toBe('prior content');
      expect(temporary).not.toBe(f.remote);
      copyFileSync(source, temporary);
    });
    await f.svc.uploadFile(target, f.source, f.remote);
    expect(readFileSync(f.remote, 'utf8')).toBe('checked replacement');
    expect(statSync(f.remote).mode & 0o777).toBe(0o600);
    expect(f.dispose).toHaveBeenCalledTimes(1);
    expect(readdirSync(f.dir).filter((p) => p.endsWith('.part'))).toEqual([]);
  });
  it('retries a short write on a new isolated engine and verifies the replacement', async () => {
    const f = fixture(async (source, temporary, attempt) => {
      if (attempt === 1) writeFileSync(temporary, 'short');
      else copyFileSync(source, temporary);
    });
    await f.svc.uploadFile(target, f.source, f.remote);
    expect(f.svc.createTransferEngine).toHaveBeenCalledTimes(2);
    expect(f.dispose).toHaveBeenCalledTimes(2);
    expect(readFileSync(f.remote, 'utf8')).toBe('checked replacement');
  });
  it.each(['short', 'corrupt', 'disconnect'])('refuses %s transfers without replacing prior content', async (fault) => {
    const f = fixture(async (source, temporary) => {
      if (fault === 'disconnect') throw Error('connection lost');
      writeFileSync(temporary, fault === 'short' ? 'short' : Buffer.alloc(statSync(source).size, 7));
    });
    await expect(f.svc.uploadFile(target, f.source, f.remote)).rejects.toThrow(
      fault === 'corrupt' ? 'SHA256' : fault === 'short' ? 'landed' : 'connection lost'
    );
    expect(readFileSync(f.remote, 'utf8')).toBe('prior content');
    expect(f.dispose).toHaveBeenCalledTimes(2);
    expect(readdirSync(f.dir).filter((p) => p.endsWith('.part'))).toEqual([]);
  });
  it('cannot promote bytes after its lease is lost during the real temporary-file transfer', async () => {
    const f = fixture(async (source, temporary) => copyFileSync(source, temporary));
    const runControl = vi.fn(async () => { throw Error('Node lease lost'); });
    await expect(f.svc.uploadFile(target, f.source, f.remote, { runControl })).rejects.toThrow('Node lease lost');
    expect(runControl).toHaveBeenCalledTimes(2);
    expect(readFileSync(f.remote, 'utf8')).toBe('prior content');
    expect(readdirSync(f.dir).filter((p) => p.endsWith('.part'))).toEqual([]);
    expect(f.svc.ssh.mock.calls.some(([, command]: [unknown, string]) => command.includes('mv -f --'))).toBe(false);
  });
  it('verifies complete bytes inside the same guard that promotes the destination', async () => {
    const f = fixture(async (source, temporary) => copyFileSync(source, temporary));
    const runControl = vi.fn(async (command: string) => {
      const temporary = readdirSync(f.dir).find((p) => p.endsWith('.part'))!;
      writeFileSync(join(f.dir, temporary), Buffer.alloc(statSync(f.source).size, 7));
      return f.svc.ssh(target, command);
    });
    await expect(f.svc.uploadFile(target, f.source, f.remote, { runControl })).rejects.toThrow('promotion rejected');
    expect(readFileSync(f.remote, 'utf8')).toBe('prior content');
  });
  it('safely retries a lost acknowledgement after the first atomic promotion', async () => {
    const f = fixture(async (source, temporary) => copyFileSync(source, temporary));
    const original = f.svc.ssh;
    let lost = false;
    f.svc.ssh = async (t: unknown, command: string) => {
      const result = await original(t, command);
      if (!lost && command.includes('mv -f --')) {
        lost = true;
        throw Error('acknowledgement lost');
      }
      return result;
    };
    await f.svc.uploadFile(target, f.source, f.remote);
    expect(lost).toBe(true);
    expect(readFileSync(f.remote, 'utf8')).toBe('checked replacement');
    expect(f.svc.createTransferEngine).toHaveBeenCalledTimes(2);
  });
});
