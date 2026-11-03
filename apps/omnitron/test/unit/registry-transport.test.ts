import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { createServer, type Server, type RequestListener } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFrameworkLayout, type RegistryPackage } from '../../src/release/layout.js';
import type { withRegistryArchive as downloadType } from '../../src/release/registry-transport.js';
import { compileRegistryTransportFixture } from '../helpers/registry-transport-fixture.js';

const name = '@omnitron-dev/omnitron', version = '0.3.2';
const bytes = Buffer.from('archive bytes are inspected independently by the caller');
const pin: RegistryPackage = { name, version, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
let fixture: string, compiled: string, download: typeof downloadType;
let servers: Server[] = [];

beforeAll(async () => {
  ({ directory: compiled, download } = await compileRegistryTransportFixture());
});
afterAll(async () => { await fs.rm(compiled, { recursive: true, force: true }); });
beforeEach(async () => {
  fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-transport-case-'));
  await fs.mkdir(path.join(fixture, 'home'));
  await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify({ private: true, packageManager: 'pnpm@12.16.1',
    scripts: { preinstall: 'node -e "require(\'fs\').writeFileSync(\'lifecycle-ran\',\'bad\')"' } }));
  await fs.writeFile(path.join(fixture, '.pnpmfile.cjs'), 'throw Error("pnpmfile must not execute during archive inspection")');
});
afterEach(async () => {
  for (const server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  servers = [];
  await fs.rm(fixture, { recursive: true, force: true });
});

async function server(handler: RequestListener): Promise<string> {
  const listener = createServer(handler);
  servers.push(listener);
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + (listener.address() as { port: number }).port + '/';
}

function options(signal?: AbortSignal) {
  return { checkout: fixture, scratch: fixture, signal, env: {
    PATH: process.env['PATH'], HOME: path.join(fixture, 'home'), XDG_CONFIG_HOME: path.join(fixture, 'home', '.config'),
    PNPM_CONFIG_NPMRC_AUTH_FILE: path.join(fixture, 'home', '.npmrc'),
    REGISTRY_FIXTURE_TOKEN: 'secret-never-reported',
  } };
}
async function read(pkg = pin, signal?: AbortSignal): Promise<Buffer> {
  return download(pkg, options(signal), async input => {
    const chunks: Buffer[] = [];
    for await (const chunk of input) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  });
}
async function configured(url: string, extra = '') {
  await fs.writeFile(path.join(fixture, 'pnpm-workspace.yaml'), `packages: []\nregistries:\n  default: http://127.0.0.1:1/\n  '@omnitron-dev': ${url}\n${extra}`);
  await fs.writeFile(path.join(fixture, '.npmrc'), '@omnitron-dev:registry=http://127.0.0.1:1/\n');
  // Current pnpm intentionally expands auth environment references only from
  // trusted user config, so a repository cannot redirect an operator's token.
  await fs.writeFile(path.join(fixture, 'home', '.npmrc'), `${url.slice('http:'.length)}:_authToken=\${REGISTRY_FIXTURE_TOKEN}\n`);
}
const metadata = (tarball: string) => JSON.stringify({ name, versions: { [version]: { name, version, dist: { tarball } } } });

describe('native pnpm registry configuration and bounded transport', () => {
  it('uses scoped YAML over npmrc routing and interpolated auth; executes no lifecycle or project hooks', async () => {
    const observed: Array<{ url: string; auth?: string }> = [];
    let url: string;
    url = await server((req, res) => {
      observed.push({ url: req.url!, auth: req.headers.authorization });
      if (req.headers.authorization !== 'Bearer secret-never-reported') { res.writeHead(401).end(); return; }
      res.end(req.url === '/blob.tgz' ? bytes : metadata(url + 'blob.tgz'));
    });
    await configured(url);
    expect(await read()).toEqual(bytes);
    expect(observed.map(item => item.url)).toEqual(['/@omnitron-dev%2fomnitron', '/blob.tgz']);
    await expect(fs.access(path.join(fixture, 'lifecycle-ran'))).rejects.toThrow();
  });

  it('uses a user token helper with the build environment and refuses a project helper', async () => {
    const marker = path.join(fixture, 'helper-ran');
    const helper = path.join(fixture, 'helper.mjs');
    await fs.writeFile(helper, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)}, 'ok');process.stdout.write(process.env.REGISTRY_FIXTURE_TOKEN);`);
    const url = await server((req, res) => {
      if (req.headers.authorization !== 'Bearer secret-never-reported') res.writeHead(401).end();
      else res.end(bytes);
    });
    await configured(url);
    const key = `${url.slice('http:'.length)}:tokenHelper=${process.execPath} ${helper}\n`;
    await fs.writeFile(path.join(fixture, 'home', '.npmrc'), key);
    expect(await read({ ...pin, tarball: url + 'blob.tgz' })).toEqual(bytes);
    expect(await fs.readFile(marker, 'utf8')).toBe('ok');
    await fs.unlink(marker);
    await fs.writeFile(path.join(fixture, 'home', '.npmrc'), '');
    await fs.appendFile(path.join(fixture, '.npmrc'), key);
    await expect(read({ ...pin, tarball: url + 'blob.tgz' })).rejects.toMatchObject({ category: 'configuration' });
    await expect(fs.access(marker)).rejects.toThrow();
  });

  it('downloads an exact locked URL without consulting version metadata', async () => {
    const url = await server((req, res) => {
      expect(req.url).toBe('/locked.tgz'); res.end(bytes);
    });
    await configured('http://127.0.0.1:1/');
    expect(await read({ ...pin, tarball: url + 'locked.tgz' })).toEqual(bytes);
  });

  it('follows registry redirects without carrying authorization to another origin', async () => {
    let redirectedAuth: string | undefined;
    let originalAuth: string | undefined;
    const destination = await server((req, res) => { redirectedAuth = req.headers.authorization; res.end(bytes); });
    const url = await server((req, res) => {
      originalAuth = req.headers.authorization;
      res.writeHead(302, { location: destination + 'archive.tgz' }).end();
    });
    await configured(url);
    expect(await read({ ...pin, tarball: url + 'archive.tgz' })).toEqual(bytes);
    expect(originalAuth).toBe('Bearer secret-never-reported');
    expect(redirectedAuth).toBeUndefined();
  });

  it('streams more than the diagnostic-output cap without buffering or truncating the archive', async () => {
    const large = randomBytes(1024 * 1024 + 13);
    const url = await server((_req, res) => res.end(large));
    await configured(url);
    expect(await read({ ...pin, tarball: url + 'large.tgz' })).toEqual(large);
  });

  it('preserves static HTTP diagnostics without reflecting registry or credential text', async () => {
    const url = await server((_req, res) => { res.writeHead(403).end('secret-never-reported'); });
    await configured(url);
    const error = await read().catch(value => value as Error);
    expect(error).toMatchObject({ category: 'authentication', status: 403 });
    expect(String(error)).not.toContain('secret-never-reported');
    expect(String(error)).not.toContain(url);
  });

  it('refuses missing exact metadata and oversized metadata', async () => {
    let oversized = false;
    const url = await server((_req, res) => res.end(oversized ? ' '.repeat(16 * 1024 * 1024 + 1) : '{"versions":{}}'));
    await configured(url);
    await expect(read()).rejects.toMatchObject({ category: 'metadata' });
    oversized = true;
    await expect(read()).rejects.toMatchObject({ category: 'metadata' });
  });

  it('cancels a stalled response and keeps the parent process environment unchanged', async () => {
    const initial = process.env['REGISTRY_FIXTURE_TOKEN'];
    const controller = new AbortController();
    const url = await server(() => controller.abort());
    await configured(url);
    await expect(read(pin, controller.signal)).rejects.toMatchObject({ category: 'cancelled' });
    expect(process.env['REGISTRY_FIXTURE_TOKEN']).toBe(initial);
  });

  it('cancels a hung trusted token helper through Xec without leaving its process behind', async () => {
    const controller = new AbortController();
    const pidFile = path.join(fixture, 'helper-pid');
    const helper = path.join(fixture, 'hung-helper.mjs');
    await fs.writeFile(helper, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
    const url = await server((_req, res) => res.end(bytes));
    await configured(url);
    await fs.writeFile(path.join(fixture, 'home', '.npmrc'), `${url.slice('http:'.length)}:tokenHelper=${process.execPath} ${helper}\n`);
    const result = read({ ...pin, tarball: url + 'blob' }, controller.signal).catch(error => error);
    let pid: number | undefined;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = await fs.readFile(pidFile, 'utf8').catch(() => '');
        if (value) { pid = Number(value); break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(pid).toBeGreaterThan(1);
    } finally { controller.abort(); }
    expect(await result).toMatchObject({ category: 'cancelled' });
    if (pid !== undefined) {
      // Reaping a killed child may briefly follow the parent's completion.
      for (let attempt = 0; attempt < 100; attempt++) {
        try { process.kill(pid, 0); } catch { return; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw Error('The cancelled fixture token helper is still alive');
    }
  });

  it('does not expose failed helper stderr or its credential text', async () => {
    const helper = path.join(fixture, 'failed-helper.mjs');
    await fs.writeFile(helper, 'process.stderr.write("secret-never-reported".repeat(1000));process.exitCode=1;');
    const url = await server((_req, res) => res.end(bytes));
    await configured(url);
    await fs.writeFile(path.join(fixture, 'home', '.npmrc'), `${url.slice('http:'.length)}:tokenHelper=${process.execPath} ${helper}\n`);
    const error = await read({ ...pin, tarball: url + 'blob' }).catch(value => value);
    expect(error).toMatchObject({ category: 'authentication' });
    expect(String(error)).not.toContain('secret-never-reported');
    expect(error.cause).toBeUndefined();
  });

  it('bounds stalled response headers with the configured pnpm fetch timeout', async () => {
    const url = await server(() => undefined);
    await configured(url, 'fetchTimeout: 100\n');
    await expect(read()).rejects.toMatchObject({ category: 'timeout' });
  }, 10_000);

  it('stops downloading when the independent SHA-512 verifier refuses the archive', async () => {
    const url = await server((_req, res) => res.end(bytes));
    await configured(url);
    await expect(download({ ...pin, tarball: url + 'blob' }, options(), async input => {
      const digest = createHash('sha512');
      for await (const chunk of input) digest.update(chunk as Buffer);
      if ('sha512-' + digest.digest('base64') !== 'sha512-wrong') throw Error('Committed SHA-512 mismatch');
    })).rejects.toThrow('Committed SHA-512 mismatch');
  });
});

it('retains a credential-free custom locked archive and rejects URLs containing credentials', () => {
  const lock = (tarball: string) => `lockfileVersion: '9.0'\npackages:\n  '${name}@${version}':\n    resolution: {integrity: '${pin.integrity}', tarball: '${tarball}'}\n`;
  const tarball = 'http://registry.internal.example/framework/pinned.tgz';
  expect(readFrameworkLayout(lock(tarball))).toMatchObject({ kind: 'registry', packages: [{ ...pin, tarball }] });
  for (const bad of ['https://user:secret@example.test/x', 'https://example.test/x?token=secret', 'file:///tmp/a.tgz']) {
    expect(() => readFrameworkLayout(lock(bad))).toThrow(/credential-free/);
  }
});
