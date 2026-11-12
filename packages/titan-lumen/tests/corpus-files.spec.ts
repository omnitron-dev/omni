import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { KnowledgeBase } from '@omnitron-dev/kb';
import { isCanonicalDocumentPath, readCorpusFile, scanCorpusFiles } from '../src/corpus-files.js';
import { LumenService } from '../src/lumen.service.js';
import { asUser } from './netron-fixture.js';

const roots: string[] = [];
const extensions = new Set(['.md', '.pdx']);
async function corpus() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lumen-corpus-')));
  roots.push(root);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('bounded corpus reads through the service', () => {
  it('uses canonical paths rather than blacklisting ordinary documentation names', async () => {
    const root = await corpus();
    await mkdir(join(root, 'guide', 'etc'), { recursive: true });
    await writeFile(join(root, 'guide', 'etc', 'dev.md'), '# A guide');
    const service = new LumenService({ docsDir: root });
    expect(await service.getDocument('guide/etc/dev.md')).toContain('A guide');
    for (const path of ['.private.md', 'x/../guide.md', 'x//y.md', 'x\\y.md', 'x/%2e.md', '/guide.md', 'C:guide.md']) {
      expect(isCanonicalDocumentPath(path, extensions)).toBe(false);
      expect(await service.getDocument(path)).toBeNull();
    }
  });

  it('does not follow symlink loops or aliases and gives deterministic inventories', async () => {
    const root = await corpus();
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'z.md'), '# Z');
    await writeFile(join(root, 'nested', 'a.md'), '# A');
    await symlink(root, join(root, 'nested', 'loop'));
    await symlink(join(root, 'z.md'), join(root, 'alias.md'));
    expect((await scanCorpusFiles(root, extensions, 1024)).map(file => file.path)).toEqual(['nested/a.md', 'z.md']);
    expect(await readCorpusFile(root, 'alias.md', 1024)).toBeNull();
    expect(await readCorpusFile(root, 'nested/loop/z.md', 1024)).toBeNull();
  });

  it('fails a whole inventory at size, entry and depth bounds instead of truncating', async () => {
    const root = await corpus();
    await writeFile(join(root, 'a.md'), '123456');
    await writeFile(join(root, 'b.md'), '123456');
    await expect(scanCorpusFiles(root, extensions, 5)).rejects.toThrow('exceeds');
    await expect(scanCorpusFiles(root, extensions, 10, { maxBytes: 10 })).rejects.toThrow('exceeds');
    await expect(scanCorpusFiles(root, extensions, 10, { maxEntries: 1 })).rejects.toThrow('entries exceed');
    await mkdir(join(root, 'one', 'two'), { recursive: true });
    await expect(scanCorpusFiles(root, extensions, 10, { maxDepth: 1 })).rejects.toThrow('depth exceeds');
    const service = new LumenService({ docsDir: root, corpusLimits: { maxEntries: 1 } });
    await expect(service.search('123')).rejects.toThrow('configured documentation corpus');
    await expect(service.getTheoremGraph()).rejects.toThrow('configured documentation corpus');
  });

  it('preserves malformed UTF-8 and missing configured root as failures, not empty success', async () => {
    const root = await corpus();
    await writeFile(join(root, 'invalid.md'), Buffer.from([0xc3, 0x28]));
    const service = new LumenService({ docsDir: root });
    await expect(service.getDocument('invalid.md')).rejects.toThrow('configured documentation corpus');
    await expect(service.search('anything')).rejects.toThrow('configured documentation corpus');
    const missing = new LumenService({ docsDir: join(root, 'absent') });
    await expect(missing.getDocument('document.md')).rejects.toThrow('configured documentation corpus');
    expect(await service.getDocument('absent.md')).toBeNull();
  });

  it('bounds requests before touching the corpus', async () => {
    const service = new LumenService({ docsDir: await corpus() });
    for (const limit of [-1, 0.5, 101, NaN, Infinity, '3']) {
      await expect(service.search('query', { limit: limit as number })).rejects.toMatchObject({ code: 400 });
    }
    await expect(service.search('q'.repeat(4097))).rejects.toMatchObject({ code: 400 });
    expect(await service.search('query', { limit: 0 })).toEqual([]);
  });

  it('rejects conflicting declared document and mathematical identities', async () => {
    const root = await corpus();
    await writeFile(join(root, 'a.md'), '---\nid: same\n---\nquery');
    await writeFile(join(root, 'b.md'), '---\nid: same\n---\nquery');
    const service = new LumenService({ docsDir: root });
    await expect(service.search('query')).rejects.toThrow('configured documentation corpus');
    const theorem = ':::theorem{id="duplicated"}\nStatement.\n:::';
    await writeFile(join(root, 'a.md'), theorem);
    await writeFile(join(root, 'b.md'), theorem);
    await expect(service.getTheoremGraph()).rejects.toThrow('configured documentation corpus');
  });

  it('does not collapse different document paths into the same synthetic ID', async () => {
    const root = await corpus();
    await mkdir(join(root, 'a'));
    await writeFile(join(root, 'a-b.md'), '# Same\nquery');
    await writeFile(join(root, 'a', 'b.md'), '# Same\nquery');
    const result = await new LumenService({ docsDir: root }).search('query');
    expect(result.map(item => item.documentId)).toEqual(['a-b.md', 'a/b.md']);
  });
});

