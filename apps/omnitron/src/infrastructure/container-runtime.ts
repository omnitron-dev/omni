/**
 * Container Runtime — Docker operations via @xec-sh/core DockerAdapter
 *
 * Uses xec's DockerAdapter for all container lifecycle management.
 * The adapter uses child_process.spawn with array-based arguments (no shell),
 * which correctly handles arguments with spaces (e.g., health check commands).
 *
 * All Omnitron-managed containers are labeled with `omnitron.managed=true`.
 */

import { createHash, randomUUID } from 'node:crypto';
import { LONG_REQUEST_TIMEOUT } from '../shared/dto/services.js';
import { CONFIG_ROOT_PREFIX } from './shipped-config.js';
import { nativeHealthCheck } from './health-recovery.js';
import type { CredentialVolumeState } from './service-credentials.js';
import { DEFAULT_PORT_BIND_HOST } from './types.js';
import type { ContainerState, ContainerStatus, ContainerSpecHashMigration, ReconcileAction, ResolvedContainer } from './types.js';

type NativeResources = NonNullable<ContainerState['resources']>;

// Docker RAMInBytes units are binary, case insensitive, with optional b/ib.
// Normalize once so argv, desired identity and native inspection agree.
function memoryBytes(value: unknown, field: string): number {
  if (typeof value !== 'string') throw new Error(`${field} must be a Docker memory size`);
  const match = /^(\d+(?:\.\d*)?|\.\d+) ?(b|[kmgtp](?:i?b)?)?$/i.exec(value);
  if (!match) throw new Error(`${field} must be a non-negative Docker memory size`);
  const unit = match[2]?.[0]?.toLowerCase();
  const power = unit && unit !== 'b' ? 'kmgtp'.indexOf(unit) + 1 : 0;
  const bytes = Math.trunc(Number(match[1]) * (power > 0 ? 1024 ** power : 1));
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`${field} exceeds exact byte representation`);
  return bytes;
}

/** Pure validation: called before network, volume, image or container mutations. */
export function containerResources(config: ResolvedContainer): Partial<NativeResources> {
  const limits = config.resources;
  if (limits !== undefined && (limits === null || typeof limits !== 'object' || Array.isArray(limits)))
    throw new Error('resources must be an object');
  const out: Partial<NativeResources> = {};
  if (limits?.memory !== undefined) out.memoryBytes = memoryBytes(limits.memory, 'resources.memory');
  if (limits?.memoryReservation !== undefined) out.memoryReservationBytes = memoryBytes(limits.memoryReservation, 'resources.memoryReservation');
  if (limits?.cpus !== undefined) {
    if (typeof limits.cpus !== 'number' || !Number.isFinite(limits.cpus) || limits.cpus < 0)
      throw new Error('resources.cpus must be finite and non-negative');
    // Docker parses the decimal spelling as an exact rational, not float * 1e9.
    const [coefficient, exponent = '0'] = String(limits.cpus).toLowerCase().split('e');
    const [whole, fraction = ''] = coefficient!.split('.');
    const digits = BigInt(whole! + fraction), scale = 9 + Number(exponent) - fraction.length;
    const divisor = scale < 0 ? 10n ** BigInt(-scale) : 1n;
    const nano = scale < 0 ? digits / divisor : digits * 10n ** BigInt(scale);
    if (digits % divisor !== 0n || nano > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('resources.cpus must be exactly representable in nano CPUs');
    out.nanoCpus = Number(nano);
  }
  // Validate both declarations, preserving the existing top-level override.
  const nested = limits?.shmSize === undefined ? undefined : memoryBytes(limits.shmSize, 'resources.shmSize');
  const shm = config.shmSize === undefined ? nested : memoryBytes(config.shmSize, 'shmSize');
  if (shm !== undefined) {
    out.shmBytes = shm;
  }
  for (const value of [out.memoryBytes, out.memoryReservationBytes]) {
    if (value !== undefined && value > 0 && value < 6 * 1024 ** 2) throw new Error('Positive memory limits require at least 6 MiB');
  }
  if (out.memoryBytes && out.memoryReservationBytes !== undefined && out.memoryReservationBytes > out.memoryBytes)
    throw new Error('resources.memoryReservation cannot exceed resources.memory');
  return out;
}

function resourceArgs(resources: Partial<NativeResources>): string[] {
  const args: string[] = [];
  if (resources.memoryBytes !== undefined) args.push('--memory', String(resources.memoryBytes));
  if (resources.memoryReservationBytes !== undefined) args.push('--memory-reservation', String(resources.memoryReservationBytes));
  if (resources.nanoCpus !== undefined) {
    const nano = BigInt(resources.nanoCpus);
    args.push('--cpus', `${nano / 1_000_000_000n}.${String(nano % 1_000_000_000n).padStart(9, '0')}`);
  }
  if (resources.shmBytes !== undefined) args.push('--shm-size', String(resources.shmBytes));
  return args;
}

function observedResources(info: { HostConfig?: Record<string, unknown> }): NativeResources | undefined {
  const h = info.HostConfig;
  if (!h || ![h['Memory'], h['MemoryReservation'], h['NanoCpus'], h['ShmSize'], h['CpuPeriod']].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) ||
      typeof h['CpuQuota'] !== 'number' || !Number.isSafeInteger(h['CpuQuota'])) return undefined;
  return { memoryBytes: h['Memory'] as number, memoryReservationBytes: h['MemoryReservation'] as number,
    nanoCpus: h['NanoCpus'] as number, shmBytes: h['ShmSize'] as number, cpuQuota: h['CpuQuota'], cpuPeriod: h['CpuPeriod'] as number };
}

/** Labels record intent; Docker HostConfig records the actual enforced limits. */
export function containerResourcesMatch(config: ResolvedContainer, actual: ContainerState): boolean {
  return Object.entries(containerResources(config)).every(([key, value]) => {
    // Zero shm asks Docker for its daemon-configurable default, not a zero-byte mount.
    if (key === 'shmBytes' && value === 0) return actual.resources !== undefined;
    if (key === 'nanoCpus' && (actual.resources?.cpuQuota === undefined || actual.resources.cpuQuota > 0)) return false;
    return actual.resources?.[key as keyof NativeResources] === value;
  });
}

/** Label carrying the desired-spec fingerprint, used for config-drift detection. */
export const SPEC_HASH_LABEL = 'omnitron.spec-hash';
export const SPEC_HASH_SCHEMA_LABEL = 'omnitron.spec-hash-schema';

/**
 * Stable fingerprint of a container's *desired* spec. Covers the fields that a
 * config edit can change and that require a recreate to apply (image, env,
 * ports, volumes, command/entrypoint, extraHosts). Deliberately EXCLUDES
 * labels — the spec-hash label is derived from this, and docker-compose adds
 * label noise — so the hash is stable across recreations of an unchanged spec.
 *
 * Stamped as a label at create time and compared on reconcile so that an env
 * change (e.g. the Tor hidden-service target) triggers a recreate instead of
 * being silently ignored because the image is unchanged.
 */
export function containerSpecHash(config: ResolvedContainer): string {
  return specificationHash(config, 2);
}

