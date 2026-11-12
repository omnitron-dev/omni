import { describe, it, expect, vi } from 'vitest';
import { sql } from '@omnitron-dev/titan-database';
import { LiveEditService } from '../src/live/live-edit.service.js';
import { createAuthoringFixture, openAuthoringDatabase, admin, writer, hash } from './authoring-fixture.js';
import type { LumenAuthoringDatabase } from '../src/live/schema.js';

const createEdit = (docId: string, patch: string) => ({ docId, patch, baseRevision: 0, baseHash: hash(''), mode: 'replace' as const });

describe('durable Lumen authoring through TitanDatabase', () => {
  it('requires a configured database and an explicit migration, with no memory substitute', async () => {
    const payload = createEdit('guide.pdx', 'content');
    await expect(new LiveEditService().applyEdit(payload, admin)).rejects.toThrow('not configured');
    const missing = new LiveEditService({ corpusId: 'missing' });
    expect(missing.isEnabled()).toBe(true);
    await expect(missing.getDocument('guide.pdx')).rejects.toThrow('TitanDatabaseModule');
    const { manager } = await openAuthoringDatabase(undefined, false);
    const unmigrated = new LiveEditService({ corpusId: 'unmigrated' }, manager);
    await expect(unmigrated.applyEdit(payload, admin)).rejects.toThrow(/lumen_documents/);
    await expect(unmigrated.readCorpus()).rejects.toThrow(/lumen_documents/);
    const memory = await openAuthoringDatabase(':memory:');
    await expect(new LiveEditService({ corpusId: 'volatile' }, memory.manager).applyEdit(payload, admin)).rejects.toThrow('file-backed SQLite');
  });

  it('requires canonical paths and a revision hash, and rejects client identity/classification fields', () => {
    const service = new LiveEditService();
    const valid = createEdit('guides/start.pdx', 'content');
    expect(service.validatePayload(valid)).toEqual({ valid: true });
    for (const docId of ['guide', '/guide.pdx', '../guide.pdx', 'a/../guide.pdx', 'a//guide.pdx', 'a\\guide.pdx', 'a%2Fguide.pdx', '.hidden.pdx', 'x.pdx?query', 'x.pdx\n'])
      expect(service.validatePayload({ ...valid, docId }).valid).toBe(false);
    for (const baseHash of [undefined, '', 'a'.repeat(63), 'x'.repeat(64)])
      expect(service.validatePayload({ ...valid, baseHash }).valid).toBe(false);
    expect(service.validatePayload({ ...valid, author: 'forged-admin' }).valid).toBe(false);
    expect(service.validatePayload({ ...valid, access: 'public' }).valid).toBe(false);
    expect(service.validatePayload({ ...valid, patch: '\ud800' }).valid).toBe(false);
    expect(service.validatePayload({ ...valid, mode: 'line-range', startLine: 0, endLine: 1 }).valid).toBe(false);
  });

  it('keeps the disk seed, every committed version and provenance after closing and reopening the database', async () => {
    const { live, manager, filename, options } = await createAuthoringFixture();
    const seed = '# Original\n\nDisk source.';
    const first = await live.applyEdit({ docId: 'guide.pdx', patch: 'First edit.', baseRevision: 0, baseHash: hash(seed) }, admin, seed);
    expect(first).toMatchObject({ success: true, revision: 1, content: seed + '\nFirst edit.' });
    const second = await live.applyEdit({ docId: 'guide.pdx', patch: 'Second edit.', baseRevision: 1, baseHash: first.hash! }, admin, 'External changed disk');
    expect(second).toMatchObject({ success: true, revision: 2, content: seed + '\nFirst edit.\nSecond edit.' });
    await manager.closeAll();
    const reopened = await openAuthoringDatabase(filename);
    const restarted = new LiveEditService(options, reopened.manager);
    expect(await restarted.getDocument('guide.pdx')).toMatchObject({ revision: 2, content: second.content, origin: 'disk', seedHash: hash(seed), author: admin.userId });
    expect((await restarted.getHistory('guide.pdx', admin)).map(version => [version.revision, version.content]))
      .toEqual([[2, second.content], [1, first.content], [0, seed]]);
  });

  it('rejects a changed revision-zero disk seed and never accepts a caller-selected starting revision', async () => {
    const { live } = await createAuthoringFixture();
    expect(await live.applyEdit({ docId: 'guide.pdx', patch: 'edit', baseRevision: 0, baseHash: hash('seed A') }, admin, 'seed B'))
      .toMatchObject({ success: false, conflict: true, revision: 0 });
    expect(await live.applyEdit({ ...createEdit('guide.pdx', 'edit'), baseRevision: 42 }, admin))
      .toMatchObject({ success: false, conflict: true, revision: 0 });
    expect(await live.getDocument('guide.pdx')).toBeUndefined();
    expect(await live.getHistory('guide.pdx', admin)).toEqual([]);
  });

  it('uses a database CAS across independent service instances so one concurrent editor wins', async () => {
    const { live, manager, options } = await createAuthoringFixture();
    const first = await live.applyEdit(createEdit('shared.pdx', 'seed'), admin);
    const services = Array.from({ length: 24 }, () => new LiveEditService(options, manager));
    const results = await Promise.all(services.map((service, index) => service.applyEdit({
      docId: 'shared.pdx', patch: 'edit ' + index, baseRevision: 1, baseHash: first.hash!,
    }, admin)));
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(results.filter(result => result.conflict)).toHaveLength(23);
    expect((await live.getDocument('shared.pdx'))?.revision).toBe(2);
    expect((await live.getHistory('shared.pdx', admin)).map(version => version.revision)).toEqual([2, 1, 0]);
  });

  it('does not lose accepted documents when more documents are authored and isolates corpus namespaces', async () => {
    const { live, manager } = await createAuthoringFixture();
    for (let index = 0; index < 5; index++) await live.applyEdit(createEdit('document-' + index + '.pdx', 'content ' + index), admin);
    expect((await live.readCorpus()).map(doc => doc.docId)).toEqual(Array.from({ length: 5 }, (_, i) => 'document-' + i + '.pdx'));
    const other = new LiveEditService({ corpusId: 'different-corpus' }, manager);
    expect(await other.getDocument('document-0.pdx')).toBeUndefined();
    expect(await other.readCorpus()).toEqual([]);
    await other.applyEdit(createEdit('document-0.pdx', 'different'), admin);
    expect((await live.getDocument('document-0.pdx'))?.content).toBe('content 0');
  });

  it('resolves a race across independent database connections without overwriting the winning revision', async () => {
    const { live, filename, options } = await createAuthoringFixture();
    const first = await live.applyEdit(createEdit('shared.pdx', 'seed'), admin);
    const connections = await Promise.all(Array.from({ length: 4 }, () => openAuthoringDatabase(filename, false)));
    const services = connections.map(({ manager }) => new LiveEditService(options, manager));
    const events = services.map(service => { const listener = vi.fn(); service.on('live-edit', listener); return listener; });
    const results = await Promise.all(services.map((service, index) => service.applyEdit({
      docId: 'shared.pdx', patch: 'independent ' + index, baseRevision: 1, baseHash: first.hash!,
    }, admin)));
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(results.filter(result => result.conflict)).toHaveLength(3);
    for (const [index, result] of results.entries()) expect(events[index]).toHaveBeenCalledTimes(result.success ? 1 : 0);
    expect((await live.getHistory('shared.pdx', admin)).map(version => version.revision)).toEqual([2, 1, 0]);
  });

  it('does not acknowledge or emit a prepared result when the database rejects COMMIT', async () => {
    const { live, manager } = await createAuthoringFixture();
    const first = await live.applyEdit(createEdit('commit.pdx', 'seed'), admin);
    const db = await manager.getConnection<LumenAuthoringDatabase>();
    await sql.raw('CREATE TABLE commit_parent (id INTEGER PRIMARY KEY)').execute(db);
    await sql.raw('CREATE TABLE commit_child (parent INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED)').execute(db);
    await sql.raw('CREATE TRIGGER fail_commit AFTER INSERT ON lumen_document_revisions WHEN NEW.revision = 2 BEGIN INSERT INTO commit_child VALUES (999); END').execute(db);
    const events = vi.fn(); live.on('live-edit', events);
    await expect(live.applyEdit({ docId: 'commit.pdx', patch: 'uncommitted', baseRevision: 1, baseHash: first.hash! }, admin)).rejects.toThrow(/FOREIGN KEY/);
    expect(events).not.toHaveBeenCalled();
    expect(await live.getDocument('commit.pdx')).toMatchObject({ revision: 1, content: 'seed' });
    expect((await live.getHistory('commit.pdx', admin)).map(version => version.revision)).toEqual([1, 0]);
  });

  it('rolls back current content when the history insert fails and only notifies after a commit', async () => {
    const { live, manager, filename } = await createAuthoringFixture();
    const observer = await openAuthoringDatabase(filename);
    const first = await live.applyEdit(createEdit('atomic.pdx', 'seed'), admin);
    const events = vi.fn();
    live.on('live-edit', events);
    const db = await manager.getConnection<LumenAuthoringDatabase>();
    await sql.raw("CREATE TRIGGER reject_revision BEFORE INSERT ON lumen_document_revisions WHEN NEW.revision = 2 BEGIN SELECT RAISE(ABORT, 'history insert denied'); END").execute(db);
    const payload = { docId: 'atomic.pdx', patch: 'next', baseRevision: 1, baseHash: first.hash! };
    await expect(live.applyEdit(payload, admin)).rejects.toThrow('history insert denied');
    expect(await live.getDocument('atomic.pdx')).toMatchObject({ content: 'seed', revision: 1 });
    expect((await live.getHistory('atomic.pdx', admin)).map(version => version.revision)).toEqual([1, 0]);
    expect(events).not.toHaveBeenCalled();
    await sql.raw('DROP TRIGGER reject_revision').execute(db);
    const visibleAtEvent: number[] = [];
    live.on('live-edit', () => {
      const pool = observer.manager.getPool() as import('better-sqlite3').Database;
      const row = pool.prepare("SELECT revision FROM lumen_documents WHERE path='atomic.pdx'").get() as { revision: number };
      visibleAtEvent.push(row.revision);
    });
    expect(await live.applyEdit(payload, admin)).toMatchObject({ success: true, revision: 2 });
    expect(visibleAtEvent).toEqual([2]);
  });

  it('refuses writes and reads after connection shutdown and keeps committed data on disk', async () => {
    const { live, manager, filename, options } = await createAuthoringFixture();
    const first = await live.applyEdit(createEdit('guide.pdx', 'saved'), admin);
    await manager.closeAll();
    await expect(live.applyEdit({ docId: 'guide.pdx', patch: 'unsaved', baseRevision: 1, baseHash: first.hash! }, admin)).rejects.toThrow();
    await expect(live.readCorpus()).rejects.toThrow();
    const reopened = await openAuthoringDatabase(filename);
    expect(await new LiveEditService(options, reopened.manager).getDocument('guide.pdx')).toMatchObject({ revision: 1, content: 'saved' });
  });

  it('rejects corrupted persisted content instead of returning it or extending its revision history', async () => {
    const { live, manager } = await createAuthoringFixture();
    const first = await live.applyEdit(createEdit('corrupt.pdx', 'seed'), admin);
    const db = await manager.getConnection<LumenAuthoringDatabase>();
    await db.updateTable('lumen_documents').set({ content: 'tampered' }).where('path', '=', 'corrupt.pdx').execute();
    await expect(live.getDocument('corrupt.pdx')).rejects.toThrow('integrity');
    await expect(live.readCorpus()).rejects.toThrow('integrity');
    await expect(live.applyEdit({ docId: 'corrupt.pdx', patch: 'next', baseRevision: 1, baseHash: first.hash! }, admin)).rejects.toThrow('integrity');
    expect((await db.selectFrom('lumen_document_revisions').select('revision').execute()).map(row => row.revision)).toEqual([0, 1]);
    await db.updateTable('lumen_documents').set({ content: 'seed' }).where('path', '=', 'corrupt.pdx').execute();
    await db.updateTable('lumen_document_revisions').set({ content: 'tampered' }).where('revision', '=', 0).execute();
    await expect(live.getHistory('corrupt.pdx', admin)).rejects.toThrow('integrity');
  });

  it('checks old and new document classifications, hidden sections, and historical access', async () => {
    const { live } = await createAuthoringFixture();
    const secret = '---\naccess: confidential\n---\nClassified';
    await expect(live.applyEdit({ docId: 'private.pdx', patch: 'public replacement', baseRevision: 0, baseHash: hash(secret), mode: 'replace' }, writer, secret))
      .rejects.toMatchObject({ code: 403 });
    await expect(live.applyEdit(createEdit('private.pdx', secret), writer)).rejects.toMatchObject({ code: 403 });
    const hidden = 'Public\n\n:::note{access="confidential"}\nSECRET\n:::\n';
    await expect(live.applyEdit({ docId: 'hidden.pdx', patch: 'change', baseRevision: 0, baseHash: hash(hidden) }, writer, hidden))
      .rejects.toMatchObject({ code: 403 });
    const first = await live.applyEdit(createEdit('private.pdx', secret), admin);
    const publicVersion = await live.applyEdit({ docId: 'private.pdx', patch: 'Public replacement', mode: 'replace', baseRevision: 1, baseHash: first.hash! }, admin);
    expect(publicVersion.success).toBe(true);
    await expect(live.getHistory('private.pdx', writer)).rejects.toMatchObject({ code: 403 });
    expect(await live.getDocument('hidden.pdx')).toBeUndefined();
  });

  it('checks conflicts before no-op results and preserves exact whitespace edits', async () => {
    const { live } = await createAuthoringFixture();
    const first = await live.applyEdit(createEdit('guide.pdx', 'seed'), admin);
    expect(await live.applyEdit({ docId: 'guide.pdx', patch: '', baseRevision: 0, baseHash: hash('') }, admin)).toMatchObject({ conflict: true });
    expect(await live.applyEdit({ docId: 'guide.pdx', patch: '', baseRevision: 1, baseHash: first.hash! }, admin)).toMatchObject({ success: true, revision: 1 });
    const whitespace = await live.applyEdit({ docId: 'guide.pdx', patch: '  ', baseRevision: 1, baseHash: first.hash! }, admin);
    expect(whitespace).toMatchObject({ success: true, revision: 2, content: 'seed\n  ' });
  });

  it('enforces write and inventory budgets without partial inventories or eviction', async () => {
    const { live } = await createAuthoringFixture({ maxPatchBytes: 32, maxDocumentBytes: 40 });
    const first = await live.applyEdit(createEdit('first.pdx', 'a'.repeat(24)), admin);
    expect(await live.applyEdit(createEdit('oversized.pdx', 'b'.repeat(33)), admin)).toMatchObject({ success: false });
    expect(await live.applyEdit({ docId: 'first.pdx', patch: 'c'.repeat(24), baseRevision: 1, baseHash: first.hash! }, admin)).toMatchObject({ success: false });
    await live.applyEdit(createEdit('second.pdx', 'b'.repeat(24)), admin);
    await expect(live.readCorpus({ maxEntries: 1 })).rejects.toThrow('budget');
    await expect(live.readCorpus({ maxBytes: 47 })).rejects.toThrow('budget');
    expect(await live.readCorpus({ maxEntries: 2, maxBytes: 48 })).toHaveLength(2);
    await expect(live.getHistory('first.pdx', admin, { maxBytes: 23 })).rejects.toThrow('budget');
    expect(await live.getDocument('oversized.pdx')).toBeUndefined();
    expect((await live.getDocument('first.pdx'))?.revision).toBe(1);
  });
});
