import { describe, it, expect } from 'vitest';
import { buildRestartPolicy } from '../../src/supervisor/restart-policy.js';
import type { IEcosystemConfig, IEcosystemAppEntry } from '../../src/config/types.js';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';

function makeConfig(overrides?: Partial<IEcosystemConfig['supervision']>): IEcosystemConfig {
  return {
    apps: [],
    supervision: { ...DEFAULT_ECOSYSTEM.supervision, ...overrides },
    monitoring: DEFAULT_ECOSYSTEM.monitoring,
    logging: DEFAULT_ECOSYSTEM.logging,
    daemon: DEFAULT_ECOSYSTEM.daemon,
    env: 'test',
  } as IEcosystemConfig;
}

function makeEntry(overrides?: Partial<IEcosystemAppEntry>): IEcosystemAppEntry {
  return { name: 'test', bootstrap: './test', ...overrides };
}

describe('buildRestartPolicy', () => {
  it('uses ecosystem defaults when no per-app override', () => {
    const policy = buildRestartPolicy(makeEntry(), makeConfig());
    expect(policy.enabled).toBe(true);
    expect(policy.maxRestarts).toBe(5);
    expect(policy.window).toBe(60_000);
    expect(policy.delay).toBe(1_000);
    expect(policy.backoff).toEqual(DEFAULT_ECOSYSTEM.supervision.backoff);
  });

  it('respects per-app maxRestarts override', () => {
    const policy = buildRestartPolicy(makeEntry({ restartPolicy: { maxRestarts: 10 } }), makeConfig());
    expect(policy.maxRestarts).toBe(10);
    expect(policy.window).toBe(60_000); // ecosystem default unchanged
  });

  it('respects per-app enabled override', () => {
    const policy = buildRestartPolicy(makeEntry({ restartPolicy: { enabled: false } }), makeConfig());
    expect(policy.enabled).toBe(false);
  });

  it('respects per-app window override', () => {
    const policy = buildRestartPolicy(makeEntry({ restartPolicy: { window: 120_000 } }), makeConfig());
    expect(policy.window).toBe(120_000);
  });

  it('respects per-app delay override', () => {
    const policy = buildRestartPolicy(makeEntry({ restartPolicy: { delay: 5_000 } }), makeConfig());
    expect(policy.delay).toBe(5_000);
  });

  it('merges per-app backoff with ecosystem backoff', () => {
    const policy = buildRestartPolicy(makeEntry({ restartPolicy: { backoff: { max: 60_000 } } }), makeConfig());
    expect(policy.backoff!.max).toBe(60_000);
    expect(policy.backoff!.type).toBe('exponential'); // from ecosystem
    expect(policy.backoff!.initial).toBe(1_000); // from ecosystem
  });

  it('uses custom ecosystem supervision settings', () => {
    const policy = buildRestartPolicy(makeEntry(), makeConfig({ maxRestarts: 3, window: 30_000 }));
    expect(policy.maxRestarts).toBe(3);
    expect(policy.window).toBe(30_000);
  });
});
