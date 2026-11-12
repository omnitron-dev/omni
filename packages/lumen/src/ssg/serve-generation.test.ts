import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishGeneration } from './publish-generation.js';

it('the ordinary serve CLI retains its captured generation and releases it on shutdown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-serve-'));
  const output = join(root, 'out');
  // External fixture without a package.json: explicit ESM config boundary.
  writeFileSync(join(root, 'lumen.config.mjs'), 'export default { title: "Preview", outDir: "out" };');
  publishGeneration(output, new Map([['index.html', '<h1>Previous generation</h1>'], ['previous.js', 'previous asset']]));
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = (reserve.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => reserve.close(error => error ? reject(error) : resolve()));
  const cli = new URL('../cli/index.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e',
    `import { runLumenCli } from ${JSON.stringify(cli)}; await runLumenCli(${JSON.stringify(['serve', '--root', root, '--host', '127.0.0.1', '--port', String(port)])});`],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', chunk => { log += String(chunk); });
  child.stderr.on('data', chunk => { log += String(chunk); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Preview did not start: ${log}`)), 10000);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited ${code}: ${log}`)); });
      child.stdout.on('data', () => {
        if (log.includes(`127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); }
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    expect(await (await fetch(origin)).text()).toContain('Previous generation');
    publishGeneration(output, new Map([['index.html', '<h1>Next generation</h1>'], ['next.js', 'next asset']]));
    expect(await (await fetch(origin)).text()).toContain('Previous generation');
    expect(await (await fetch(`${origin}/previous.js`)).text()).toBe('previous asset');
    expect((await fetch(`${origin}/next.js`)).status).toBe(404);
    child.kill('SIGTERM');
    const [code] = await once(child, 'exit');
    // The TSX source loader reports conventional 128 + SIGTERM on shutdown.
    expect([0, 143], log).toContain(code);
    expect(readdirSync(root).filter(name => name.startsWith('.out-preview-'))).toEqual([]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
