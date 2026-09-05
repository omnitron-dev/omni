/**
 * Two independent fetches whose failures must not be silent.
 *
 * Several console pages load two RPCs at once through `Promise.allSettled`
 * and read only the fulfilled halves. That keeps one failure from blanking
 * the other, which is right, and discards the failure entirely, which is not:
 * the traces page had BOTH queries failing against the database schema, had
 * never returned a row, and displayed "No traces collected yet" — a plausible
 * answer that was not the true one.
 */

import { describe, it, expect } from 'vitest';

import { settledPair } from '../../webapp/src/utils/settled-pair.js';

const ok = <T>(value: T) => Promise.resolve(value);
const fails = (message: string) => Promise.reject(new Error(message));

describe('settledPair', () => {
  it('returns both halves when both succeed', async () => {
    const result = await settledPair([ok([1, 2]), ok('summary')], [[], '']);

    expect(result).toEqual({ first: [1, 2], second: 'summary', partialFailure: null });
  });

  it('keeps the half that worked and names the half that did not', async () => {
    const result = await settledPair<number[], string>(
      [ok([1]), fails('service map unavailable')],
      [[], '']
    );

    expect(result.first).toEqual([1]);
    expect(result.second).toEqual('');
    expect(result.partialFailure).toBe('service map unavailable');
  });

  it('reports a first-half failure just as loudly', async () => {
    const result = await settledPair<number[], string>([fails('list unavailable'), ok('s')], [[], '']);

    expect(result.first).toEqual([]);
    expect(result.second).toBe('s');
    expect(result.partialFailure).toBe('list unavailable');
  });

  it('throws when both fail, rather than showing an empty page', async () => {
    // The traces defect exactly: two failures rendered as "nothing collected
    // yet", which reads as a healthy empty state.
    await expect(
      settledPair([fails('queryTraces exploded'), fails('getServiceMap exploded')], [[], []])
    ).rejects.toThrow('queryTraces exploded');
  });

  it('describes a rejection that is not an Error', async () => {
    const result = await settledPair<number[], number[]>(
      [ok([1]), Promise.reject('a bare string')],
      [[], []]
    );

    expect(result.partialFailure).toBe('request failed');
  });
});
