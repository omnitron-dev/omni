import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { containerObservation, containerResources, containerSpecHash, inspectStackContainers } from './container-runtime.js';
import { DEFAULT_PORT_BIND_HOST, type ContainerState, type InfrastructureState, type ResolvedContainer } from './types.js';
import { stackDefinitionFingerprint } from '../project/node-stack-stop.js';
import type { ExistingInfrastructureReview } from '../shared/dto/project.js';

/** Private native input. Environment and commands must never leave this reader. */
type Native = Record<string, any>;
export interface ExistingContainerProbes {
  inspect(names: string[]): Promise<Native[]>;
  image(id: string): Promise<Native>;
  inventory(scope: { project: string; stack: string }): Promise<Array<{ name: string; id: string }>>;
}
const execute = promisify(execFile);
async function inspect(args: string[]): Promise<Native[]> {
  try {
    const { stdout } = await execute('docker', args, { timeout: 15_000, maxBuffer: 32 * 1024 * 1024 });
    const answer: unknown = JSON.parse(stdout);
    if (!Array.isArray(answer)) throw Error();
    return answer;
  } catch { throw new Error('Native Docker inspection is unavailable'); }
}
export const existingContainerProbes: ExistingContainerProbes = {
  inventory: inspectStackContainers,
  inspect: names => inspect(['container', 'inspect', ...names]),
  image: async id => {
    const images = await inspect(['image', 'inspect', id]);
    if (images.length !== 1 || typeof images[0]?.['Id'] !== 'string') throw Error('Native image identity is unavailable');
    return images[0]!;
  },
};
export async function localBridgeId(name: string): Promise<string> {
  const [network] = await inspect(['network', 'inspect', '--', name]);
  if (!network || network['Name'] !== name || network['Driver'] !== 'bridge' || network['Scope'] !== 'local' ||
      !/^[a-f0-9]{64}$/.test(network['Id'] ?? '')) throw Error(`Cannot verify local Docker bridge ${name}`);
  return network['Id'];
}
const sorted = (values: unknown[]) => values.map(value => JSON.stringify(value)).sort();
const environment = (values: unknown): Record<string, string> => {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value.includes('=')))
    throw Error('Native environment is unavailable');
  const entries = values.map(value => [value.slice(0, value.indexOf('=')), value.slice(value.indexOf('=') + 1)]);
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw Error('Duplicate native environment');
  return Object.fromEntries(entries);
};
const duration = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const units: Record<string, number> = { ns: 1, us: 1e3, ms: 1e6, s: 1e9, m: 60e9, h: 3600e9 };
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ns|us|ms|s|m|h)/g)];
  const n = parts.reduce((sum, part) => sum + Number(part[1]) * units[part[2]!]!, 0);
  if (!parts.length || parts.map(part => part[0]).join('') !== value || !Number.isSafeInteger(n))
    throw Error('Health-check duration is not representable');
  return n;
};
const host = (value: unknown) => value === '' || value === undefined || value === '0.0.0.0' ? '*' : value;

function mountsMatch(volumes: ResolvedContainer['volumes'], mounts: Native[], runtime: Native, imageConfig: Native): boolean {
  const declared = new Map(volumes.map(volume => [volume.target, volume]));
  const inherited = Object.keys(imageConfig['Volumes'] ?? {}).filter(target => !declared.has(target));
  const observed = new Map(mounts.map(mount => [mount['Destination'], mount]));
  if (declared.size !== volumes.length || observed.size !== mounts.length || observed.size !== declared.size + inherited.length) return false;
  if (inherited.length) {
    // Docker creates anonymous volumes for image VOLUME destinations. Prove that
    // no explicit mount supplied them. Their exact native identities enter the review digest.
    const binds = volumes.map(v => v.source + ':' + v.target + (v.readonly ? ':ro' : ''));
    if (!isDeepStrictEqual(sorted(runtime['Binds'] ?? []), sorted(binds)) || runtime['Mounts']?.length || runtime['VolumesFrom']?.length ||
        Object.keys(runtime['Tmpfs'] ?? {}).length || (runtime['VolumeDriver'] && runtime['VolumeDriver'] !== 'local')) return false;
    for (const target of inherited) {
      const actual = observed.get(target);
      if (actual?.['Type'] !== 'volume' || actual['Driver'] !== 'local' || !/^[a-f0-9]{64}$/.test(actual['Name'] ?? '') ||
          actual['RW'] !== true || actual['Mode'] !== '') return false;
    }
  }
  return volumes.every(wanted => {
    const actual = observed.get(wanted.target);
    const bind = path.isAbsolute(wanted.source) || wanted.source.startsWith('.');
    return actual?.['RW'] === !wanted.readonly && (bind
      ? actual['Type'] === 'bind' && actual['Source'] === path.resolve(wanted.source)
      : actual['Type'] === 'volume' && actual['Name'] === wanted.source);
  });
}

