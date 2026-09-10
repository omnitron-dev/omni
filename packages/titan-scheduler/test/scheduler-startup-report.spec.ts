/**
 * The scheduler says what it scheduled.
 *
 * Until this line existed, the only way to find out whether a `@Cron`
 * method had been picked up was to wait for the hour it was supposed to
 * fire and see whether anything happened. Two production incidents were
 * found that way, months late: a job whose provider could not be resolved,
 * and a job whose name collided with another's.
 *
 * Names go to debug because a large application schedules dozens of them;
 * the count goes to info, where a boot log will carry it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';

import { SchedulerService } from '../src/scheduler.service.js';
import { SchedulerRegistry } from '../src/scheduler.registry.js';
import { SchedulerExecutor } from '../src/scheduler.executor.js';
import type { ISchedulerConfig } from '../src/scheduler.interfaces.js';

const config: ISchedulerConfig = { enabled: false, maxConcurrent: 5, queueSize: 100, shutdownTimeout: 5000 };

describe('SchedulerService startup report', () => {
  let registry: SchedulerRegistry;
  let scheduler: SchedulerService;
  let lines: Array<{ level: string; ctx: Record<string, unknown> }>;

  beforeEach(() => {
    lines = [];
    const logger = {
      info: (ctx: Record<string, unknown>) => lines.push({ level: 'info', ctx }),
      debug: (ctx: Record<string, unknown>) => lines.push({ level: 'debug', ctx }),
    };
    registry = new SchedulerRegistry(config);
    scheduler = new SchedulerService(
      registry,
      new SchedulerExecutor(config),
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      logger as never
    );
  });

  afterEach(async () => {
    if (scheduler.isRunning()) await scheduler.onStop();
  });

  it('reports how many jobs it started', async () => {
    const target = { run() {} };
    registry.registerJob('nightly', 'cron', '0 3 * * *', target, 'run', {});
    registry.registerJob('hourly', 'cron', '0 * * * *', target, 'run', {});

    await scheduler.onStart();

    const started = lines.find((l) => l.ctx['event'] === 'scheduler.started');
    expect(started, 'the scheduler started without saying so').toBeDefined();
    expect(started?.ctx['jobs']).toBe(2);
  });

  it('counts a disabled job as not started', async () => {
    const target = { run() {} };
    registry.registerJob('nightly', 'cron', '0 3 * * *', target, 'run', {});
    registry.registerJob('switched-off', 'cron', '0 4 * * *', target, 'run', { disabled: true });

    await scheduler.onStart();

    const started = lines.find((l) => l.ctx['event'] === 'scheduler.started');
    expect(started?.ctx['jobs'], 'a disabled job is not scheduled').toBe(1);
    expect(started?.ctx['disabled']).toBe(1);
  });

  it('names them at debug', async () => {
    const target = { run() {} };
    registry.registerJob('nightly', 'cron', '0 3 * * *', target, 'run', {});

    await scheduler.onStart();

    const named = lines.find((l) => l.ctx['event'] === 'scheduler.jobs');
    expect(named?.level).toBe('debug');
    expect(named?.ctx['jobs']).toEqual(['nightly']);
  });
});
