import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { FileNode } from '../../src/files/file-node.js';
import { FilesRpcService } from '../../src/files/files.rpc-service.js';
import { runWithAuth } from '../../src/services/auth-context.js';
import { MemoryFileStore } from '../helpers/memory-file-store.js';
import type { FileEntry, FileNodeRequest } from '../../src/shared/dto/files.js';
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), 'file-recovery-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
const owner = { userId: 'alice', roles: ['admin'], permissions: [], metadata: { sessionId: 'session' } };
const auth = { validateSession: async () => ({ id: 'alice', role: 'admin' }) } as never;
const audit = { record: async () => {} };

describe('durable transfer coordinator recovery', () => {
  it('reconciles a lost begin-write acknowledgement after daemon reconstruction', async () => {
    await fs.mkdir(path.join(root, 'source'));
    await fs.mkdir(path.join(root, 'destination'));
    await fs.writeFile(path.join(root, 'source/data.txt'), 'recover this content');
    const source = new FileNode(
      [{ id: 'work', label: 'Source', path: path.join(root, 'source') }],
      new MemoryFileStore()
    );
    const target = new FileNode(
      [{ id: 'work', label: 'Destination', path: path.join(root, 'destination') }],
      new MemoryFileStore()
    );
    const journal = new MemoryFileStore();
    let lose = true;
    const remote = async (_node: string, actor: string, request: FileNodeRequest) => {
      const result = await target.invoke(actor, request);
      if (request.op === 'beginWrite' && lose) {
        lose = false;
        throw new Error('response lost');
      }
      return result;
    };
    let service = new FilesRpcService(source, remote, auth, audit, journal);
    const entry = (await source.invoke('alice', { op: 'stat', rootId: 'work', path: 'data.txt' })) as FileEntry;
    const started = await runWithAuth(owner, () =>
      service.copy({
        sources: [{ nodeId: 'local', rootId: 'work', path: 'data.txt', version: entry.version }],
        destination: { nodeId: 'remote', rootId: 'work', path: '' },
      })
    );
    for (let i = 0; i < 100; i++) {
      if ((await runWithAuth(owner, () => service.transfers()))[0]?.state === 'failed') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await runWithAuth(owner, () => service.transfers()))[0]?.state).toBe('failed');
    await service.dispose();
    service = new FilesRpcService(source, remote, auth, audit, journal);
    await runWithAuth(owner, () => service.controlTransfer({ id: started.id, action: 'resume' }));
    for (let i = 0; i < 100; i++) {
      if ((await runWithAuth(owner, () => service.transfers()))[0]?.state === 'completed') break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await runWithAuth(owner, () => service.transfers()))[0]).toMatchObject({
      state: 'completed',
      completedFiles: 1,
      bytes: 20,
    });
    expect(await fs.readFile(path.join(root, 'destination/data.txt'), 'utf8')).toBe('recover this content');
    await service.dispose();
  });
});
