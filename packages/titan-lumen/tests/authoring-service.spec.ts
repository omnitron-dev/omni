import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { LumenService } from '../src/lumen.service.js';
import { LiveEditService } from '../src/live/live-edit.service.js';
import { createAuthoringFixture, hash, openAuthoringDatabase } from './authoring-fixture.js';
import { asUser } from './netron-fixture.js';

async function fixture(seed: string) {
  const state = await createAuthoringFixture();
  const docsDir = join(dirname(state.filename), 'docs');
  await mkdir(docsDir);
  await writeFile(join(docsDir, 'guide.md'), seed);
  const service = new LumenService({ docsDir, liveEdit: state.options }, undefined, state.live);
  return { ...state, docsDir, service, client: await asUser(service, 'admin') };
}

describe('durable authoring through native Lumen RPC', () => {
  it('reads the same committed content in document, search and graph after restart', async () => {
    const seed = '# Seed\nOriginal source.';
    const f = await fixture(seed);
    const initial = await f.client.getEditableDocument('guide.md');
    expect(initial).toMatchObject({ docId: 'guide.md', revision: 0, hash: hash(seed), content: seed });
    const content = '# Revised\nA durable insight.\n\n:::theorem{id="durable-theorem" title="Durable insight"}\nA true statement.\n:::';
    expect(await f.client.saveLiveEdit({ docId: 'guide.md', mode: 'replace', patch: content, baseRevision: initial!.revision, baseHash: initial!.hash }))
      .toMatchObject({ success: true, revision: 1, hash: hash(content) });
    await writeFile(join(f.docsDir, 'guide.md'), '# Stale source\n' + 'x'.repeat(20_000));
    const reopened = await openAuthoringDatabase(f.filename, false);
    const live = new LiveEditService(f.options, reopened.manager);
    const service = new LumenService({ docsDir: f.docsDir, liveEdit: f.options,
      corpusLimits: { maxBytes: Buffer.byteLength(content) } }, undefined, live);
    const client = await asUser(service, 'admin');
    expect(await client.getDocument('guide')).toBe(content);
    expect(await client.getEditableDocument('guide.md')).toMatchObject({ revision: 1, hash: hash(content) });
    expect(await client.search('durable')).toMatchObject([{ path: 'guide.md', title: 'Revised' }]);
    expect(await client.search('Stale source')).toEqual([]);
    expect(await client.getTheoremGraph()).toMatchObject({ nodes: [{ id: 'durable-theorem', path: 'guide.md' }] });
    expect(await live.getHistory('guide.md', { userId: 'verified-admin', roles: ['admin'] }))
      .toMatchObject([{ revision: 1, content }, { revision: 0, content: seed }]);
  });

  it('rejects a stale revision-zero file snapshot instead of silently adopting changed source', async () => {
    const f = await fixture('# First');
    const read = await f.client.getEditableDocument('guide.md');
    await writeFile(join(f.docsDir, 'guide.md'), '# Changed externally');
    expect(await f.client.saveLiveEdit({ docId: 'guide.md', patch: '# Overwrite', mode: 'replace', baseRevision: 0, baseHash: read!.hash }))
      .toMatchObject({ success: false, conflict: true, revision: 0 });
    expect(await f.live.getDocument('guide.md')).toBeUndefined();
    expect(await f.client.getDocument('guide.md')).toBe('# Changed externally');
  });

  it('requires whole-document authorization before editing or revealing revision state', async () => {
    const f = await fixture('# Shared\n\n:::theorem{access="confidential" title="Secret"}\nHidden content.\n:::');
    const editor = await asUser(f.service, 'editor');
    const reader = await asUser(f.service, 'reader');
    expect(await editor.getDocument('guide.md')).not.toContain('Hidden content');
    await expect(reader.getEditableDocument('guide.md')).rejects.toMatchObject({ code: 403 });
    await expect(editor.getEditableDocument('guide.md')).rejects.toMatchObject({ code: 403 });
    const state = await f.client.getEditableDocument('guide.md');
    await expect(editor.saveLiveEdit({ docId: 'guide.md', patch: 'Replace', baseRevision: 0, baseHash: state!.hash, mode: 'replace' }))
      .rejects.toMatchObject({ code: 403 });
    expect(await f.live.getDocument('guide.md')).toBeUndefined();
  });

  it('keeps enabled-but-unavailable storage as an error rather than serving stale disk data', async () => {
    const f = await fixture('# Stale disk');
    const service = new LumenService({ docsDir: f.docsDir, liveEdit: f.options });
    const client = await asUser(service, 'admin');
    await expect(client.getDocument('guide.md')).rejects.toThrow('TitanDatabaseModule');
    await expect(client.search('Stale')).rejects.toThrow('configured documentation corpus');
    await expect(client.getTheoremGraph()).rejects.toThrow('configured documentation corpus');
  });

  it('resolves extension aliases in the same order for persisted and file-backed documents', async () => {
    const f = await fixture('# Markdown');
    const state = await f.client.getEditableDocument('guide.md');
    await f.client.saveLiveEdit({ docId: 'guide.md', patch: '# Edited Markdown', mode: 'replace', baseRevision: 0, baseHash: state!.hash });
    await writeFile(join(f.docsDir, 'guide.pdx'), '# PDX precedence');
    expect(await f.client.getDocument('guide')).toBe('# PDX precedence');
    expect(await f.client.getDocument('guide.md')).toBe('# Edited Markdown');
    await expect(f.client.getEditableDocument('guide')).rejects.toMatchObject({ code: 400 });
  });
});
