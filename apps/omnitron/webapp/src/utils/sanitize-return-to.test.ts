/**
 * Where a sign-in redirect is allowed to send the operator.
 *
 * `returnTo` comes from the URL, so it is attacker-controlled: a link to
 * `/auth/sign-in?returnTo=…` that lands the operator on someone else's page
 * after a successful login is a credible phishing step, because the sign-in
 * itself was genuine.
 *
 * The previous version pattern-matched the dangerous shapes — require a
 * leading `/`, then strip `^//+`. That reads as thorough and misses the case
 * next to the one it handles: `/\evil.com` starts with `/`, survives the
 * strip, and every browser normalises it to `//evil.com`. `URL` resolution
 * is not a stricter pattern; it is the difference between predicting how a
 * URL will be read and reading it the same way.
 */

import { describe, it, expect } from 'vitest';

import { sanitizeReturnTo } from './errors.js';

describe('sanitizeReturnTo', () => {
  it('keeps an ordinary in-app destination', () => {
    expect(sanitizeReturnTo('/apps')).toBe('/apps');
    expect(sanitizeReturnTo('/apps?tab=logs')).toBe('/apps?tab=logs');
    expect(sanitizeReturnTo('/apps#section')).toBe('/apps#section');
    expect(sanitizeReturnTo(encodeURIComponent('/stacks/dev'))).toBe('/stacks/dev');
  });

  it('refuses an absolute URL', () => {
    expect(sanitizeReturnTo('https://evil.com')).toBe('/');
    expect(sanitizeReturnTo('http://evil.com/path')).toBe('/');
  });

  it('refuses a protocol-relative URL, however it is spelled', () => {
    // `//evil.com` was already handled. The rest are the same attack with
    // one character changed, and each was allowed through before.
    expect(sanitizeReturnTo('//evil.com')).toBe('/');
    expect(sanitizeReturnTo('/\\evil.com')).toBe('/');
    expect(sanitizeReturnTo('/\\/evil.com')).toBe('/');
    expect(sanitizeReturnTo('%2f%2fevil.com')).toBe('/');
  });

  it('refuses a path that normalises INTO an authority', () => {
    // `/..//evil.com` resolves on our own origin, so an origin check passes
    // it — but its pathname is `//evil.com`, protocol-relative again for
    // whatever reads it next. The check has to look at what it returns, not
    // only at what it parsed.
    expect(sanitizeReturnTo('/..//evil.com')).toBe('/');
  });

  it('refuses a non-http scheme', () => {
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/');
    expect(sanitizeReturnTo('data:text/html,<script>alert(1)</script>')).toBe('/');
  });

  it('falls back for the empty cases', () => {
    expect(sanitizeReturnTo(null)).toBe('/');
    expect(sanitizeReturnTo(undefined)).toBe('/');
    expect(sanitizeReturnTo('')).toBe('/');
  });

  it('honours a caller-supplied fallback', () => {
    expect(sanitizeReturnTo('https://evil.com', '/dashboard')).toBe('/dashboard');
  });

  it('resolves traversal rather than rejecting it', () => {
    // `/../../evil` is not an attack on this origin — it is just a path.
    // Rejecting it would be noise; normalising it is what a browser does.
    expect(sanitizeReturnTo('/../../evil')).toBe('/evil');
  });
});
