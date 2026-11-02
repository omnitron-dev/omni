import { describe, expect, it } from 'vitest';
import { compareExecutionIdentityEvidence, describeExecutionIdentityDrift, isExecutionIdentityEvidence,
  projectExecutionIdentity } from '../../src/shared/execution-identity.js';

function snapshot() {
  return {
    status: { owner: { id: 'owner-1', pid: 42 } },
    apps: [
      { info: { name: 'files', pid: 100, restarts: 0 }, startedAt: 1000,
        children: [{ name: 'http', processId: 'files-http' }], pools: [{ name: 'transform', workerIds: ['transform-a', 'transform-b'] }] },
      { info: { name: 'catalog', pid: 200, restarts: 0 }, startedAt: 2000,
        children: [{ name: 'http', processId: 'catalog-http' }], pools: [{ name: 'index', workerIds: ['index-a', 'index-b'] }] },
    ],
    workers: ['files-http', 'catalog-http', 'transform-a', 'transform-b', 'index-a', 'index-b'].map((id, i) =>
      ({ info: { id, startTime: 3000 + i }, pid: 300 + i })),
  };
}

describe('bounded execution identity diagnostics', () => {
  it('is deterministic across unordered snapshot collections without mutating them', () => {
    const original = snapshot(), reordered = snapshot();
    reordered.apps.reverse(); reordered.workers.reverse();
    for (const app of reordered.apps) app.pools[0]!.workerIds.reverse();
    const input = structuredClone(reordered);
    expect(projectExecutionIdentity(reordered)).toEqual(projectExecutionIdentity(original));
    expect(reordered).toEqual(input);
    expect(isExecutionIdentityEvidence(projectExecutionIdentity(original))).toBe(true);
  });

  it('names the actual rotating pools while preserving independent app/owner identity', () => {
    const before = snapshot(), after = snapshot();
    for (const app of after.apps) app.pools[0]!.workerIds = app.pools[0]!.workerIds.map(id => id + '-new');
    for (const worker of after.workers.slice(2)) { worker.info.id += '-new'; worker.pid += 100; worker.info.startTime += 3600000; }
    const drift = compareExecutionIdentityEvidence(projectExecutionIdentity(before), projectExecutionIdentity(after));
    expect(drift).toEqual({ kind: 'compared', ownerChanged: false, workersChanged: true, apps: [],
      pools: [{ app: 'catalog', pool: 'index' }, { app: 'files', pool: 'transform' }], omittedApps: 0, omittedPools: 0 });
    expect(describeExecutionIdentityDrift(drift)).toContain('files/transform');
    expect(describeExecutionIdentityDrift(drift)).toContain('catalog/index');
  });

  it('attributes child and app birth changes and reports unattributed worker drift', () => {
    const before = snapshot(), after = snapshot();
    after.apps[0]!.startedAt++; after.workers[1]!.pid++;
    const drift = compareExecutionIdentityEvidence(projectExecutionIdentity(before), projectExecutionIdentity(after));
    expect(drift.kind === 'compared' && drift.apps).toEqual(['catalog', 'files']);
    const orphan = snapshot(); orphan.workers.push({ info: { id: 'unattributed', startTime: 4000 }, pid: 999 });
    expect(describeExecutionIdentityDrift(compareExecutionIdentityEvidence(projectExecutionIdentity(before), projectExecutionIdentity(orphan))))
      .toContain('outside attributed app/pool groups');
  });

  it('never reads or emits entry/env/log/metrics payloads', () => {
    const input = snapshot();
    Object.defineProperty(input.apps[0], 'entry', { get() { throw Error('private config must not be read'); } });
    Object.assign(input, { logs: ['never-project-me'], env: { TOKEN: 'never-project-me' }, metrics: { detail: 'never-project-me' } });
    const evidence = projectExecutionIdentity(input);
    expect(evidence).not.toBeNull();
    expect(JSON.stringify(evidence)).not.toMatch(/never-project-me|TOKEN|entry|metrics|startTime/);
  });

  it('rejects extra own fields at every evidence level before serializing private values', () => {
    const valid = projectExecutionIdentity(snapshot())!;
    expect(isExecutionIdentityEvidence({ ...valid, config: { token: 'private' } })).toBe(false);
    expect(isExecutionIdentityEvidence({ ...valid, owner: { ...valid.owner, token: 'private' } })).toBe(false);
    expect(isExecutionIdentityEvidence({ ...valid, groups: [{ ...valid.groups[0]!, config: { token: 'private' } }, ...valid.groups.slice(1)] })).toBe(false);
    for (const where of ['root', 'owner', 'group']) {
      const changed = structuredClone(valid), target = where === 'root' ? changed : where === 'owner' ? changed.owner : changed.groups[0]!;
      Object.defineProperty(target, 'private', { get() { throw Error('must reject before JSON serialization'); } });
      expect(isExecutionIdentityEvidence(changed)).toBe(false);
    }
  });

  it('fails closed on malformed, duplicate, oversized or control-character identities', () => {
    expect(projectExecutionIdentity({ ...snapshot(), apps: Array.from({ length: 129 }, () => snapshot().apps[0]) })).toBeNull();
    const duplicate = snapshot(); duplicate.workers.push(duplicate.workers[0]!);
    expect(projectExecutionIdentity(duplicate)).toBeNull();
    const invalid = snapshot(); invalid.status.owner.pid = NaN;
    expect(projectExecutionIdentity(invalid)).toBeNull();
    const control = snapshot(); control.apps[0]!.info.name = 'unsafe\nlabel';
    expect(projectExecutionIdentity(control)).toBeNull();
    const huge = snapshot(); huge.apps[0]!.info.name = 'x'.repeat(161);
    expect(projectExecutionIdentity(huge)).toBeNull();
  });

  it('keeps legacy/missing detail and unlocated strict digest changes actionable', () => {
    const evidence = projectExecutionIdentity(snapshot());
    expect(compareExecutionIdentityEvidence(undefined, evidence)).toEqual({ kind: 'unavailable' });
    expect(describeExecutionIdentityDrift(compareExecutionIdentityEvidence(undefined, evidence))).toContain('unavailable');
    expect(describeExecutionIdentityDrift(compareExecutionIdentityEvidence(evidence, evidence))).toContain('do not locate the strict inventory change');
  });

  it('bounds the list of affected groups while preserving deterministic omitted counts', () => {
    const before = snapshot(), after = snapshot();
    before.apps = Array.from({ length: 12 }, (_, i) => ({ ...snapshot().apps[0]!, info: { name: 'app-' + String(i).padStart(2, '0'), pid: i + 1, restarts: 0 } }));
    after.apps = structuredClone(before.apps); for (const app of after.apps) app.startedAt++;
    const drift = compareExecutionIdentityEvidence(projectExecutionIdentity(before), projectExecutionIdentity(after));
    expect(drift.kind === 'compared' && drift.apps.length).toBe(8);
    expect(drift.kind === 'compared' && drift.omittedApps).toBe(4);
  });
});
