/**
 * `omnitron tor [project] [stack]` — inspect Tor hidden service onion addresses.
 *
 * Reads `/var/lib/tor/<name>/hostname` from a running tor container via
 * `docker exec`, and lists each hidden service with its .onion address.
 * Useful since onions are not knowable until tor has generated the keys
 * (first start) and never appear in logs unless tor is run with debug
 * verbosity.
 *
 * Whose onion, and on which machine, is part of the answer. The command took
 * the first container on THIS machine whose name ended in `-tor` and printed
 * its onions under a bare «Tor Hidden Services» — measured 2026-09-23, the
 * dev stack's (`daos-dev-tor`: portal `ohtohqkc5pknagnl…onion`), which is not
 * the test portal (`6me2nawd…c7cid.onion`, on 37.27.130.185), and nothing on
 * screen said which it was; the container was named only under --json.
 *
 * Supports `--json` for scripting.
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
 * service resolver gives it (e.g. `daos-dev-tor`, `omnitron-tor`).
 */
function isTor(c: ContainerState): boolean {
  return c.service === 'tor' || /(^|-)tor$/i.test(c.name);
}

/** Whether a container belongs to the stack asked about: labels first, name second. */
function belongsTo(c: ContainerState, project: string | undefined, stack: string | undefined): boolean {
  if (!project) return true;
  if (c.project || c.stack) return c.project === project && (!stack || c.stack === stack);
  return c.name.startsWith(stack ? `${project}-${stack}-` : `${project}-`);
}

/** `project/stack` as the container's labels say, or its name when they do not. */
function stackOf(c: ContainerState): string {
  return c.project && c.stack ? `${c.project}/${c.stack}` : `unlabelled (${c.name})`;
}

/**
 * List the directories under /var/lib/tor that look like hidden services
 * (i.e. contain a `hostname` file) and read each hostname.
 */
async function readOnions(container: string): Promise<OnionEntry[]> {
  // `find` (BusyBox-compatible) lists hidden-service hostname files — more
  // portable across container shells than glob expansion in a quoted
  // `sh -c '...'`, which has shown up as empty output via some runtime
  // adapters. We avoid `-printf` (not in BusyBox find).
  let raw: string;
  try {
    raw = await execInContainer(container, [
      'find',
      '/var/lib/tor',
      '-mindepth', '2',
      '-maxdepth', '2',
      '-name', 'hostname',
      '-type', 'f',
    ]);
  } catch {
    return [];
  }

  const paths = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  const entries: OnionEntry[] = [];
  for (const p of paths) {
    // Service name is the parent dir of hostname.
    const dir = p.replace(/\/hostname$/, '');
    const service = dir.split('/').pop() ?? '';
    let onion: string | null = null;
    try {
      const content = await execInContainer(container, ['cat', p]);
      onion = content.trim() || null;
    } catch {
      // hostname unreadable (permissions, race) — leave null
    }
    entries.push({ service, onion, source: p });
  }
  return entries;
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
    const message =
      `${project}/${stack} is a ${info.type} stack: its tor container ${container} runs on ${where}, not on this machine. ` +
      'No daemon RPC reads an onion address from a node, so none is printed here.';
    if (emitError(message, { project, stack, container, hosts })) return;
    for (const host of hosts) {
      log.info(`  On the node: ssh <user>@${host} docker exec ${container} sh -c 'cat /var/lib/tor/*/hostname'`);
    }
  } catch (err) {
    emitError(`No tor container for ${project}/${stack} on this machine, and the daemon could not say where it runs: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}

export async function torCommand(project?: string, stack?: string): Promise<void> {
  const here = (await listManagedContainers()).filter(isTor);
  const chosen = here.filter((c) => belongsTo(c, project, stack));

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
  const found = [];
  for (const c of chosen) {
    found.push({ container: c.name, project: c.project ?? null, stack: c.stack ?? null, services: await readOnions(c.name) });
  }

  // One container keeps the old top-level `container` and `services`, so a
  // script written against them still reads them; `containers` holds every
  // one, each with its stack, and `machine` says whose disk they are on.
  if (emitJson({ machine: 'this machine', hostname: machine, containers: found, ...(found.length === 1 ? found[0] : {}) })) {
    return;
  }

  for (const [i, c] of found.entries()) {
    const title = `Tor Hidden Services — ${c.container}, stack ${stackOf(chosen[i]!)}, this machine (${machine})`;
    if (c.services.length === 0) {
      log.warn(`${title}: running, but no hidden services have been published yet.`);
      log.info('Tor needs ~30-90s after first start to generate keys and publish HSes.');
      log.info(`Try 'docker logs ${c.container}' to see bootstrap progress.`);
      continue;
    }
    const lines: string[] = [];
    for (const e of c.services) {
      if (!e.onion) {
        lines.push(`${prism.yellow('?')} ${prism.bold(e.service)}: ${prism.dim('not yet generated')}`);
        continue;
      }
      lines.push(`${prism.green('●')} ${prism.bold(e.service)}: ${prism.cyan(e.onion)}`);
    }
    box(lines.join('\n'), title);
  }
}
