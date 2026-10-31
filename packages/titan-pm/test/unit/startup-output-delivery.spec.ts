import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProcessSpawner } from '../../src/process-spawner.js';
import type { ILogger } from '../../src/types.js';
import { NetronClient } from '../../src/netron-client.js';
import type { ProcessOutputContext } from '../../src/output-capture.js';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const noop = () => {};
const logger = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child() { return this; } } as unknown as ILogger;

async function fixture(source: string, thread = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-output-'));
  cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'fixture.mjs');
  fs.writeFileSync(file, source);
  const spawner = new ProcessSpawner(logger, { isolation: thread ? 'worker' : 'none', forwardChildLogs: false, advanced: { tempDir: directory } });
  (spawner as unknown as { forkWorkerPath: string }).forkWorkerPath = file;
  (spawner as unknown as { workerRuntimePath: string }).workerRuntimePath = file;
  if (thread) {
    const connect = vi.spyOn(NetronClient.prototype, 'connect').mockResolvedValue(undefined);
    cleanup.push(() => connect.mockRestore());
  }
  cleanup.push(() => spawner.cleanup());
  return { spawner, file };
}

describe('real process output across startup', () => {
  it('captures import failure, complete multiline stderr and EOF before rejecting startup', async () => {
    const { spawner, file } = await fixture(`process.stdout.write('before failure\\n');
      process.stderr.write('Error: missing module\\n    at bootstrap\\nlast fragment'); process.exitCode=7;`);
    const rows: Array<{ line: string; context: ProcessOutputContext }> = [];
    await expect(spawner.spawn(file, { startupTimeout: 3000, onOutput: (line, _stream, context) => { rows.push({ line, context }); } })).rejects.toThrow('code 7');
    expect(rows.filter(row => row.context.stream === 'stderr').map(row => row.line)).toEqual(['Error: missing module', '    at bootstrap', 'last fragment']);
    expect(rows.find(row => row.line === 'before failure')).toBeTruthy();
    expect(new Set(rows.map(row => row.context.id)).size).toBe(rows.length);
  });

  it('keeps one reader and one identity across readiness, including a line straddling ready', async () => {
    const { spawner, file } = await fixture(`process.stdout.write('before\\npar'); process.send({type:'ready'});
      setTimeout(()=>process.stdout.write('tial\\nafter\\n'),20); setTimeout(()=>process.exit(0),70);`);
    const rows: string[] = [];
    const handle = await spawner.spawn(file, { startupTimeout: 3000, onOutput: line => { rows.push(line); } });
    cleanup.push(() => handle.terminate());
    await new Promise<void>(resolve => { if (!handle.isAlive()) resolve(); else handle.onExit?.(() => resolve()); });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(rows).toEqual(['before', 'partial', 'after']);
    expect((handle.worker.stdout as { listenerCount: (name: string) => number }).listenerCount('data')).toBe(1);
  });
  it('captures worker-thread output before and after readiness without forwarding it into the parent stdout', async () => {
    const { spawner, file } = await fixture(`import {parentPort} from 'node:worker_threads';
      process.stdout.write('thread-before\\n'); parentPort.postMessage({type:'ready'});
      setTimeout(()=>process.stderr.write('thread-after\\n'),20); setTimeout(()=>process.exit(0),70);`, true);
    const rows: string[] = [];
    const handle = await spawner.spawn(file, { startupTimeout: 3000, onOutput: line => { rows.push(line); } });
    cleanup.push(() => handle.terminate());
    await new Promise<void>(resolve => { if (!handle.isAlive()) resolve(); else handle.onExit?.(() => resolve()); });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(rows).toEqual(['thread-before', 'thread-after']);
  });

});
