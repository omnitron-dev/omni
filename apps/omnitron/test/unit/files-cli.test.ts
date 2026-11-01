import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';
const { service } = vi.hoisted(() => ({
  service: {
    roots: vi.fn(),
    stat: vi.fn(),
    readChunk: vi.fn(),
    saveText: vi.fn(),
    archiveFormats: vi.fn(),
    copy: vi.fn(),
  },
}));
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({ service: async () => service, disconnect: async () => {} }),
}));
import { filesCommand } from '../../src/commands/files.js';
let directory: string;
beforeEach(async () => {
  vi.resetAllMocks();
  process.exitCode = undefined;
  setEnvOverride({ OMNITRON_OUTPUT: 'json' });
  directory = await fs.mkdtemp(path.join(tmpdir(), 'file-cli-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  resetEnvCache();
  process.exitCode = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
async function capture(run: () => Promise<void>) {
  const out: string[] = [],
    err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    out.push(String(c));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
    err.push(String(c));
    return true;
  });
  await run();
  return { out: out.join(''), err: err.join(''), code: process.exitCode };
}
describe('files CLI output and local publication', () => {
  it('keeps empty export lists as structured data and reports mutation errors as failures', async () => {
    service.roots.mockResolvedValue({ protocol: 1, roots: [] });
    const listed = await capture(() => filesCommand('roots', undefined, {}));
    expect(JSON.parse(listed.out)).toEqual({ ok: true, data: { protocol: 1, roots: [] } });
    const refused = await capture(() => filesCommand('save', 'config', { root: 'work' }));
    expect(JSON.parse(refused.err)).toMatchObject({ ok: false, error: expect.stringContaining('--version') });
    expect(refused.code).toBe(1);
    expect(service.saveText).not.toHaveBeenCalled();
  });
  it('uses explicit archive modes and node capability inspection through the same service', async () => {
    service.archiveFormats.mockResolvedValue({ formats: [], limitations: [], observedAt: '2026-11-02T00:00:00Z' });
    await capture(() => filesCommand('archive-formats', undefined, { node: 'source', toNode: 'target' }));
    expect(service.archiveFormats).toHaveBeenCalledWith({ nodeId: 'source', destinationNodeId: 'target' });
    service.stat.mockResolvedValue({ version: 'version' });
    service.copy.mockResolvedValue({ id: 'transfer' });
    await capture(() =>
      filesCommand('copy', 'tree', {
        node: 'source',
        root: 'work',
        toNode: 'target',
        toRoot: 'work',
        archiveFormat: 'tar.gz',
        archiveOutput: 'directory',
        archiveName: 'restored',
      })
    );
    expect(service.copy).toHaveBeenCalledWith({
      sources: [{ nodeId: 'source', rootId: 'work', path: 'tree', version: 'version' }],
      destination: { nodeId: 'target', rootId: 'work', path: '' },
      archive: { format: 'tar.gz', output: 'directory', name: 'restored' },
    });
    service.copy.mockClear();
    const rejected = await capture(() =>
      filesCommand('copy', 'tree', { root: 'work', toNode: 'target', toRoot: 'work', archiveFormat: 'tar.gz' })
    );
    expect(rejected.code).toBe(1);
    expect(service.copy).not.toHaveBeenCalled();
  });
  it('never overwrites an existing local download or publishes corrupt bytes', async () => {
    const data = Buffer.from('received'),
      destination = path.join(directory, 'existing');
    await fs.writeFile(destination, 'keep');
    service.stat.mockResolvedValue({ kind: 'file', size: data.length, version: 'version' });
    service.readChunk.mockResolvedValue({
      offset: 0,
      data: data.toString('base64'),
      sha256: createHash('sha256').update(data).digest('hex'),
      eof: true,
    });
    expect((await capture(() => filesCommand('download', 'remote', { root: 'work', to: destination }))).code).toBe(1);
    expect(await fs.readFile(destination, 'utf8')).toBe('keep');
    expect(await fs.readdir(directory)).toEqual(['existing']);
    service.readChunk.mockResolvedValue({ offset: 0, data: data.toString('base64'), sha256: 'corrupt' });
    expect(
      (await capture(() => filesCommand('download', 'remote', { root: 'work', to: path.join(directory, 'new') }))).code
    ).toBe(1);
    expect(await fs.readdir(directory)).toEqual(['existing']);
  });
});
