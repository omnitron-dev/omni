import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostStorageResource, HostStorageSnapshot } from '../shared/dto/system-info.js';

interface Mirror {
  key: string;
  members: number;
}
export interface StorageSubject {
  key: string;
  name: string;
  detail: string;
  mirrors: Mirror[];
}
interface ObservedResource extends HostStorageResource, StorageSubject {
  identifiable: boolean;
  /** Number of configured devices on a redundant RAID1 array, also retained during degradation. */
  mirrorSize: number | null;
}
export interface StorageObservation extends HostStorageSnapshot {
  resources: ObservedResource[];
}

const mdName = /^md(?:_?d)?\d+$/;
const namespaceName = /^nvme\d+(?:c\d+)?n\d+$/;
const controllerName = /^nvme\d+$/;
const memberName = /^dev-([a-zA-Z0-9_.!-]{1,128})$/;
const controllerStates = new Set(['new', 'live', 'resetting', 'connecting', 'deleting', 'deleting (no IO)', 'dead']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function entries(path: string) {
  try {
    return (await readdir(path)).sort();
  } catch {
    return null;
  }
}
async function field(path: string) {
  try {
    return (await readFile(path, { encoding: 'utf8', signal: AbortSignal.timeout(1_500) })).trim();
  } catch {
    return null;
  }
}
function count(value: string | null): number | null {
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}
function token(value: string | null) {
  return value && /^[a-z0-9_-]{1,32}$/.test(value) ? value : null;
}
function privateKey(kind: string, identity: string) {
  return `${kind}/${createHash('sha256').update(identity).digest('hex')}`;
}
function usableUuid(value: string | null): value is string {
  return !!value && uuid.test(value) && /[1-9a-f]/i.test(value);
}

async function identity(kind: string, name: string, stable: string | null, path: string, boot: string | null) {
  // Old sysfs ABIs may provide only the kernel name. The boot and sysfs object together can identify
  // that attachment until hot removal. Without either form of identity a reused name cannot confirm repair.
  const inode =
    !stable && usableUuid(boot)
      ? await stat(path, { bigint: true }).then(
          (s) => String(s.ino),
          () => null
        )
      : null;
  return {
    key: privateKey(kind, stable ?? (inode ? `${boot}/${inode}` : `unidentified/${name}`)),
    identifiable: !!stable || !!inode,
  };
}

async function readArray(root: string, name: string, boot: string | null) {
  const dir = join(root, 'block', name, 'md');
  const [paths, rawLevel, rawMissing, rawExpected, rawAction, rawState, id] = await Promise.all([
    entries(dir),
    ...['level', 'degraded', 'raid_disks', 'sync_action', 'array_state', 'uuid'].map((f) => field(join(dir, f))),
  ] as const);
  const level = token(rawLevel ?? null);
  const missing = count(rawMissing ?? null);
  const expected = count(rawExpected ?? null);
  const action = token(rawAction ?? null);
  const state = token(rawState ?? null);
  const members = await Promise.all(
    (paths ?? [])
      .filter((p) => memberName.test(p))
      .map(async (p) => {
        const text = await field(join(dir, p, 'state'));
        const states = text?.split(',').map((s) => token(s.trim()));
        return { name: p.slice(4), states: states?.length && states.every((s): s is string => !!s) ? states : null };
      })
  );
  const synced = members.filter((m) => m.states?.includes('in_sync')).length;
  const fault = members.some((m) => m.states?.some((s) => s === 'faulty' || s === 'blocked'));
  const measured =
    paths !== null &&
    level !== null &&
    missing === 0 &&
    expected !== null &&
    expected > 0 &&
    (level !== 'raid1' || expected >= 2) &&
    members.every((m) => m.states !== null) &&
    synced >= expected &&
    ['clean', 'active', 'active-idle', 'readonly', 'read-auto'].includes(state ?? '') &&
    (action === 'idle' || action === 'check');
  const health = (missing !== null && missing > 0) || fault ? 'degraded' : measured ? 'healthy' : 'unknown';
  const knownMembers = paths !== null && members.every((m) => m.states !== null);
  const detail = [
    level ?? 'level unknown',
    `degraded=${missing ?? '?'}`,
    `in_sync=${knownMembers ? synced : '?'}/${expected ?? '?'}`,
    `array_state=${state ?? '?'}`,
    `sync_action=${action ?? '?'}`,
    ...members.map((m) => `${m.name}=${m.states?.join(',') ?? '?'}`),
  ].join(' ');
  const resource: ObservedResource = {
    kind: 'array',
    ...(await identity('md', name, usableUuid(id ?? null) ? id! : null, dir, boot)),
    name,
    health,
    detail,
    mirrorSize: level === 'raid1' && expected !== null && expected >= 2 ? expected : null,
    mirrors: [],
  };
  return { resource, members };
}

async function readController(root: string, name: string, boot: string | null) {
  const dir = join(root, 'class', 'nvme', name);
  const [raw, transport, address, children] = await Promise.all([
    field(join(dir, 'state')),
    field(join(dir, 'transport')),
    field(join(dir, 'address')),
    entries(dir),
  ]);
  const state = controllerStates.has(raw ?? '') ? raw : null;
  // A PCI slot survives a controller renumber or a physical replacement. Fabric addresses can contain host identities.
  const slot =
    transport === 'pcie' && address && /^[\da-f]{4}:[\da-f]{2}:[\da-f]{2}\.\d$/i.test(address) ? address : null;
  const resource: ObservedResource = {
    kind: 'controller',
    ...(await identity('nvme', name, slot, dir, boot)),
    name,
    health: state === 'dead' ? 'degraded' : state === 'live' ? 'healthy' : 'unknown',
    detail: `state=${state ?? 'unknown'}`,
    mirrors: [],
    mirrorSize: null,
  };
  // With native multipath the first number is the subsystem instance. The controller's sysfs children identify its paths.
  const namespaces = (children ?? []).filter((p) => namespaceName.test(p));
  return { resource, namespaces, slot };
}

/** Fixed read-only sysfs files. The root and platform are local seams for synthetic fixtures. */
export async function readHostStorage(
  root = '/sys',
  platform: NodeJS.Platform = process.platform,
  procRoot = '/proc'
): Promise<StorageObservation> {
  if (platform !== 'linux') return { status: 'unsupported', issues: ['Linux sysfs is required'], resources: [] };
  const [block, controllersList, boot] = await Promise.all([
    entries(join(root, 'block')),
    readdir(join(root, 'class', 'nvme')).then(
      (names) => names.sort(),
      async (e: NodeJS.ErrnoException) =>
        e.code === 'ENOENT' && (await entries(join(root, 'class'))) !== null ? [] : null
    ),
    field(join(procRoot, 'sys/kernel/random/boot_id')),
  ]);
  const [arrays, controllers] = await Promise.all([
    Promise.all((block ?? []).filter((n) => mdName.test(n)).map((n) => readArray(root, n, boot))),
    Promise.all(
      (controllersList ?? []).filter((n) => controllerName.test(n)).map((n) => readController(root, n, boot))
    ),
  ]);
  const issues: string[] = [];
  if (block === null) issues.push('Block device inventory unavailable');
  if (controllersList === null || (!controllers.length && block?.some((n) => namespaceName.test(n))))
    issues.push('NVMe controller inventory unavailable');
  const mirrors = new Map<string, Mirror[]>();
  for (const { resource, members } of arrays) {
    if (resource.health !== 'degraded' || !resource.mirrorSize) continue;
    const info = { key: resource.key, members: resource.mirrorSize };
    resource.mirrors.push(info);
    for (const member of members) {
      const disk = member.name.replace(/p\d+$/, '');
      if (namespaceName.test(disk)) mirrors.set(disk, [...(mirrors.get(disk) ?? []), info]);
    }
  }
  for (const controller of controllers) {
    for (const path of controller.namespaces) {
      controller.resource.mirrors.push(...(mirrors.get(path.replace(/c\d+n/, 'n')) ?? []));
    }
  }
  const namespaces = await Promise.all(
    (block ?? [])
      .filter((n) => namespaceName.test(n))
      .map(async (name) => {
        const dir = join(root, 'block', name);
        const [size, nsid, id] = await Promise.all(['size', 'nsid', 'uuid'].map((f) => field(join(dir, f))));
        const sectors = count(size ?? null);
        const controller = controllers.find((c) => c.namespaces.includes(name));
        const stable =
          controller?.slot && count(nsid ?? null) !== null
            ? `${controller.slot}/${nsid}`
            : usableUuid(id ?? null)
              ? id!
              : null;
        const resource: ObservedResource = {
          kind: 'namespace',
          ...(await identity('block', name, stable, dir, boot)),
          name,
          health: sectors === 0 ? 'degraded' : sectors === null ? 'unknown' : 'healthy',
          detail: `sectors=${sectors ?? 'unknown'}`,
          mirrors: mirrors.get(name.replace(/c\d+n/, 'n')) ?? [],
          mirrorSize: null,
        };
        return resource;
      })
  );
  const resources = [...arrays.map((a) => a.resource), ...controllers.map((c) => c.resource), ...namespaces];
  const status = resources.some((r) => r.health === 'degraded')
    ? 'degraded'
    : issues.length || resources.some((r) => r.health === 'unknown')
      ? 'unknown'
      : resources.length
        ? 'healthy'
        : 'not-applicable';
  return { status, resources, issues };
}

/** Only device aliases, states and counts cross the authenticated system snapshot boundary. */
export function storageSnapshot(observation: StorageObservation): HostStorageSnapshot {
  return {
    status: observation.status,
    issues: observation.issues,
    resources: observation.resources.map(({ kind, name, health, detail }) => ({ kind, name, health, detail })),
  };
}

/** Reconcile the outstanding fault subjects using this observation and the evidence persisted in the firing event. */
export function storageDecision(observation: StorageObservation, previous: StorageSubject[]) {
  const subjects: StorageSubject[] = [];
  const evidence: string[] = [];
  const restored: string[] = [];
  const current = new Map(observation.resources.map((r) => [r.key, r]));
  const keys = new Set([
    ...previous.map((p) => p.key),
    ...observation.resources.filter((r) => r.health === 'degraded').map((r) => r.key),
  ]);
  for (const key of keys) {
    const prior = previous.find((p) => p.key === key);
    const reading = current.get(key);
    const mirrors = new Map<string, number>();
    for (const m of [...(prior?.mirrors ?? []), ...(reading?.mirrors ?? [])])
      mirrors.set(m.key, Math.max(mirrors.get(m.key) ?? 0, m.members));
    const restoredMirrors =
      mirrors.size > 0 &&
      [...mirrors].every(([id, expected]) => {
        const array = current.get(id);
        return array?.health === 'healthy' && array.identifiable && (array.mirrorSize ?? 0) >= expected;
      });
    // Loss of the old device is only explained by fully restored redundancy on every associated mirror.
    // A still-visible fault, an unreadable device, or a mirror reduced to one member cannot settle it.
    if (
      reading?.health === 'healthy' &&
      (reading.identifiable || restoredMirrors) &&
      (reading.kind !== 'array' || !mirrors.size || restoredMirrors)
    ) {
      restored.push(`${reading.name} ${reading.detail}`);
      continue;
    }
    if (!reading && restoredMirrors && !observation.issues.length) {
      restored.push(
        `${prior!.name} replaced in ${[...mirrors.keys()].map((k) => current.get(k)!.name).join(', ')}; mirrors fully synchronized`
      );
      continue;
    }
    const name = reading?.name ?? prior!.name;
    const detail = reading?.health === 'degraded' ? reading.detail : prior!.detail;
    subjects.push({
      key,
      name,
      detail,
      mirrors: [...mirrors].sort(([a], [b]) => a.localeCompare(b)).map(([id, members]) => ({ key: id, members })),
    });
    evidence.push(
      reading?.health === 'degraded'
        ? `${name} ${detail}`
        : `${name} ${reading?.detail ?? 'missing'} (restoration unconfirmed, last fault: ${detail})`
    );
  }
  // A successful read of the remaining devices cannot establish which other devices an unreadable inventory omitted.
  if (!subjects.length && previous.length && observation.issues.length) {
    return {
      subjects: previous,
      value: [
        `Restoration unconfirmed (${observation.issues.join(', ')})`,
        ...previous.map((s) => `${s.name} last fault: ${s.detail}`),
      ].join(' · '),
      restored: [],
      firing: true,
    };
  }
  return { subjects, value: evidence.join(' · '), restored, firing: subjects.length > 0 };
}
