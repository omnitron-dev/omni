/**
 * OmnitronEnvConfig snapshot + override semantics.
 *
 * The override hook is documented as "patches the snapshot for the
 * remainder of the process", but it used to be applied only on the cached
 * path: an override registered BEFORE the first `getEnv()` was dropped,
 * because the first call returned the freshly-built snapshot directly.
 * That is the natural order in tests (`resetEnvCache()` → override →
 * exercise), and it silently disabled every such override.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getEnv, setEnvOverride, resetEnvCache } from '../../src/shared/env-config.js';

describe('env-config', () => {
  beforeEach(() => resetEnvCache());
  afterEach(() => resetEnvCache());

  it('applies an override registered before the first getEnv()', () => {
    setEnvOverride({ OMNITRON_DATABASE_URL: 'postgresql://u:p@example:1234/db' });

    expect(getEnv().OMNITRON_DATABASE_URL).toBe('postgresql://u:p@example:1234/db');
  });

  it('applies an override registered after the snapshot was taken', () => {
    getEnv();
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });

    expect(getEnv().OMNITRON_OUTPUT).toBe('json');
  });

  it('resetEnvCache() clears both the snapshot and the override', () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    expect(getEnv().OMNITRON_OUTPUT).toBe('json');

    resetEnvCache();

    expect(getEnv().OMNITRON_OUTPUT).toBeUndefined();
  });

  it('reads through to process.env when no override is set', () => {
    process.env['OMNITRON_STACK'] = 'unit-test-stack';
    try {
      expect(getEnv().OMNITRON_STACK).toBe('unit-test-stack');
    } finally {
      delete process.env['OMNITRON_STACK'];
    }
  });
});
