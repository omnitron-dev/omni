/**
 * Container Runtime — Docker operations via @xec-sh/core DockerAdapter
 *
 * Uses xec's DockerAdapter for all container lifecycle management.
 * The adapter uses child_process.spawn with array-based arguments (no shell),
 * which correctly handles arguments with spaces (e.g., health check commands).
 *
 * All Omnitron-managed containers are labeled with `omnitron.managed=true`.
 */

import { createHash } from 'node:crypto';
import type { ContainerState, ContainerStatus, ResolvedContainer } from './types.js';

/** Label carrying the desired-spec fingerprint, used for config-drift detection. */
export const SPEC_HASH_LABEL = 'omnitron.spec-hash';

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
  const sortedEnv = Object.keys(config.environment)
    .sort()
    .map((k) => [k, config.environment[k]]);
  const normalized = JSON.stringify({
    image: config.image,
    env: sortedEnv,
    ports: [...config.ports].sort((a, b) => a.host - b.host || a.container - b.container),
    volumes: [...config.volumes]
      .map((v) => ({ s: v.source, t: v.target, ro: !!v.readonly }))
      .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)),
    command: config.command ?? null,
    entrypoint: config.entrypoint ?? null,
    extraHosts: [...(config.extraHosts ?? [])].sort(),
  });
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
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
const ADAPTER_DEAD_PATTERNS = /(?:cannot connect to the docker daemon|docker daemon is not running|connect ENOENT|connect ECONNREFUSED.*docker|EOF$|connection reset)/i;

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
 * Check if Docker daemon is available.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    return await withAdapter((adapter) => adapter.isAvailable());
  } catch {
    return false;
  }
}

/**
 * List all Omnitron-managed containers.
 */
export async function listManagedContainers(): Promise<ContainerState[]> {
  try {
    return await withAdapter(async (adapter) => {
      const allNames: string[] = await adapter.listContainers(true);
      const managed: ContainerState[] = [];

      for (const name of allNames) {
        try {
          const info = await adapter.inspectContainer(name);
          const labels = info?.Config?.Labels ?? {};
          if (labels['omnitron.managed'] === 'true') {
            const failure = describeContainerFailure(info.State);
            managed.push({
              name: (info.Name ?? name).replace(/^\//, ''),
              image: info.Config?.Image ?? '',
              status: mapInspectStatus(info.State?.Status),
              containerId: info.Id?.slice(0, 12),
              health: mapInspectHealth(info.State?.Health?.Status),
              ...(failure && { error: failure }),
            });
          }
        } catch {
          // Container may have been removed between list and inspect
        }
      }

      return managed;
    });
  } catch {
    return [];
  }
}

/**
 * Get state of a specific container by name.
 */
export async function getContainerState(name: string): Promise<ContainerState | null> {
  try {
    return await withAdapter(async (adapter) => {
      const exists = await adapter.containerExists(name);
      if (!exists) return null;

      const info = await adapter.inspectContainer(name);
      // Network attachment: an OrbStack/dockerd restart can leave a container
      // 'running' but detached from every network (empty Networks) with its
      // published ports gone — reachable by nothing. Surface it so callers can
      // recreate instead of trusting the 'running' status.
      const networkAttached = Object.keys(info.NetworkSettings?.Networks ?? {}).length > 0;
      const failure = describeContainerFailure(info.State);
      return {
        name: (info.Name ?? name).replace(/^\//, ''),
        image: info.Config?.Image ?? '',
        status: mapInspectStatus(info.State?.Status),
        containerId: info.Id?.slice(0, 12),
        health: mapInspectHealth(info.State?.Health?.Status),
        specHash: info.Config?.Labels?.[SPEC_HASH_LABEL],
        networkAttached,
        ...(failure && { error: failure }),
      };
    });
  } catch {
    return null;
  }
}

/**
 * Create and start a container from a resolved config.
 */
export async function createContainer(config: ResolvedContainer): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  // Ensure the managed network exists before we try to attach to it.
  // Idempotent — `docker network create` errors with "already exists"
  // when present, which we treat as success. Doing this here (rather
  // than at daemon start) keeps the provisioner self-sufficient and
  // means single-container test setups work without a manual prep step.
  if (config.network) {
    await ensureNetwork(config.network);
  }

  // Ensure volumes exist
  for (const vol of config.volumes) {
    if (!vol.source.startsWith('/') && !vol.source.startsWith('.')) {
      await createVolume(vol.source);
    }
  }

  // Pull image if not present
  await ensureImage(config.image);

  // Build docker run command directly — xec adapter can hang
  const args: string[] = ['docker', 'run', '-d', '--name', config.name];

  // Network — explicit network avoids the default bridge, which
  // accumulates phantom endpoints after dockerd restarts on macOS and
  // blocks container recreation with "endpoint with name X already
  // exists in network bridge". Falls back to docker's default when
  // unspecified so single-container / no-stack usage still works.
  if (config.network) {
    args.push('--network', config.network);
  }

  // Port mappings
  for (const p of config.ports) {
    args.push('-p', `${p.host}:${p.container}`);
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
  const labels = { ...(config.labels ?? {}), [SPEC_HASH_LABEL]: containerSpecHash(config) };
  for (const [key, value] of Object.entries(labels)) {
    args.push('--label', `${key}=${value}`);
  }

  // Restart policy
  if (config.restart && config.restart !== 'no') {
    args.push('--restart', config.restart);
  }

  // Health check
  if (config.healthCheck) {
    const test = config.healthCheck.test.length === 2 && config.healthCheck.test[0] === 'CMD-SHELL'
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

  // SHM size
  if (config.shmSize) {
    args.push('--shm-size', config.shmSize);
  }

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

  // Execute docker run — use async execFile to avoid blocking event loop.
  //
  // Self-heal the two stale-state failures that otherwise wedge a managed
  // container into an unstartable state (both seen in production on
  // macOS/OrbStack after dockerd restarts under disk pressure):
  //   1. "endpoint with name X already exists in network N" — an orphaned
  //      libnetwork endpoint outlived its container; docker run then leaves a
  //      half-created container with PortBindings set but NO published host
  //      port, so clients get ECONNREFUSED while inspect says "running".
  //   2. "Conflict. The container name X is already in use" — a leftover
  //      Created-state container from a previously failed run.
  // On either, scrub the stale state and retry the run exactly once.
  const runDocker = () => execFileAsync('docker', args.slice(1), { encoding: 'utf-8', timeout: 60_000 });
  let stdout: string;
  try {
    ({ stdout } = await runDocker());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/endpoint with name .* already exists|is already in use by container/i.test(msg)) throw err;
    await scrubStaleContainerState(config.name, config.network);
    ({ stdout } = await runDocker());
  }

  // Post-create guard: a container can report "running" yet have its declared
  // host ports UNpublished when it silently reused an orphaned endpoint
  // (PortBindings present but never wired by dockerd) — the exact failure that
  // took Redis offline and cascaded to a login outage. Detect the mismatch and
  // rebuild once from clean state so a successful return always means the
  // declared ports are actually reachable.
  if (config.ports.length > 0 && !(await arePortsPublished(config.name, config.ports))) {
    await scrubStaleContainerState(config.name, config.network);
    ({ stdout } = await runDocker());
  }

  const output = (stdout ?? '').trim();

  // Return container ID from docker run output (first line is container ID)
  return (output || config.name).slice(0, 12);
}

/**
 * Clear stale Docker state that blocks (re)creating a managed container: a
 * leftover container holding the name, and an orphaned libnetwork endpoint
 * holding the name on the managed network. Best-effort — every step may
 * legitimately find nothing to remove.
 */
async function scrubStaleContainerState(name: string, network?: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync('docker', ['rm', '-f', name], { encoding: 'utf-8', timeout: 15_000 });
  } catch {
    // No leftover container.
  }
  if (network) {
    try {
      await execFileAsync('docker', ['network', 'disconnect', '-f', network, name], {
        encoding: 'utf-8',
        timeout: 15_000,
      });
    } catch {
      // No orphaned endpoint for this name.
    }
  }
}

/**
 * True if every declared host port shows up in `docker port <name>` (i.e.
 * dockerd actually published it). Returns true when the check itself fails,
 * so a transient docker hiccup never triggers a needless rebuild of a
 * container that is in fact fine.
 */
async function arePortsPublished(
  name: string,
  ports: Array<{ host: number; container: number }>,
): Promise<boolean> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    // `docker port` prints one line per published port, e.g.
    // "6379/tcp -> 0.0.0.0:6379"; an unpublished container prints nothing.
    const { stdout } = await execFileAsync('docker', ['port', name], { encoding: 'utf-8', timeout: 10_000 });
    const mapped = stdout ?? '';
    return ports.every((p) => mapped.includes(`:${p.host}`));
  } catch {
    return true;
  }
}