/** Compare enforced settings, including image defaults. A historical label is not evidence of drift. */
export function existingContainerMismatch(desired: ResolvedContainer, native: Native, image: Native): string | null {
  const config = native['Config'], runtime = native['HostConfig'];
  if (!config || !runtime || !image['Config'] || image['Id'] !== native['Image']) return 'native configuration is incomplete';
  if (!/^sha256:[a-f0-9]{64}$/.test(image['Id'] ?? '')) return 'native image identity is unavailable';
  if (!/^[a-f0-9]{64}$/.test(native['Id'] ?? '') || native['Name'] !== '/' + desired.name) return 'native container identity differs';
  if (typeof native['State']?.StartedAt !== 'string' || !Number.isFinite(Date.parse(native['State'].StartedAt))) return 'native restart generation is unavailable';
  if (native['State']?.Status !== 'running' || native['State']?.Running !== true) return 'container is not running';
  if (native['State']?.Health && native['State'].Health.Status !== 'healthy') return 'native health is not ready';
  if ((desired.healthCheck || (image['Config'].Healthcheck && image['Config'].Healthcheck.Test?.[0] !== 'NONE')) && native['State']?.Health?.Status !== 'healthy')
    return 'native health is not ready';
  if (config['Image'] !== desired.image) return 'image reference differs';
  if ((config.User ?? '') !== (image['Config'].User ?? '') || (config.WorkingDir ?? '') !== (image['Config'].WorkingDir ?? '') ||
      (config.StopSignal ?? '') !== (image['Config'].StopSignal ?? '') || config.Tty === true || config.OpenStdin === true ||
      runtime.Privileged === true || runtime.ReadonlyRootfs === true || runtime.PublishAllPorts === true || runtime.AutoRemove === true ||
      [runtime.CapAdd, runtime.CapDrop, runtime.Devices, runtime.DeviceRequests].some(value => value?.length) ||
      [runtime.PidMode, runtime.UTSMode, runtime.UsernsMode].some(value => value && value !== 'private')) return 'native runtime options differ';
  if (Object.entries(desired.labels).some(([key, value]) => config.Labels?.[key] !== value)) return 'stack ownership differs';
  // Native mount paths cannot prove which bytes a daemon loaded at creation.
  // Existing intent is usable only when its complete current spec reproduces the receipt.
  if (desired.configDigest && config.Labels?.['omnitron.spec-hash'] !== containerSpecHash(desired))
    return 'mounted configuration content cannot be proved from this spec receipt';
  if (!isDeepStrictEqual(environment(config.Env), { ...environment(image['Config'].Env ?? []), ...desired.environment })) return 'environment differs';
  const entrypoint = desired.entrypoint ? [desired.entrypoint[0]] : image['Config'].Entrypoint ?? null;
  const args = [...(desired.entrypoint?.slice(1) ?? []), ...(desired.command ?? [])];
  // docker run --entrypoint clears the image CMD, even when no positional arguments follow.
  const command = args.length || desired.entrypoint ? args : image['Config'].Cmd ?? [];
  if (!isDeepStrictEqual(config.Entrypoint ?? null, entrypoint) || !isDeepStrictEqual(config.Cmd ?? [], command)) return 'command or entrypoint differs';
  const wantedPorts = sorted(desired.ports.map(p => [p.container + '/tcp', host(p.bindHost ?? DEFAULT_PORT_BIND_HOST), String(p.host)]));
  const actualPorts = (bindings: Native | undefined) => sorted(Object.entries(bindings ?? {}).flatMap(([port, portBindings]) =>
    (portBindings as Native[] | null)?.map(binding => [port, host(binding['HostIp']), binding['HostPort']]) ?? []));
  if (!isDeepStrictEqual(wantedPorts, actualPorts(runtime.PortBindings)) ||
      !isDeepStrictEqual(wantedPorts, actualPorts(native['NetworkSettings']?.Ports))) return 'published ports differ';
  if (!Array.isArray(native['Mounts'])) return 'native mounts are unavailable';
  if (!mountsMatch(desired.volumes, native['Mounts'], runtime, image['Config'])) return 'volume identity or mount permissions differ';
  const network = desired.network ?? 'bridge';
  // Docker retains the original NetworkMode after moving to another bridge, even across a restart.
  const namedBridge = (name: unknown) => typeof name === 'string' && /^[a-z0-9][a-z0-9_.-]*_default$/.test(name);
  const movedHostDatabase = desired.labels['omnitron.internal'] === 'true' && desired.labels['omnitron.service'] === 'omnitron-pg' &&
    namedBridge(runtime.NetworkMode) && namedBridge(network);
  if ((runtime.NetworkMode !== network && !movedHostDatabase) ||
      !/^[a-f0-9]{64}$/.test(native['NetworkSettings']?.Networks?.[network]?.NetworkID ?? '') ||
      Object.keys(native['NetworkSettings'].Networks).length !== 1) return 'network attachment differs';
  const [restart, attempts] = (desired.restart || 'no').split(':');
  if ((runtime.RestartPolicy?.['Name'] || 'no') !== restart || runtime.RestartPolicy?.MaximumRetryCount !== Number(attempts ?? 0))
    return 'restart policy differs';
  if (!isDeepStrictEqual([...(runtime.ExtraHosts ?? [])].sort(), [...(desired.extraHosts ?? [])].sort())) return 'extra host bindings differ';
  const resources = containerResources(desired);
  const fields: Record<string, string> = { memoryBytes: 'Memory', memoryReservationBytes: 'MemoryReservation', nanoCpus: 'NanoCpus', shmBytes: 'ShmSize' };
  for (const [key, value] of Object.entries({ memoryBytes: 0, memoryReservationBytes: 0, nanoCpus: 0, ...resources })) {
    if (key === 'shmBytes' && value === 0) {
      if (!Number.isSafeInteger(runtime.ShmSize) || runtime.ShmSize <= 0) return 'shared memory limit is unavailable';
    } else if (runtime[fields[key]!] !== value) return 'resource limits differ';
  }
  if (runtime.CpuQuota > 0 || runtime.CpuPeriod > 0) return 'CPU quota differs';
  const health = config.Healthcheck ?? null;
  if (desired.healthCheck) {
    const declared = desired.healthCheck;
    const cmd = declared.test.length === 2 && declared.test[0] === 'CMD-SHELL' ? declared.test[1]
      : declared.test.filter(part => part !== 'CMD-SHELL' && part !== 'CMD').join(' ');
    if (!health || !isDeepStrictEqual(health.Test, ['CMD-SHELL', cmd]) ||
      Object.entries({ Interval: duration(declared.interval), Timeout: duration(declared.timeout),
        StartPeriod: duration(declared.startPeriod), Retries: declared.retries }).some(([key, value]) => (health[key] ?? 0) !== (value ?? image['Config'].Healthcheck?.[key] ?? 0)))
      return 'health-check specification differs';
  } else if (!isDeepStrictEqual(health, image['Config'].Healthcheck ?? null)) return 'health-check specification differs';
  return null;
}

