import { describe, it, expect } from 'vitest';
import { defineEcosystem } from '../../src/config/define-ecosystem.js';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';

describe('defineEcosystem', () => {
  const minApps = [{ name: 'main', bootstrap: './apps/main/src/bootstrap.ts' }];

  it('merges with defaults when minimal config provided', () => {
    const result = defineEcosystem({ apps: minApps });
    expect(result.apps).toEqual(minApps);
    expect(result.supervision).toEqual(DEFAULT_ECOSYSTEM.supervision);
    expect(result.monitoring).toEqual(DEFAULT_ECOSYSTEM.monitoring);
    expect(result.logging).toEqual(DEFAULT_ECOSYSTEM.logging);
    expect(result.daemon).toEqual(DEFAULT_ECOSYSTEM.daemon);
    expect(result.env).toBe(DEFAULT_ECOSYSTEM.env);
  });

  it('overrides supervision partially', () => {
    const result = defineEcosystem({
      apps: minApps,
      supervision: { ...DEFAULT_ECOSYSTEM.supervision, maxRestarts: 10 },
    });
    expect(result.supervision.maxRestarts).toBe(10);
    expect(result.supervision.strategy).toBe('one_for_one'); // default
    expect(result.supervision.window).toBe(60_000); // default
  });

  it('overrides monitoring partially', () => {
    const result = defineEcosystem({
      apps: minApps,
      monitoring: {
        healthCheck: { interval: 30_000, timeout: 10_000 },
      },
    });
    expect(result.monitoring.healthCheck.interval).toBe(30_000);
    expect(result.monitoring.healthCheck.timeout).toBe(10_000);
    // metrics should keep defaults
    expect(result.monitoring.metrics).toEqual(DEFAULT_ECOSYSTEM.monitoring.metrics);
  });

  it('overrides daemon config', () => {
    const result = defineEcosystem({
      apps: minApps,
      daemon: { ...DEFAULT_ECOSYSTEM.daemon, port: 9800, host: '0.0.0.0' },
    });
    expect(result.daemon.port).toBe(9800);
    expect(result.daemon.host).toBe('0.0.0.0');
  });

  it('overrides logging config', () => {
    const result = defineEcosystem({
      apps: minApps,
      logging: { ...DEFAULT_ECOSYSTEM.logging, compress: false, format: 'text' },
    });
    expect(result.logging.compress).toBe(false);
    expect(result.logging.format).toBe('text');
  });

  it('overrides env', () => {
    const result = defineEcosystem({ apps: minApps, env: 'production' });
    expect(result.env).toBe('production');
  });

  it('preserves multiple apps with dependencies', () => {
    const apps = [
      { name: 'main', bootstrap: './main' },
      { name: 'storage', bootstrap: './storage', dependsOn: ['main'] },
      { name: 'messaging', bootstrap: './messaging', dependsOn: ['main'], critical: true },
    ];
    const result = defineEcosystem({ apps });
    expect(result.apps).toHaveLength(3);
    expect(result.apps[1]!.dependsOn).toEqual(['main']);
    expect(result.apps[2]!.critical).toBe(true);
  });
});
