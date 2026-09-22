/**
 * What is this deployment doing right now?
 *
 * Measured on 2026-09-22: `stack start daos/test` logged «Starting remote
 * stack — deploying to slave daemons» at 04:43:47 and its next line,
 * «building main», at 04:57:36 — thirteen minutes and forty-nine seconds of
 * silence with the work in flight. The CLI stops waiting at ten minutes and
 * says the operation is «probably still running», which was true and named
 * nothing. In that window the step was found by reading the deploy path and
 * then probing six bootstraps, an input checksum and a dist hash in separate
 * processes — none of which was slow, so the answer cost the whole window and
 * arrived after the log line that made it moot.
 *
 * The artifact builder already learned half of this: it prints `building X`
 * BEFORE the compiler runs rather than after, because a line that arrives at
 * the end cannot describe the middle. This is the other half. A transition
 * only speaks when something changes, and the question at minute nine is not
 * «what happened» but «what is still happening» — so the phase repeats its
 * own name on a timer, with the seconds it has been in it.
 */

export interface PhaseLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

export interface DeployPhases {
  /** Name the step now running. Resets the clock this reporter prints. */
  enter(phase: string): void;
  /** Stop reporting. Idempotent: the deploy path has several exits. */
  done(): void;
}

export function reportPhases(
  logger: PhaseLogger,
  context: Record<string, unknown>,
  everyMs = 30_000,
): DeployPhases {
  let phase: string | null = null;
  let since = Date.now();

  const timer = setInterval(() => {
    // Before the first `enter` and after `done` there is nothing to report,
    // and a reporter that says «still undefined» is worse than silence.
    if (phase === null) return;
    logger.info(
      { ...context, phase, seconds: Math.round((Date.now() - since) / 1000) },
      `Still ${phase}`,
    );
  }, everyMs);

  // A progress timer must never be the reason a process outlives its work.
  timer.unref?.();

  return {
    enter(next: string): void {
      phase = next;
      since = Date.now();
    },
    done(): void {
      phase = null;
      clearInterval(timer);
    },
  };
}
