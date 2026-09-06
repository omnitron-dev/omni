/**
 * Classifying an error the user is about to be told something about.
 *
 * `isNetworkError` decides whether an application says "check your
 * connection" or shows what the server actually replied, and
 * `createErrorRecoveryHandler` routes on it. Getting it wrong in either
 * direction is user-visible: a missed network failure leaves someone staring
 * at an unexplained error with a working reload one click away, and a false
 * one blames their router for a sentence the server wrote.
 *
 * The corpora below are the real shapes, not invented ones — each browser
 * engine words a failed `fetch` differently, and Safari's wording shares no
 * word with the others.
 */

import { describe, it, expect, vi } from 'vitest';

import { isNetworkError, isChunkLoadError, createErrorRecoveryHandler } from './errors.js';

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

const NETWORK_FAILURES: Array<[string, Error]> = [
  ['Chrome and Edge', new TypeError('Failed to fetch')],
  ['Firefox', new TypeError('NetworkError when attempting to fetch resource.')],
  ['Safari', new TypeError('Load failed')],
  ['React Native', new TypeError('Network request failed')],
  ['a Vite chunk', new TypeError('Failed to fetch dynamically imported module: /assets/page.js')],
  ['a refused connection', withCode('connect ECONNREFUSED 127.0.0.1:443', 'ECONNREFUSED')],
  ['a DNS failure', withCode('getaddrinfo EAI_AGAIN api.example.com', 'EAI_AGAIN')],
  ['axios', new Error('Network Error')],
];

const NOT_NETWORK: Array<[string, unknown]> = [
  ['a declined payment', new Error('Connection to the payment provider was declined')],
  ['a region restriction', new Error('This network is not supported in your region')],
  ['a roster status', new Error('User is offline in the roster')],
  ['a programmer error', new TypeError('undefined is not a function')],
  ['an auth failure', new Error('Invalid credentials')],
  ['a rejected string', 'Failed to fetch'],
];

describe('isNetworkError', () => {
  it.each(NETWORK_FAILURES)('recognises %s', (_label, error) => {
    expect(isNetworkError(error)).toBe(true);
  });

  it.each(NOT_NETWORK)('does not claim %s is one', (_label, error) => {
    expect(isNetworkError(error)).toBe(false);
  });
});

describe('isChunkLoadError', () => {
  it.each([
    ['webpack', new Error('Loading chunk 42 failed.')],
    ['vite', new TypeError('Failed to fetch dynamically imported module: /assets/page.js')],
  ])('recognises %s', (_label, error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it('does not claim an ordinary network failure is one', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('createErrorRecoveryHandler', () => {
  it('offers a reload for a chunk that failed, not a connection warning', () => {
    // Both predicates match a failed chunk; the order decides which recovery
    // the user is offered, and only one of them fixes it.
    const onChunkError = vi.fn();
    const onNetworkError = vi.fn();
    const handle = createErrorRecoveryHandler({ onChunkError, onNetworkError });

    handle(new TypeError('Failed to fetch dynamically imported module: /assets/page.js'));

    expect(onChunkError).toHaveBeenCalledTimes(1);
    expect(onNetworkError).not.toHaveBeenCalled();
  });

  it('routes a server answer to the generic handler', () => {
    const onNetworkError = vi.fn();
    const onGenericError = vi.fn();
    const handle = createErrorRecoveryHandler({ onNetworkError, onGenericError });

    handle(new Error('Connection to the payment provider was declined'));

    expect(onNetworkError).not.toHaveBeenCalled();
    expect(onGenericError).toHaveBeenCalledTimes(1);
  });
});
