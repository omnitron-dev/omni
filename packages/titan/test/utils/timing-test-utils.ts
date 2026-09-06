/**
 * Millisecond bounds that measure the code rather than the machine.
 *
 * A flat `expect(duration).toBeLessThan(100)` is an assertion about the host it
 * runs on. With eight vitest workers on one box the same code reads 106ms and
 * the suite goes red with nothing wrong — seen repeatedly in full-package runs
 * of this repository, in three different suites.
 *
 * The failure in the other direction is worse and quieter: a bound generous
 * enough never to flake also passes when the property it was meant to prove is
 * absent. `test/validation/security.spec.ts` had a case — a bound asserted
 * under the comment "should fail quickly without processing all items", where
 * every one of the 10 000 items WAS processed and the bound passed anyway,
 * because a fast machine can do all that work inside the budget.
 *
 * So the reference workload is measured at the moment of the comparison and
 * the bound is a ratio against it. Sustained load moves both numbers together
 * and cancels; what remains is the thing these bounds exist for — a
 * catastrophic regression, an accidental O(n^2), a cache that stops caching.
 *
 * A bound expressed this way still cannot prove a short-circuit. When that is
 * the claim, COUNT the work instead of timing it.
 */

/** Observed for `runReference` on the box the nominal figures came from. */
const REFERENCE_MS = 12;

/**
 * A deliberately trivial, allocation-light loop, so the number tracks raw CPU
 * speed rather than GC behaviour.
 */
export function runReference(): number {
  const start = performance.now();
  let acc = 0;
  for (let i = 0; i < 5_000_000; i++) acc += i % 7;
  const elapsed = performance.now() - start;
  // Keep `acc` observable so the loop cannot be optimised away.
  return acc >= 0 ? elapsed : elapsed;
}

let warmed = false;

/**
 * Scale a nominal millisecond bound by how slow this machine is right now.
 *
 * Never tightens: on a machine faster than the one the nominal figure came
 * from, the nominal figure stands. Loosening on a slow machine is the point;
 * tightening on a fast one would turn a regression guard into a benchmark that
 * fails when the hardware improves.
 */
export function budget(nominalMs: number): number {
  if (!warmed) {
    runReference(); // the first run measures the JIT, not the machine
    warmed = true;
  }
  const reference = Math.min(runReference(), runReference());
  return Math.max(nominalMs, (nominalMs / REFERENCE_MS) * reference);
}
