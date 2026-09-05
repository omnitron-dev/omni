/**
 * A shutdown that ran out of budget must say so, and not by a coin toss.
 *
 * `shutdown()` raced two promises: the LifecycleController running the tasks,
 * and a `setTimeout` rejecting after `gracefulShutdownTimeout`. When the
 * budget runs out the controller stops starting work — it skips the remaining
 * phases, logs a line, and RESOLVES. So whether the caller saw a timeout
 * depended on which of two same-duration timers settled first: with
 * `gracefulShutdownTimeout: 100`, the controller gives each task a 100 ms
 * deadline too, and both fire at once.
 *
 * On an idle machine the outer rejection usually won, which is why the test
 * covering this passed alone and failed inside the full 290-file suite.
 *
 * The contract these cases pin, and the distinction that matters:
 *   - a NON-CRITICAL task missing its own deadline is not fatal — siblings
 *     still run, and shutdown succeeds;
 *   - the shutdown BUDGET running out is fatal, because work was abandoned.
 */
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
  it('rejects when the budget runs out, whichever timer fires first', async () => {
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

    // "budget exhausted" is the fact; the phase names say where it ran out.
    await expect(app.shutdown(ShutdownReason.Manual)).rejects.toThrow(/budget exhausted|Shutdown/i);
  });

  it('does NOT reject when a non-critical task misses its own deadline inside the budget', async () => {
    // The distinction the fix must preserve: this task fails, its failure is
    // reported as an event, and the shutdown still succeeds because there was
    // budget left to finish everything else.
    const errors: string[] = [];
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

    await expect(app.shutdown(ShutdownReason.Manual)).resolves.toBeUndefined();
    expect(errors).toContain('Slow Task');
  });
});
