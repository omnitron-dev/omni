import { expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyGeneration } from './publish-generation.js';

it('ordinary dev rebuilds and restarts without mutating the published generation with compiler cache', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lumen-dev-generation-'));
  const temporary = join(root, 'temporary');
  const output = join(root, 'out');
  mkdirSync(temporary);
  mkdirSync(join(root, 'docs'));
  // This external fixture has no ESM package boundary.
  writeFileSync(join(root, 'lumen.config.mjs'), 'export default { title: "Development", outDir: "out" };');
  const document = join(root, 'docs/index.md');
  const change = (value: string) => writeFileSync(document, `---\nslug: /\n---\n# ${value}\n`);
  change('First generation');
  const reserve = createServer();
  reserve.listen(0, '127.0.0.1');
  await once(reserve, 'listening');
  const port = (reserve.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => reserve.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const cli = new URL('../cli/index.ts', import.meta.url).href;
  let child: ChildProcess | undefined;
  let log = '';
  const start = () => {
    log = '';
    child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e',
      `import { runLumenCli } from ${JSON.stringify(cli)}; await runLumenCli(${JSON.stringify(['dev', '--root', root, '--host', '127.0.0.1', '--port', String(port)])});`],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: temporary } });
    child.stdout!.on('data', chunk => { log += String(chunk); });
    child.stderr!.on('data', chunk => { log += String(chunk); });
  };
  const until = async (check: () => boolean | Promise<boolean>, description: string) => {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (child!.exitCode !== null || child!.signalCode !== null) throw Error(`Dev exited: ${log}`);
      if (await check()) return;
      await delay(50);
    }
    throw Error(`${description}: ${log}`);
  };
  const renders = (value: string) => until(async () => {
    const response = await fetch(origin).catch(() => null);
    return response?.status === 200 && (await response.text()).includes(value);
  }, `Dev must render ${value}`);
  const stop = async () => {
    const ended = once(child!, 'exit');
    child!.kill('SIGTERM');
    const [code] = await Promise.race([
      ended,
      delay(10_000, undefined, { ref: false }).then(() => { throw Error(`Dev did not stop: ${log}`); }),
    ]);
    expect([0, 143], log).toContain(code);
    expect(readdirSync(temporary).filter(name => name.startsWith('lumen-dev-'))).toEqual([]);
  };
  try {
    start();
    await renders('First generation');
    // A real Vite request starts its optimizer; the on-disk inventory must stay exact.
    await fetch(`${origin}/@vite/client`);
    await until(() => readdirSync(temporary).some(name => name.startsWith('lumen-dev-')), 'Private compiler cache');
    const first = verifyGeneration(output).digest;
    change('Second generation');
    await renders('Second generation');
    const second = verifyGeneration(output).digest;
    expect(second).not.toBe(first);
    change('Broken generation\n\n[Missing](./missing.md)');
    await until(() => log.includes('ERR_BROKEN_LINK'), 'Invalid build must be diagnosed');
    expect(verifyGeneration(output).digest).toBe(second);
    expect(await (await fetch(origin)).text()).toContain('Second generation');
    change('Third generation');
    await renders('Third generation');
    await stop();
    const third = verifyGeneration(output).digest;
    start();
    await renders('Third generation');
    expect(verifyGeneration(output).digest).toBe(third);
    await stop();
    expect(log).not.toContain('Generation inventory does not match');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit');
      child.kill('SIGKILL');
      await ended;
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 90_000);
