import { configuredFileRoots } from '../../src/files/file-config.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { FileNode, FILE_LIMITS } from '../../src/files/file-node.js';
import type { FileDocument, FileEntry, FileNodeRequest, FileUpload, FileTrash } from '../../src/shared/dto/files.js';

import { MemoryFileStore } from '../helpers/memory-file-store.js';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let root: string, store: MemoryFileStore, node: FileNode;
const call = <T>(request: FileNodeRequest, actor = 'alice') => node.invoke(actor, request) as Promise<T>;
const ref = { rootId: 'work', path: 'document.txt' };
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'omnitron-files-'));
  store = new MemoryFileStore();
  node = new FileNode(
    [
      { id: 'work', label: 'Workspace', path: root },
      { id: 'read', label: 'Read only', path: root, readOnly: true },
    ],
    store
  );
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('file export boundary and atomic editing', () => {
  it.each(['../outside', '/etc/passwd', 'a/../b', 'a//b', 'a\\b', '.omnitron-files/private', 'a\0b'])(
    'rejects traversal or reserved path %s',
    async (p) => {
      await expect(call({ op: 'readText', rootId: 'work', path: p })).rejects.toThrow();
    }
  );
  it('does not follow symlinks, including ancestor links and replaced roots', async () => {
    await fs.symlink(tmpdir(), path.join(root, 'escape'));
    await expect(call({ op: 'readText', rootId: 'work', path: 'escape/unavailable' })).rejects.toThrow('Symbolic');
    await call({ op: 'list', rootId: 'work', path: '' });
    const old = root + '-old';
    await fs.rename(root, old);
    await fs.mkdir(root);
    try {
      await expect(call({ op: 'list', rootId: 'work', path: '' })).rejects.toThrow('root changed');
    } finally {
      await fs.rm(old, { recursive: true, force: true });
    }
  });
  it('keeps original data on stale or concurrent saves and preserves UTF-8, BOM and CRLF', async () => {
    const content = 'Привет 🌐\r\nsecond\r\n';
    const first = await call<FileDocument>({ op: 'saveText', ...ref, content, bom: true, version: null });
    expect(await fs.readFile(path.join(root, ref.path), 'utf8')).toBe('\ufeff' + content);
    expect(first).toMatchObject({ content, bom: true });
    const results = await Promise.allSettled(
      ['one', 'two'].map((text) => call({ op: 'saveText', ...ref, content: text, version: first.version }))
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(call({ op: 'saveText', ...ref, content: 'lost update', version: first.version })).rejects.toThrow(
      'conflict'
    );
    await expect(call({ op: 'saveText', ...ref, rootId: 'read', content: '', version: null })).rejects.toThrow(
      'read-only'
    );
  });
  it('rejects oversized and binary editors and stale transfer reads', async () => {
    await fs.writeFile(path.join(root, ref.path), Buffer.from([0xff, 0]));
    await expect(call({ op: 'readText', ...ref })).rejects.toThrow();
    await fs.writeFile(path.join(root, ref.path), Buffer.alloc(FILE_LIMITS.text + 1));
    await expect(call({ op: 'readText', ...ref })).rejects.toThrow('1 MiB');
    const stat = await call<FileEntry>({ op: 'stat', ...ref });
    await fs.writeFile(path.join(root, ref.path), 'changed');
    await expect(call({ op: 'readChunk', ...ref, version: stat.version, offset: 0 })).rejects.toThrow('changed');
  });
  it('moves to recoverable trash, checks ownership and refuses restore collisions', async () => {
    const saved = await call<FileDocument>({ op: 'saveText', ...ref, content: 'keep', version: null });
    const removed = await call<FileTrash>({ op: 'trash', ...ref, version: saved.version });
    await expect(fs.stat(path.join(root, ref.path))).rejects.toThrow();
    await expect(call({ op: 'restore', id: removed.id }, 'bob')).rejects.toThrow('session');
    await fs.writeFile(path.join(root, ref.path), 'other');
    await expect(call({ op: 'restore', id: removed.id })).rejects.toThrow('conflict');
    expect(await fs.readFile(path.join(root, ref.path), 'utf8')).toBe('other');
    await fs.unlink(path.join(root, ref.path));
    expect(await call<FileTrash>({ op: 'restore', id: removed.id })).toMatchObject({ restored: true });
    expect(await fs.readFile(path.join(root, ref.path), 'utf8')).toBe('keep');
  });
  it('reconciles a restored file after losing the journal acknowledgement', async () => {
    const saved = await call<FileDocument>({ op: 'saveText', ...ref, content: 'recover', version: null });
    const removed = await call<FileTrash>({ op: 'trash', ...ref, version: saved.version });
    expect(removed).not.toHaveProperty('identity');
    store.fail = true;
    await expect(call({ op: 'restore', id: removed.id })).rejects.toThrow('journal unavailable');
    expect(await fs.readFile(path.join(root, ref.path), 'utf8')).toBe('recover');
    store.fail = false;
    node = new FileNode([{ id: 'work', label: 'Workspace', path: root }], store);
    expect(await call<FileTrash>({ op: 'restore', id: removed.id })).toMatchObject({ restored: true });
    expect(await call({ op: 'trashList', rootId: 'work' })).toEqual([]);
  });
});

describe('durable acknowledged file writes', () => {
  it('resumes after reconstruction, accepts identical retries, rejects corrupt/out-of-order frames and publishes once', async () => {
    const data = Buffer.from('durable transfer 🌐');
    const opened = await call<FileUpload>({ op: 'beginWrite', ...ref, size: data.length });
    await expect(fs.stat(path.join(root, ref.path))).rejects.toThrow();
    const frame = {
      op: 'writeChunk' as const,
      id: opened.id,
      offset: 0,
      data: data.toString('base64'),
      sha256: sha(data),
    };
    await expect(call({ ...frame, offset: 1 })).rejects.toThrow();
    await expect(call({ ...frame, sha256: '0'.repeat(64) })).rejects.toThrow('checksum');
    await expect(call(frame, 'bob')).rejects.toThrow('session');
    expect(await call<FileUpload>(frame)).toMatchObject({ offset: data.length });
    node = new FileNode([{ id: 'work', label: 'Workspace', path: root }], store);
    expect(await call<FileUpload>(frame)).toMatchObject({ offset: data.length });
    const complete = await call<FileUpload>({ op: 'commitWrite', id: opened.id });
    expect(complete).toMatchObject({ state: 'complete', sha256: sha(data) });
    expect(await call({ op: 'commitWrite', id: opened.id })).toEqual(complete);
    expect(await fs.readFile(path.join(root, ref.path))).toEqual(data);
    await expect(call({ op: 'beginWrite', ...ref, size: 2 })).rejects.toThrow('exists');
  });
  it('recovers a write ahead of its journal acknowledgement without corrupting the destination', async () => {
    const data = Buffer.from('recover');
    const u = await call<FileUpload>({ op: 'beginWrite', ...ref, size: data.length });
    store.fail = true;
    const frame = { op: 'writeChunk' as const, id: u.id, offset: 0, data: data.toString('base64'), sha256: sha(data) };
    await expect(call(frame)).rejects.toThrow('journal unavailable');
    store.fail = false;
    await call(frame);
    await call({ op: 'commitWrite', id: u.id });
    expect(await fs.readFile(path.join(root, ref.path))).toEqual(data);
  });
  it('does not overwrite a destination created during transfer', async () => {
    const u = await call<FileUpload>({ op: 'beginWrite', ...ref, size: 0 });
    await fs.writeFile(path.join(root, ref.path), 'created elsewhere');
    await expect(call({ op: 'commitWrite', id: u.id })).rejects.toThrow('nothing was overwritten');
    expect(await fs.readFile(path.join(root, ref.path), 'utf8')).toBe('created elsewhere');
  });
});

describe('node file policy', () => {
  it('defaults to administrator filesystem access and permits explicit restricted or disabled exports', () => {
    expect(configuredFileRoots()).toEqual([{ id: 'system', label: 'Filesystem', path: '/' }]);
    expect(configuredFileRoots({ enabled: false })).toEqual([]);
    expect(configuredFileRoots({ roots: [] })).toEqual([]);
    const roots = [{ id: 'readonly', label: 'Logs', path: '/var/log', readOnly: true }];
    expect(configuredFileRoots({ roots })).toEqual(roots);
    expect(() => configuredFileRoots({ enabled: 'false' } as never)).toThrow('boolean');
    expect(() => configuredFileRoots(null as never)).toThrow('object');
  });
  it('stages within a writable child instead of requiring a writable export root', async () => {
    await fs.mkdir(path.join(root, 'child'));
    const child = { rootId: 'work', path: 'child/config.json' };
    await call({ op: 'saveText', ...child, version: null, content: '{}' });
    expect(await fs.readFile(path.join(root, child.path), 'utf8')).toBe('{}');
    await expect(fs.stat(path.join(root, '.omnitron-files'))).rejects.toThrow();
    expect((await fs.stat(path.join(root, 'child/.omnitron-files'))).isDirectory()).toBe(true);
  });
});
