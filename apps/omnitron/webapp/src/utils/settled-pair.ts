/**
 * Two independent fetches whose failures must not be silent.
 *
 * Several console pages load two RPCs at once — a list and a summary, rules
 * and firing alerts, pipelines and their runs — through `Promise.allSettled`,
 * and then read only the fulfilled halves. That keeps one failure from
 * blanking the other, which is right, and discards the failure entirely,
 * which is not: the traces page had BOTH of its queries failing against the
 * database schema, had never returned a row, and displayed "No traces
 * collected yet" — a plausible answer that was not the true one.
 *
 * This keeps the tolerance and drops the silence. One half failing yields the
 * other half plus a note saying what is missing; both failing throws, because
 * at that point there is nothing to show and pretending otherwise is the
 * defect above.
 */

export interface SettledPair<A, B> {
  first: A;
  second: B;
  /** What failed, when exactly one of the two did. */
  partialFailure: string | null;
}

const describe = (reason: unknown): string =>
  (reason as { message?: string })?.message ?? 'request failed';

/**
 * Await both, tolerate one failure, report it.
 *
 * @param fallbacks what to substitute for a half that failed — usually an
 *        empty list, so the page renders its "nothing here" state for that
 *        half while the note explains why.
 * @throws when both fail, carrying the first reason.
 */
export async function settledPair<A, B>(
  promises: [Promise<A>, Promise<B>],
  fallbacks: [A, B]
): Promise<SettledPair<A, B>> {
  const [a, b] = await Promise.allSettled(promises);

  if (a.status === 'rejected' && b.status === 'rejected') {
    throw new Error(describe(a.reason));
  }

  const failure =
    a.status === 'rejected' ? describe(a.reason) : b.status === 'rejected' ? describe(b.reason) : null;

  return {
    first: a.status === 'fulfilled' ? a.value : fallbacks[0],
    second: b.status === 'fulfilled' ? b.value : fallbacks[1],
    partialFailure: failure,
  };
}
