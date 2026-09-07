/**
 * Applying a reloaded ecosystem config, and saying what happened when it
 * fails half-way.
 *
 * A SIGHUP reload has two phases with different failure meanings. LOADING can
 * fail harmlessly — a malformed file is rejected before anything changes, and
 * the daemon is exactly as it was. APPLYING cannot: each destination takes the
 * new config in turn, and a failure in the middle leaves the daemon split —
 * the orchestrator restarting apps from the new list while the file watcher
 * still watches the old one, which is precisely the divergence the watcher
 * step was added to fix.
 *
 * The operator saw `SIGHUP config reload failed: <message>`. The reasonable
 * reading of that is "the reload did not happen", and it is the wrong one
 * exactly when it matters. This makes the message carry the state instead.
 */

export interface ReloadStep<C> {
  /** Operator-facing name — this appears in the failure message. */
  name: string;
  apply: (config: C) => Promise<void> | void;
}

/**
 * Run each step in order. On failure, throw an error naming what was applied,
 * what failed and what was skipped, with the original attached as `cause`.
 */
export async function applyReloadedConfig<C>(config: C, steps: ReloadStep<C>[]): Promise<void> {
  const applied: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    try {
      await step.apply(config);
      applied.push(step.name);
    } catch (err) {
      const skipped = steps.slice(i + 1).map((s) => s.name);
      // The distinction that decides what an operator does next: a first-step
      // failure really is "nothing changed", and calling that a partial apply
      // would send them looking for damage that is not there.
      const state =
        applied.length === 0
          ? 'nothing was applied, so the daemon is unchanged'
          : `already applied: ${applied.join(', ')}` +
            (skipped.length > 0 ? `; not applied: ${skipped.join(', ')}` : '');

      throw new Error(`config reload failed at '${step.name}' — ${state}`, { cause: err });
    }
  }
}
