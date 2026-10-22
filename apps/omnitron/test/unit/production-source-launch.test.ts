import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { launchClassic } from '../../src/orchestrator/classic-launcher.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

it('runs a classic app in its declared directory without inheriting daemon preload flags', async () => {
  const root = mkdtempSync(join(tmpdir(), 'omni-classic-'));
  const dir = join(root, 'application');
  mkdirSync(dir);
  writeFileSync(
    join(dir, 'start.cjs'),
    `require('node:fs').writeFileSync('reading.json', JSON.stringify({ cwd:process.cwd(), args:process.execArgv })); process.send({type:'ready'}); setInterval(()=>{}, 1000);`
  );
  const flags = process.execArgv;
  let child;
  try {
    process.execArgv = ['--import', 'not-installed-in-the-application'];
    const entry = { name: 'reading', cwd: dir, script: './start.cjs' };
    child = await launchClassic(entry, new AppHandle(entry, 'classic'), root, createNullLogger());
    const reading = JSON.parse(readFileSync(join(dir, 'reading.json'), 'utf8'));
    expect(reading.cwd).toBe(dir);
    expect(reading.args).toEqual([]);
  } finally {
    process.execArgv = flags;
    if (child) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

it('compiles the complete source topology in production and does not arm a watcher', async () => {
  const root = mkdtempSync(join(tmpdir(), 'omni-production-ts-'));
  const service = new OrchestratorService(createNullLogger(), {} as never, {} as never, root);
  const internal = service as any;
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(
      join(root, 'bootstrap.ts'),
      `export default { name:'proof', version:'1', processes:[{name:'worker',module:'./worker.ts'}] };`
    );
    // A parameter property is not erasable by Node's native TS reader.
    writeFileSync(
      join(root, 'worker.ts'),
      'class Counter { constructor(public value: number) {} } export const value = new Counter(42).value;'
    );
    const launch = vi.fn(async (_entry, _handle, _config, _bootstrap, _topology, build) => {
      const file = build.modulePaths.get('worker');
      const output = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import {value} from ${JSON.stringify(pathToFileURL(file).href)}; console.log(value)`,
        ],
        { encoding: 'utf8' }
      );
      expect(output.trim()).toBe('42');
    });
    internal.launchTopology = launch;
    service.devMode = false;
    const entry = { name: 'proof', cwd: root, bootstrap: './bootstrap.ts', watch: false };
    await internal.launchBootstrapMode(entry, new AppHandle(entry, 'bootstrap'), {});
    expect(launch).toHaveBeenCalledOnce();
    expect(internal.buildService.isWatching('proof')).toBe(false);
  } finally {
    await internal.buildService?.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