function nativeFingerprint(native: Native): string {
  // Health probe timestamps and counters are observations, not resource identity.
  const { Labels: labels, ...config } = native['Config'];
  const { ["omnitron.spec-hash"]: _hash, ...ownership } = labels ?? {};
  return stackDefinitionFingerprint([native['Id'], native['Image'], native['State'].StartedAt,
    { ...config, Labels: ownership }, native['HostConfig'], native['Mounts'], native['NetworkSettings']]);
}

/** Read the same native evidence for preview and apply, including the complete predicted configuration. */
export async function planLegacyContainer(desired: ResolvedContainer, id: string, probes = existingContainerProbes) {
  const [before] = await probes.inspect([id]);
  if (!before || before['Id'] !== id) throw Error('Historical container identity changed during reconciliation');
  const image = await probes.image(desired.image);
  const mismatch = existingContainerMismatch(desired, before, image);
  const beforeFingerprint = nativeFingerprint(before);
  if (!mismatch) return { args: [], beforeFingerprint, expectedFingerprint: beforeFingerprint, image };
  if (mismatch !== 'resource limits differ') throw Error(`Cannot adopt existing ${desired.name}: ${mismatch}`);
  const resources = containerResources(desired);
  const old = before['HostConfig'];
  const expected = { ...old };
  const args: string[] = [];
  if (resources.memoryBytes && old.Memory === 0 && old.MemorySwap === 0) {
    expected.Memory = resources.memoryBytes;
    expected.MemorySwap = resources.memoryBytes * 2;
    if (!Number.isSafeInteger(expected.MemorySwap)) throw Error('Docker memory and swap limit exceeds exact byte representation');
    args.push('--memory', String(expected.Memory), '--memory-swap', String(expected.MemorySwap));
  }
  if (resources.memoryReservationBytes && old.MemoryReservation === 0) {
    expected.MemoryReservation = resources.memoryReservationBytes;
    args.push('--memory-reservation', String(expected.MemoryReservation));
  }
  const predicted = { ...before, HostConfig: expected };
  if (!args.length || existingContainerMismatch(desired, predicted, image))
    throw Error(`Existing ${desired.name} requires a separately reviewed resource transition`);
  return { args, beforeFingerprint, expectedFingerprint: nativeFingerprint(predicted), image };
}

