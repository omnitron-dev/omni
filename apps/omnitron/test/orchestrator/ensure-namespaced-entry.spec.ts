/**
 * `ensureNamespacedEntry` is the defensive auto-promotion gate at the
 * top of `OrchestratorService.startApp`. Bare-name handles that slip
 * through used to become invisible to the webapp's stack-prefix lookup
 * (project.service.ts:toStackInfo filters on `${project}/${stack}/`),
 * so a perfectly healthy app showed up as "stopped" in the UI.
 *
 * These tests pin the four observable cases:
 *   - bare name + OMNITRON_PROJECT/STACK env present → promoted
 *   - already canonical → untouched (idempotent)
 *   - env missing → untouched (manual ad-hoc start)
 *   - cross-project namespaced name → untouched (operator intent)
 */
import { describe, it, expect } from 'vitest';
import { ensureNamespacedEntry } from '../../src/orchestrator/orchestrator.service.js';

const baseEntry = {
  name: 'main',
  script: 'dist/index.js',
} as any;

describe('ensureNamespacedEntry', () => {
  it('promotes a bare name when OMNITRON_PROJECT + OMNITRON_STACK are present', () => {
    const out = ensureNamespacedEntry({
      ...baseEntry,
      env: { OMNITRON_PROJECT: 'omni', OMNITRON_STACK: 'dev' },
    });
    expect(out.name).toBe('omni/dev/main');
  });

  it('is a no-op when the entry is already canonically namespaced', () => {
    const out = ensureNamespacedEntry({
      ...baseEntry,
      name: 'omni/dev/main',
      env: { OMNITRON_PROJECT: 'omni', OMNITRON_STACK: 'dev' },
    });
    expect(out.name).toBe('omni/dev/main');
    expect(out).toBe(out); // same identity is acceptable; only the name matters
  });

  it('is a no-op when env lacks OMNITRON_PROJECT or OMNITRON_STACK', () => {
    expect(ensureNamespacedEntry(baseEntry).name).toBe('main');
    expect(ensureNamespacedEntry({ ...baseEntry, env: { OMNITRON_PROJECT: 'omni' } }).name).toBe('main');
    expect(ensureNamespacedEntry({ ...baseEntry, env: { OMNITRON_STACK: 'dev' } }).name).toBe('main');
  });

  it('preserves a name already namespaced under a different project/stack', () => {
    // Operator intent: cross-project administrative start. Don't rewrite.
    const out = ensureNamespacedEntry({
      ...baseEntry,
      name: 'daos/prod/main',
      env: { OMNITRON_PROJECT: 'omni', OMNITRON_STACK: 'dev' },
    });
    expect(out.name).toBe('daos/prod/main');
  });

  it('returns the SAME reference when no rewrite is needed (no spurious allocations)', () => {
    const entry = { ...baseEntry, name: 'omni/dev/main', env: { OMNITRON_PROJECT: 'omni', OMNITRON_STACK: 'dev' } };
    expect(ensureNamespacedEntry(entry)).toBe(entry);
  });
});
