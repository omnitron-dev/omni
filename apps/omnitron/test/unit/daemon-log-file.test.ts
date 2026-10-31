import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ReopenableFileStream } from '../../src/daemon/daemon.module.js';
afterEach(() => vi.restoreAllMocks());
it('finishes short writes and fsyncs the flush barrier before acknowledging it', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-file-'));
  const file = path.join(directory, 'daemon.log');
  const stream = new ReopenableFileStream(file);
  const original = fs.write.bind(fs);
  vi.spyOn(fs, 'write').mockImplementation(((fd, buffer, offset, length, position, callback) => {
    original(fd, buffer, offset, Math.min(length, 3), position, callback);
  }) as typeof fs.write);
  const synced = vi.spyOn(fs, 'fsync');
  try {
    await new Promise<void>((resolve, reject) => stream.write(Buffer.from('Error\n  at αβ\n'), error => error ? reject(error) : resolve()));
    await new Promise<void>((resolve, reject) => stream.write(Buffer.alloc(0), error => error ? reject(error) : resolve()));
    expect(synced).toHaveBeenCalledOnce();
    expect(fs.readFileSync(file, 'utf8')).toBe('Error\n  at αβ\n');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  } finally { stream.destroy(); await new Promise<void>(resolve => stream.once('close', resolve)); fs.rmSync(directory, { recursive: true }); }
});
