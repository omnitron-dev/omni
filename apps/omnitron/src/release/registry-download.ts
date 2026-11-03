/** Private subprocess: stdout is exclusively the original compressed archive.
 * Config/auth are read by pnpm itself with this process's cwd and environment. */
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getConfig } from '@pnpm/config.reader';
import { pickRegistryForPackage } from '@pnpm/config.pick-registry-for-package';
import { createGetAuthHeaderByURI } from '@pnpm/network.auth-header';
import { createFetchFromRegistry } from '@pnpm/network.fetch';
import type { RegistryPackage } from './layout.js';
import type { RegistryFailure } from './registry-transport.js';

class DownloadFailure extends Error {
  constructor(readonly category: RegistryFailure, readonly status?: number) { super(category); }
}

function httpAddress(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) throw new DownloadFailure('metadata');
  let url: URL;
  try { url = new URL(value); } catch { throw new DownloadFailure('metadata'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new DownloadFailure('metadata');
  return url.href;
}

async function boundedJson(stream: ReadableStream<Uint8Array>, maximum: number): Promise<unknown> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) throw new DownloadFailure('metadata');
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof DownloadFailure) throw error;
    throw new DownloadFailure('metadata');
  } finally { reader.releaseLock(); }
}

async function download(): Promise<void> {
  // This is a private parent-generated request, but bound it before parsing.
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16384) throw new DownloadFailure('configuration');
    chunks.push(chunk as Buffer);
  }
  const pkg = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RegistryPackage;
  if (typeof pkg.name !== 'string' || !/^@omnitron-dev\/[a-z0-9][a-z0-9._-]*$/.test(pkg.name) ||
      typeof pkg.version !== 'string' || pkg.version.length > 128) throw new DownloadFailure('configuration');
  let config: Awaited<ReturnType<typeof getConfig>>['config'];
  try {
    ({ config } = await getConfig({
      cliOptions: { dir: process.cwd(), 'ignore-pnpmfile': true }, workspaceDir: process.cwd(),
      packageManager: { name: 'omnitron', version: 'registry-inspection' }, env: process.env,
    }));
  } catch { throw new DownloadFailure('configuration'); }
  let getAuth: ReturnType<typeof createGetAuthHeaderByURI>;
  try { getAuth = createGetAuthHeaderByURI(config.configByUri); }
  catch { throw new DownloadFailure('authentication'); }
  const timeout = Math.min(config.fetchTimeout && config.fetchTimeout > 0 ? config.fetchTimeout : 60_000, 60_000);
  const fetchArchive = createFetchFromRegistry({
    configByUri: config.configByUri, maxSockets: 2, timeout,
    ...(config.ca === undefined ? {} : { ca: config.ca }),
    ...(config.cert === undefined ? {} : { cert: config.cert }),
    ...(config.key === undefined ? {} : { key: config.key }),
    ...(config.httpProxy === undefined ? {} : { httpProxy: config.httpProxy }),
    ...(config.httpsProxy === undefined ? {} : { httpsProxy: config.httpsProxy }),
    ...(config.noProxy === undefined ? {} : { noProxy: config.noProxy }),
    ...(config.localAddress === undefined ? {} : { localAddress: config.localAddress }),
    ...(config.strictSsl === undefined ? {} : { strictSsl: config.strictSsl }),
    ...(config.userAgent === undefined ? {} : { userAgent: config.userAgent }),
  });
  const read = async (address: string): Promise<Response> => {
    let authHeaderValue: string | undefined;
    try { authHeaderValue = getAuth(address, { pkgName: pkg.name }); }
    catch { throw new DownloadFailure('authentication'); }
    let response: Response;
    try {
      response = await fetchArchive(address, {
        ...(authHeaderValue === undefined ? {} : { authHeaderValue }), retry: { retries: 0 }, timeout,
        headers: { 'accept-encoding': 'identity' },
      });
    } catch (error) {
      const failure = error as { code?: unknown; cause?: { code?: unknown } } | null;
      const timeoutCodes = ['ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT'];
      throw new DownloadFailure(timeoutCodes.includes(String(failure?.code)) || timeoutCodes.includes(String(failure?.cause?.code))
        ? 'timeout' : 'network');
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new DownloadFailure(response.status === 401 || response.status === 403 ? 'authentication' : 'http', response.status);
    }
    return response;
  };
  let tarball: string;
  if (pkg.tarball !== undefined) tarball = httpAddress(pkg.tarball);
  else {
    const registry = httpAddress(pickRegistryForPackage(config.registriesByScope, pkg.name));
    const address = new URL(pkg.name.replace('/', '%2f'), registry.endsWith('/') ? registry : registry + '/').href;
    const response = await read(address);
    const metadata = await boundedJson(response.body!, 16 * 1024 * 1024) as {
      versions?: Record<string, { name?: string; version?: string; dist?: { tarball?: unknown } }>;
    } | null;
    const exact = metadata?.versions?.[pkg.version];
    if (exact?.name !== pkg.name || exact.version !== pkg.version) throw new DownloadFailure('metadata');
    tarball = httpAddress(exact.dist?.tarball);
  }
  const response = await read(tarball);
  let received = 0;
  await pipeline(Readable.fromWeb(response.body! as import('node:stream/web').ReadableStream<Uint8Array>),
    new Transform({ transform(chunk: Buffer, _encoding, next) {
      received += chunk.length;
      next(received > 64 * 1024 * 1024 ? new DownloadFailure('metadata') : null, chunk);
    } }), process.stdout);
}

try { await download(); }
catch (error) {
  const known = error instanceof DownloadFailure ? error : new DownloadFailure('network');
  process.stderr.write(JSON.stringify({ category: known.category, ...(known.status === undefined ? {} : { status: known.status }) }));
  process.exitCode = 1;
}
