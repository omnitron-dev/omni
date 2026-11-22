/**
 * Inspect public onion hostnames and the physical Tor containers that own them.
 */

import os from 'node:os';
import { box, log, prism } from '@xec-sh/kit';
import { listManagedContainers, execInContainer } from '../infrastructure/container-runtime.js';
import type { ContainerState } from '../infrastructure/types.js';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { emitJson, emitError, isJsonMode } from './output.js';

interface OnionEntry {
  service: string;
  onion: string | null;
  /** Container path where the hostname was read. */
  source: string;
}

/**
 * A stack's tor container: by the `omnitron.service` label, or — for a
 * container made before labels were written — by the `<prefix>-tor` name the
 * service resolver gives it (e.g. `sample-dev-tor`, `omnitron-tor`).
 */
function isTor(c: ContainerState): boolean {
  return c.service ? c.service === 'tor' : /(^|-)tor$/i.test(c.name);
}

/** Whether a container belongs to the stack asked about: labels first, name second. */
function belongsTo(c: ContainerState, project: string | undefined, stack: string | undefined): boolean {
  if (!project) return true;
  if (c.project || c.stack) return c.project === project && (!stack || c.stack === stack);
  return stack ? c.name === `${project}-${stack}-tor` : c.name.startsWith(`${project}-`);
}

/** `project/stack` as the container's labels say, or its name when they do not. */
function stackOf(c: ContainerState): string {
  return c.project && c.stack ? `${c.project}/${c.stack}` : `unlabelled (${c.name})`;
}

/**
 * Use the inspected Docker ID throughout, even if the container name is reused.
 */
async function readOnions(container: string): Promise<OnionEntry[]> {
  const raw = await execInContainer(container, [
    'find', '/var/lib/tor', '-mindepth', '2', '-maxdepth', '2', '-name', 'hostname', '-type', 'f', '-print0',
  ]);
  const entries: OnionEntry[] = [];
  for (const source of raw.split('\0').filter(Boolean).sort()) {
    const service = /^\/var\/lib\/tor\/([^/]+)\/hostname$/.exec(source)?.[1];
    if (!service || service === '.' || service === '..') throw new Error('Invalid Tor hostname location');
    let onion: string | null = null;
    try {
      const content = (await execInContainer(container, ['head', '-c', '64', source])).trim();
      if (/^[a-z2-7]{56}\.onion$/.test(content)) onion = content;
    } catch {
      // Report the affected service even when its hostname disappeared after discovery.
    }
    entries.push({ service, onion, source });
  }
  return entries;
}

async function inspectTor(c: ContainerState) {
  const identity = { container: c.name, containerId: c.containerId ?? null, status: c.status, project: c.project ?? null, stack: c.stack ?? null };
  if (c.containerId && (c.status === 'exited' || c.status === 'dead' || c.status === 'created')) {
    return { ...identity, observation: 'not-running', services: [] };
  }
  if (c.containerId && c.status === 'running') {
    try {
      const services = await readOnions(c.containerId);
      return { ...identity, observation: services.some(entry => !entry.onion) ? 'unavailable' : 'read', services };
    } catch {
      // Discovery failed for this physical container. Other stacks can still be inspected.
    }
  }
  return { ...identity, observation: 'unavailable', services: [] };
}

/**
 * Where a stack that has no tor container here runs, asked of the daemon.
 *
 * A remote stack's tor is on its node. No daemon RPC reads an onion address
 * from a node — the master relays status, health and metrics, not files in a
 * node's containers — so the honest answer names the container and the
 * machine and prints no onion, rather than printing this machine's.
 */
async function explainAbsence(project: string, stack: string): Promise<void> {
  const client = createDaemonClient();
  try {
    if (!(await client.isReachable())) {
      emitError(
        `No tor container for ${project}/${stack} on this machine, and the daemon did not answer — ` +
          'so whether the stack runs somewhere else is unknown.',
      );
      return;
    }
    const projects = await client.service<import('../shared/dto/services.js').IProjectRpcService>('OmnitronProject');
    const info = await projects.getStack({ project, stack });
    const container = info.infrastructure.services['tor']?.containerName ?? `${project}-${stack}-tor`;
    if (info.type === 'local') {
      emitError(`No tor container for ${project}/${stack} on this machine — the stack is local and has none running.`);
      return;
    }
    const hosts = info.nodes.map((n) => n.host);
    const where = hosts.length > 0 ? hosts.join(', ') : 'its node';
    emitError(
      `Tor container ${container} is declared for ${project}/${stack} on ${where}. Run 'omnitron tor ${project} ${stack}' there to inspect it.`,
      { project, stack, container, hosts },
    );
  } catch (err) {
    emitError(`No tor container for ${project}/${stack} on this machine, and the daemon could not say where it runs: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}

export async function torCommand(project?: string, stack?: string): Promise<void> {
  let chosen: ContainerState[];
  try {
    chosen = (await listManagedContainers({ orThrow: true })).filter(c => isTor(c) && belongsTo(c, project, stack));
  } catch {
    process.exitCode = 1;
    emitError('Could not inspect managed containers on this machine.');
    return;
  }

  if (chosen.length === 0) {
    process.exitCode = 1;
    if (project && stack) {
      await explainAbsence(project, stack);
      return;
    }
    if (project) {
      emitError(`No tor container for project ${project} on this machine.`);
      return;
    }
    if (isJsonMode()) {
      emitError('No tor container found. Add a `tor` service to your omnitron.config.ts.');
    } else {
      log.warn('No tor container found on this machine.');
      log.info('Add a `tor` service to your omnitron.config.ts:');
      log.info("  services: { tor: { preset: 'tor', config: { hiddenServices: [...] } } }");
    }
    return;
  }

  const machine = os.hostname();
  const found = await Promise.all(chosen.map(inspectTor));
  const result = { machine: 'this machine', hostname: machine, containers: found, ...(found.length === 1 ? found[0] : {}) };
  if (found.some(c => c.observation === 'unavailable')) {
    process.exitCode = 1;
    if (emitError('Could not read all public Tor hostnames.', { data: result })) return;
  } else if (emitJson(result)) {
    return;
  }

  for (const [i, c] of found.entries()) {
    // Short enough for the box border, which cuts a long title: the host
    // name goes in the body.
    const title = `Tor · stack ${stackOf(chosen[i]!)} · ${c.container} · this machine`;
    if (c.observation === 'not-running') {
      log.info(`${title} (${machine}): ${c.status}. Hostnames were not read.`);
      continue;
    }
    if (c.services.length === 0) {
      if (c.observation === 'read') log.info(`${title} (${machine}): running. No public hostname files found.`);
      else log.warn(`${title} (${machine}): ${c.status}, public hostnames unavailable.`);
      continue;
    }
    const lines: string[] = [prism.dim(`on ${machine}`)];
    for (const e of c.services) {
      if (!e.onion) {
        lines.push(`${prism.yellow('?')} ${prism.bold(e.service)}: ${prism.dim('public hostname unavailable')}`);
        continue;
      }
      lines.push(`${prism.green('●')} ${prism.bold(e.service)}: ${prism.cyan(e.onion)}`);
    }
    box(lines.join('\n'), title);
  }
}
