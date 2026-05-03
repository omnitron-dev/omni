/**
 * Verifies that OrchestratorService resolves bare app names to their
 * namespaced handle keys. Affects three callsites tightened in this work:
 *   - resolveAppName (always existed, but now used wider)
 *   - getLogs (MED-7)
 *   - getHandle (LOW-12)
 *
 * The orchestrator's process management plumbing is heavy; instead of
 * spinning it up we drive a minimal handles map directly to exercise just
 * the name-resolution logic. This keeps the test fast and free of system
 * dependencies.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

const noopLogger: ILogger = {
  trace: () => {}, debug: () => {}, info: () => {}, warn: () => {},
  error: () => {}, fatal: () => {}, child: () => noopLogger,
  time: () => () => {}, isLevelEnabled: () => false,
  setLevel: () => {}, getLevel: () => 'info' as any,
};

/** Build an orchestrator with a hand-seeded handles map. */
function build(handles: Record<string, { entry: any; getLogs?: () => string[] }>): OrchestratorService {
  // Constructor needs ProcessManager + StateStore — both unused in the
  // surface area we're testing. Cast through any to keep this minimal.
  const orch = new OrchestratorService(noopLogger, {} as any, {} as any);
  // Inject our synthetic handles map.
  (orch as any).handles = new Map(Object.entries(handles));
  return orch;
}

describe('OrchestratorService.resolveAppName', () => {
  it('returns the exact key when present', () => {
    const orch = build({
      'omni/dev/main': { entry: { name: 'omni/dev/main' } },
    });
    expect(orch.resolveAppName('omni/dev/main')).toBe('omni/dev/main');
  });

  it('matches a bare app name to a namespaced handle key', () => {
    const orch = build({
      'omni/dev/main': { entry: { name: 'omni/dev/main' } },
      'omni/dev/storage': { entry: { name: 'omni/dev/storage' } },
    });
    expect(orch.resolveAppName('main')).toBe('omni/dev/main');
    expect(orch.resolveAppName('storage')).toBe('omni/dev/storage');
  });

  it('returns undefined when no handle matches', () => {
    const orch = build({ 'omni/dev/main': { entry: { name: 'omni/dev/main' } } });
    expect(orch.resolveAppName('unknown')).toBeUndefined();
  });

  it('does NOT match arbitrary substrings — only the trailing /<name> segment', () => {
    const orch = build({
      'project/stack/billing-api': { entry: { name: 'project/stack/billing-api' } },
    });
    // 'api' is part of the handle key but not the trailing segment;
    // matching it would be incorrect (would alias 'analytics-api', etc.).
    expect(orch.resolveAppName('api')).toBeUndefined();
    expect(orch.resolveAppName('billing-api')).toBe('project/stack/billing-api');
  });
});

describe('OrchestratorService.getHandle (LOW-12)', () => {
  it('looks up by bare name in stack mode', () => {
    const handle = { entry: { name: 'omni/dev/main', env: { FOO: 'bar' } } } as any;
    const orch = build({ 'omni/dev/main': handle });
    expect(orch.getHandle('main')).toBe(handle);
  });

  it('returns undefined when neither the bare nor the namespaced name matches', () => {
    const orch = build({ 'omni/dev/main': { entry: { name: 'omni/dev/main' } } });
    expect(orch.getHandle('messaging')).toBeUndefined();
  });
});

describe('OrchestratorService.getLogs (MED-7)', () => {
  it('returns log buffer for a bare name in stack mode', () => {
    const orch = build({
      'omni/dev/main': {
        entry: { name: 'omni/dev/main' },
        getLogs: () => ['line A', 'line B'],
      } as any,
    });
    const result = orch.getLogs('main');
    expect(result).toHaveLength(1);
    expect(result[0]?.app).toBe('omni/dev/main');
    expect(result[0]?.lines).toEqual(['line A', 'line B']);
  });

  it('returns logs for ALL handles when no name is provided', () => {
    const orch = build({
      'omni/dev/main': { entry: { name: 'omni/dev/main' }, getLogs: () => ['m1'] } as any,
      'omni/dev/storage': { entry: { name: 'omni/dev/storage' }, getLogs: () => ['s1'] } as any,
    });
    const result = orch.getLogs();
    expect(result).toHaveLength(2);
    const apps = result.map((r) => r.app).sort();
    expect(apps).toEqual(['omni/dev/main', 'omni/dev/storage']);
  });
});
