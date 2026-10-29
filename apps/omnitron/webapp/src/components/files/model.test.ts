import { describe, expect, it } from 'vitest';
import { fileName, relativePath, lineEnding, visibleEntries, encodeChunk, relocateBuffer } from './model';
import type { FileEntry } from '@omnitron-dev/omnitron/dto/services';

describe('file workspace boundary and presentation', () => {
  it('rejects unsafe path components without rewriting user intent', () => {
    for (const input of ['../root', 'dir/../file', '.omnitron-files', 'a\\b', 'bad\0name'])
      expect(() => relativePath(input)).toThrow();
    expect(relativePath('/srv/project/')).toBe('srv/project');
    expect(relativePath('/')).toBe('');
    expect(fileName('Отчёт 🌐.json')).toBe('Отчёт 🌐.json');
    expect(() => fileName('я'.repeat(128))).toThrow();
  });
  it('distinguishes uniform and mixed line endings to prevent silent conversion', () => {
    expect(lineEnding('a\r\nb\r\n')).toBe('\r\n');
    expect(lineEnding('a\nb\n')).toBe('\n');
    expect(lineEnding('a\rb\r')).toBe('\r');
    expect(lineEnding('a\r\nb\n')).toBe('mixed');
  });
  it('filters the loaded page and keeps directories first in both sorting directions', () => {
    const entries = [
      { name: 'file10', kind: 'file', size: 10 },
      { name: 'folder', kind: 'directory', size: 0 },
      { name: 'file2', kind: 'file', size: 2 },
      { name: '.hidden', kind: 'file', size: 3 },
    ] as FileEntry[];
    expect(visibleEntries(entries, '', false, 'name', false).map((e) => e.name)).toEqual(['folder', 'file2', 'file10']);
    expect(visibleEntries(entries, '', false, 'size', true).map((e) => e.name)).toEqual(['folder', 'file10', 'file2']);
    expect(visibleEntries(entries, 'HIDDEN', true, 'name', false)).toHaveLength(1);
  });
  it('encodes a full protocol chunk without argument-stack overflow or hash drift', async () => {
    const bytes = new Uint8Array(256 * 1024).fill(173),
      encoded = await encodeChunk(bytes);
    expect(Uint8Array.from(atob(encoded.data), (c) => c.charCodeAt(0))).toEqual(bytes);
    expect(encoded.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('keeps unsaved text through renames without accepting a stale document version', () => {
    const location = { nodeId: 'edge', rootId: 'work', path: 'folder/file.txt' };
    const buffer = {
      id: JSON.stringify(location),
      location,
      text: 'unsaved',
      document: { content: 'saved', version: 'before', bytes: 5, bom: false },
    };
    const source = { ...location, version: 'before' };
    const moved = relocateBuffer(buffer, source, { path: 'folder/renamed.txt', version: 'after' });
    expect(moved).toMatchObject({
      text: 'unsaved',
      location: { path: 'folder/renamed.txt' },
      document: { version: 'after' },
    });
    expect(moved.id).toBe(JSON.stringify(moved.location));
    expect(
      relocateBuffer(buffer, { ...source, version: 'external-change' }, { path: 'new.txt', version: 'after' }).document
        .version
    ).toBe('before');
    const folder = { ...source, path: 'folder', version: 'folder-before' };
    expect(relocateBuffer(buffer, folder, { path: 'other', version: 'folder-after' })).toMatchObject({
      location: { path: 'other/file.txt' },
      document: { version: 'before' },
    });
    expect(relocateBuffer(buffer, { ...folder, nodeId: 'another-node' }, { path: 'other', version: 'after' })).toBe(
      buffer
    );
    expect(relocateBuffer(buffer, { ...folder, path: 'fold' }, { path: 'other', version: 'after' })).toBe(buffer);
  });
});
