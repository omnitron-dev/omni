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
    const names = await withAdapter((adapter) => adapter.listContainers(true) as Promise<string[]>);
    if (names.length === 0) return [];

    // One `docker inspect` for every container, not one per container.
    //
    // The per-container loop this replaces issued a subprocess each: on a host
    // with 28 containers that is 28 spawns, and the console polls this every
    // ten seconds. Measured on that host: 0.042s for one inspect, 0.225s for
    // all 28 in a single call — so the loop cost roughly 1.2s of process
    // churn per poll when it was working, and under load it stopped returning
    // at all, leaving the containers page in its loading state indefinitely.
    const inspected = await inspectContainers(names);

    const managed: ContainerState[] = [];
    for (const info of inspected) {
      if (info?.Config?.Labels?.['omnitron.managed'] !== 'true') continue;
      const failure = describeContainerFailure(info.State);
      managed.push({
        name: (info.Name ?? '').replace(/^\//, ''),
        image: info.Config?.Image ?? '',
        status: mapInspectStatus(info.State?.Status),
        containerId: info.Id?.slice(0, 12),
        health: mapInspectHealth(info.State?.Health?.Status),
        startedAt: info.State?.StartedAt,
        ports: publishedPorts(info),
        service: info.Config?.Labels?.['omnitron.service'],
        project: info.Config?.Labels?.['omnitron.project'],
        stack: info.Config?.Labels?.['omnitron.stack'],
        ...(failure && { error: failure }),
      });
    }

    return managed;
  } catch {
    return [];
  }
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
async function inspectContainers(names: string[]): Promise<any[]> {
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
        startedAt: info.State?.StartedAt,
        ports: publishedPorts(info),
        specHash: info.Config?.Labels?.[SPEC_HASH_LABEL],
        service: info.Config?.Labels?.['omnitron.service'],
        networkAttached,
        ...(failure && { error: failure }),
      };
    });
  } catch {
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
 * stand: `daos-dev-gateway` published on 0.0.0.0:80 while the other ten
 * managed containers were all on 127.0.0.1, and a browser on the LAN could
 * sign in. Defence in depth, because the resolver-side default is the one
 * that can be forgotten and this one cannot.
 */
export function portArg(p: { host: number; container: number; bindHost?: string }): string {
  const bindHost = p.bindHost ?? '127.0.0.1';
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
    const { stdout } = await promisify(execFile)(
      'docker',
      ['ps', '-a', '--format', '{{.Names}}\t{{.Ports}}'],
      { encoding: 'utf-8', timeout: 20_000 },
    );
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
  lookup: (hostPort: number) => Promise<string | null> = containerHoldingPort,
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
  //   3. "Bind for 127.0.0.1:5432 failed: port is already allocated" — the
  //      docker-proxy of a container `docker rm` has already returned for
  //      has not released its bind yet. A reconciler that removes and
  //      immediately recreates races that release. Measured on a node
  //      recreating three services at once: all three failed this way and
  //      were left in `Created`, and `docker start` by hand a second later
  //      worked — which is what makes it a race rather than a conflict.
  //
  // The first two are scrubbed; the third only needs a moment. Both are
  // retried, with a short wait, up to three times.
  //
  // Deliberately narrow. A missing image, a bad flag, or a port genuinely
  // held by something else is permanent, and retrying it turns one clear
  // error into several identical ones separated by delays.
  const runDocker = () => execFileAsync('docker', args.slice(1), { encoding: 'utf-8', timeout: 60_000 });

  let stdout: string | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      ({ stdout } = await runDocker());
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);

      if (isStaleContainerState(msg)) {
        await scrubStaleContainerState(config.name, config.network);
        continue;
      }

      if (isPortNotYetReleased(msg)) {
        // The failed run leaves the container in `Created` holding the name,
        // so the next attempt would hit the name conflict instead of the
        // port. Remove it, then wait for the bind to go.
        await removeContainer(config.name).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
        continue;
      }

      throw err;
    }
  }
  if (lastError || stdout === undefined) {
    const message = lastError instanceof Error ? lastError.message : String(lastError ?? '');
    if (isPortNotYetReleased(message)) {
      // Waiting did not help, so something is holding the port rather than
      // letting go of it. Name it: the docker error names the port and
      // withholds the one thing an operator can act on.
      throw new Error(await describeBindFailure(config, message));
    }
    throw lastError ?? new Error(`docker run produced no container id for ${config.name}`);
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
 * Does a Docker volume exist?
 *
 * The question behind this one is "does this service already hold state
 * initialised with some other password" — a Postgres data directory keeps
 * the password it was created with and ignores `POSTGRES_PASSWORD`
 * thereafter, so a volume is the difference between a first provision and
 * one that would lock an application out of its own database.
 *
 * `docker volume inspect` rather than listing and filtering: the answer is
 * about one name, and a list is a different question that happens to
 * contain it.
 */
export async function volumeExists(name: string): Promise<boolean> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    await promisify(execFile)('docker', ['volume', 'inspect', name], { timeout: 15_000 });
    return true;
  } catch (err) {
    // "No such volume" is an answer. Anything else — docker unreachable, a
    // timeout, a permission error — is NOT, and the two must not be
    // collapsed: the caller generates a credential when this says false, and
    // generating one for a volume that does exist locks an application out
    // of its own database. So only the message that means absence answers
    // absence; everything else answers "assume there is state", which
    // leaves a service on a default loudly rather than breaking it quietly.
    const message = err instanceof Error ? err.message : String(err);
    return !/no such volume/i.test(message);
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
export const __test__ = { describeContainerFailure, portArg };
