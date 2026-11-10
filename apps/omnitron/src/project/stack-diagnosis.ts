import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import type { ResolvedContainer } from '../infrastructure/types.js';
import { containerSpecHash, hostPortsOverlap, SPEC_HASH_LABEL, readDockerInventory, type DockerInventory } from '../infrastructure/container-runtime.js';
import type { StackDiagnosisCheck } from '../shared/dto/stack-diagnosis.js';

/** A successful TCP connection does not establish ownership. Bind and immediately release instead. */
async function portAvailable(port: number, host: string): Promise<boolean | null> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    const timer = setTimeout(() => { server.close(); resolve(null); }, 1000);
    server.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(error.code === 'EADDRINUSE' ? false : null);
    });
    server.listen({ port, host, exclusive: true }, () => server.close(() => { clearTimeout(timer); resolve(true); }));
  });
}

export const localDiagnosisProbes = {
  inventory: readDockerInventory,
  port: portAvailable,
  mount: async (file: string): Promise<'present' | 'missing' | 'unknown'> => {
    try { await fs.access(file, fs.constants.R_OK); return 'present'; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unknown'; }
  },
};

/** Never executes health commands, pulls images, creates directories/volumes or mutates a container. */
export async function diagnoseContainers(
  containers: readonly ResolvedContainer[],
  probes = localDiagnosisProbes,
): Promise<StackDiagnosisCheck[]> {
  if (!containers.length) return [{ code: 'docker.unneeded', resource: 'Infrastructure', state: 'pass', message: 'No Docker services declared.' }];
  const checks: StackDiagnosisCheck[] = [];
  let inventory: DockerInventory;
  try { inventory = await probes.inventory(); }
  catch {
    return [{ code: 'docker.unavailable', resource: 'Docker', state: 'unknown', message: 'Docker inventory could not be read; absence of containers is not established.', action: 'Check the Docker daemon, selected context and access permissions, then retry.' }];
  }
  checks.push({ code: 'docker.available', resource: 'Docker', state: 'pass', message: 'Container, image and volume inventory read successfully.' });
  const reserved: Array<{ name: string; host: number; bindHost?: string }> = [];
  for (const container of containers) {
    const resource = container.name;
    const add = (code: string, state: StackDiagnosisCheck['state'], message: string, action?: string) => checks.push({ code, resource, state, message, ...(action && { action }) });
    const current = inventory.containers.find(item => item.name === container.name);
    const owned = current && ['omnitron.managed', 'omnitron.project', 'omnitron.stack', 'omnitron.service']
      .every(label => container.labels[label] !== undefined && current.labels[label] === container.labels[label]);
    if (current && !owned) add('container.foreign', 'blocked', 'The container name is occupied without matching stack ownership.', 'Resolve the naming conflict; diagnosis will not adopt or remove it.');
    else if (!current) add('container.create', 'change', 'Not present. Start will create this service.');
    else if (current.labels[SPEC_HASH_LABEL] !== containerSpecHash(container)) add('container.recreate', 'change', 'The declared specification differs. Start may recreate this container.', 'Review data volumes and impact before starting.');
    else if (!current.running) add('container.start', 'change', 'Present but stopped. Start will bring up this service.');
    else if (current.health === 'unhealthy') add('container.unhealthy', 'blocked', 'Docker reports the service unhealthy.', 'Inspect service logs and health details before starting dependent applications.');
    else if (current.health === 'starting') add('container.starting', 'unknown', 'The service health check is still starting.', 'Retry after the service becomes ready.');
    else add('container.running', 'pass', current.health === 'healthy' ? 'Running; Docker health check passed.' : 'Running; no Docker health check is configured.');
    if (!inventory.images.includes(container.image)) add('image.pull', 'change', 'The required image is not cached. Start needs a registry download.', 'Registry access and image availability are not tested by this offline check.');
    for (const mount of container.volumes) {
      if (path.isAbsolute(mount.source) || mount.source.startsWith('.')) {
        const state = await probes.mount(mount.source);
        if (state !== 'present') add('mount.unavailable', state === 'missing' ? 'blocked' : 'unknown', `Bind mount ${mount.source} is ${state === 'missing' ? 'missing' : 'unreadable'}.`, 'Prepare the declared file or directory before starting; diagnosis creates nothing.');
      } else if (!inventory.volumes.includes(mount.source)) add('volume.create', 'change', `Named volume ${mount.source} will be created empty.`, 'Restore required data before starting if this is an existing environment.');
    }
    for (const port of container.ports) {
      const overlaps = (binding: { host: number; bindHost?: string }) => hostPortsOverlap(port, binding);
      const duplicate = reserved.find(overlaps);
      const foreign = inventory.containers.find(item => item.running && !(item === current && owned) && item.ports.some(overlaps));
      reserved.push({ name: resource, ...port });
      if (duplicate || foreign) {
        add('port.conflict', 'blocked', `Host port ${port.host} conflicts with ${duplicate?.name ?? foreign?.name}.`, 'Choose a free port in the stack configuration.');
      } else if (!(owned && current.running && current.ports.some(overlaps))) {
        const available = await probes.port(port.host, port.bindHost ?? '0.0.0.0');
        if (available !== true) add('port.unavailable', available === false ? 'blocked' : 'unknown', `Host port ${port.host} ${available === false ? 'is in use' : 'could not be checked'}.`, 'Inspect the host listener or choose another port.');
      }
    }
  }
  return checks;
}
