import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileNode } from '../../src/files/file-node.js';
import { assertStructuralChange, structuralPaths } from '../../src/files/structural-policy.js';
import { fileNameError } from '../../src/shared/file-policy.js';
import { MemoryFileStore } from '../helpers/memory-file-store.js';
import type { FileDocument, FileEntry } from '../../src/shared/dto/files.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('protects structural system entries and parents, while keeping ordinary descendants editable', () => {
  for (const value of ['', 'etc', 'usr', 'var', 'Users', 'System', 'private', 'private/etc']) expect(() => assertStructuralChange('/', value)).toThrow();
  for (const value of ['etc/example.conf', 'var/log/example.log', 'Users/alice/project']) expect(() => assertStructuralChange('/', value)).not.toThrow();
  expect(() => assertStructuralChange('/srv/work', 'production', ['production/data'])).toThrow();
  expect(() => assertStructuralChange('/srv/work', 'production/data', ['production/data'])).toThrow();
  expect(() => assertStructuralChange('/srv/work', 'production/data/settings.json', ['production/data'])).not.toThrow();
  expect(structuralPaths('/srv/work')).toEqual([]);
});

it('enforces naming rules at the node boundary and never turns rename into an implicit move', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'omni-structural-')); roots.push(root);
  const node = new FileNode([{ id: 'work', label: 'Work', path: root }], new MemoryFileStore());
  const file = await node.invoke('alice', { op: 'saveText', rootId: 'work', path: 'keep.txt', content: 'keep', version: null }) as FileDocument;
  await mkdir(path.join(root, 'nested'));
  for (const destination of ['', '/', 'nested/moved.txt', 'bad/name', 'bad\\name', 'bad\u007fname', 'x'.repeat(256)]) {
    await expect(node.invoke('alice', { op: 'rename', rootId: 'work', path: 'keep.txt', destination, version: file.version })).rejects.toThrow();
    expect(await readFile(path.join(root, 'keep.txt'), 'utf8')).toBe('keep');
  }
  expect(fileNameError('Отчёт 🌐.txt')).toBeNull();
  expect(fileNameError('   ')).not.toBeNull();
  await node.invoke('alice', { op: 'rename', rootId: 'work', path: 'keep.txt', destination: 'renamed.txt', version: file.version });
  expect(await readFile(path.join(root, 'renamed.txt'), 'utf8')).toBe('keep');
});

it('enforces configured structural protections in rename and trash without preventing ordinary child edits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'omni-structural-')); roots.push(root);
  const node = new FileNode([{ id: 'work', label: 'Work', path: root, protectedPaths: ['production/data'] }], new MemoryFileStore());
  await mkdir(path.join(root, 'production/data'), { recursive: true });
  for (const entry of ['production', 'production/data']) {
    const observed = await node.invoke('alice', { op: 'stat', rootId: 'work', path: entry }) as FileEntry;
    await expect(node.invoke('alice', { op: 'rename', rootId: 'work', path: entry, destination: `${entry}-new`, version: observed.version })).rejects.toThrow('protected');
    await expect(node.invoke('alice', { op: 'trash', rootId: 'work', path: entry, version: observed.version })).rejects.toThrow('protected');
  }
  const child = await node.invoke('alice', { op: 'saveText', rootId: 'work', path: 'production/data/config.json', content: '{}', version: null }) as FileDocument;
  await node.invoke('alice', { op: 'saveText', rootId: 'work', path: 'production/data/config.json', content: '{"enabled":true}', version: child.version });
  expect(await readFile(path.join(root, 'production/data/config.json'), 'utf8')).toBe('{"enabled":true}');
  expect(node.roots().roots[0]!.protectedPaths).toContain('production/data');
  expect(() => new FileNode([{ id: 'bad', label: 'Bad', path: root, protectedPaths: ['../outside'] }], new MemoryFileStore())).toThrow();
});