/** Schema 1 omitted enforced resources. Its use is restricted to verified metadata migration. */
function specificationHash(config: ResolvedContainer, schema: 1 | 2): string {
  const resources = containerResources(config);
  const sortedEnv = Object.keys(config.environment)
    .sort()
    .map((k) => [k, config.environment[k]]);
  const normalized = JSON.stringify({
    image: config.image,
    env: sortedEnv,
    // `bindHost` is part of what a port IS. Without it, changing a container
    // from every-interface to loopback leaves the hash identical and the
    // container published exactly as before.
    ports: [...config.ports]
      .map((p) => ({ h: p.host, c: p.container, b: p.bindHost ?? null }))
      .sort((a, b) => a.h - b.h || a.c - b.c),
    volumes: [...config.volumes]
      .map((v) => ({ s: v.source, t: v.target, ro: !!v.readonly }))
      .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)),
    command: config.command ?? null,
    entrypoint: config.entrypoint ?? null,
    extraHosts: [...(config.extraHosts ?? [])].sort(),
    // A health check is baked into the container at creation: docker reads
    // `HEALTHCHECK` once and never again. Leaving it out of the hash means a
    // corrected check never reaches anything already running — the fix lands
    // in the code, the reconciler sees no difference, and the container goes
    // on answering the old question forever.
    //
    // Measured: the gateway's probe was corrected from `curl` (absent from
    // its image) to one that also tries wget, the node was reprovisioned,
    // and the container kept the curl-only check and kept reporting
    // unhealthy.
    healthCheck: config.healthCheck ?? null,
    // The network a container is on is not a detail of how it runs but of
    // what it can reach. A service moved between networks and not recreated
    // is on the old one, and its name resolves for nobody.
    network: config.network ?? null,
    restart: config.restart,
    ...(schema === 2 && Object.keys(resources).length ? { resources } : {}),
    // What the mounted config files SAY, which the volume paths above cannot:
    // an nginx.conf rewritten in place has the same path. Only when present,
    // so a container with no config files keeps the hash it was created
    // with and an upgrade of omnitron recreates nothing on its account.
    ...(config.configDigest ? { configDigest: config.configDigest } : {}),
  });
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

/** Revalidate a recorded migration against the current desired spec and native observation. */
export function containerSpecHashMatches(config: ResolvedContainer, actual: ContainerState,
  migration?: ContainerSpecHashMigration): boolean {
  const schema = actual.labels?.[SPEC_HASH_SCHEMA_LABEL];
  if (schema !== undefined && schema !== '1' && schema !== '2') return false;
  const current = containerSpecHash(config);
  if (actual.specHash === current && schema !== '1') return true;
  return Boolean(migration && migration.fromSchema === 1 && migration.toSchema === 2 && schema !== '2' &&
    migration.containerId === actual.containerId && /^[a-f0-9]{64}$/.test(migration.containerId) &&
    migration.fromHash === actual.specHash && migration.fromHash === specificationHash(config, 1) &&
    migration.toHash === current && containerResourcesMatch(config, actual) &&
    Object.entries(config.labels).every(([key, value]) => actual.labels?.[key] === value));
}

/** A legacy spec binds the static settings and omits the native resource limits. */
export function hasLegacyContainerSpec(config: ResolvedContainer, actual: ContainerState): boolean {
  const schema = actual.labels?.[SPEC_HASH_SCHEMA_LABEL];
  return (schema === undefined || schema === '1') && actual.specHash === specificationHash(config, 1) &&
    Boolean(actual.containerId && /^[a-f0-9]{64}$/.test(actual.containerId)) &&
    Object.entries(config.labels).every(([key, value]) => actual.labels?.[key] === value);
}

/** One decision for inspection, startup and repair. Callers check native ownership before any effect. */
export function planContainerAction(desired: ResolvedContainer, actual: ContainerState | null,
  migration?: ContainerSpecHashMigration): ReconcileAction {
  containerResources(desired);
  const service = desired.name;
  const recreate = (reason: string): ReconcileAction => ({ type: 'recreate', service, config: desired, reason });
  if (!actual) return { type: 'create', service, config: desired };
  if (!containerResourcesMatch(desired, actual)) return recreate('resource limits differ from Docker inspection');
  const running = actual.status === 'running';
  if (!running && actual.status !== 'created' && actual.status !== 'exited') return recreate('status: ' + actual.status);
  if (running && actual.networkAttached === false) return recreate('network-detached (running but on no network)');
  if (actual.image !== desired.image)
    return recreate(`image changed${running ? '' : ' while stopped'}: ${actual.image} → ${desired.image}`);
  if (!actual.specHash) return recreate('native specification receipt is missing');
  if (!containerSpecHashMatches(desired, actual, migration))
    return recreate(`config drift${running ? '' : ' while ' + actual.status} (spec ${actual.specHash} → ${containerSpecHash(desired)})`);
  return running ? { type: 'noop', service } : { type: 'start', service, containerId: actual.containerId ?? service };
}

/** Bind the migrated observation to the exact container recorded by its owner. */
export function migrateContainerSpecHash(config: ResolvedContainer, actual: ContainerState,
  previous: ContainerState | undefined): ContainerSpecHashMigration | undefined {
  if (containerSpecHashMatches(config, actual)) return undefined;
  if (containerSpecHashMatches(config, actual, previous?.specHashMigration)) return previous?.specHashMigration;
  const id = actual.containerId, prior = previous?.containerId;
  if (!id || !/^[a-f0-9]{64}$/.test(id) || !prior || !actual.specHash ||
      (prior.length === 12 ? !id.startsWith(prior) : prior !== id) || previous?.specHash !== actual.specHash ||
      !hasLegacyContainerSpec(config, actual) || !containerResourcesMatch(config, actual)) return undefined;
  return { fromSchema: 1, toSchema: 2, fromHash: actual.specHash, toHash: containerSpecHash(config), containerId: id };
}

// =============================================================================
// Singleton DockerAdapter (lazy-loaded, self-healing)
// =============================================================================

let _adapter: any = null;

async function getAdapter(): Promise<any> {
  if (_adapter) return _adapter;
  const { DockerAdapter } = await import('@xec-sh/core');
  _adapter = new DockerAdapter();
  return _adapter;
}

/**
 * Patterns that mean "the docker daemon connection is gone" rather than
 * "this specific operation failed". When we see one, we invalidate the
 * cached adapter so the next call gets a fresh instance — without this,
 * a docker-daemon restart would leave us forever trying to talk to a
 * dead socket.
 */
const ADAPTER_DEAD_PATTERNS =
  /(?:cannot connect to the docker daemon|docker daemon is not running|connect ENOENT|connect ECONNREFUSED.*docker|EOF$|connection reset)/i;

function isAdapterDeadError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return ADAPTER_DEAD_PATTERNS.test(msg);
}

/**
 * Run `op` against the docker adapter. If it fails with an error that
 * indicates the daemon connection is dead, invalidate the cached adapter
 * and retry exactly once with a fresh one — recovering automatically
 * from docker daemon restarts.
 */
