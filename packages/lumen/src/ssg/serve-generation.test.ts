import { it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishGeneration } from './publish-generation.js';

it.each(['0', '1'])('the ordinary serve CLI retains its generation and releases it with FORCE_COLOR=%s', async (color) => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-serve-'));
  const output = join(root, 'out');
  // External fixture without a package.json: explicit ESM config boundary.
  writeFileSync(join(root, 'lumen.config.mjs'), 'export default { title: "Preview", outDir: "out", baseUrl: "/manual/", trailingSlash: true };');
  publishGeneration(output, new Map([
    ['index.html', '<h1>Previous generation</h1>'], ['previous.js', 'previous asset'],
    ['docs/api/index.html', '<h1>API directory</h1>'],
    ['docs/日本語/index.html', '<h1>Unicode directory</h1>'],
  ]));
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = (reserve.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => reserve.close(error => error ? reject(error) : resolve()));
  const cli = new URL('../cli/index.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e',
    `import { runLumenCli } from ${JSON.stringify(cli)}; await runLumenCli(${JSON.stringify(['serve', '--root', root, '--host', '127.0.0.1', '--port', String(port)])});`],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: color } });
  let log = '';
  child.stdout.on('data', chunk => { log += String(chunk); });
  child.stderr.on('data', chunk => { log += String(chunk); });
  try {
    const origin = `http://127.0.0.1:${port}/manual`;
    // Human-readable URLs contain ANSI sequences under Turbo/CI. Readiness is
    // the served generation, independently of terminal formatting.
    await vi.waitFor(async () => {
      expect(child.exitCode, log).toBeNull();
      expect(child.signalCode, log).toBeNull();
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      expect(response.status, log).toBe(200);
      expect(await response.text(), log).toContain('Previous generation');
    }, { timeout: 10000, interval: 50 });
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`${origin}/docs/api?q=typed%20value`, { method, redirect: 'manual' });
      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe('/manual/docs/api/?q=typed%20value');
    }
    expect(await (await fetch(`${origin}/docs/api`)).text()).toContain('API directory');
    expect(await (await fetch(`${origin}/docs/api/`)).text()).toContain('API directory');
    expect(await (await fetch(`${origin}/docs/${encodeURIComponent('日本語')}`)).text()).toContain('Unicode directory');
    expect((await fetch(`${origin}/missing`, { redirect: 'manual' })).status).toBe(404);
    expect((await fetch(`${origin}/docs/api`, { method: 'POST', redirect: 'manual' })).status).toBe(404);
    expect((await fetch(`${origin}/docs/api`, { headers: { accept: 'application/json' }, redirect: 'manual' })).status).toBe(404);
    for (const path of ['/%2f%2fexample.com', '/%2e%2e%2fdocs%2fapi', '/docs%00api', '/%5c%5cexample.com', '/docs/%E0%A4%A']) {
      expect((await fetch(`${origin}${path}`, { redirect: 'manual' })).headers.get('location')).toBeNull();
    }
    publishGeneration(output, new Map([['index.html', '<h1>Next generation</h1>'], ['next.js', 'next asset']]));
    expect(await (await fetch(origin)).text()).toContain('Previous generation');
    expect(await (await fetch(`${origin}/previous.js`)).text()).toBe('previous asset');
    expect((await fetch(`${origin}/next.js`)).status).toBe(404);
    const ended = once(child, 'exit');
    child.kill('SIGTERM');
    const [code] = await ended;
    // The TSX source loader reports conventional 128 + SIGTERM on shutdown.
    expect([0, 143], log).toContain(code);
    expect(readdirSync(root).filter(name => name.startsWith('.out-preview-'))).toEqual([]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit');
      child.kill('SIGKILL');
      await ended;
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
