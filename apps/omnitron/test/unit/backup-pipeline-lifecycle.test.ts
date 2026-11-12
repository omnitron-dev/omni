import fs from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dumpToFile, restoreFromFile } from '../../src/services/backup-pipeline.js';

let directory: string;
const timers = new Set<ReturnType<typeof setTimeout>>();
const pidFiles: string[] = [];
const file = (name: string) => path.join(directory, name);
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
};
const pidFile = (name: string) => {
  const result = file(name);
  pidFiles.push(result);
  return result;
};
const pidAt = (name: string) => Number(fs.readFileSync(name, 'utf8'));
async function untilPresent(name: string): Promise<void> {
  await vi.waitFor(() => expect(fs.existsSync(name)).toBe(true), { timeout: 5_000, interval: 10 });
}

beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-lifecycle-')); });
afterEach(() => {
  vi.restoreAllMocks();
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  // The baseline intentionally leaks a producer. Reap only PIDs written by
  // these harmless fixtures, so a red regression never leaves it running.
  for (const name of pidFiles.splice(0)) {
    if (!fs.existsSync(name)) continue;
    const pid = pidAt(name);
    if (alive(pid)) process.kill(pid, 'SIGKILL');
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

/** Inject a stream fault while retaining real files, subprocesses and backpressure. */
async function alterWriteStream(alter: (stream: fs.WriteStream) => void): Promise<void> {
  const seen = new WeakSet<fs.WriteStream>();
  const decorate = (stream: fs.WriteStream) => {
    if (!seen.has(stream)) { seen.add(stream); alter(stream); }
    return stream;
  };
  const create = fs.createWriteStream;
  vi.spyOn(fs, 'createWriteStream').mockImplementation((...args) => decorate(create(...args)));
  const handle = await fs.promises.open(file('prototype'), 'wx');
  const prototype = Object.getPrototypeOf(handle) as Pick<typeof handle, 'createWriteStream'>;
  const createOwned = prototype.createWriteStream;
  vi.spyOn(prototype, 'createWriteStream').mockImplementation(function createDecorated(this: typeof handle, ...args) {
    return decorate(createOwned.apply(this, args));
  });
  await handle.close();
}

async function alterSync(alter: (handle: FileHandle, sync: () => Promise<void>) => Promise<void>): Promise<void> {
  const handle = await fs.promises.open(file('sync-prototype'), 'wx');
  const prototype = Object.getPrototypeOf(handle) as Pick<typeof handle, 'sync'>;
  const sync = prototype.sync;
  vi.spyOn(prototype, 'sync').mockImplementation(function syncWithFault(this: typeof handle) {
    return alter(this, () => sync.call(this));
  });
  await handle.close();
}

describe('backup transfer lifecycle', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 86_400_001])('rejects invalid budget %s before file/process effects', async timeoutMs => {
    const marker = file('spawned');
    await expect(dumpToFile(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], "spawned")', marker],
      file('out'), false, { timeoutMs })).rejects.toThrow(/timeout must be an integer/);
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('preserves an existing destination on spawn failure and refuses before child effects', async () => {
    const output = file('existing');
    fs.writeFileSync(output, 'a previous valid backup');
    await expect(dumpToFile('/no-such-backup-producer', [], output, false)).rejects.toThrow();
    expect(fs.readFileSync(output, 'utf8')).toBe('a previous valid backup');
    const marker = file('spawned');
    await expect(dumpToFile(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], "spawned")', marker],
      output, false)).rejects.toThrow(/already exists/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('does not replace a destination claimed by another writer during the transfer', async () => {
    const ready = pidFile('writer.pid'), release = file('release'), output = file('result');
    const run = dumpToFile(process.execPath, ['-e', `
      const fs = require('node:fs');
      fs.writeFileSync(process.argv[1], String(process.pid));
      const timer = setInterval(() => { if (fs.existsSync(process.argv[2])) {
        clearInterval(timer); process.stdout.end('our complete output');
      } }, 10);
    `, ready, release], output, false, { timeoutMs: 5_000 });
    const observed = run.then(() => undefined, error => error as Error);
    await untilPresent(ready);
    expect(fs.existsSync(output)).toBe(false);
    fs.writeFileSync(output, 'another writer owns this', { flag: 'wx' });
    fs.writeFileSync(release, 'continue');
    expect(await observed).toBeInstanceOf(Error);
    expect(fs.readFileSync(output, 'utf8')).toBe('another writer owns this');
    expect(fs.readdirSync(directory).filter(name => name.endsWith('.partial'))).toEqual([]);
  });

  it('kills and reaps a live producer after output failure, before returning the error', async () => {
    const marker = pidFile('producer.pid');
    await alterWriteStream(stream => {
      const write = stream._write;
      stream._write = function writeWithFailure(chunk, encoding, callback) {
        write.call(this, chunk, encoding, error => callback(error ?? new Error('injected ENOSPC after a real write')));
      };
    });
    await expect(dumpToFile(process.execPath, ['-e', `
      require('node:fs').writeFileSync(process.argv[1], String(process.pid));
      process.stdout.on('error', () => {});
      process.stdout.write('partial bytes');
      setInterval(() => {}, 1000);
    `, marker], file('failed'), false, { timeoutMs: 5_000 })).rejects.toThrow(/ENOSPC/);
    expect(alive(pidAt(marker)), 'the producer survived a failed output').toBe(false);
    expect(fs.existsSync(file('failed'))).toBe(false);
    expect(fs.readdirSync(directory).filter(name => name.endsWith('.partial'))).toEqual([]);
  });

  it('enforces the deadline while the output is finalizing after the producer exited', async () => {
    const marker = pidFile('completed.pid');
    await alterWriteStream(stream => {
      stream._final = callback => { timers.add(setTimeout(callback, 1_500)); };
    });
    await expect(dumpToFile(process.execPath, ['-e', `
      require('node:fs').writeFileSync(process.argv[1], String(process.pid));
      process.stdout.end('complete producer output');
    `, marker], file('late'), true, { timeoutMs: 500 })).rejects.toThrow(/deadline/);
    expect(alive(pidAt(marker))).toBe(false);
    expect(fs.existsSync(file('late'))).toBe(false);
  });

  it('terminates the owned local process group instead of waiting for an inherited pipe to close', async () => {
    const childPid = pidFile('descendant.pid');
    const descendant = `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => {}, 4000);`;
    const started = performance.now();
    await expect(dumpToFile(process.execPath, ['-e', `
      require('node:child_process').spawn(process.execPath, ['-e', process.argv[1], process.argv[2]], { stdio: 'inherit' });
      process.exit(0);
    `, descendant, childPid], file('inherited'), false, { timeoutMs: 500 })).rejects.toThrow(/deadline/);
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(alive(pidAt(childPid))).toBe(false);
    expect(fs.existsSync(file('inherited'))).toBe(false);
  });

  it('reaps a restore consumer when decompression fails after it received data', async () => {
    const marker = pidFile('consumer.pid'), input = file('broken.gz');
    const bytes = Buffer.concat([gzipSync(Buffer.alloc(2 * 1024 * 1024, 'x')), Buffer.from('invalid gzip trailer')]);
    fs.writeFileSync(input, bytes);
    await expect(restoreFromFile(process.execPath, ['-e', `
      require('node:fs').writeFileSync(process.argv[1], String(process.pid));
      process.stdin.resume(); process.stdin.on('error', () => {});
      setInterval(() => {}, 1000);
    `, marker], input, true, { timeoutMs: 5_000 })).rejects.toThrow();
    expect(alive(pidAt(marker)), 'restore consumer survived invalid input').toBe(false);
    expect(fs.readFileSync(input)).toEqual(bytes);
  });

  it('does not publish a completed file whose fsync failed', async () => {
    await alterSync(async handle => {
      expect((await handle.stat()).isFile()).toBe(true);
      throw new Error('injected file fsync failure');
    });
    await expect(dumpToFile(process.execPath, ['-e', 'process.stdout.end("complete")'], file('unsynced'), false))
      .rejects.toThrow(/file fsync failure/);
    expect(fs.existsSync(file('unsynced'))).toBe(false);
    expect(fs.readdirSync(directory).filter(name => name.endsWith('.partial'))).toEqual([]);
  });

  it('does not publish after a file fsync finishes beyond the execution deadline', async () => {
    await alterSync(async (_handle, sync) => {
      await sync();
      await new Promise<void>(resolve => { timers.add(setTimeout(resolve, 800)); });
    });
    await expect(dumpToFile(process.execPath, ['-e', 'process.stdout.end("complete")'], file('late-sync'), false,
      { timeoutMs: 300 })).rejects.toThrow(/deadline/);
    expect(fs.existsSync(file('late-sync'))).toBe(false);
    expect(fs.readdirSync(directory).filter(name => name.endsWith('.partial'))).toEqual([]);
  });

  it('reports directory durability failure without deleting a concurrent replacement', async () => {
    const output = file('published');
    await alterSync(async (handle, sync) => {
      if ((await handle.stat()).isFile()) { await sync(); return; }
      expect(fs.readFileSync(output, 'utf8')).toBe('complete');
      expect(fs.statSync(output).mode & 0o077).toBe(0);
      fs.unlinkSync(output);
      fs.writeFileSync(output, 'replacement belongs to another writer', { flag: 'wx' });
      throw new Error('injected directory fsync failure');
    });
    await expect(dumpToFile(process.execPath, ['-e', 'process.stdout.end("complete")'], output, false))
      .rejects.toThrow(/publication was not confirmed.*directory fsync failure/);
    expect(fs.readFileSync(output, 'utf8')).toBe('replacement belongs to another writer');
  });

  it('retains the original process error when private staging cleanup also fails', async () => {
    const unlink = fs.promises.unlink;
    vi.spyOn(fs.promises, 'unlink').mockImplementation(async name => {
      if (String(name).endsWith('.partial')) throw new Error('injected staging cleanup refusal');
      await unlink(name);
    });
    const result = await dumpToFile(process.execPath, ['-e', 'process.stdout.write("partial"); process.exitCode = 7'],
      file('failed-cleanup'), false).then(() => undefined, error => error as AggregateError);
    expect(result).toBeInstanceOf(AggregateError);
    expect(result?.message).toMatch(/exited with code 7.*cleanup failed.*staging cleanup refusal/);
    expect(result?.errors[0]).toBeInstanceOf(Error);
    expect(result?.errors[0].message).toContain('exited with code 7');
    expect(fs.existsSync(file('failed-cleanup'))).toBe(false);
    expect(fs.readdirSync(directory).filter(name => name.endsWith('.partial'))).toHaveLength(1);
  });
});