async function withAdapter<T>(op: (adapter: any) => Promise<T>): Promise<T> {
  const adapter = await getAdapter();
  try {
    return await op(adapter);
  } catch (err) {
    if (!isAdapterDeadError(err)) throw err;
    _adapter = null;
    const fresh = await getAdapter();
    return await op(fresh);
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * How many containers this host's Docker holds, by state — every container,
 * not only omnitron's.
 *
 * One `docker ps`, the CLI the rest of this file speaks, with a timeout that
 * ends it. The system snapshot asked Docker through systeminformation's
 * socket client instead, which sends `GET /info HTTP/1.0` and waits for the
 * connection to close; OrbStack answers `HTTP/1.1 200` and keeps it open, so
 * every question hung until the library's own timeout — measured 2026-09-23:
 * no answer in 20 s where `curl` on the same socket took 0.055 s — and left
 * its socket open behind it.
 */
export async function countContainersByState(
  timeoutMs = 10_000
): Promise<{ running: number; paused: number; stopped: number }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('docker', ['ps', '-a', '--format', '{{.State}}'], {
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
  const counts = { running: 0, paused: 0, stopped: 0 };
  for (const state of String(stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)) {
    if (state === 'running') counts.running++;
    else if (state === 'paused') counts.paused++;
    else counts.stopped++;
  }
  return counts;
}

/**
 * Check if Docker daemon is available.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    return await withAdapter((adapter) => adapter.isAvailable());
  } catch {
    return false;
  }
}

/** Read ownership without locking each container for a full native inspection. */
async function managedContainerInventory(expected?: ReadonlySet<string>, scope?: { project: string; stack: string }): Promise<Array<{ id: string; name: string }>> {
  const format = '{"id":{{json .ID}},"name":{{json .Names}},"managed":{{json (.Label "omnitron.managed")}},"project":{{json (.Label "omnitron.project")}},"stack":{{json (.Label "omnitron.stack")}}}';
  const args = ['ps', '-a', '--no-trunc', '--format', format];
  // An expected name can be occupied by an unmanaged container. Include it in the ownership check.
  if (!expected?.size) {
    args.push('--filter', 'label=omnitron.managed=true');
    if (scope) args.push('--filter', 'label=omnitron.project=' + scope.project, '--filter', 'label=omnitron.stack=' + scope.stack);
  }
  const { stdout } = await executeDocker(args, { maxBuffer: 32 * 1024 * 1024 });
  const entries: Array<{ id: string; name: string }> = [];
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const entry = JSON.parse(line);
    if (typeof entry?.name !== 'string' || !entry.name || typeof entry.id !== 'string' || !/^[a-f0-9]{64}$/.test(entry.id))
      throw Error('Container inventory has no immutable identity');
    if (entry.managed !== 'true') {
      if (expected?.has(entry.name)) throw Error('A declared container name is occupied by an unmanaged container');
    } else if (scope && (entry.project !== scope.project || entry.stack !== scope.stack)) {
      if (expected?.has(entry.name)) throw Error(`Container '${entry.name}' belongs to another allocation`);
    } else {
      entries.push({ id: entry.id, name: entry.name });
    }
  }
  return entries;
}

/**
 * List all Omnitron-managed containers.
 *
 * `[]` when Docker cannot be asked, which is right for a listing and wrong for
 * a health check: «nothing is running» and «Docker did not answer» are
 * different states. `orThrow` keeps them apart.
 */
export async function listManagedContainers(options: { orThrow?: boolean; checkNames?: ReadonlySet<string> } = {}): Promise<ContainerState[]> {
  try {
    const ownership = await managedContainerInventory(options.checkNames);
    if (!ownership.length) return [];
    const inspected = await inspectContainers(ownership.map(container => container.id), options.orThrow);
    if (options.orThrow) {
      const names = new Map(inspected.map(container => [container.Id, container.Name]));
      if (ownership.some(container => names.get(container.id) !== '/' + container.name))
        throw Error('Container inventory changed during native inspection');
    }

    const managed: ContainerState[] = [];
    for (const info of inspected) {
      if (info?.Config?.Labels?.['omnitron.managed'] !== 'true') {
        if (options.checkNames?.has((info?.Name ?? '').replace(/^\//, ''))) throw new Error('A declared container name is occupied by an unmanaged container');
        continue;
      }
      const failure = describeContainerFailure(info.State);
      managed.push({
        name: (info.Name ?? '').replace(/^\//, ''),
        image: info.Config?.Image ?? '',
        status: mapInspectStatus(info.State?.Status),
        containerId: info.Id,
        specHash: info.Config?.Labels?.[SPEC_HASH_LABEL],
        labels: info.Config?.Labels,
        health: mapInspectHealth(info.State?.Health?.Status, info.State?.Status),
        healthCheck: nativeHealthCheck(info.State?.Health),
        startedAt: info.State?.StartedAt,
        ports: publishedPorts(info),
        resources: observedResources(info),
        service: info.Config?.Labels?.['omnitron.service'],
        project: info.Config?.Labels?.['omnitron.project'],
        stack: info.Config?.Labels?.['omnitron.stack'],
        app: info.Config?.Labels?.['omnitron.app'],
        ...(failure && { error: failure }),
      });
    }

    return managed;
  } catch (err) {
    if (options.orThrow) throw err;
    return [];
  }
}

/** Native IDs are the authority for destructive operations. Never follow a reused name. */
export async function inspectStackContainers(scope: { project: string; stack: string }, names: readonly string[] = []) {
  const owned = await managedContainerInventory(new Set(names), scope);
  return owned.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Published ports, as `"80/tcp" -> 9800`.
 *
 * `ContainerState.ports` was declared, documented as a name→port map, and
 * assigned by nothing — so the console's Ports column showed `--` for every
 * container on a host where all twelve publish ports. The data was already in
 * hand: `docker inspect` returns it, and this reads it out of the response
 * both call sites already have.
 *
 * The keys are container ports rather than the logical names a service config
 * uses (`main`, `rpc`), because that is what Docker knows. A container that
 * exposes a port without publishing it has a null binding and is left out —
 * it is not reachable from the host, so listing it would overstate what is
 * available.
 */
function publishedPorts(info: {
  NetworkSettings?: { Ports?: Record<string, Array<{ HostPort?: string }> | null> };
}): Record<string, number> | undefined {
  const raw = info.NetworkSettings?.Ports;
  if (!raw) return undefined;

  const out: Record<string, number> = {};
  for (const [containerPort, bindings] of Object.entries(raw)) {
    // Docker lists both the IPv4 and IPv6 binding for the same publish; they
    // carry the same host port, so the first usable one is the answer.
    const hostPort = bindings?.find((b) => b?.HostPort)?.HostPort;
    if (!hostPort) continue;
    const port = Number(hostPort);
    if (Number.isInteger(port) && port > 0) out[containerPort] = port;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Inspect many containers in one call.
 *
 * `docker inspect` takes any number of names and returns a JSON array. Names
 * that no longer exist are reported on stderr and simply absent from the
 * array — which is the behaviour wanted here, since a container can be
 * removed between listing and inspecting.
 */
async function inspectContainers(names: string[], strict = false): Promise<any[]> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync('docker', ['inspect', ...names], {
      timeout: 15_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (strict) throw err;
    // A non-zero exit means SOME name was unknown; docker still prints the
    // ones it found, so the output is worth parsing rather than discarding.
    const stdout = (err as { stdout?: string }).stdout;
    if (!stdout) return [];
    try {
      const parsed = JSON.parse(stdout);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

type NativePortBindings = Record<string, Array<{ HostPort?: string; HostIp?: string }> | null>;

// Creation needs identity, bindings and enforced limits. Keep environment,
// command lines and health-check output outside this structured response.
const creationInspectFormat = (mounts: boolean) => `[{
  "Id":{{json .Id}},"Name":{{json .Name}},
  "Config":{"Image":{{json .Config.Image}},"Labels":{{json .Config.Labels}}},
  ${mounts ? '"Mounts":[{{range $i, $m := .Mounts}}{{if $i}},{{end}}{"Source":{{json $m.Source}},"Destination":{{json $m.Destination}},"RW":{{json $m.RW}}}{{end}}],' : ''}
  "State":{"Status":{{json .State.Status}}},
  "HostConfig":{"PortBindings":{{json .HostConfig.PortBindings}},
    "Memory":{{json .HostConfig.Memory}},"MemoryReservation":{{json .HostConfig.MemoryReservation}},
    "NanoCpus":{{json .HostConfig.NanoCpus}},"ShmSize":{{json .HostConfig.ShmSize}},
    "CpuPeriod":{{json .HostConfig.CpuPeriod}},"CpuQuota":{{json .HostConfig.CpuQuota}}},
  "NetworkSettings":{"Ports":{{json .NetworkSettings.Ports}}}
}]`;

interface NativeContainerObservation {
  Id?: string;
  Name?: string;
  Config?: { Image?: string; Labels?: Record<string, string> };
  State?: { Status?: string; StartedAt?: string; ExitCode?: number; Error?: string; OOMKilled?: boolean;
    Health?: { Status?: string; Log?: unknown[] } };
  HostConfig?: Record<string, unknown> & { PortBindings?: NativePortBindings };
  NetworkSettings?: { Networks?: Record<string, unknown>; Ports?: NativePortBindings };
  Mounts?: Array<{ Source: string; Destination: string; Type?: string; Name?: string; RW?: boolean }>;
}

/** Project the same native observation for one container and for a complete inventory. */
export function containerObservation(info: NativeContainerObservation, name: string, fullId: boolean): ContainerState {
  // Network attachment: an OrbStack/dockerd restart can leave a container
  // 'running' but detached from every network (empty Networks) with its
  // published ports gone — reachable by nothing. Surface it so callers can
  // recreate instead of trusting the 'running' status.
  const networkAttached = Object.keys(info.NetworkSettings?.Networks ?? {}).length > 0;
  const failure = describeContainerFailure(info.State);
  const bindings = info.NetworkSettings?.Ports;
  return {
    name: (info.Name ?? name).replace(/^\//, ''),
    image: info.Config?.Image ?? '',
    status: mapInspectStatus(info.State?.Status),
    containerId: fullId ? info.Id : info.Id?.slice(0, 12),
    health: mapInspectHealth(info.State?.Health?.Status, info.State?.Status),
    healthCheck: nativeHealthCheck(info.State?.Health),
    startedAt: info.State?.StartedAt,
    ports: publishedPorts(info),
    ...(fullId && bindings && { portBindings: Object.fromEntries(Object.entries(bindings).map(([key, values]) =>
      [key, (values ?? []).flatMap(({ HostIp, HostPort }) => {
        const port = Number(HostPort);
        return HostIp && Number.isInteger(port) && port > 0 && port <= 65535 ? [{ address: HostIp, port }] : [];
      })])) }),
    resources: observedResources(info),
    specHash: info.Config?.Labels?.[SPEC_HASH_LABEL],
    labels: info.Config?.Labels,
    ...(info.Mounts && { mounts: info.Mounts.map(mount => ({
      source: mount.Source,
      target: mount.Destination,
      ...(typeof mount.RW === 'boolean' && { readOnly: !mount.RW }),
      ...(mount.Type && { type: mount.Type }), ...(mount.Name && { name: mount.Name }),
    })) }),
    service: info.Config?.Labels?.['omnitron.service'],
    networkAttached,
    ...(failure && { error: failure }),
  };
}

/** Native inspection by name or immutable ID. Only a precise Docker absence reply establishes absence. */
async function inspectDockerContainer(ref: string, mounts: boolean, id?: string, timeout?: number) {
  try {
    const result = await executeDocker(['container', 'inspect', '--format', creationInspectFormat(mounts), '--', ref], {
      ...(timeout !== undefined && { timeout }), redactOutput: false,
    });
    let raw: NativeContainerObservation | undefined;
    try { [raw] = JSON.parse(result.stdout) as NativeContainerObservation[]; }
    catch { throw Error('Docker returned invalid container inspection data'); }
    if (!raw?.Id || !/^[a-f0-9]{64}$/.test(raw.Id) || id && raw.Id !== id)
      throw Error('Docker did not confirm the immutable container ID');
    return { ...raw, Id: raw.Id };
  } catch (error) {
    const stderr = (error as { stderr?: string })?.stderr;
    if (definiteDockerFailure(error) && /^(?:Error(?: response from daemon)?:\s*)?no such (?:object|container):\s*(.+)$/i.exec(stderr!.trim())?.[1] === ref)
      return null;
    throw error;
  }
}

export async function reviewedContainerState(ref: string) {
  const byId = /^[a-f0-9]{64}$/.test(ref);
  const raw = await inspectDockerContainer(ref, true, byId ? ref : undefined);
  if (raw && !byId && raw.Name !== '/' + ref) throw Error('Docker did not confirm the reviewed container name');
  return raw ? containerObservation(raw, ref, true) : null;
}

/** The caller records intent before this single request and reconciles its immutable ID after any unknown reply. */
export async function requestReviewedContainerRemoval(id: string): Promise<'issued' | 'refused'> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Reviewed Docker removal requires an immutable container ID');
  try { await executeDocker(['container', 'rm', '--force', '--', id]); }
  catch (error) {
    if (definiteDockerFailure(error) && !/removal.+in progress|marked for removal/i.test((error as { stderr: string }).stderr))
      return 'refused';
  }
  return 'issued';
}

/**
 * Get state of a specific container by name.
 */
export async function getContainerState(name: string, options: { orThrow?: boolean; fullId?: boolean } = {}): Promise<ContainerState | null> {
  try {
    return await withAdapter(async (adapter) => {
      // containerExists deliberately returns false for every inspect failure.
      // Ownership transfer must distinguish confirmed absence from a daemon
      // outage: a successful complete listing proves absence; a listed object
      // that cannot then be inspected is an error, including deletion races.
      const exists = options.orThrow
        ? (await adapter.listContainers(true) as string[]).includes(name)
        : await adapter.containerExists(name);
      if (!exists) return null;

      const info = await adapter.inspectContainer(name);
      return containerObservation(info, name, options.fullId === true);
    });
  } catch (error) {
    if (options.orThrow) throw error;
    return null;
  }
}

/**
 * One `-p` value.
 *
 * `9800:80` publishes on every INTERFACE — Docker's default, and Docker's
 * iptables rules are inserted ahead of the host firewall's, so such a port is
 * reachable from the network no matter what `ufw status` says.
 *
 * An omission therefore used to mean the widest possible answer. This is the
 * single place a published port becomes a docker argument, and it now reads an
 * absent `bindHost` as loopback: a container that must be reachable says so,
 * with `bindHost: '0.0.0.0'`, in a line someone can see in a diff.
 *
 * `applyManagedDefaults` fills the same field in the resolver, and should —
 * that is what puts the binding into `containerSpecHash`, so changing it
 * recreates the container instead of leaving the old one published. But a
 * default that every resolver must remember is a default that one of them
 * will not: `resolveGateway` was the one return of four that did not call it,
 * and the gateway is the container that faces outward. Measured on the dev
 * stand: `sample-dev-gateway` published on 0.0.0.0:80 while the other ten
 * managed containers were all on 127.0.0.1, and a browser on the LAN could
 * sign in. Defence in depth, because the resolver-side default is the one
 * that can be forgotten and this one cannot.
 */
export function portArg(p: { host: number; container: number; bindHost?: string }): string {
  const bindHost = p.bindHost ?? DEFAULT_PORT_BIND_HOST;
  return `${bindHost}:${p.host}:${p.container}`;
}

/**
 * Docker state left over from a container that is gone.
 *
 * An orphaned libnetwork endpoint, or a `Created` husk holding the name.
 * Both are scrubbed and the run retried.
 */
export function isStaleContainerState(message: string): boolean {
  return /endpoint with name .* already exists|is already in use by container/i.test(message);
}

/**
 * A port whose previous holder has not let go yet.
 *
 * `docker rm` returns before the kernel releases the bind its docker-proxy
 * held, so removing a container and immediately recreating it races that
 * release. Measured on a node recreating postgres, redis and minio at once:
 * all three failed this way, each left in `Created`, and `docker start` by
 * hand a second later worked — which is what makes it a race rather than a
 * conflict, and a retry the right answer rather than a louder error.
 *
 * Narrow on purpose. A missing image, a bad flag, or a port genuinely held
 * by something else is permanent, and retrying it turns one clear error into
 * several identical ones separated by delays.
 */
export function isPortNotYetReleased(message: string): boolean {
  return /port is already allocated|failed to set up container networking/i.test(message);
}

/**
 * Which container holds a host port, if any.
 *
 * `port is already allocated` is true and useless: it names the port and
 * withholds the only thing an operator can act on. Measured on a node where
 * three services would not start —
 *
 *     Bind for 127.0.0.1:5432 failed: port is already allocated
 *
 * — and the holder was `omnitron-postgres`, a container from an earlier
 * naming of the same stack that the reconciler had stopped recognising and
 * therefore stopped managing. Nothing in the failure said that, and nothing
 * else would: the reconciler converges the containers it can name, and a
 * container it no longer names is invisible to it while remaining very
 * visible to the kernel.
 *
 * Answers null when nothing holds it, which is its own information: the
 * bind failed for another reason.
 */
export async function containerHoldingPort(hostPort: number): Promise<string | null> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    const { stdout } = await promisify(execFile)('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Ports}}'], {
      encoding: 'utf-8',
      timeout: 20_000,
    });
    for (const line of String(stdout).split('\n')) {
      const [name, ports] = line.split('\t');
      if (!name || !ports) continue;
      // `127.0.0.1:5432->5432/tcp` and `0.0.0.0:5480->5432/tcp`: the host
      // port is the one before the arrow, and it is the one that collides.
      if (new RegExp(`:${hostPort}->`).test(ports)) return name;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Explain a bind failure by naming what is holding the port.
 *
 * Kept separate from the retry because it answers a different question:
 * the retry asks "will this resolve on its own", and this asks "if not,
 * what do I tell the operator".
 */
export async function describeBindFailure(
  config: { name: string; ports: Array<{ host: number; bindHost?: string | undefined }> },
  original: string,
  /** The lookup, as a parameter so this is answerable without a docker. */
  lookup: (hostPort: number) => Promise<string | null> = containerHoldingPort
): Promise<string> {
  for (const port of config.ports) {
    const holder = await lookup(port.host);
    if (!holder || holder === config.name) continue;
    return (
      `${config.name} cannot take ${port.bindHost ?? '0.0.0.0'}:${port.host} — the container ` +
      `\`${holder}\` is holding it. If that is a leftover from an earlier naming of this stack, ` +
      `\`docker rm -f ${holder}\` releases the port and keeps its volume.`
    );
  }
  return original;
}

/**
 * Create and start a container from a resolved config.
 */
export async function createContainer(config: ResolvedContainer, options: { fullId?: boolean; pull?: 'never' } = {}): Promise<string> {
  return provisionContainer(config, options);
}

export class ContainerAllocationRefused extends Error {}
export type PreparedContainerAction =
  | { operation: 'allocate' | 'discover' | 'verify' | 'discard'; creation: string; id?: string }
  | { operation: 'publish'; creation: string; id: string; stagedName: string;
      configure: (running: boolean) => Promise<void>;
      issued: 'allocated' | 'renaming' | 'starting'; record: (effect: 'allocated' | 'renaming' | 'starting') => Promise<void> };

/** Reviewed allocation suspends between native create and start. Every resumed effect uses its original nonce and ID. */
export async function preparedContainer(config: ResolvedContainer, action: PreparedContainerAction): Promise<string> {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(action.creation) ||
      action.id !== undefined && !/^[a-f0-9]{64}$/.test(action.id) ||
      action.operation === 'verify' && !action.id) throw Error('Invalid prepared Docker allocation identity');
  return provisionContainer(config, { fullId: true, pull: 'never' }, action);
}

async function provisionContainer(config: ResolvedContainer, options: { fullId?: boolean; pull?: 'never' }, staged?: PreparedContainerAction): Promise<string> {
  const resources = containerResources(config);
  // Ensure the managed network exists before we try to attach to it.
  // Idempotent — `docker network create` errors with "already exists"
  // when present, which we treat as success. Doing this here (rather
  // than at daemon start) keeps the provisioner self-sufficient and
  // means single-container test setups work without a manual prep step.
  if (config.network && !staged) {
    await ensureNetwork(config.network);
  }

  // Ensure volumes exist. A `configroot:` source is a shipped directory this
  // node has no copy of (`shipped-config.ts`), not a volume to create: it
  // reaches `docker run`, which refuses it by name.
  for (const vol of staged ? [] : config.volumes) {
    if (!vol.source.startsWith('/') && !vol.source.startsWith('.') && !vol.source.startsWith(CONFIG_ROOT_PREFIX)) {
      await createVolume(vol.source);
    }
  }

  // Pull image if not present
  if (options.pull !== 'never') await ensureImage(config.image);

  // Use the local Xec executor with explicit argv. The command can contain
  // credentials in environment, application flags and nested health checks;
  // raw execFile errors would print those arguments before any logger sees them.
  const args: string[] = ['container', 'create', '--name', config.name];
  if (options.pull === 'never') args.push('--pull=never');

  // Network — explicit network avoids the default bridge, which
  // accumulates phantom endpoints after dockerd restarts on macOS and
  // blocks container recreation with "endpoint with name X already
  // exists in network bridge". Falls back to docker's default when
  // unspecified so single-container / no-stack usage still works.
  if (config.network) {
    args.push('--network', config.network);
  }

  for (const p of config.ports) {
    args.push('-p', portArg(p));
  }

  // Environment variables
  for (const [key, value] of Object.entries(config.environment)) {
    args.push('-e', `${key}=${value}`);
  }

  // Volumes
  for (const v of config.volumes) {
    args.push('-v', `${v.source}:${v.target}${v.readonly ? ':ro' : ''}`);
  }

  // Labels — stamp the desired-spec fingerprint so a later reconcile can
  // detect config drift (env/ports/volumes/cmd change under the same image)
  // and recreate instead of silently no-op'ing.
  const creation = staged?.creation ?? randomUUID();
  const labels = { ...(config.labels ?? {}), [SPEC_HASH_LABEL]: containerSpecHash(config),
    [SPEC_HASH_SCHEMA_LABEL]: '2', 'omnitron.creation': creation };
  for (const [key, value] of Object.entries(labels)) {
    args.push('--label', `${key}=${value}`);
  }

  // Restart policy
  if (config.restart && config.restart !== 'no') {
    args.push('--restart', config.restart);
  }

  // Health check
  if (config.healthCheck) {
    const test =
      config.healthCheck.test.length === 2 && config.healthCheck.test[0] === 'CMD-SHELL'
        ? config.healthCheck.test[1]!
        : config.healthCheck.test.filter((t) => t !== 'CMD-SHELL' && t !== 'CMD').join(' ');
    args.push('--health-cmd', test);
    if (config.healthCheck.interval) args.push('--health-interval', config.healthCheck.interval);
    if (config.healthCheck.timeout) args.push('--health-timeout', config.healthCheck.timeout);
    if (config.healthCheck.retries) args.push('--health-retries', String(config.healthCheck.retries));
    if (config.healthCheck.startPeriod) args.push('--health-start-period', config.healthCheck.startPeriod);
  }

  // Extra hosts (e.g., host.docker.internal → host-gateway)
  if (config.extraHosts) {
    for (const entry of config.extraHosts) {
      args.push('--add-host', entry);
    }
  }

  args.push(...resourceArgs(resources));

  // Entrypoint override
  if (config.entrypoint) {
    args.push('--entrypoint', config.entrypoint[0]!);
  }

  // Image + command
  args.push(config.image);
  // If entrypoint has multiple args, append remaining after image
  if (config.entrypoint && config.entrypoint.length > 1) {
    args.push(...config.entrypoint.slice(1));
  }
  if (config.command) {
    args.push(...config.command);
  }

  // A timed-out Docker request can become visible later. Only create is issued before
  // the immutable ID is known, so a late allocation cannot also start serving.
  const deadline = performance.now() + LONG_REQUEST_TIMEOUT;
  const remaining = (phase: string, id?: string, cause?: unknown) => {
    const ms = Math.ceil(deadline - performance.now());
    if (ms <= 0) throw Error(`Docker ${phase} is unconfirmed for ${config.name} (creation ${creation}${id ? ', id ' + id : ''})`, { cause });
    return ms;
  };
  const expectedBindings = config.ports.map(port => `${port.container}/tcp ${port.bindHost ?? DEFAULT_PORT_BIND_HOST} ${port.host}`).sort();
  const publication = (bindings: NativePortBindings | undefined, id: string) => {
    if (!expectedBindings.length) return 'published';
    if (bindings == null) return 'unconfirmed';
    if (typeof bindings !== 'object' || Array.isArray(bindings)) throw Error('Cannot verify native port bindings for ' + id);
    const observed = Object.entries(bindings).flatMap(([port, hosts]) => (hosts ?? []).map(host => `${port} ${host.HostIp} ${host.HostPort}`)).sort();
    if (observed.length === expectedBindings.length && observed.every((entry, index) => entry === expectedBindings[index])) return 'published';
    return observed.length > expectedBindings.length || observed.some(entry => !expectedBindings.includes(entry)) ? 'conflict' : 'pending';
  };
  const inspect = async (id?: string) => {
    // Address an acknowledged allocation by immutable ID. Only after a lost
    // create reply is the name needed to discover that ID.
    const ref = id ?? config.name;
    const raw = await inspectDockerContainer(ref, Boolean(staged), id, remaining('inspection', id));
    if (!raw) return null;
    if ((raw.Name !== '/' + config.name && !(staged?.operation === 'publish' && raw.Name === '/' + staged.stagedName)) ||
        raw.Config?.Labels?.['omnitron.creation'] !== creation)
      throw Error(`Container '${config.name}' belongs to another creation`);
    const actual = containerObservation(raw, ref, true);
    if (actual.specHash !== labels[SPEC_HASH_LABEL]) throw Error('The Docker specification hash differs for ' + raw.Id);
    if (actual.image !== config.image) throw Error('The Docker image differs for ' + raw.Id);
    if (!Object.entries(labels).every(([key, value]) => actual.labels?.[key] === value))
      throw Error('The Docker ownership labels differ for ' + raw.Id);
    if (staged && (!actual.mounts || config.volumes.length !== actual.mounts.length ||
        !config.volumes.every(volume => actual.mounts!.some(mount => mount.source === volume.source &&
          mount.target === volume.target && mount.readOnly === Boolean(volume.readonly)))))
      throw Error('The native mounts differ for the prepared container ' + raw.Id);
    if (staged && !containerResourcesMatch(config, actual)) throw Error('The native resource limits differ for the prepared container ' + raw.Id);
    if ((actual.status === 'created' || actual.status === 'running') && publication(raw.HostConfig?.PortBindings, raw.Id) !== 'published')
      throw Error('The configured Docker port bindings differ for ' + raw.Id);
    return { ...actual, id: raw.Id, publication: actual.status === 'running' ? publication(raw.NetworkSettings?.Ports, raw.Id) : 'unconfirmed' };
  };
  const sweepStaleEndpoint = async () => {
    if (!config.network) return 0;
    const { PhantomEndpointJanitor } = await import('./phantom-endpoint-janitor.js');
    const { createNullLogger } = await import('@omnitron-dev/titan/module/logger');
    return new PhantomEndpointJanitor({ networks: [config.network], logger: createNullLogger() }).sweepNetwork(config.network, config.name);
  };
  const waitForState = async (phase: 'create' | 'start', id: string | undefined, cause: unknown, reply: 'refused' | 'lost' | 'acknowledged') => {
    const failure = cause;
    let checkedNetwork = false;
    let removedPhantom = false;
    for (;;) {
      let actual;
      try { actual = await inspect(id); }
      catch (error) {
        if (reply === 'refused' || !lostDockerTransport(error)) throw error;
        cause = error;
      }
      remaining(phase, id, cause);
      if (actual && (actual.status === 'running' || phase === 'create' && actual.status === 'created')) {
        id ??= actual.id;
        if (!containerResourcesMatch(config, actual)) {
          if (reply === 'acknowledged') await removeContainer(actual.id);
          throw Error(`Container '${config.name}' does not enforce its declared resource limits`);
        }
        if (actual.status !== 'running' || actual.publication === 'published') return actual;
        if (staged && actual.publication === 'conflict') throw Error('The native publication conflicts with the prepared Docker ID ' + actual.id);
        // A missing binding can appear later. Rebuild only on a conflicting
        // publication or after verifying and clearing a same-name phantom.
        if (reply === 'acknowledged') {
          if (actual.publication === 'conflict' || removedPhantom && actual.publication === 'pending') return actual;
        }
        if ((reply === 'acknowledged' || staged) && actual.publication === 'pending' && config.network && !checkedNetwork) {
          checkedNetwork = true;
          removedPhantom = await sweepStaleEndpoint() > 0;
        }
        cause = Error(`Docker has not published the declared ports for ${actual.containerId}`, { cause: failure });
      } else if (actual && actual.status !== 'created') {
        throw Error(`Docker ${phase} left ${actual.containerId} in state ${actual.status}`, { cause });
      }
      if (reply === 'refused') throw cause;
      await new Promise(resolve => setTimeout(resolve, Math.min(500, remaining(phase, id, cause))));
      remaining(phase, id, cause);
    }
  };

  const allocate = async (): Promise<{ id: string; running: boolean }> => {
    let failure: unknown;
    try {
      // Keep time to inspect the committed effect even if the client never
      // receives its reply. Creation, startup and all observations share the deadline.
      const id = (await executeDocker(args, { timeout: Math.ceil(remaining('create') / 2) })).stdout.trim();
      if (/^[a-f0-9]{64}$/.test(id)) return { id, running: false };
      failure = Error('Docker create returned no immutable container ID');
    } catch (error) {
      if (staged?.operation === 'allocate' && definiteDockerFailure(error))
        throw new ContainerAllocationRefused('Docker refused allocation of ' + config.name + ': ' + (error as { stderr: string }).stderr.trim(), { cause: error });
      if (definiteDockerFailure(error) && !isStaleContainerState((error as Error).message)) throw error;
      failure = error;
    }
    const actual = await waitForState('create', undefined, failure, definiteDockerFailure(failure) ? 'refused' : 'lost');
    return { id: actual.id, running: actual.status === 'running' };
  };

  if (staged) {
    if (staged.operation === 'publish') {
      const id = staged.id;
      let state = await inspect(id);
      if (!state || state.status !== 'created' && state.status !== 'running') throw Error('The prepared Docker ID is absent or stopped: ' + id);
      if (state.name === config.name && staged.issued === 'allocated') throw Error('The prepared Docker ID was renamed outside its recorded operation');
      if (state.name === staged.stagedName) {
        if (state.status !== 'created' || staged.issued === 'starting') throw Error('Unexpected state of the staged Docker container ' + id);
        if (staged.issued === 'allocated') {
          await staged.record('renaming');
          try { await executeDocker(['container', 'rename', '--', id, config.name], { timeout: Math.ceil(remaining('rename', id) / 2) }); }
          catch (error) {
            if (definiteDockerFailure(error)) {
              const native = await inspect(id);
              if (native?.name === staged.stagedName && native.status === 'created') await staged.record('allocated');
              throw error;
            }
          }
        }
        // A lost rename reply cannot authorize starting a container under the wrong name.
        for (;;) {
          try { state = await inspect(id); } catch (error) { if (!lostDockerTransport(error)) throw error; state = null; }
          remaining('rename', id);
          if (state?.name === config.name && (state.status === 'created' || state.status === 'running')) break;
          if (state && state.status !== 'created') throw Error('Cannot confirm the prepared Docker rename for ' + id);
          await new Promise(resolve => setTimeout(resolve, Math.min(500, remaining('rename', id))));
        }
      }
      if (state.status === 'running' && staged.issued !== 'starting') throw Error('The prepared Docker ID started outside its recorded operation');
      await staged.configure(state.status === 'running');
      if (state.status === 'created' && staged.issued !== 'starting') {
        await staged.record('starting');
        const start = async () => {
          try { await executeDocker(['container', 'start', '--', id], { timeout: Math.ceil(remaining('start', id) / 2) }); }
          catch (error) {
            if (!definiteDockerFailure(error)) return undefined;
            const native = await inspect(id);
            if (native?.status !== 'created' || native.name !== config.name) throw error;
            // The start was refused and the exact renamed ID is still inactive. Rollback may retire it.
            await staged.record('renaming');
            return error;
          }
          return undefined;
        };
        const failure = await start();
        if (failure) {
          if (!isStaleContainerState((failure as Error).message) || !await sweepStaleEndpoint()) throw failure;
          await staged.record('starting');
          const retryFailure = await start();
          if (retryFailure) throw retryFailure;
        }
      }
      const serving = await waitForState('start', id, undefined, 'lost');
      if (serving.name !== config.name) throw Error('The prepared Docker ID lost its published name');
      return id;
    }
    if (staged.operation === 'discard') {
      const state = await inspect(staged.id);
      if (!state && !staged.id) throw Error('Docker allocation is still unconfirmed for ' + config.name + ' (creation ' + creation + ')');
      if (state) {
        if (state.status !== 'created') throw Error('Cannot discard a prepared container in state ' + state.status);
        await removeContainer(state.id);
        if (await inspect(state.id)) throw Error('Prepared Docker removal is unconfirmed for ' + state.id);
      }
      return '';
    }
    const id = staged.operation === 'allocate' ? (await allocate()).id : staged.id;
    const state = staged.operation === 'verify' ? await inspect(id) : await waitForState('create', id, undefined, 'lost');
    if (!state || state.status !== 'created') throw Error('The prepared Docker allocation is not in Created state for ' + config.name);
    return state.id;
  }

  let unpublished = false;
  for (let attempt = 1; ; attempt++) {
    const { id, running } = await allocate();
    if (!running) {
      try {
        const started = await executeDocker(['container', 'start', '--', id], { timeout: Math.ceil(remaining('start', id) / 2) });
        if (started.stdout.trim() !== id) throw Error('Docker start did not acknowledge ' + id);
      } catch (error) {
        if (!definiteDockerFailure(error)) {
          await waitForState('start', id, error, 'lost');
          return options.fullId ? id : id.slice(0, 12);
        }
        const message = error instanceof Error ? error.message : String(error);
        const bindFailure = isPortNotYetReleased(message);
        if (!bindFailure && !isStaleContainerState(message)) throw error;
        // A failed start may leave an owned Created container. Verify that it
        // is still that stopped ID before releasing the name for another create.
        const actual = await inspect(id);
        if (!actual || actual.status !== 'created' && actual.status !== 'exited') throw error;
        await removeContainer(id);
        if (attempt >= 3) throw bindFailure ? Error(await describeBindFailure(config, message), { cause: error }) : error;
        if (bindFailure) {
          await new Promise(resolve => setTimeout(resolve, Math.min(attempt * 1000, remaining('start', id))));
        } else await sweepStaleEndpoint();
        continue;
      }
    }

    if (!running && (config.ports.length || Object.keys(resources).length)) {
      const actual = await waitForState('start', id, undefined, 'acknowledged');
      if (actual.publication !== 'published') {
        await removeContainer(id);
        if (unpublished) throw Error(`Docker did not publish the declared ports for ${config.name}`);
        unpublished = true;
        continue;
      }
    }
    return options.fullId ? id : id.slice(0, 12);
  }
}

function lostDockerTransport(error: unknown): boolean {
  const command = error as { code?: string; stderr?: string };
  return command?.code === 'TIMEOUT_ERROR' || command?.code === 'EXECUTION_OUTCOME_UNKNOWN' ||
    /(?:\bEOF\b|connection (?:reset|refused)|context cancel(?:ed|led)|deadline exceeded|timed? ?out|broken pipe|bad gateway|gateway timeout)/i.test(command?.stderr ?? '');
}

/** A transport failure or lost stdout can follow a committed Docker mutation. */
function definiteDockerFailure(error: unknown): boolean {
  const command = error as { code?: string; stderr?: string; signal?: string; aborted?: boolean };
  return command?.code === 'COMMAND_FAILED' && !command.signal && !command.aborted && Boolean(command.stderr?.trim()) && !lostDockerTransport(error);
}

/**
 * Start an existing stopped container.
 */
export async function startContainer(nameOrId: string): Promise<void> {
  const adapter = await getAdapter();
  await adapter.startContainer(nameOrId);
}

async function executeDocker(args: string[], { maxBuffer = 1024 * 1024, timeout = 60_000, redactOutput = true }:
  { maxBuffer?: number; timeout?: number; redactOutput?: boolean } = {}) {
  const { ExecutionEngine } = await import('@xec-sh/core');
  const engine = new ExecutionEngine({ defaultShell: false, enableEvents: false });
  try {
    return await engine.execute({ command: 'docker', args, shell: false, adapter: 'local',
      timeout, maxBuffer, redactOutput, throwOnNonZeroExit: true });
  } finally { await engine.dispose(); }
}

export async function restartContainer(id: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Native restart requires an immutable Docker container ID');
  await executeDocker(['container', 'restart', '--', id]);
}

/**
 * Change a Docker network attachment using only immutable identities.
 */
export async function changeNetworkAttachment(operation: 'connect' | 'disconnect', networkId: string, containerId: string): Promise<void> {
  if (![networkId, containerId].every(id => /^[a-f0-9]{64}$/.test(id))) throw Error('Network attachment requires immutable Docker IDs');
  await executeDocker(['network', operation, '--', networkId, containerId]);
}

/**
 * Stop a running container gracefully.
 */
export async function stopContainer(nameOrId: string, timeout = 10): Promise<void> {
  const adapter = await getAdapter();
  await adapter.stopContainer(nameOrId, timeout);
}

/**
 * Remove a container (force if running).
 */
export async function removeContainer(nameOrId: string, options: { graceful?: boolean } = {}): Promise<void> {
  const adapter = await getAdapter();
  await adapter.removeContainer(nameOrId, !options.graceful, options);
}

/**
 * Pull an image if not present locally.
 */
export async function ensureImage(image: string): Promise<void> {
  // A local content ID is not a registry reference. Never turn it into a
  // pull of a repository named "sha256", or accept a missing local object.
  const local = image.startsWith('sha256:');
  if (local && !/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Invalid local image ID');
  if (local || image.includes('@')) {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    try {
      const { stdout } = await promisify(execFile)('docker', ['image', 'inspect', '--format', '{{.Id}}', '--', image], { timeout: 15_000, maxBuffer: 4096 });
      if (!/^sha256:[a-f0-9]{64}$/.test(stdout.trim()) || (local && stdout.trim() !== image)) throw new Error('Local image identity mismatch');
      return;
    } catch (error) { if (local) throw error; }
  } else {
    // A registry port belongs to the repository; an omitted tag means latest.
    const tagged = image.lastIndexOf(':') > image.lastIndexOf('/') ? image : image + ':latest';
    const adapter = await getAdapter();
    const images: string[] = await adapter.listImages(tagged);
    if (images.includes(tagged)) return;
  }
  const adapter = await getAdapter();
  await adapter.pullImage(image);
}

/**
 * Execute a command inside a running container.
 */
export async function execInContainer(nameOrId: string, command: string[]): Promise<string> {
  const adapter = await getAdapter();
  const result = await adapter.execute({
    command: command[0],
    args: command.slice(1),
    shell: false,
    adapterOptions: { type: 'docker', container: nameOrId },
  });
  return (result.stdout ?? '').trim();
}

/**
 * Wait for container health check to pass.
 */
export async function waitForHealthy(name: string, timeoutMs = 60_000): Promise<boolean> {
  const adapter = await getAdapter();
  try {
    await adapter.waitForHealthy(name, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/** Reuse existing Docker networks; create only an explicitly absent named bridge. */
export async function ensureNetwork(name: string): Promise<void> {
  // Sharing another container's namespace is a runtime mode, not a network object.
  if (name.startsWith('container:') && name.length > 'container:'.length) return;
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const options = { encoding: 'utf-8' as const, timeout: 15_000 };
  const inspect = () => run('docker', ['network', 'inspect', name], options);
  try {
    await inspect();
    // In particular, host/none/bridge are Docker-owned and must never be created.
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no such network|network .+ not found/i.test(message)) throw error;
  }
  try {
    await run('docker', ['network', 'create', name, '--driver', 'bridge'], options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) throw error;
    // A concurrent creator won. Verify its result rather than trusting error prose.
    await inspect();
  }
}

/**
 * Create a Docker volume if it doesn't exist.
 */
export async function createVolume(name: string): Promise<void> {
  const adapter = await getAdapter();
  try {
    await adapter.createVolume(name);
  } catch {
    // Volume may already exist
  }
}

/** Read the adoption label recorded when a replacement node reserves a volume. */
export async function credentialVolumeState(name: string): Promise<CredentialVolumeState> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  let labels: unknown;
  try {
    const { stdout } = await promisify(execFile)('docker', ['volume', 'inspect', '--format', '{{json .Labels}}', name], { timeout: 15_000 });
    labels = JSON.parse(stdout);
  } catch (err) {
    const { code, stderr } = err as { code?: unknown; stderr?: string };
    if (code === 1 && typeof stderr === 'string' && /\bno such volume\b/i.test(stderr)) return 'absent';
    throw new Error(`Cannot inspect Docker volume '${name}' before resolving its credentials.`, { cause: err });
  }
  if (labels === null) return 'existing';
  if (typeof labels !== 'object' || Array.isArray(labels)) throw new Error(`Invalid Docker labels for volume '${name}'.`);
  return Object.hasOwn(labels, 'org.omnitron.service-adoption') ? 'restored' : 'existing';
}

/**
 * Get container logs.
 */
export async function getContainerLogs(nameOrId: string, tail = 100): Promise<string> {
  const adapter = await getAdapter();
  return adapter.getLogs(nameOrId, { tail });
}

/**
 * Dispose the adapter (cleanup).
 */
export async function disposeEngine(): Promise<void> {
  if (_adapter && typeof _adapter.dispose === 'function') {
    await _adapter.dispose();
    _adapter = null;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Why a container is not running, in the words Docker already has.
 *
 * `ContainerState.error` has been part of the type all along and nothing ever
 * filled it, while `docker inspect` carries both the exit code and a
 * human-readable reason. So `omnitron doctor` could say "Container
 * omnitron-nginx is created" and no more, when the answer was sitting one
 * field away: "Bind for 0.0.0.0:9800 failed: port is already allocated".
 *
 * A container that is running, or that exited cleanly because it was asked
 * to, has nothing to report — returning something there would turn a normal
 * stop into a finding.
 */
function describeContainerFailure(state?: {
  Status?: string;
  ExitCode?: number;
  Error?: string;
  OOMKilled?: boolean;
}): string | undefined {
  if (!state) return undefined;
  if (state.Status?.toLowerCase() === 'running') return undefined;

  const parts: string[] = [];
  if (state.Error) parts.push(state.Error);
  if (state.OOMKilled) parts.push('killed by the OOM killer');
  // Exit 0 is a clean stop; only a non-zero code is worth carrying.
  if (typeof state.ExitCode === 'number' && state.ExitCode !== 0) {
    parts.push(`exit code ${state.ExitCode}`);
  }

  return parts.length > 0 ? parts.join(' — ') : undefined;
}

function mapInspectStatus(status?: string): ContainerStatus {
  if (!status) return 'not_found';
  const lower = status.toLowerCase();
  if (lower === 'running') return 'running';
  if (lower === 'exited') return 'exited';
  if (lower === 'created') return 'created';
  if (lower === 'restarting') return 'restarting';
  if (lower === 'paused') return 'paused';
  if (lower === 'dead') return 'dead';
  return 'not_found';
}

function mapInspectHealth(health?: string, status?: string): 'healthy' | 'unhealthy' | 'starting' | 'none' {
  // Docker retains its last probe after a stop. That historical verdict must
  // not be presented as a current measurement in CLI, Console or topology.
  if (status?.toLowerCase() !== 'running' || !health) return 'none';
  if (health === 'healthy') return 'healthy';
  if (health === 'unhealthy') return 'unhealthy';
  if (health === 'starting') return 'starting';
  return 'none';
}

/**
 * Exported for tests only.
 *
 * `describeContainerFailure` is a pure function over an inspect payload, and
 * the payloads worth testing are the ones a live Docker will not produce on
 * demand — a refused port bind, an OOM kill.
 */
export const __test__ = { describeContainerFailure, portArg };

export interface DockerInventory {
  containers: Array<{ name: string; running: boolean; health?: string; labels: Record<string, string>; observation: ContainerState; ports: Array<{ host: number; bindHost?: string }> }>;
  images: string[];
  volumes: string[];
}

/** Bounded, read-only host inventory, including unmanaged containers that can conflict with a plan. */
let pendingDockerInventory: Promise<DockerInventory> | undefined;
export async function readDockerInventory(): Promise<DockerInventory> {
  if (pendingDockerInventory) return pendingDockerInventory;
  pendingDockerInventory = inspectDockerInventory();
  try { return await pendingDockerInventory; } finally { pendingDockerInventory = undefined; }
}
async function inspectDockerInventory(): Promise<DockerInventory> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const read = async (args: string[]) => (await run('docker', args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 16 * 1024 * 1024 })).stdout;
  const [ids, images, volumes] = await Promise.all([
    read(['ps', '-aq']), read(['image', 'ls', '--no-trunc', '--digests', '--format', '{{json .}}']),
    read(['volume', 'ls', '--format', '{{.Name}}']),
  ]);
  const names = ids.trim().split('\n').filter(Boolean);
  const inspected = names.length ? await inspectContainers(names, true) : [];
  if (inspected.length !== names.length) throw new Error('Incomplete Docker snapshot');
  return {
    containers: inspected.map(info => ({
      name: String(info.Name).replace(/^\//, ''), running: info.State?.Running === true,
      observation: containerObservation(info, info.Name, true),
      health: info.State?.Health?.Status, labels: info.Config?.Labels ?? {},
      ports: Object.values(info.NetworkSettings?.Ports ?? {}).flatMap(bindings =>
        (Array.isArray(bindings) ? bindings : []).map(binding => ({ host: Number(binding.HostPort), bindHost: String(binding.HostIp) }))),
    })),
    images: images.trim().split('\n').filter(Boolean).flatMap(line => {
      const image = JSON.parse(line);
      return [String(image.ID), `${image.Repository}:${image.Tag}`, `${image.Repository}@${image.Digest}`];
    }),
    volumes: volumes.trim().split('\n').filter(Boolean),
  };
}
/** A wildcard Docker binding reserves this port on every interface. */
export function hostPortsOverlap(a: { host: number; bindHost?: string }, b: { host: number; bindHost?: string }): boolean {
  return a.host === b.host && (!a.bindHost || !b.bindHost || a.bindHost === b.bindHost ||
    ['0.0.0.0', '::'].includes(a.bindHost) || ['0.0.0.0', '::'].includes(b.bindHost));
}
