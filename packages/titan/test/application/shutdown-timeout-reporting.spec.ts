/** A timeout is unknown completion, regardless of a hook's criticality.
 * Application and the standalone controller must report the same failure. */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

import { Application } from '../../src/application/index.js';
import { ShutdownReason, ApplicationEvent } from '../../src/types.js';

async function appWith(options: Record<string, unknown>, task: Record<string, unknown>) {
  const app = await Application.create({
    disableCoreModules: true,
    disableGracefulShutdown: false,
    environment: 'test',
    ...options,
  } as never);
  app.registerShutdownTask(task as never);
  await app.start();
  return app;
}

describe('shutdown budget reporting', () => {
  it('rejects when the shared shutdown budget runs out', async () => {
    const app = await appWith(
      { gracefulShutdownTimeout: 100 },
      {
        id: 'very-slow',
        name: 'Very Slow Task',
        handler: () => new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      },
    );

    await expect(app.shutdown(ShutdownReason.Manual)).rejects.toThrow(/timed out|timeout/i);
  });

  it('says what was skipped', async () => {
    const app = await appWith(
      { gracefulShutdownTimeout: 100 },
      {
        id: 'very-slow',
        name: 'Very Slow Task',
        handler: () => new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      },
    );

    await expect(app.shutdown(ShutdownReason.Manual)).rejects.toThrow(/shutdown is incomplete/i);
  });

  it('rejects an unfinished non-critical task without closing its dependencies', async () => {
    const errors: string[] = [];
    const completed: unknown[] = [];
    let cleaned = false;
    const app = await appWith(
      { gracefulShutdownTimeout: 5_000 },
      {
        id: 'slow',
        name: 'Slow Task',
        timeout: 50,
        handler: () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
      },
    );
    app.on(ApplicationEvent.ShutdownTaskError, (d: { task: string }) => errors.push(d.task));
    app.on(ApplicationEvent.ShutdownComplete, data => completed.push(data));
    app.registerCleanup(() => { cleaned = true; });

    await expect(app.shutdown(ShutdownReason.Manual)).rejects.toThrow(/shutdown is incomplete/i);
    expect(errors).toContain('Slow Task');
    expect(completed).toEqual([]);
    expect(cleaned).toBe(false);
  });
});
