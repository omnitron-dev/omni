import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionEngine } from '@xec-sh/core';
import { ARCHIVE_LIMITS, ArchivePayloadWriter, createArchive, probeArchiveFormats, restoreArchive, validateArchiveManifest } from '../../src/files/archive-codec.js';
import type { FileArchiveManifest } from '../../src/shared/dto/files.js';

const folders: string[] = [];
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const signal = () => new AbortController().signal;
const rootEntry = { path: 'root', kind: 'directory' as const, size: 0, mode: 0o700 };
const file = (name: string, data: Buffer | string) => ({ path: 'root/' + name, kind: 'file' as const,
  size: Buffer.byteLength(data), mode: 0o640, sha256: digest(data) });
const manifest = (): FileArchiveManifest => ({ protocol: 1, rootName: 'root', entries: [rootEntry, file('z', 'first'), file('a', 'second'), file('empty', '')] });
async function temp() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-codec-test-')); await fs.chmod(directory, 0o700); folders.push(directory); return directory; }
async function output() { const directory = await temp(); await fs.mkdir(path.join(directory, 'root'), { mode: 0o700 }); return directory; }
afterEach(async () => { await Promise.all(folders.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });

describe('archive manifest admission', () => {
  it('accepts a bounded, ordered tree with a single root and checksummed files', () => {
    expect(() => validateArchiveManifest(manifest())).not.toThrow();
  });
  it.each(['../escape', '/absolute', 'root/../../escape', 'root/a\\b', 'root/a\nflag', 'root/.omnitron-files', 'root//empty'])('rejects unsafe paths: %s', unsafe => {
    const value = manifest(); value.entries[1]!.path = unsafe;
    expect(() => validateArchiveManifest(value)).toThrow();
  });
  it('rejects duplicates, undeclared parents, special entries and elevated mode bits', () => {
    const duplicate = manifest(); duplicate.entries.push(duplicate.entries[1]!);
    expect(() => validateArchiveManifest(duplicate)).toThrow();
    const parent = manifest(); parent.entries[1]!.path = 'root/missing/file';
    expect(() => validateArchiveManifest(parent)).toThrow('parent');
    const kind = manifest(); kind.entries[1]!.kind = 'symlink' as 'file';
    expect(() => validateArchiveManifest(kind)).toThrow();
    const permissions = manifest(); permissions.entries[1]!.mode = 0o4755;
    expect(() => validateArchiveManifest(permissions)).toThrow();
  });
  it('rejects over-limit trees, byte totals, depth and missing file hashes', () => {
    const size = manifest(); size.entries[1]!.size = ARCHIVE_LIMITS.bytes; size.entries[2]!.size = 1;
    expect(() => validateArchiveManifest(size)).toThrow('byte limit');
    const depth = manifest(); depth.entries[1]!.path = 'root/' + 'a/'.repeat(32) + 'file';
    expect(() => validateArchiveManifest(depth)).toThrow();
    const count = manifest(); count.entries = Array.from({ length: ARCHIVE_LIMITS.entries + 1 }, () => rootEntry);
    expect(() => validateArchiveManifest(count)).toThrow();
    const hash = manifest(); delete hash.entries[1]!.sha256;
    expect(() => validateArchiveManifest(hash)).toThrow('SHA-256');
  });
});

describe('bounded archive stdout decoder', () => {
  it('handles arbitrary chunk boundaries, ordered binary payloads and empty trailing files', async () => {
    const directory = await output(), value = manifest();
    const bytes = Buffer.from([0, 255, 127, 1]); value.entries[1] = file('z', bytes);
    const all = Buffer.concat([bytes, Buffer.from('second')]), progress: number[] = [];
    await pipeline(Readable.from([...all].map(byte => Buffer.from([byte]))),
      new ArchivePayloadWriter(directory, value, signal(), count => progress.push(count)));
    expect(await fs.readFile(path.join(directory, 'root/z'))).toEqual(bytes);
    expect(await fs.readFile(path.join(directory, 'root/a'), 'utf8')).toBe('second');
    expect((await fs.stat(path.join(directory, 'root/empty'))).size).toBe(0);
    expect(progress.at(-1)).toBe(all.length);
  });
  it.each([
    ['truncated', 'firstsecon', 'before the declared manifest'],
    ['extra', 'firstsecondEXTRA', 'beyond the declared manifest'],
    ['modified', 'wrongsecond', 'checksum mismatch'],
  ])('rejects %s payloads', async (_kind, bytes, error) => {
    await expect(pipeline(Readable.from([Buffer.from(bytes)]), new ArchivePayloadWriter(await output(), manifest(), signal()))).rejects.toThrow(error);
  });
  it('refuses existing files and symbolic links, preserving their targets', async () => {
    const directory = await output(), outside = path.join(directory, 'outside');
    await fs.writeFile(outside, 'preserve'); await fs.symlink(outside, path.join(directory, 'root/z'));
    await expect(pipeline(Readable.from([Buffer.from('firstsecond')]), new ArchivePayloadWriter(directory, manifest(), signal()))).rejects.toThrow();
    expect(await fs.readFile(outside, 'utf8')).toBe('preserve');
  });
  it('stops a cancelled decoder before opening another file', async () => {
    const directory = await output(), controller = new AbortController(); controller.abort(new Error('cancelled by test'));
    await expect(pipeline(Readable.from([Buffer.from('firstsecond')]), new ArchivePayloadWriter(directory, manifest(), controller.signal))).rejects.toThrow('cancelled');
    expect(await fs.readdir(path.join(directory, 'root'))).toEqual([]);
  });
  it('closes an fd whose asynchronous open resolves after cancellation', async () => {
    const directory = await output();
    const realOpen = fs.open.bind(fs);
    const handle = await realOpen(path.join(directory, 'root/z'), 'wx', 0o600);
    const close = vi.spyOn(handle, 'close');
    let release!: () => void;
    const pending = new Promise<typeof handle>(resolve => { release = () => resolve(handle); });
    const opening = vi.spyOn(fs, 'open').mockReturnValueOnce(pending);
    const writer = new ArchivePayloadWriter(directory, manifest(), signal());
    writer.on('error', () => {});
    const closed = new Promise<void>(resolve => writer.once('close', resolve));
    try {
      writer.write(Buffer.from('first'), () => {});
      expect(opening).toHaveBeenCalledOnce();
      writer.destroy(new Error('cancelled during open'));
      release(); await closed;
      expect(close).toHaveBeenCalledOnce();
      expect(await fs.readFile(path.join(directory, 'root/z'), 'utf8')).toBe('');
    } finally { opening.mockRestore(); close.mockRestore(); }
  });
  it('can leave the private payload accessible until a publisher verifies and applies final modes', async () => {
    const directory = await output(), value = manifest(); value.entries[1]!.mode = 0;
    await pipeline(Readable.from([Buffer.from('firstsecond')]),
      new ArchivePayloadWriter(directory, value, signal(), undefined, { preserveModes: false }));
    expect((await fs.stat(path.join(directory, 'root/z'))).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(path.join(directory, 'root/z'), 'utf8')).toBe('first');
  });
});

describe('probed native archive codecs through Xec', () => {
  it('retains archive output when an encoder works but its decoder fails', async () => {
    vi.resetModules();
    const { probeArchiveFormats: probeFresh } = await import('../../src/files/archive-codec.js');
    const execute = vi.spyOn(ExecutionEngine.prototype, 'execute').mockImplementation(function (command) {
      if (command.command !== 'zip') return Promise.reject(new Error('Codec unavailable in this test'));
      (command.stdout as Writable).end(Buffer.from('encoded test fixture'));
      return Promise.resolve({}) as ReturnType<ExecutionEngine['execute']>;
    });
    try {
      const capabilities = await probeFresh();
      const encodedZip = execute.mock.calls.some(([command]) => command.command === 'zip');
      expect(encodedZip).toBe(true);
      expect(capabilities.formats.find(format => format.format === 'zip')?.outputs).toEqual(['archive']);
    } finally { execute.mockRestore(); }
  });
  it('round-trips every advertised restorable format with no filename-extension inference', async () => {
    const capabilities = await probeArchiveFormats();
    const directory = await temp(), snapshot = path.join(directory, 'snapshot'); await fs.mkdir(snapshot, { mode: 0o700 });
    await fs.mkdir(path.join(snapshot, 'root'), { mode: 0o700 });
    await fs.writeFile(path.join(snapshot, 'root/z'), 'first'); await fs.writeFile(path.join(snapshot, 'root/a'), 'second'); await fs.writeFile(path.join(snapshot, 'root/empty'), '');
    for (const [index, format] of capabilities.formats.entries()) {
      const archiveFile = path.join(directory, 'payload-' + index);
      await createArchive({ format: format.format, manifest: manifest(), sourceDirectory: snapshot, outputFile: archiveFile, signal: signal() });
      expect((await fs.stat(archiveFile)).size).toBeGreaterThan(0);
      if (!format.outputs.includes('directory')) continue;
      const target = path.join(directory, 'target-' + index); await fs.mkdir(target, { mode: 0o700 });
      await restoreArchive({ format: format.format, manifest: manifest(), archiveFile, outputDirectory: target, signal: signal() });
      expect(await fs.readFile(path.join(target, 'root/z'), 'utf8')).toBe('first');
      expect(await fs.readFile(path.join(target, 'root/a'), 'utf8')).toBe('second');
      expect((await fs.stat(path.join(target, 'root/z'))).mode & 0o777).toBe(0o640);
    }
    expect(capabilities.formats.every(format => format.format !== '7z' || !format.outputs.includes('directory'))).toBe(true);
  });
  it('round-trips empty folders for every advertised restorable format', async () => {
    const capabilities = await probeArchiveFormats();
    const directory = await temp(), snapshot = path.join(directory, 'snapshot'); await fs.mkdir(snapshot, { mode: 0o700 });
    await fs.mkdir(path.join(snapshot, 'root'), { mode: 0o700 });
    const value: FileArchiveManifest = { protocol: 1, rootName: 'root', entries: [rootEntry] };
    for (const [index, format] of capabilities.formats.filter(item => item.outputs.includes('directory')).entries()) {
      const archiveFile = path.join(directory, 'empty-' + index), target = path.join(directory, 'target-' + index);
      await fs.mkdir(target, { mode: 0o700 });
      await createArchive({ format: format.format, manifest: value, sourceDirectory: snapshot, outputFile: archiveFile, signal: signal() });
      await restoreArchive({ format: format.format, manifest: value, archiveFile, outputDirectory: target, signal: signal() });
      expect(await fs.readdir(path.join(target, 'root'))).toEqual([]);
    }
  });
  it('does not overwrite an existing archive or include undeclared snapshot files', async () => {
    const directory = await temp(), snapshot = path.join(directory, 'snapshot'); await fs.mkdir(snapshot, { mode: 0o700 });
    await fs.mkdir(path.join(snapshot, 'root'), { mode: 0o700 });
    const outputFile = path.join(directory, 'output'); await fs.writeFile(outputFile, 'original');
    const value: FileArchiveManifest = { protocol: 1, rootName: 'root', entries: [rootEntry] };
    await expect(createArchive({ format: 'tar', manifest: value, sourceDirectory: snapshot, outputFile, signal: signal() })).rejects.toThrow();
    expect(await fs.readFile(outputFile, 'utf8')).toBe('original');
    await fs.writeFile(path.join(snapshot, 'root/undeclared'), 'not in manifest');
    await expect(createArchive({ format: 'tar', manifest: value, sourceDirectory: snapshot, outputFile: path.join(directory, 'other'), signal: signal() })).rejects.toThrow('undeclared');
  });
});
