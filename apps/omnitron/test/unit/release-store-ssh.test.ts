import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { parseStoreConfig, resolveStore, S3ObjectStore } from '../../src/release/artifact-store.js';
import { configuredReleaseStore } from '../../src/release/configured-store.js';

const driver = vi.hoisted(() => ({ connect: vi.fn(), open: vi.fn(), dispose: vi.fn() }));
vi.mock('@xec-sh/core/ssh', () => ({ NodeSSH: class { connect = driver.connect; createTunnel = driver.open; dispose = driver.dispose; } }));
const ssh = { host: 'store.internal', username: 'releases', port: 22,
  hostFingerprint: 'SHA256:' + 'A'.repeat(43), privateKey: { secret: 'ssh-key' } };
const raw = { endpoint: 'http://127.0.0.1:9000', bucket: 'artifacts', accessKey: { secret: 'access' }, secretKey: { secret: 'secret' }, ssh };
const vault = async (key: string) => key === 'ssh-key' ? '-----BEGIN PRIVATE KEY-----\nfixture' : 'test-value';
const servers: Server[] = [];
beforeEach(() => vi.resetAllMocks());
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.close(() => resolve()); server.closeAllConnections();
  })));
});
async function listen() {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.headers.host + (req.url ?? '')); res.writeHead(200, { etag: '"exact"' }); res.end('payload');
  });
  servers.push(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { port: (server.address() as AddressInfo).port, requests };
}

it('only sends S3 to the pinned SSH endpoint, preserving the signed host and cleaning up on disconnect', async () => {
  const [local, remote] = await Promise.all([listen(), listen()]);
  const closed = Promise.withResolvers<void>();
  const close = vi.fn(async () => closed.resolve());
  driver.open.mockResolvedValue({ localPort: remote.port, closed: closed.promise, close });
  const config = parseStoreConfig({ ...raw, endpoint: 'http://127.0.0.1:' + local.port }, 'test');
  const store = await configuredReleaseStore(config, vault);
  try {
    expect(driver.connect).toHaveBeenCalledWith(expect.objectContaining({
      hostKeyChecking: 'strict', expectedHostFingerprint: ssh.hostFingerprint, host: ssh.host,
    }));
    expect(driver.open).toHaveBeenCalledWith({ localHost: '127.0.0.1', localPort: 0, remoteHost: '127.0.0.1', remotePort: local.port });
    expect((await store.read('index', 20))?.toString()).toBe('payload');
    expect(remote.requests).toEqual(['127.0.0.1:' + local.port + '/artifacts/index']);
    closed.resolve();
    await vi.waitFor(() => expect(driver.dispose).toHaveBeenCalled());
    await expect(store.read('index', 20)).rejects.toThrow(/closed/);
    expect(local.requests).toEqual([]);
  } finally { await Promise.all([store.close(), store.close()]); }
  expect(close).toHaveBeenCalledTimes(1);
});

it('never falls back to the local store on rejected identity or when a route is missing', async () => {
  const cfg = parseStoreConfig(raw, 'test');
  driver.connect.mockRejectedValue(new Error('host key rejected'));
  await expect(configuredReleaseStore(cfg, vault)).rejects.toThrow('host key rejected');
  expect(driver.open).not.toHaveBeenCalled();
  expect(driver.dispose).toHaveBeenCalledWith(true);
  const resolved = await resolveStore(cfg, vault);
  expect(() => new S3ObjectStore(resolved)).toThrow(/transport/);
});
it.each([
  { ssh: { ...ssh, privateKey: 'literal' } }, { ssh: { ...ssh, hostFingerprint: undefined } },
  { ssh: { ...ssh, privateKey: { secret: 'key', default: 'literal' } } },
  { ssh: { ...ssh, host: 'bad\nhost' } }, { ssh: { ...ssh, port: 65536 } },
  { ssh: { ...ssh, remoteHost: 'another-host' } }, { endpoint: 'https://elsewhere.invalid' },
  { forcePathStyle: false },
])('rejects unsafe route declarations before any socket opens', change => {
  expect(() => parseStoreConfig({ ...raw, ...change }, 'test')).toThrow();
  expect(driver.connect).not.toHaveBeenCalled();
});
