/**
 * A sink the config kept.
 *
 * `defineEcosystem` rebuilds `monitoring` field by field — `healthCheck`,
 * `metrics` — so a key it does not name is dropped on the way in. The alert
 * sink (`monitoring.alertSink`) is such a key: a project that declared one and
 * went through `defineEcosystem` would have had its alerts delivered nowhere,
 * with nothing saying so.
 */
import { describe, it, expect } from 'vitest';

import { defineEcosystem } from '../../src/config/define-ecosystem.js';

describe('defineEcosystem', () => {
  it('keeps the alert sink a project declares', () => {
    const sink = { app: 'main', service: 'OpsAlerts', method: 'raise' };
    expect(defineEcosystem({ apps: [], monitoring: { alertSink: sink } } as never).monitoring.alertSink).toEqual(sink);
  });

  it('and invents none for a project that declares none', () => {
    expect(defineEcosystem({ apps: [] } as never).monitoring).not.toHaveProperty('alertSink');
  });
});