describe('source visibility and failures', () => {
  it('requires explicit public exposure of a source corpus, including through Netron', async () => {
    const root = await corpus();
    await writeFile(join(root, 'secret.ts'), 'export const Secret = "not public";');
    const service = new LumenService({ sourceDir: root });
    expect(await service.getSymbolContract('Secret')).toBeNull();
    expect(await (await asUser(service, 'reader')).getSymbolContract('Secret')).toBeNull();
    expect(await (await asUser(service, 'staff')).getSymbolContract('Secret')).toMatchObject({ name: 'Secret' });
    expect(await new LumenService({ sourceDir: root, sourceAccess: 'public' }).getSymbolContract('Secret')).toMatchObject({ name: 'Secret' });
  });

  it('does not call a private knowledge base anonymously or silently fall back after its failure', async () => {
    const root = await corpus();
    await writeFile(join(root, 'public.md'), '# Public\nquery');
    let calls = 0;
    const knowledgeBase = {
      query: async () => { calls++; throw new Error('offline'); },
      getApi: async () => { calls++; throw new Error('offline'); },
    } as unknown as KnowledgeBase;
    const service = new LumenService({ docsDir: root, sourceDir: root, knowledgeBase });
    expect(await service.search('query')).toHaveLength(1);
    expect(await service.getSymbolContract('Secret')).toBeNull();
    expect(calls).toBe(0);
    const staff = await asUser(service, 'staff');
    await expect(staff.search('query')).rejects.toThrow('configured knowledge base');
    await expect(staff.getSymbolContract('Secret')).rejects.toThrow('configured knowledge base');
    expect(calls).toBe(2);
  });

  it('bounds concurrent corpus work through Netron and releases capacity after failure', async () => {
    const root = await corpus();
    const ready = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    let admitted = 0;
    const knowledgeBase = {
      query: async () => {
        if (++admitted === 4) ready.resolve();
        await gate.promise;
        throw new Error('Isolated unavailable store');
      },
    } as unknown as KnowledgeBase;
    const client = await asUser(new LumenService({ docsDir: root, knowledgeBase, knowledgeBaseAccess: 'public' }));
    const pending = Promise.allSettled(Array.from({ length: 4 }, () => client.search('query')));
    try {
      await ready.promise;
      await expect(client.getTheoremGraph()).rejects.toMatchObject({ code: 429 });
    } finally { gate.resolve(); }
    expect((await pending).filter(result => result.status === 'rejected')).toHaveLength(4);
    expect(await client.getTheoremGraph()).toEqual({ nodes: [], edges: [] });
  });

  it('surfaces a missing source directory for authorized users', async () => {
    const service = new LumenService({ sourceDir: join(await corpus(), 'missing') });
    const staff = await asUser(service, 'staff');
    await expect(staff.getSymbolContract('Missing')).rejects.toThrow('configured source corpus');
  });
});
