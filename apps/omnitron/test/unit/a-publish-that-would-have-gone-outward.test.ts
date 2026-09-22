/**
 * The one operation here that is irreversible and outward-facing.
 *
 * Measured 2026-09-22 on the machine that would run it:
 *
 *   @omnitron-dev/titan    public npm, latest 0.2.0, published 2026-05-16
 *   @omnitron-dev/common   public npm, latest 0.2.0
 *   local packages         also 0.2.0, four months of commits later
 *   ~/.npmrc               one auth token for registry.npmjs.org, mode 0600
 *   repository             no package private, none with publishConfig,
 *                          .npmrc scopes nothing
 *
 * An accidental `pnpm -r publish` in that state does not fail. It succeeds,
 * outward, into a scope that is already public, with a credential that is
 * already loaded. Everything below exists so that it cannot.
 */

import { describe, it, expect } from 'vitest';

import { decidePublish, npmrcFor, redactTokens } from '../../src/release/publish.js';

const GITLAB = { registry: 'https://gitlab.example/api/v4/projects/7/packages/npm/', scope: '@omnitron-dev' };

describe('where a publish is allowed to go', () => {
  it('allows the configured private registry', () => {
    const d = decidePublish(GITLAB);

    expect(d.action).toBe('publish');
    expect(d.because).toBe('gitlab.example for @omnitron-dev');
  });

  it('refuses the public registry, and says what is already there', () => {
    const d = decidePublish({ ...GITLAB, registry: 'https://registry.npmjs.org/' });

    expect(d.action).toBe('refuse');
    expect(d.because).toMatch(/already published there by someone/);
  });

  it('refuses the other public one too', () => {
    expect(decidePublish({ ...GITLAB, registry: 'https://registry.yarnpkg.com/' }).action).toBe('refuse');
  });

  it('refuses plain http, because the token travels with every request', () => {
    const d = decidePublish({ ...GITLAB, registry: 'http://gitlab.example/api/v4/projects/7/packages/npm/' });

    expect(d.action).toBe('refuse');
    expect(d.because).toMatch(/not https/);
  });

  it('allows http to a loopback registry — the control, so testing is possible', () => {
    // Without this the rule would be untestable against a local verdaccio,
    // and a rule nobody can exercise is a rule nobody trusts.
    expect(decidePublish({ ...GITLAB, registry: 'http://localhost:4873/' }).action).toBe('publish');
  });

  it('refuses something that is not an address at all', () => {
    expect(decidePublish({ ...GITLAB, registry: 'gitlab.example' }).action).toBe('refuse');
  });

  it('refuses a scope without its @', () => {
    const d = decidePublish({ ...GITLAB, scope: 'omnitron-dev' });

    expect(d.action).toBe('refuse');
    expect(d.because).toMatch(/is not a scope/);
  });
});

describe('the .npmrc a publish runs with', () => {
  it('scopes the registry and carries the token for that host only', () => {
    const rc = npmrcFor(GITLAB, 'glpat-secret');

    expect(rc).toContain('@omnitron-dev:registry=https://gitlab.example/api/v4/projects/7/packages/npm/');
    expect(rc).toContain('//gitlab.example/api/v4/projects/7/packages/npm/:_authToken=glpat-secret');
  });

  it('names no other host, so a credential cannot reach one', () => {
    const rc = npmrcFor(GITLAB, 'glpat-secret');

    expect(rc).not.toMatch(/registry\.npmjs\.org/);
  });

  it('ends the registry path with a slash whether or not it was given one', () => {
    // npm matches the auth line against the resolved URL; a missing slash
    // makes the token silently not apply, and the publish then fails as
    // «unauthenticated» with a correct token in hand.
    const rc = npmrcFor({ ...GITLAB, registry: 'https://gitlab.example/api/v4/projects/7/packages/npm' }, 't');

    expect(rc).toContain('//gitlab.example/api/v4/projects/7/packages/npm/:_authToken=t');
  });
});

describe('what a build log may keep', () => {
  it('redacts an auth token line', () => {
    const out = redactTokens('//gitlab.example/npm/:_authToken=glpat-abc123\nok');

    expect(out).not.toContain('glpat-abc123');
    expect(out).toContain('«redacted»');
  });

  it('redacts a password inside a URL, which is how one reached the daemon log today', () => {
    const out = redactTokens('connecting to redis://omni:s3cr3t@10.0.0.4:6379');

    expect(out).not.toContain('s3cr3t');
    expect(out).toContain('redis://omni:«redacted»@10.0.0.4:6379');
  });

  it('leaves ordinary output alone — the control', () => {
    const text = 'published @omnitron-dev/titan@0.2.0+ab12cd3 in 1.2s';

    expect(redactTokens(text)).toBe(text);
  });
});