/**
 * Start an existing stopped container.
 */
export async function startContainer(nameOrId: string): Promise<void> {
  const adapter = await getAdapter();
  await adapter.startContainer(nameOrId);
}

/**
 * Stop a running container gracefully.
 */
export async function stopContainer(nameOrId: string, _timeout = 10): Promise<void> {
  const adapter = await getAdapter();
  await adapter.stopContainer(nameOrId);
}

/**
 * Remove a container (force if running).
 */
export async function removeContainer(nameOrId: string): Promise<void> {
  const adapter = await getAdapter();
  try {
    await adapter.removeContainer(nameOrId, true);
  } catch {
    // Already removed
  }
}

/**
 * Pull an image if not present locally.
 */
export async function ensureImage(image: string): Promise<void> {
  const adapter = await getAdapter();
  try {
    // Check if image exists locally via listImages
    const images: string[] = await adapter.listImages(image.split(':')[0]);
    if (images.some((i: string) => i.includes(image))) return;
  } catch {
    // Can't check — try to pull
  }

  try {
    await adapter.pullImage(image);
  } catch {
    // Image may already exist or network unavailable — proceed and let docker handle it
  }
}

/**
 * Execute a command inside a running container.
 */
export async function execInContainer(nameOrId: string, command: string[]): Promise<string> {
  const adapter = await getAdapter();
  const result = await adapter.execute({
    command: command[0],
    args: command.slice(1),
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

/**
 * Create a Docker bridge network if it doesn't exist.
 *
 * Idempotent — `docker network create` exits non-zero with a recognisable
 * "already exists" message when the network is present; we swallow that
 * specific case and propagate everything else. Done via execFile rather
 * than the adapter because the adapter doesn't expose network APIs and
 * the call is rare (once per daemon startup per network).
 */
export async function ensureNetwork(name: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync('docker', ['network', 'create', name, '--driver', 'bridge'], {
      encoding: 'utf-8',
      timeout: 15_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(msg)) return; // idempotent
    throw err;
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

function mapInspectHealth(health?: string): 'healthy' | 'unhealthy' | 'starting' | 'none' {
  if (!health) return 'none';
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
export const __test__ = { describeContainerFailure };
