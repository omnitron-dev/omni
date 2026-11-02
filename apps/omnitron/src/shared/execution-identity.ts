import { createHash } from 'node:crypto';

/** Diagnostic identity only. Never substitutes for the owner's strict inventory digest. */
export interface ExecutionIdentityGroup {
  kind: 'app' | 'pool';
  app: string;
  pool?: string;
  members: number;
  digest: string;
}

export interface ExecutionIdentityEvidence {
  protocol: 1;
  owner: { id: string; pid: number };
  appCount: number;
  workerCount: number;
  workersDigest: string;
  groups: ExecutionIdentityGroup[];
}

export type ExecutionIdentityDrift = { kind: 'unavailable' } | {
  kind: 'compared';
  ownerChanged: boolean;
  workersChanged: boolean;
  apps: string[];
  pools: Array<{ app: string; pool: string }>;
  omittedApps: number;
  omittedPools: number;
};

const MAX_APPS = 128, MAX_POOLS = 256, MAX_WORKERS = 4096, MAX_REFERENCES = 16384;
const MAX_LABEL = 160, MAX_BYTES = 64 * 1024, MAX_CHANGED = 8;
const hashPattern = /^[a-f0-9]{64}$/;
const exactFields = (value: Record<string, unknown>, names: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return keys.length === names.length && keys.every(key => typeof key === 'string' && names.includes(key));
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const label = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_LABEL && [...value].every(character => {
  const code = character.codePointAt(0)!;
  return code >= 32 && (code < 127 || code > 159) && code !== 0x2028 && code !== 0x2029;
});
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const pid = (value: unknown): number | null => value === undefined || value === null ? null : integer(value) && value > 0 ? value : NaN;
const counter = (value: unknown): number | null => value === undefined || value === null ? null : integer(value) ? value : NaN;
const digest = (domain: string, value: unknown): string => createHash('sha256').update(domain + '\0').update(JSON.stringify(value)).digest('hex');
const groupKey = (group: ExecutionIdentityGroup): string => group.kind + '\0' + group.app + '\0' + (group.pool ?? '');
const sortStrings = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** One existing snapshot, bounded work, no entry/config/environment/log/metrics serialization. */
export function projectExecutionIdentity(snapshot: unknown): ExecutionIdentityEvidence | null {
  try {
    if (!object(snapshot) || !object(snapshot['status']) || !object(snapshot['status']['owner']) ||
        !label(snapshot['status']['owner']['id']) || !integer(snapshot['status']['owner']['pid']) || snapshot['status']['owner']['pid'] < 1 ||
        !Array.isArray(snapshot['apps']) || snapshot['apps'].length > MAX_APPS ||
        !Array.isArray(snapshot['workers']) || snapshot['workers'].length > MAX_WORKERS) return null;
    const workers = new Map<string, unknown[]>();
    for (const worker of snapshot['workers']) {
      if (!object(worker) || !object(worker['info']) || !label(worker['info']['id']) || workers.has(worker['info']['id']) || !integer(worker['info']['startTime'])) return null;
      const workerPid = pid(worker['pid']), restarts = counter(worker['info']['restartCount']);
      if (Number.isNaN(workerPid) || Number.isNaN(restarts)) return null;
      workers.set(worker['info']['id'], [worker['info']['id'], workerPid, worker['info']['startTime'], restarts]);
    }
    const identity = (id: string): unknown[] => workers.get(id) ?? [id, 'missing'];
    const groups: ExecutionIdentityGroup[] = [], names = new Set<string>();
    let pools = 0, references = 0;
    for (const app of snapshot['apps']) {
      if (!object(app) || !object(app['info']) || !label(app['info']['name']) || names.has(app['info']['name']) || !integer(app['startedAt'])) return null;
      names.add(app['info']['name']);
      const appPid = pid(app['info']['pid']), restarts = counter(app['info']['restarts']);
      if (Number.isNaN(appPid) || Number.isNaN(restarts)) return null;
      const children = app['children'] ?? [], appPools = app['pools'] ?? [];
      if (!Array.isArray(children) || children.length > MAX_WORKERS || !Array.isArray(appPools) || appPools.length > MAX_POOLS) return null;
      references += children.length; pools += appPools.length;
      if (references > MAX_REFERENCES || pools > MAX_POOLS) return null;
      const childNames = new Set<string>(), childIdentities: Array<[string, unknown[] | null]> = [];
      for (const child of children) {
        if (!object(child) || !label(child['name']) || childNames.has(child['name']) ||
            (child['processId'] !== undefined && !label(child['processId']))) return null;
        childNames.add(child['name']);
        childIdentities.push([child['name'], typeof child['processId'] === 'string' ? identity(child['processId']) : null]);
      }
      childIdentities.sort((a, b) => sortStrings(a[0], b[0]));
      groups.push({ kind: 'app', app: app['info']['name'], members: children.length,
        digest: digest('execution-identity/app/1', [appPid, app['startedAt'], restarts, childIdentities]) });
      const poolNames = new Set<string>();
      for (const pool of appPools) {
        if (!object(pool) || !label(pool['name']) || poolNames.has(pool['name']) || !Array.isArray(pool['workerIds']) || pool['workerIds'].length > MAX_WORKERS) return null;
        poolNames.add(pool['name']); references += pool['workerIds'].length;
        if (references > MAX_REFERENCES) return null;
        const ids = new Set<string>();
        for (const id of pool['workerIds']) { if (!label(id) || ids.has(id)) return null; ids.add(id); }
        groups.push({ kind: 'pool', app: app['info']['name'], pool: pool['name'], members: ids.size,
          digest: digest('execution-identity/pool/1', [...ids].sort(sortStrings).map(identity)) });
      }
    }
    groups.sort((a, b) => sortStrings(groupKey(a), groupKey(b)));
    const result: ExecutionIdentityEvidence = { protocol: 1, owner: { id: snapshot['status']['owner']['id'], pid: snapshot['status']['owner']['pid'] },
      appCount: snapshot['apps'].length, workerCount: workers.size,
      workersDigest: digest('execution-identity/workers/1', [...workers.keys()].sort(sortStrings).map(identity)), groups };
    return Buffer.byteLength(JSON.stringify(result)) <= MAX_BYTES ? result : null;
  } catch { return null; }
}

export function isExecutionIdentityEvidence(value: unknown): value is ExecutionIdentityEvidence {
  try {
    if (!object(value) || !exactFields(value, ['protocol', 'owner', 'appCount', 'workerCount', 'workersDigest', 'groups']) || value['protocol'] !== 1 || !object(value['owner']) || !exactFields(value['owner'], ['id', 'pid']) || !label(value['owner']['id']) || !integer(value['owner']['pid']) || value['owner']['pid'] < 1 ||
        !integer(value['appCount']) || value['appCount'] > MAX_APPS || !integer(value['workerCount']) || value['workerCount'] > MAX_WORKERS ||
        typeof value['workersDigest'] !== 'string' || !hashPattern.test(value['workersDigest']) || !Array.isArray(value['groups']) || value['groups'].length > MAX_APPS + MAX_POOLS) return false;
    const apps = new Set<string>(); let previous = '', pools = 0;
    for (const group of value['groups']) {
      if (!object(group) || (group['kind'] !== 'app' && group['kind'] !== 'pool') || !exactFields(group, group['kind'] === 'pool' ? ['kind', 'app', 'pool', 'members', 'digest'] : ['kind', 'app', 'members', 'digest']) || !label(group['app']) || !integer(group['members']) || group['members'] > MAX_WORKERS ||
          typeof group['digest'] !== 'string' || !hashPattern.test(group['digest'])) return false;
      if (group['kind'] === 'app') { if (group['pool'] !== undefined || apps.has(group['app'])) return false; apps.add(group['app']); }
      else { if (!label(group['pool'])) return false; pools++; }
      const key = groupKey(group as unknown as ExecutionIdentityGroup);
      if (previous && key <= previous) return false; previous = key;
    }
    return apps.size === value['appCount'] && pools <= MAX_POOLS && value['groups'].every(group => group['kind'] !== 'pool' || apps.has(group['app'])) &&
      Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES;
  } catch { return false; }
}

export function compareExecutionIdentityEvidence(before: unknown, after: unknown): ExecutionIdentityDrift {
  if (!isExecutionIdentityEvidence(before) || !isExecutionIdentityEvidence(after)) return { kind: 'unavailable' };
  const old = new Map(before.groups.map(group => [groupKey(group), group])), next = new Map(after.groups.map(group => [groupKey(group), group]));
  const apps: string[] = [], pools: Array<{ app: string; pool: string }> = [];
  for (const key of [...new Set([...old.keys(), ...next.keys()])].sort(sortStrings)) {
    const source = old.get(key), target = next.get(key);
    if (source?.digest === target?.digest && source?.members === target?.members) continue;
    const group = target ?? source!;
    if (group.kind === 'app') apps.push(group.app); else pools.push({ app: group.app, pool: group.pool! });
  }
  return { kind: 'compared', ownerChanged: before.owner['id'] !== after.owner['id'] || before.owner['pid'] !== after.owner['pid'],
    workersChanged: before.workerCount !== after.workerCount || before.workersDigest !== after.workersDigest,
    apps: apps.slice(0, MAX_CHANGED), pools: pools.slice(0, MAX_CHANGED), omittedApps: Math.max(0, apps.length - MAX_CHANGED), omittedPools: Math.max(0, pools.length - MAX_CHANGED) };
}

export function describeExecutionIdentityDrift(drift: ExecutionIdentityDrift): string {
  if (drift.kind === 'unavailable') return 'Bounded identity details are unavailable';
  const reasons: string[] = [];
  if (drift.ownerChanged) reasons.push('execution owner identity changed');
  if (drift.apps.length) reasons.push('apps: ' + drift.apps.map(name => JSON.stringify(name)).join(', ') + (drift.omittedApps ? ' and ' + drift.omittedApps + ' more' : ''));
  if (drift.pools.length) reasons.push('worker pools: ' + drift.pools.map(pool => JSON.stringify(pool.app + '/' + pool.pool)).join(', ') + (drift.omittedPools ? ' and ' + drift.omittedPools + ' more' : ''));
  if (drift.workersChanged && !drift.apps.length && !drift.pools.length) reasons.push('worker identities changed outside attributed app/pool groups');
  return reasons.length ? reasons.join('; ') : 'Identity details do not locate the strict inventory change';
}
