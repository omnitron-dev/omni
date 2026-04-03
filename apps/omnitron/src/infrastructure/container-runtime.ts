/**
 * Container Runtime — Docker operations via @xec-sh/core DockerAdapter
 *
 * Uses xec's DockerAdapter for all container lifecycle management.
 * The adapter uses child_process.spawn with array-based arguments (no shell),
 * which correctly handles arguments with spaces (e.g., health check commands).
 *
 * All Omnitron-managed containers are labeled with `omnitron.managed=true`.
 */

import type { ContainerState, ContainerStatus, ResolvedContainer } from './types.js';

// =============================================================================
// Singleton DockerAdapter (lazy-loaded)
// =============================================================================

let _adapter: any = null;

async function getAdapter(): Promise<any> {
  if (_adapter) return _adapter;
  const { DockerAdapter } = await import('@xec-sh/core');
  _adapter = new DockerAdapter();
  return _adapter;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Check if Docker daemon is available.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const adapter = await getAdapter();
    return adapter.isAvailable();
  } catch {
    return false;
  }
}

/**
 * List all Omnitron-managed containers.
 */
export async function listManagedContainers(): Promise<ContainerState[]> {
  const adapter = await getAdapter();
  try {
    // listContainers returns names; filter by inspecting labels
    const allNames: string[] = await adapter.listContainers(true);
    const managed: ContainerState[] = [];

    for (const name of allNames) {
      try {
        const info = await adapter.inspectContainer(name);
        const labels = info?.Config?.Labels ?? {};
        if (labels['omnitron.managed'] === 'true') {
          managed.push({
            name: (info.Name ?? name).replace(/^\//, ''),
            image: info.Config?.Image ?? '',
            status: mapInspectStatus(info.State?.Status),
            containerId: info.Id?.slice(0, 12),
            health: mapInspectHealth(info.State?.Health?.Status),
          });
        }
      } catch {
        // Container may have been removed between list and inspect
      }
    }

    return managed;
  } catch {
    return [];
  }
}

/**
 * Get state of a specific container by name.
 */
export async function getContainerState(name: string): Promise<ContainerState | null> {
  const adapter = await getAdapter();
  try {
    const exists = await adapter.containerExists(name);
    if (!exists) return null;

    const info = await adapter.inspectContainer(name);
    return {
      name: (info.Name ?? name).replace(/^\//, ''),
      image: info.Config?.Image ?? '',
      status: mapInspectStatus(info.State?.Status),
      containerId: info.Id?.slice(0, 12),
      health: mapInspectHealth(info.State?.Health?.Status),
    };
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

  // Labels
  for (const [key, value] of Object.entries(config.labels ?? {})) {
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

  // Execute docker run — use async execFile to avoid blocking event loop
  const { stdout } = await execFileAsync('docker', args.slice(1), { encoding: 'utf-8', timeout: 60_000 });
  const output = (stdout ?? '').trim();

  // Return container ID from docker run output (first line is container ID)
  return (output || config.name).slice(0, 12);
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
