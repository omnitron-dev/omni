import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

describe('runtime diagnostics with unavailable stderr', () => {
  it.each([false, true])('survives a real broken pipe (logger throws: %s)', async failingLogger => {
    const source = new URL('../../src/monitoring/runtime-diagnostics.ts', import.meta.url).href;
    const script = `
      import { RuntimeDiagnostics } from ${JSON.stringify(source)};
      const diagnostics = new RuntimeDiagnostics();
      if (${failingLogger}) diagnostics.setLogger({info(){throw Error('logger failed')},warn(){throw Error('logger failed')},error(){throw Error('logger failed')}});
      process.stdin.once('data', () => {
        diagnostics.failure('fixture.storage', 'Storage is unavailable', Error('fixture'));
        diagnostics.resolve('fixture.storage');
        setImmediate(async () => {
          console.log(JSON.stringify({ snapshot: diagnostics.snapshot(), health: await diagnostics.check() }));
          process.stdin.destroy();
        });
      });
      console.log('ready');
    `;
    // No application/OS service is involved. Closing only this child's pipe
    // reproduces the asynchronous error that try/catch around stream.write misses.
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx/esm'), '--input-type=module', '-e', script], {
      stdio: ['pipe', 'pipe', 'pipe'], signal: AbortSignal.timeout(10_000),
    });
    const closed = once(child, 'close');
    let stdout = '', stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    const ready = new Promise<void>(resolve => {
      child.stdout.setEncoding('utf8').on('data', chunk => {
        stdout += chunk;
        if (stdout.includes('ready\n')) resolve();
      });
    });
    try {
      await Promise.race([ready, closed.then(() => { throw Error('Fixture exited before readiness: ' + stderr); })]);
      child.stderr.destroy();
      child.stdin.end('write');
      const [code, signal] = await closed;
      expect({ code, signal, stderr }).toEqual({ code: 0, signal: null, stderr: '' });
      const result = JSON.parse(stdout.trim().split('\n').at(-1)!);
      expect(result.snapshot.active).toEqual([]);
      expect(result.snapshot.output.failedWrites).toBe(2);
      expect(result.snapshot.output.lastError).toMatch(/EPIPE|broken pipe/i);
      expect(result.health.status).toBe('degraded');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await closed.catch(() => undefined);
    }
  });
});