/** Old Docker labels omitted limits. Converge memory in place only after proving every other native setting. */
export async function reconcileLegacyContainer(desired: ResolvedContainer, id: string, probes = existingContainerProbes,
  update = async (args: string[]) => { await execute('docker', ['container', 'update', ...args], { timeout: 15_000 }); }): Promise<void> {
  const { args, beforeFingerprint, expectedFingerprint, image } = await planLegacyContainer(desired, id, probes);
  if (!args.length) return;
  const [confirmed] = await probes.inspect([id]);
  if (!confirmed || confirmed['Id'] !== id || nativeFingerprint(confirmed) !== beforeFingerprint)
    throw Error('Historical container changed before applying memory limits');
  await update([...args, id]);
  const [observed] = await probes.inspect([id]);
  if (!observed || observed['Id'] !== id || existingContainerMismatch(desired, observed, image) || expectedFingerprint !== nativeFingerprint(observed))
    throw Error(`Cannot confirm the in-place memory update for ${desired.name}; inspect the retained container`);
}

/** Public admission report. Native state and mount paths stay on the host. */
export async function reviewExistingContainers(desired: readonly ResolvedContainer[], probes = existingContainerProbes,
  scope?: { project: string; stack: string }): Promise<ExistingInfrastructureReview> {
  return (await inspectExistingInfrastructure(desired, probes, scope)).review;
}

/** Project the receipt and service states from a single complete Docker observation. */
export async function inspectExistingInfrastructure(desired: readonly ResolvedContainer[], probes = existingContainerProbes,
  scope?: { project: string; stack: string }): Promise<{ review: ExistingInfrastructureReview; state: InfrastructureState }> {
  const review: ExistingInfrastructureReview = { protocol: 1, mode: 'preserve', digest: null, checks: [], containers: [] };
  const state: InfrastructureState = { ready: false, lastReconciled: new Date().toISOString(),
    services: Object.fromEntries(desired.map(({ name, image }) => [name, {
      name, image, status: 'unknown', error: 'Native infrastructure has not been verified',
    } satisfies ContainerState])) };
  try {
    if (new Set(desired.map(c => c.name)).size !== desired.length) throw Error('Duplicate infrastructure declaration');
    const project = scope?.project ?? desired[0]?.labels['omnitron.project'], stack = scope?.stack ?? desired[0]?.labels['omnitron.stack'];
    if (desired.length && (!project || !stack || desired.some(container => container.labels['omnitron.project'] !== project || container.labels['omnitron.stack'] !== stack)))
      throw Error('Ambiguous infrastructure ownership');
    const inventory = project && stack ? await probes.inventory({ project, stack }) : [];
    if (project && stack) review.scope = { project, stack };
    if (!isDeepStrictEqual(inventory.map(item => item.name).sort(), desired.map(item => item.name).sort())) {
      review.checks.push({ code: 'infrastructure.preservation-footprint', resource: 'Infrastructure', state: 'blocked', message: 'Native ownership footprint differs from the desired services; reconcile separately.' });
      return { review, state };
    }
    const observed = desired.length ? await probes.inspect(desired.map(c => c.name)) : [];
    for (const declaration of [...desired].sort((a, b) => a.name.localeCompare(b.name))) {
      const candidates = observed.filter(item => item['Name'] === '/' + declaration.name);
      const native = candidates.length === 1 ? candidates[0] : undefined;
      const mismatch = !native || !inventory.some(item => item.name === declaration.name && item.id === native['Id']) ? 'native container is missing, replaced or ambiguous' :
        existingContainerMismatch(declaration, native, await probes.image(declaration.image));
      review.checks.push({ code: mismatch ? 'infrastructure.preservation-blocked' : 'infrastructure.preserved', resource: declaration.name,
        state: mismatch?.includes('cannot be proved') ? 'unknown' : mismatch ? 'blocked' : 'pass', message: mismatch ? `Cannot preserve: ${mismatch}.` : 'Existing native identity and specification verified; no infrastructure changes permitted.' });
      if (mismatch) state.services[declaration.name]!.error = mismatch;
      else {
        review.containers.push({ name: declaration.name, id: native!['Id'], fingerprint: nativeFingerprint(native!) });
        state.services[declaration.name] = containerObservation(native!, declaration.name, true);
      }
    }
    if (review.checks.every(check => check.state === 'pass')) review.digest = stackDefinitionFingerprint([
      'omnitron/infrastructure.preserve/v1', review.scope ?? null, [...desired].sort((a, b) => a.name.localeCompare(b.name)), review.containers,
    ]);
  } catch {
    review.checks.push({ code: 'infrastructure.preservation-unknown', resource: 'Infrastructure', state: 'unknown', message: 'Complete native infrastructure identity and specification could not be verified.' });
  }
  state.ready = review.digest !== null;
  return { review, state };
}
