import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateNginxConfig } from '../../src/webapp/webapp.service.js';

// Explicit opt-in, using an already installed image. No application containers,
// data volumes, registry downloads or fixed host ports participate in this test.
const image = process.env.OMNITRON_TEST_NGINX_IMAGE;
const exec = promisify(execFile);

describe.skipIf(!image)('Console asset caching through nginx', () => {
  const container = `omnitron-cache-test-${randomUUID()}`;
  let directory: string;
  let origin: string;
  let started = false;
  const assets = [
    { url: '/bundle-A1b2c3d4.js', cache: 'public, max-age=31536000, immutable' },
    { url: '/bundle.js', cache: 'public, max-age=3600, must-revalidate' },
  ];

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-nginx-cache-'));
    await fs.chmod(directory, 0o755);
    await fs.writeFile(path.join(directory, 'nginx.conf'), generateNginxConfig('127.0.0.1', 9801, 9802));
    for (const asset of assets) await fs.writeFile(path.join(directory, asset.url.slice(1)), 'console.log("fixture");');
    const { stdout: id } = await exec('docker', ['run', '--rm', '-d', '--pull=never', '--name', container,
      '-p', '127.0.0.1::80', '-v', `${directory}/nginx.conf:/etc/nginx/nginx.conf:ro`,
      '-v', `${directory}:/usr/share/nginx/html:ro`, image!], { timeout: 30_000 });
    started = id.trim().length > 0;
    const { stdout } = await exec('docker', ['port', container, '80/tcp'], { timeout: 10_000 });
    expect(stdout.trim()).toMatch(/^127\.0\.0\.1:\d+$/);
    origin = `http://${stdout.trim()}`;
  }, 40_000);

  afterAll(async () => {
    if (started) await exec('docker', ['rm', '-f', container], { timeout: 15_000 });
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  async function response(url: string, headers: Record<string, string> = {}) {
    const result = await fetch(origin + url, { headers, signal: AbortSignal.timeout(5_000) });
    await result.arrayBuffer();
    expect(result.headers.get('content-security-policy')).toContain("script-src 'self'");
    return result;
  }

  for (const asset of assets) {
    it(`caches full, partial and revalidated successful responses for ${asset.url}`, async () => {
      const full = await response(asset.url);
      expect(full.status).toBe(200);
      expect(full.headers.get('cache-control')).toBe(asset.cache);
      const partial = await response(asset.url, { Range: 'bytes=0-7' });
      expect(partial.status).toBe(206);
      expect(partial.headers.get('cache-control')).toBe(asset.cache);
      const etag = full.headers.get('etag');
      expect(etag).toBeTruthy();
      const unchanged = await response(asset.url, { 'If-None-Match': etag! });
      expect(unchanged.status).toBe(304);
      expect(unchanged.headers.get('cache-control')).toBe(asset.cache);
    });

    it(`does not store a missing ${asset.url}`, async () => {
      const missing = await response(`/missing${asset.url}`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get('cache-control')).toBe('no-store');
    });

    it(`does not store ${asset.url} when a later filter rejects its range`, async () => {
      const invalid = await response(asset.url, { Range: 'bytes=999999999-' });
      expect(invalid.status).toBe(416);
      // nginx can run the header filter twice. no-store must survive the final
      // status and overrides any earlier max-age directive (RFC 9111 §5.2.2.5).
      expect(invalid.headers.get('cache-control')?.split(/\s*,\s*/)).toContain('no-store');
    });
  }
});
