import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishGeneration } from './publish-generation.js';

it.each(['0', '1'])('the ordinary serve CLI retains its generation and releases it with FORCE_COLOR=%s', async (color) => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-serve-'));
  const output = join(root, 'out');
  // External fixture without a package.json: explicit ESM config boundary.
  writeFileSync(join(root, 'title.js'), 'export default "Preview";');
  writeFileSync(join(root, 'lumen.config.mjs'), 'const modules = import.meta.glob("./title.js", { eager: true, import: "default" }); export default { title: modules["./title.js"], outDir: "out", baseUrl: "/manual/", trailingSlash: true };');
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
    `import { runLumenCli } from ${JSON.stringify(cli)}; await runLumenCli(${JSON.stringify(['serve', '--root', root, '--host', '127.0.0.1', '--port', String(port)])}); process.send('listening'); process.disconnect();`],
  { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], timeout: 15_000, killSignal: 'SIGKILL', env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: color } });
  const exited = once(child, 'exit');
  let openRequest: Socket | undefined;
  let log = '';
  child.stdout.on('data', chunk => { log += String(chunk); });
  child.stderr.on('data', chunk => { log += String(chunk); });
  try {
    const origin = `http://127.0.0.1:${port}/manual`;
    // The public command resolves after Vite listens. Verify its real HTTP
    // response separately from startup, independently of terminal formatting.
    const [ready] = await Promise.race([
      once(child, 'message', { signal: AbortSignal.timeout(10_000) }),
      exited.then(([code, signal]) => { throw Error(`CLI exited (${code ?? signal})`); }),
    ]).catch(error => { throw Error(`Preview did not start.\n${log}`, { cause: error }); });
    expect(ready).toBe('listening');
    const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
    expect(response.status, log).toBe(200);
    expect(await response.text(), log).toContain('Previous generation');
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
    openRequest = connect(port, '127.0.0.1');
    await once(openRequest, 'connect');
    openRequest.on('error', () => {}); // Closing the preview can reset this incomplete request.
    const accepted = once(openRequest, 'data', { signal: AbortSignal.timeout(1_000) });
    // The first reply proves Vite accepted this socket. The next request has no final CRLF.
    openRequest.write('HEAD /manual/ HTTP/1.1\r\nHost: localhost\r\n\r\nGET /manual/ HTTP/1.1\r\nHost: localhost\r\n');
    const [headers] = await accepted;
    expect(String(headers)).toMatch(/^HTTP\/1\.1 200\b/);
    const closed = once(child, 'close', { signal: AbortSignal.timeout(3_000) });
    const signal = color === '0' ? 'SIGINT' : 'SIGTERM';
    child.kill(signal);
    const [code] = await closed;
    expect([0, signal === 'SIGINT' ? 130 : 143], log).toContain(code);
    expect(readdirSync(root).filter(name => name.startsWith('.out-preview-'))).toEqual([]);
  } finally {
    openRequest?.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
