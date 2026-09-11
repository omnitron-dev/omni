/**
 * What a child printed before dying during startup has to reach the log file.
 *
 * A child that never reports ready produces no WorkerHandle — titan-pm creates
 * one only after `waitForReady` resolves — so there is no `onLog` to subscribe
 * to and nothing to replay. The one place that output exists is on the error
 * `waitForReady` throws, which carries the stdout and stderr it captured while
 * waiting. Before this, the orchestrator copied a truncated stderr tail into
 * an in-memory ring that only `omnitron inspect` reads, and the app's own log
 * file recorded nothing at all about the failure.
 *
 * That is the case where reading it matters most. An application that dies
 * before its logger exists has already said everything it is ever going to
 * say, on these two streams, and then it is gone.
 */
import { describe, it, expect, vi } from 'vitest';

import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

const silentLogger = (): any => {
  const noop = () => {};
  const logger: any = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
  logger.child = () => logger;
  return logger;
};

const orchestrator = () =>
  new OrchestratorService(silentLogger(), {} as never, {} as never, process.cwd());

describe('output of a child that failed to start', () => {
  it('reaches the app log handlers', () => {
    const service = orchestrator();
    const lines: Array<{ app: string; line: string }> = [];
    service.onAppLog((app, line) => lines.push({ app, line }));

    (service as any).persistChildOutput(
      'acme/dev/main',
      'http',
      'Cannot find module ./missing.js\nat loader',
      'stderr'
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]?.app).toBe('acme/dev/main');
    const first = JSON.parse(lines[0]!.line);
    expect(first.msg).toBe('Cannot find module ./missing.js');
    expect(first.level, 'stderr from a dead child is an error, not chatter').toBe(50);
    expect(first.processName).toBe('acme/dev/main/http');
  });

  it('passes structured lines through untouched', () => {
    // The child may well have got far enough to produce real pino output.
    const service = orchestrator();
    const lines: string[] = [];
    service.onAppLog((_app, line) => lines.push(line));
    const original = '{"level":30,"time":"2026-09-11T00:00:00.000Z","msg":"Application starting"}';

    (service as any).persistChildOutput('app', 'http', original, 'stdout');

    expect(lines).toEqual([original]);
  });

  it('says nothing when the child printed nothing', () => {
    const service = orchestrator();
    const lines: string[] = [];
    service.onAppLog((_app, line) => lines.push(line));

    (service as any).persistChildOutput('app', 'http', undefined, 'stderr');
    (service as any).persistChildOutput('app', 'http', '   \n\n', 'stderr');

    expect(lines).toEqual([]);
  });

  it('records the failure even when the child printed nothing', () => {
    // A module that throws on import reports the error over IPC and exits
    // without writing to either stream. Before this, that produced a log file
    // with no mention of the failure at all.
    const service = orchestrator();
    const lines: string[] = [];
    service.onAppLog((_app, line) => lines.push(line));
    const error = Object.assign(new Error('deliberate startup failure'), {
      childStack: 'Error: deliberate startup failure\n    at file:///worker.js:3:7',
    });

    (service as any).persistChildFailure('acme/dev/pricing', 'collector', error);

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.level).toBe(50);
    expect(entry.event).toBe('process.start_failed');
    expect(entry.msg).toContain('deliberate startup failure');
    expect(entry.err.stack, 'the stack from inside the child is the whole diagnosis').toContain(
      'worker.js:3:7'
    );
  });

  it('does not repeat the app name a child already carries', () => {
    // Supervisor events arrive with `childName` bare in one path and already
    // qualified in another; prefixing unconditionally wrote
    // `acme/dev/pricing/acme/dev/pricing/http` into the log file.
    const service = orchestrator();
    const lines: string[] = [];
    service.onAppLog((_app, line) => lines.push(line));

    (service as any).persistChildFailure(
      'acme/dev/pricing',
      'acme/dev/pricing/collector',
      new Error('boom')
    );

    expect(JSON.parse(lines[0]!).processName).toBe('acme/dev/pricing/collector');
  });

  it('survives a log handler that throws', () => {
    // A broken handler must not take down failure reporting, which is the one
    // path where losing the message costs the most.
    const service = orchestrator();
    const seen: string[] = [];
    service.onAppLog(() => {
      throw new Error('handler is broken');
    });
    service.onAppLog((_app, line) => seen.push(line));

    expect(() => (service as any).persistChildOutput('app', 'http', 'boom', 'stderr')).not.toThrow();
    expect(seen).toHaveLength(1);
  });
});
