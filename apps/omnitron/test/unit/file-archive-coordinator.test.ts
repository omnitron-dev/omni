import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { FilesRpcService } from '../../src/files/files.rpc-service.js';
import type { FileNode } from '../../src/files/file-node.js';
import { runWithAuth } from '../../src/services/auth-context.js';
import { MemoryFileStore } from '../helpers/memory-file-store.js';
import type {
  FileArchiveCapabilities,
  FileArchiveStatus,
  FileCopyRequest,
  FileNodeRequest,
  FileTransfer,
  FileUpload,
} from '../../src/shared/dto/files.js';
const owner = { userId: 'alice', roles: ['admin'], permissions: [], metadata: { sessionId: 'session' } };
const data = Buffer.from('encoded archive'),
  sha = createHash('sha256').update(data).digest('hex');
const request: FileCopyRequest = {
  sources: [{ nodeId: 'local', rootId: 'work', path: 'tree', version: 'a'.repeat(64) }],
  destination: { nodeId: 'target', rootId: 'work', path: '' },
  archive: { format: 'tar.gz', output: 'directory', name: 'restored' },
};
const caps: FileArchiveCapabilities = {
  observedAt: new Date().toISOString(),
  limitations: [],
  formats: [
    { format: 'tar.gz', label: 'Gzip TAR', extension: '.tar.gz', outputs: ['archive', 'directory'] },
    { format: 'zip', label: 'ZIP', extension: '.zip', outputs: ['archive'] },
  ],
};
const services: FilesRpcService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
});
function fixture() {
  const journal = new MemoryFileStore();
  let upload: FileUpload | undefined;
  const ready: FileArchiveStatus = {
    id: 'source',
    state: 'ready',
    phase: 'archiving',
    preparedBytes: 5,
    sourceBytes: 5,
    file: {
      name: 'tree.tar.gz',
      path: 'payload',
      kind: 'file',
      size: data.length,
      modifiedAt: new Date().toISOString(),
      mode: 0o600,
      version: sha,
    },
    manifest: {
      protocol: 1,
      rootName: 'tree',
      entries: [
        { path: 'tree', kind: 'directory', size: 0, mode: 0o700 },
        { path: 'tree/file', kind: 'file', size: 5, mode: 0o600, sha256: 'b'.repeat(64) },
      ],
    },
  };
  const source = vi.fn(async (_actor: string, input: FileNodeRequest): Promise<unknown> => {
    switch (input.op) {
      case 'archiveFormats':
        return caps;
      case 'prepareArchive':
      case 'archiveStatus':
        return { ...ready, id: input.id };
      case 'readArchive':
        return { offset: 0, data: data.toString('base64'), sha256: sha, eof: true };
      case 'releaseArchive':
        return;
      default:
        throw new Error(`Unexpected source operation: ${input.op}`);
    }
  });
  const target = vi.fn(async (_node: string, _actor: string, input: FileNodeRequest): Promise<unknown> => {
    switch (input.op) {
      case 'archiveFormats':
        return caps;
      case 'beginWrite':
      case 'beginArchiveWrite':
        return (upload ??= { id: input.id!, state: 'receiving', offset: 0, size: input.size });
      case 'writeChunk':
        upload = { ...upload!, offset: data.length };
        return upload;
      case 'commitWrite':
        upload = { ...upload!, state: 'complete', sha256: sha };
        return upload;
      case 'writeStatus':
        return upload;
      case 'abortWrite':
        upload = { ...upload!, state: upload!.state === 'complete' ? 'complete' : 'aborted' };
        return upload;
      case 'acknowledgeWrite':
        return;
      default:
        throw new Error(`Unexpected destination operation: ${input.op}`);
    }
  });
  const make = () => {
    const service = new FilesRpcService(
      { invoke: source } as unknown as FileNode,
      target,
      { validateSession: async () => ({ id: 'alice', role: 'admin' }) } as never,
      { record: async () => {} },
      journal
    );
    services.push(service);
    return service;
  };
  const start = (service: FilesRpcService, input = request) => runWithAuth(owner, () => service.copy(input));
  const view = async (service: FilesRpcService) => (await runWithAuth(owner, () => service.transfers()))[0]!;
  const state = async (service: FilesRpcService, expected: FileTransfer['state']) => {
    await vi.waitFor(async () => expect((await view(service)).state).toBe(expected));
    return view(service);
  };
  return { source, target, journal, ready, make, start, view, state };
}
describe('archive transfer coordinator', () => {
  it('waits for destination restoration rather than treating transferred bytes as completion', async () => {
    const f = fixture(),
      service = f.make(),
      normal = f.target.getMockImplementation()!;
    let restore = false;
    f.target.mockImplementation(async (node, actor, op) => {
      if (op.op === 'commitWrite' || op.op === 'writeStatus')
        return {
          id: 'receipt',
          offset: data.length,
          size: data.length,
          state: restore ? 'complete' : 'committing',
          sha256: sha,
        };
      return normal(node, actor, op);
    });
    await f.start(service);
    await vi.waitFor(async () => expect((await f.view(service)).phase).toBe('restoring'));
    expect((await f.view(service)).state).toBe('running');
    expect(f.source.mock.calls.some(([, op]) => op.op === 'releaseArchive')).toBe(false);
    restore = true;
    expect(await f.state(service, 'completed')).toMatchObject({
      bytes: data.length,
      totalBytes: data.length,
      completedFiles: 1,
    });
    expect(f.target.mock.calls.find(([, , op]) => op.op === 'beginArchiveWrite')?.[2]).toMatchObject({
      manifest: f.ready.manifest,
      sha256: sha,
      path: 'restored',
    });
    expect(f.source.mock.calls.filter(([, op]) => op.op === 'prepareArchive')).toHaveLength(1);
    expect(f.source.mock.calls.some(([, op]) => op.op === 'stat' || op.op === 'readChunk')).toBe(false);
  });
  it('binds archive-file publication to the complete encoded digest', async () => {
    const f = fixture(),
      service = f.make();
    await f.start(service, { ...request, archive: { format: 'tar.gz', output: 'archive', name: 'tree.tar.gz' } });
    await f.state(service, 'completed');
    expect(f.target.mock.calls.find(([, , op]) => op.op === 'beginWrite')?.[2]).toMatchObject({
      sha256: sha,
      path: 'tree.tar.gz',
    });
    expect(f.target.mock.calls.some(([, , op]) => op.op === 'beginArchiveWrite')).toBe(false);
  });
  it('reuses the immutable archive plan after a lost destination admission response', async () => {
    const f = fixture();
    let service = f.make();
    const normal = f.target.getMockImplementation()!;
    let lose = true;
    f.target.mockImplementation(async (node, actor, op) => {
      const answer = await normal(node, actor, op);
      if (op.op === 'beginArchiveWrite' && lose) {
        lose = false;
        throw new Error('response lost');
      }
      return answer;
    });
    const job = await f.start(service);
    await f.state(service, 'failed');
    await service.dispose();
    service = f.make();
    await runWithAuth(owner, () => service.controlTransfer({ id: job.id, action: 'resume' }));
    await f.state(service, 'completed');
    expect(f.source.mock.calls.filter(([, op]) => op.op === 'prepareArchive')).toHaveLength(1);
    const admissions = f.target.mock.calls
      .filter(([, , op]) => op.op === 'beginArchiveWrite')
      .map(([, , op]) => (op as { id: string }).id);
    expect(new Set(admissions).size).toBe(1);
  });
  it('recovers interrupted planning and retries only cleanup after publication', async () => {
    const f = fixture();
    let service = f.make();
    const normal = f.source.getMockImplementation()!;
    let unavailable = true,
      cleanup = true;
    f.source.mockImplementation(async (actor, op) => {
      if (op.op === 'prepareArchive' && unavailable) throw new Error('offline');
      if (op.op === 'releaseArchive' && cleanup) throw new Error('offline after commit');
      return normal(actor, op);
    });
    const job = await f.start(service);
    await f.state(service, 'failed');
    await service.dispose();
    service = f.make();
    unavailable = false;
    await runWithAuth(owner, () => service.controlTransfer({ id: job.id, action: 'resume' }));
    expect(await f.state(service, 'completed')).toMatchObject({
      cleanupPending: true,
      error: expect.stringContaining('cleanup is pending'),
    });
    const writes = f.target.mock.calls.length;
    cleanup = false;
    await runWithAuth(owner, () => service.controlTransfer({ id: job.id, action: 'resume' }));
    expect((await f.view(service)).cleanupPending).toBeUndefined();
    expect(f.target.mock.calls).toHaveLength(writes);
  });
  it('keeps lost destination cleanup acknowledgements durable without repeating publication', async () => {
    const f = fixture();
    let service = f.make();
    const normal = f.target.getMockImplementation()!;
    let unavailable = true;
    f.target.mockImplementation(async (node, actor, op) => {
      if (op.op === 'acknowledgeWrite' && unavailable) throw new Error('ack lost');
      return normal(node, actor, op);
    });
    const job = await f.start(service);
    expect(await f.state(service, 'completed')).toMatchObject({ cleanupPending: true });
    await service.dispose();
    service = f.make();
    unavailable = false;
    const commits = f.target.mock.calls.filter(([, , op]) => op.op === 'commitWrite').length;
    await runWithAuth(owner, () => service.controlTransfer({ id: job.id, action: 'resume' }));
    expect((await f.view(service)).cleanupPending).toBeUndefined();
    expect(f.target.mock.calls.filter(([, , op]) => op.op === 'commitWrite')).toHaveLength(commits);
    expect(f.source.mock.calls.filter(([, op]) => op.op === 'releaseArchive')).toHaveLength(1);
  });
  it('retains archive output if destination codecs cannot be inspected and refuses unproven restoration', async () => {
    const f = fixture(),
      service = f.make();
    f.target.mockRejectedValue(new Error('old node'));
    const answer = await runWithAuth(owner, () =>
      service.archiveFormats({ nodeId: 'local', destinationNodeId: 'target' })
    );
    expect(answer.formats.every((item) => item.outputs.join() === 'archive')).toBe(true);
    expect(answer.limitations).toContain(
      'Destination decoding could not be verified; archive-file output remains available.'
    );
    await f.start(service);
    expect((await f.state(service, 'failed')).error).toContain('unavailable');
    expect(f.source.mock.calls.some(([, op]) => op.op === 'prepareArchive')).toBe(false);
  });
  it('does not report a published destination cancelled after a lost commit response', async () => {
    const f = fixture(),
      service = f.make(),
      normal = f.target.getMockImplementation()!;
    let lose = true;
    f.target.mockImplementation(async (node, actor, op) => {
      const answer = await normal(node, actor, op);
      if (op.op === 'commitWrite' && lose) {
        lose = false;
        throw new Error('acknowledgement lost');
      }
      return answer;
    });
    const job = await f.start(service);
    await f.state(service, 'failed');
    await expect(runWithAuth(owner, () => service.controlTransfer({ id: job.id, action: 'cancel' }))).rejects.toThrow(
      'complete'
    );
    expect((await f.view(service)).state).toBe('failed');
    await runWithAuth(owner, () => service.controlTransfer({ id: job.id, action: 'resume' }));
    expect(await f.state(service, 'completed')).toMatchObject({ completedFiles: 1, bytes: data.length });
  });
  it('pauses source preparation at coordinator checkpoints and cancels its private snapshot explicitly', async () => {
    const f = fixture(),
      service = f.make(),
      normal = f.source.getMockImplementation()!;
    f.source.mockImplementation(async (actor, op) => {
      if (op.op === 'prepareArchive' || op.op === 'archiveStatus')
        return {
          ...f.ready,
          id: op.id,
          state: 'preparing',
          phase: 'snapshotting',
          file: undefined,
          manifest: undefined,
        };
      return normal(actor, op);
    });
    const job = await f.start(service);
    await vi.waitFor(async () => expect((await f.view(service)).phase).toBe('snapshotting'));
    expect((await runWithAuth(owner, () => service.controlTransfer({ id: job.id, action: 'pause' }))).state).toBe(
      'paused'
    );
    expect(f.source.mock.calls.some(([, op]) => op.op === 'releaseArchive')).toBe(false);
    expect((await runWithAuth(owner, () => service.controlTransfer({ id: job.id, action: 'cancel' }))).state).toBe(
      'cancelled'
    );
    expect(f.source.mock.calls.filter(([, op]) => op.op === 'releaseArchive')).toHaveLength(1);
    expect(f.target.mock.calls.some(([, , op]) => op.op === 'beginArchiveWrite')).toBe(false);
  });
  it('enforces admin admission before capability probes and source reads', async () => {
    const f = fixture(),
      service = f.make();
    for (const role of ['viewer', 'operator']) {
      const lower = { ...owner, roles: [role] };
      await expect(runWithAuth(lower, () => service.archiveFormats({ nodeId: 'local' }))).rejects.toThrow('admin');
      await expect(runWithAuth(lower, () => service.copy(request))).rejects.toThrow('admin');
    }
    expect(f.source).not.toHaveBeenCalled();
    expect(f.target).not.toHaveBeenCalled();
  });
  it('rejects traversal before snapshot admission', async () => {
    const f = fixture(),
      service = f.make();
    await expect(
      f.start(service, { ...request, archive: { ...request.archive!, name: '../escape' } })
    ).rejects.toThrow();
    expect(f.source).not.toHaveBeenCalled();
  });
});
