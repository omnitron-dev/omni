import { describe, it, expect } from 'vitest';

import { requirePayload, requireString } from '../../src/services/anonymous-input.js';

const code = (fn: () => unknown): string => {
  try {
    fn();
    return 'no-throw';
  } catch (e) {
    return String((e as { code?: string; statusCode?: number }).code ?? (e as { statusCode?: number }).statusCode ?? 'unknown');
  }
};

const message = (fn: () => unknown): string => {
  try {
    fn();
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

describe('requirePayload', () => {
  it('rejects the shapes that produced a 500', () => {
    for (const bad of [undefined, null, 'string', 42, []]) {
      expect(message(() => requirePayload(bad, 'signIn'))).toMatch(/expected an object payload/);
    }
  });

  it('answers 400, not 500', () => {
    expect(code(() => requirePayload(undefined, 'signIn'))).toMatch(/400|BAD_REQUEST/i);
  });

  it('passes an object through', () => {
    const o = { username: 'a' };
    expect(requirePayload(o, 'signIn')).toBe(o);
  });
});

describe('requireString', () => {
  it('names the field that is wrong', () => {
    expect(message(() => requireString({}, 'username', 'signIn'))).toContain("'username'");
  });

  it('rejects an empty string, which reaches the service as a falsy id', () => {
    expect(message(() => requireString({ sessionId: '' }, 'sessionId', 'signOut'))).toMatch(/non-empty/);
  });

  it('rejects a non-string', () => {
    expect(message(() => requireString({ token: 7 }, 'token', 'validateToken'))).toMatch(/non-empty string/);
  });

  it('returns the value', () => {
    expect(requireString({ token: 'abc' }, 'token', 'validateToken')).toBe('abc');
  });
});
