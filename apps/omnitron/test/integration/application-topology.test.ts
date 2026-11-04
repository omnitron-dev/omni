import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Netron } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ApplicationTopology } from '../../src/orchestrator/application-topology.js';

const logger = createNullLogger();
let directory: string;
const scopes: ApplicationTopology[] = [];
const clients: Netron[] = [];
type Worker = { run(value: string): Promise<string> };

beforeEach(async () => { directory = await fs.mkdtemp('/tmp/omni-topology-'); });
afterEach(async () => {
  vi.restoreAllMocks();
  try {
    for (const client of clients.splice(0)) await client.stop();
    for (const scope of scopes.splice(0)) await scope.close();
    expect(await fs.readdir(directory)).toEqual([]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
async function scope(application: string) {
  const result = await ApplicationTopology.allocate(directory, application, logger);
  scopes.push(result);
  await result.start();
  return result;
}
async function connect(application: ApplicationTopology) {
  const client = new Netron(logger);
  clients.push(client);
  client.registerTransport('unix', () => new UnixSocketTransport());
  client.setTransportOptions('unix', { requestTimeout: 2000, timeout: 2000 });
  await client.start();
  return client.connect(application.url, false);
}
async function expose(application: ApplicationTopology, result: string) {
  await application.router.exposePoolService('workers', 'Worker', '1.0.0', {
    execute: async (_method: string, _service: string, _member: string, args: unknown[]) => `${result}:${args[0]}`,
  } as never, ['run']);
}

describe('native Netron application isolation', () => {
  it('keeps same-name services independent across simultaneous deployments, stop and restart', async () => {
    const first = await scope('sample/dev/quotes');
    const second = await scope('other/local/quotes');
    await Promise.all([expose(first, 'first'), expose(second, 'second')]);
    const firstPeer = await connect(first);
    const secondPeer = await connect(second);
    const firstWorker = await firstPeer.queryInterface<Worker>('Worker@1.0.0');
    const secondWorker = await secondPeer.queryInterface<Worker>('Worker@1.0.0');
    const values = await Promise.all(Array.from({ length: 20 }, (_, index) => Promise.all([
      firstWorker.run(String(index)), secondWorker.run(String(index)),
    ])));
    expect(values).toEqual(Array.from({ length: 20 }, (_, index) => [`first:${index}`, `second:${index}`]));
    await first.close();
    await expect(secondWorker.run('still-live')).resolves.toBe('second:still-live');
    const restarted = await scope('sample/dev/quotes');
    expect(restarted.url).not.toBe(first.url);
    await expose(restarted, 'restarted');
    const restartedPeer = await connect(restarted);
    const restartedWorker = await restartedPeer.queryInterface<Worker>('Worker@1.0.0');
    await expect(restartedWorker.run('new')).resolves.toBe('restarted:new');
    await expect(secondWorker.run('unchanged')).resolves.toBe('second:unchanged');
  });

  it('exposes no owner management service and creates private filesystem endpoints', async () => {
    const application = await scope('sample/dev/quotes');
    await expose(application, 'app');
    const peer = await connect(application);
    await expect(peer.queryInterface('OmnitronExecution@1.0.0')).rejects.toThrow();
    await expect(peer.queryInterface('OmnitronDaemon@1.0.0')).rejects.toThrow();
    const socket = application.url.slice('unix://'.length);
    expect((await fs.stat(socket)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(socket))).mode & 0o777).toBe(0o700);
    await application.close();
    await expect(fs.stat(path.dirname(socket))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains cleanup failures and retries without affecting another application', async () => {
    const first = await scope('first');
    const second = await scope('second');
    await expose(first, 'first');
    await expose(second, 'second');
    const peer = await connect(second);
    const worker = await peer.queryInterface<Worker>('Worker');
    vi.spyOn(first.router, 'releaseAll').mockRejectedValueOnce(new Error('unconfirmed cleanup'));
    await expect(first.close()).rejects.toThrow('shutdown incomplete');
    await expect(first.start()).rejects.toThrow('closing or closed');
    await expect(worker.run('live')).resolves.toBe('second:live');
    await Promise.all([first.close(), first.close()]);
    await expect(worker.run('after-retry')).resolves.toBe('second:after-retry');
  });

  it('refuses an unsafe parent and an overlong socket path without allocating a scope', async () => {
    await fs.chmod(directory, 0o755);
    await expect(ApplicationTopology.allocate(directory, 'app', logger)).rejects.toThrow('must be private');
    await fs.chmod(directory, 0o700);
    const long = path.join(directory, 'a'.repeat(85));
    try { await expect(ApplicationTopology.allocate(long, 'app', logger)).rejects.toThrow('100-byte'); }
    finally { await fs.rmdir(long); }
  });

  it('does not recursively remove unexpected files during cleanup', async () => {
    const application = await scope('app');
    const evidence = path.join(path.dirname(application.url.slice('unix://'.length)), 'evidence');
    await fs.writeFile(evidence, 'preserve');
    await expect(application.close()).rejects.toMatchObject({ code: 'ENOTEMPTY' });
    expect(await fs.readFile(evidence, 'utf8')).toBe('preserve');
    await fs.unlink(evidence);
    await application.close();
  });
});
