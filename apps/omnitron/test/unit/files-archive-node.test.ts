import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { FileNode } from '../../src/files/file-node.js';
import { FilesRpcService } from '../../src/files/files.rpc-service.js';
import { runWithAuth } from '../../src/services/auth-context.js';
import { MemoryFileStore } from '../helpers/memory-file-store.js';
import type { FileArchiveStatus, FileEntry, FileUpload, FileChunk, FileTransfer } from '../../src/shared/dto/files.js';
let base: string, sourceRoot: string, targetRoot: string, source: FileNode, target: FileNode, store: MemoryFileStore;
const actor = 'alice';
async function wait<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let count = 0; count < 1000; count++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Operation did not finish');
}
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(tmpdir(), 'file-archives-'));
  sourceRoot = path.join(base, 'source');
  targetRoot = path.join(base, 'target');
  await fs.mkdir(sourceRoot);
  await fs.mkdir(targetRoot);
  await fs.mkdir(path.join(sourceRoot, 'project'));
  await fs.mkdir(path.join(sourceRoot, 'project/empty'));
  await fs.writeFile(path.join(sourceRoot, 'project/data.txt'), 'archive contents');
  source = new FileNode(
    [{ id: 'work', label: 'Source', path: sourceRoot }],
    new MemoryFileStore(),
    path.join(base, 'cache')
  );
  store = new MemoryFileStore();
  target = new FileNode([{ id: 'work', label: 'Target', path: targetRoot }], store, path.join(base, 'target-cache'));
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});
async function prepare(): Promise<FileArchiveStatus> {
  const entry = (await source.invoke(actor, { op: 'stat', rootId: 'work', path: 'project' })) as FileEntry,
    id = randomUUID();
  await source.invoke(actor, {
    op: 'prepareArchive',
    id,
    rootId: 'work',
    path: 'project',
    version: entry.version,
    format: 'tar',
  });
  const status = await wait(
    () => source.invoke(actor, { op: 'archiveStatus', id }) as Promise<FileArchiveStatus>,
    (value) => value.state !== 'preparing'
  );
  expect(status.state, status.error).toBe('ready');
  return status;
}
async function receive(status: FileArchiveStatus, checksum?: string): Promise<string> {
  const id = randomUUID();
  await target.invoke(actor, {
    op: 'beginArchiveWrite',
    id,
    rootId: 'work',
    path: 'copy',
    size: status.file!.size,
    format: 'tar',
    manifest: status.manifest!,
    sha256: checksum ?? status.file!.version,
  });
  let offset = 0;
  while (offset < status.file!.size) {
    const chunk = (await source.invoke(actor, {
      op: 'readArchive',
      id: status.id,
      version: status.file!.version,
      offset,
    })) as FileChunk;
    const upload = (await target.invoke(actor, {
      op: 'writeChunk',
      id,
      offset,
      data: chunk.data,
      sha256: chunk.sha256,
    })) as FileUpload;
    offset = upload.offset;
  }
  return id;
}
async function commit(id: string): Promise<FileUpload> {
  await target.invoke(actor, { op: 'commitWrite', id });
  return wait(
    () => target.invoke(actor, { op: 'writeStatus', id }) as Promise<FileUpload>,
    (value) => value.state !== 'committing'
  );
}
function conflictOnPublication(id: string): void {
  const original = store.kvSetSync.bind(store);
  let injected = false;
  store.kvSetSync = (key, value) => {
    original(key, value);
    if (
      !injected &&
      key === `files:upload:${id}` &&
      (value as { archive?: { directories?: unknown } }).archive?.directories
    ) {
      injected = true;
      writeFileSync(path.join(targetRoot, 'copy/data.txt'), 'external');
    }
  };
}
describe('archive source snapshots and durable directory publication', () => {
  it('snapshots one version, transfers checked chunks and restores empty directories', async () => {
    const prepared = await prepare();
    expect(prepared.preparedBytes).toBe(16);
    expect(prepared.manifest?.entries.map((entry) => entry.path)).toEqual([
      'project',
      'project/data.txt',
      'project/empty',
    ]);
    await fs.writeFile(path.join(sourceRoot, 'project/data.txt'), 'a newer version');
    const id = await receive(prepared);
    expect(await commit(id)).toMatchObject({
      state: 'complete',
      publication: 'complete',
      restoredBytes: 16,
      sha256: prepared.file!.version,
    });
    expect(await fs.readFile(path.join(targetRoot, 'copy/data.txt'), 'utf8')).toBe('archive contents');
    expect((await fs.stat(path.join(targetRoot, 'copy/empty'))).isDirectory()).toBe(true);
    await target.invoke(actor, { op: 'acknowledgeWrite', id });
    await source.invoke(actor, { op: 'releaseArchive', id: prepared.id });
    expect(await fs.readdir(path.join(base, 'cache'))).toEqual([]);
  });
  it('denies exported/protected roots and symlink trees', async () => {
    const root = (await source.invoke(actor, { op: 'stat', rootId: 'work', path: '' })) as FileEntry;
    await expect(
      source.invoke(actor, {
        op: 'prepareArchive',
        id: randomUUID(),
        rootId: 'work',
        path: '',
        version: root.version,
        format: 'tar',
      })
    ).rejects.toThrow();
    const protectedNode = new FileNode(
      [{ id: 'work', label: 'Source', path: sourceRoot, protectedPaths: ['project'] }],
      new MemoryFileStore(),
      path.join(base, 'private-cache')
    );
    const project = (await protectedNode.invoke(actor, { op: 'stat', rootId: 'work', path: 'project' })) as FileEntry;
    await expect(
      protectedNode.invoke(actor, {
        op: 'prepareArchive',
        id: randomUUID(),
        rootId: 'work',
        path: 'project',
        version: project.version,
        format: 'tar',
      })
    ).rejects.toThrow();
    await fs.symlink('/etc', path.join(sourceRoot, 'project/link'));
    const current = (await source.invoke(actor, { op: 'stat', rootId: 'work', path: 'project' })) as FileEntry,
      id = randomUUID();
    await source.invoke(actor, {
      op: 'prepareArchive',
      id,
      rootId: 'work',
      path: 'project',
      version: current.version,
      format: 'tar',
    });
    const result = await wait(
      () => source.invoke(actor, { op: 'archiveStatus', id }) as Promise<FileArchiveStatus>,
      (value) => value.state !== 'preparing'
    );
    expect(result.state).toBe('failed');
    expect(result.error).toMatch(/links|Symbolic/);
  });
  it('binds snapshots to their actor and detects private payload mutation', async () => {
    const prepared = await prepare();
    await expect(
      source.invoke('bob', { op: 'readArchive', id: prepared.id, version: prepared.file!.version, offset: 0 })
    ).rejects.toThrow(/identity/);
    await fs.appendFile(path.join(base, 'cache', prepared.id, 'payload'), 'tamper');
    await expect(source.invoke(actor, { op: 'archiveStatus', id: prepared.id })).rejects.toThrow(/changed/);
  });
  it('rejects archive checksum mismatch before publication and permits safe cancellation', async () => {
    const id = await receive(await prepare(), '0'.repeat(64));
    expect(await commit(id)).toMatchObject({ state: 'failed', error: expect.stringContaining('SHA-256') });
    await expect(fs.stat(path.join(targetRoot, 'copy'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await target.invoke(actor, { op: 'abortWrite', id })).toMatchObject({ state: 'aborted' });
  });
  it('never replaces a destination created after admission', async () => {
    const id = await receive(await prepare());
    await fs.mkdir(path.join(targetRoot, 'copy'));
    await fs.writeFile(path.join(targetRoot, 'copy/existing'), 'keep');
    expect((await commit(id)).state).toBe('failed');
    expect(await fs.readFile(path.join(targetRoot, 'copy/existing'), 'utf8')).toBe('keep');
    expect(await target.invoke(actor, { op: 'abortWrite', id })).toMatchObject({ state: 'aborted' });
    await expect(fs.stat(path.join(targetRoot, 'copy/data.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains partial receipt, refuses cancellation and resumes without overwriting conflicts', async () => {
    const id = await receive(await prepare());
    conflictOnPublication(id);
    expect(await commit(id)).toMatchObject({
      state: 'failed',
      publication: 'partial',
      error: expect.stringContaining('nothing was overwritten'),
    });
    await expect(target.invoke(actor, { op: 'abortWrite', id })).rejects.toThrow(/partial/);
    expect(await fs.readFile(path.join(targetRoot, 'copy/data.txt'), 'utf8')).toBe('external');
    await fs.unlink(path.join(targetRoot, 'copy/data.txt'));
    target = new FileNode([{ id: 'work', label: 'Target', path: targetRoot }], store, path.join(base, 'target-cache'));
    expect(await commit(id)).toMatchObject({ state: 'complete', publication: 'complete' });
    expect(await fs.readFile(path.join(targetRoot, 'copy/data.txt'), 'utf8')).toBe('archive contents');
  });
  it('rejects a substituted publication directory on resume', async () => {
    const id = await receive(await prepare());
    conflictOnPublication(id);
    expect((await commit(id)).state).toBe('failed');
    await fs.rename(path.join(targetRoot, 'copy'), path.join(targetRoot, 'prior'));
    await fs.mkdir(path.join(targetRoot, 'copy'));
    expect(await commit(id)).toMatchObject({ state: 'failed', error: expect.stringContaining('replaced') });
    expect(await fs.readdir(path.join(targetRoot, 'copy'))).toEqual([]);
  });
  it('cancels a running source preparation and removes its private files', async () => {
    const selected = (await source.invoke(actor, { op: 'stat', rootId: 'work', path: 'project' })) as FileEntry,
      id = randomUUID();
    await source.invoke(actor, {
      op: 'prepareArchive',
      id,
      rootId: 'work',
      path: 'project',
      version: selected.version,
      format: 'tar',
    });
    expect(await source.invoke(actor, { op: 'abortArchive', id })).toMatchObject({ state: 'cancelled' });
    await expect(fs.stat(path.join(base, 'cache', id))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('cancels a restoration before publication and keeps no destination', async () => {
    const id = await receive(await prepare());
    await target.invoke(actor, { op: 'commitWrite', id });
    expect(await target.invoke(actor, { op: 'abortWrite', id })).toMatchObject({ state: 'aborted' });
    await expect(fs.stat(path.join(targetRoot, 'copy'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refuses a source that changes while the private snapshot is read', async () => {
    const invoke = source.invoke.bind(source);
    let modified = false;
    source.invoke = async (identity, request) => {
      const value = await invoke(identity, request);
      if (request.op === 'readChunk' && !modified) {
        modified = true;
        await fs.writeFile(path.join(sourceRoot, 'project/data.txt'), 'changed');
      }
      return value;
    };
    const selected = (await source.invoke(actor, { op: 'stat', rootId: 'work', path: 'project' })) as FileEntry,
      id = randomUUID();
    await source.invoke(actor, {
      op: 'prepareArchive',
      id,
      rootId: 'work',
      path: 'project',
      version: selected.version,
      format: 'tar',
    });
    expect(
      await wait(
        () => source.invoke(actor, { op: 'archiveStatus', id }) as Promise<FileArchiveStatus>,
        (value) => value.state !== 'preparing'
      )
    ).toMatchObject({ state: 'failed', error: expect.stringContaining('changed') });
  });
  it.each(['archive', 'directory'] as const)('completes a real coordinator transfer with %s output', async (output) => {
    const journal = new MemoryFileStore(),
      owner = { userId: 'alice', roles: ['admin'], permissions: [], metadata: { sessionId: 'session' } };
    const auth = { validateSession: async () => ({ id: 'alice', role: 'admin' }) } as never;
    const service = new FilesRpcService(
      source,
      async (_node, identity, request) => target.invoke(identity, request),
      auth,
      { record: async () => {} },
      journal
    );
    try {
      const selected = (await source.invoke(actor, { op: 'stat', rootId: 'work', path: 'project' })) as FileEntry;
      const started = await runWithAuth(owner, () =>
        service.copy({
          sources: [{ nodeId: 'local', rootId: 'work', path: 'project', version: selected.version }],
          destination: { nodeId: 'remote', rootId: 'work', path: '' },
          archive: { format: 'tar', output, name: output === 'archive' ? 'result.tar' : 'result' },
        })
      );
      const result = await wait(
        () =>
          runWithAuth(owner, async () =>
            (await service.transfers()).find((value) => value.id === started.id)!
          ) as Promise<FileTransfer>,
        (value) => !['planning', 'running'].includes(value.state) && !value.cleanupPending
      );
      expect(result.state, result.error).toBe('completed');
      expect(result.cleanupPending).not.toBe(true);
      if (output === 'directory')
        expect(await fs.readFile(path.join(targetRoot, 'result/data.txt'), 'utf8')).toBe('archive contents');
      else expect((await fs.stat(path.join(targetRoot, 'result.tar'))).size).toBeGreaterThan(16);
      expect(await fs.readdir(path.join(base, 'cache'))).toEqual([]);
    } finally {
      await service.dispose();
    }
  });
  it('drains source preparation on shutdown before a replacement provider can resume', async () => {
    const journal = new MemoryFileStore(),
      cache = path.join(base, 'shutdown-cache');
    let provider = new FileNode([{ id: 'work', label: 'Source', path: sourceRoot }], journal, cache);
    const selected = (await provider.invoke(actor, { op: 'stat', rootId: 'work', path: 'project' })) as FileEntry,
      id = randomUUID();
    const request = {
      op: 'prepareArchive' as const,
      id,
      rootId: 'work',
      path: 'project',
      version: selected.version,
      format: 'tar' as const,
    };
    await provider.invoke(actor, request);
    expect(provider.activeOperationCount()).toBe(1);
    await provider.dispose();
    expect(provider.activeOperationCount()).toBe(0);
    await expect(provider.invoke(actor, { op: 'roots' })).rejects.toThrow(/stopping/);
    expect(journal.kvGetSync<{ view: FileArchiveStatus }>(`files:archive:${id}`)?.view.state).toBe('interrupted');
    provider = new FileNode([{ id: 'work', label: 'Source', path: sourceRoot }], journal, cache);
    await provider.invoke(actor, request);
    expect(
      await wait(
        () => provider.invoke(actor, { op: 'archiveStatus', id }) as Promise<FileArchiveStatus>,
        (value) => value.state !== 'preparing'
      )
    ).toMatchObject({ state: 'ready' });
    await provider.invoke(actor, { op: 'releaseArchive', id });
    await provider.dispose();
  });
  it('preserves executable and restrictive file modes after verified restoration', async () => {
    await fs.chmod(path.join(sourceRoot, 'project/data.txt'), 0o500);
    const prepared = await prepare(),
      id = await receive(prepared);
    expect((await commit(id)).state).toBe('complete');
    expect((await fs.stat(path.join(targetRoot, 'copy/data.txt'))).mode & 0o777).toBe(0o500);
  });
  it('rejects unsafe manifests and upload key rebinding', async () => {
    const prepared = await prepare(),
      id = await receive(prepared);
    await expect(
      target.invoke(actor, {
        op: 'beginArchiveWrite',
        id,
        rootId: 'work',
        path: 'copy',
        size: prepared.file!.size,
        format: 'tar',
        manifest: prepared.manifest!,
        sha256: '0'.repeat(64),
      })
    ).rejects.toThrow(/bound/);
    await expect(
      target.invoke(actor, {
        op: 'beginArchiveWrite',
        id: randomUUID(),
        rootId: 'work',
        path: 'bad',
        size: prepared.file!.size,
        format: 'tar',
        manifest: { ...prepared.manifest!, entries: [{ path: '../escape', kind: 'directory', size: 0, mode: 0o700 }] },
        sha256: prepared.file!.version,
      })
    ).rejects.toThrow(/unsafe/);
    await target.invoke(actor, { op: 'abortWrite', id });
  });
});
