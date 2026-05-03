/**
 * `omnitron tor` — inspect Tor hidden service onion addresses.
 *
 * Reads `/var/lib/tor/<name>/hostname` from the running tor container
 * via `docker exec`, lists all configured hidden services with their
 * .onion addresses. Useful since onions are not knowable until tor has
 * generated the keys (first start) and never appear in logs unless tor
 * is run with debug verbosity.
 *
 * Supports `--json` for scripting.
 */

import { box, log, prism } from '@xec-sh/kit';
import { listManagedContainers, execInContainer } from '../infrastructure/container-runtime.js';
import { emitJson, emitError, isJsonMode } from './output.js';

interface OnionEntry {
  service: string;
  onion: string | null;
  /** Container path where the hostname was read. */
  source: string;
}

/**
 * Locate the tor container regardless of stack prefix. Tor preset
 * uses service name 'tor' which becomes `<prefix>-tor` per service-resolver
 * (e.g. `omni-dev-tor`, `omnitron-tor`).
 */
async function findTorContainer(): Promise<string | null> {
  const all = await listManagedContainers();
  // Name-suffix match: anything ending in `-tor` or exactly `tor`.
  const match = all.find((c) => /(^|-)tor$/i.test(c.name));
  return match?.name ?? null;
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
  let raw = '';
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

export async function torCommand(): Promise<void> {
  const container = await findTorContainer();
  if (!container) {
    if (isJsonMode()) {
      emitError('No tor container found. Add a `tor` service to your omnitron.config.ts.');
    } else {
      log.warn('No tor container found.');
      log.info('Add a `tor` service to your omnitron.config.ts:');
      log.info("  services: { tor: { preset: 'tor', config: { hiddenServices: [...] } } }");
    }
    process.exitCode = 1;
    return;
  }

  const entries = await readOnions(container);

  if (emitJson({ container, services: entries })) return;

  if (entries.length === 0) {
    log.warn(`Tor container '${container}' is running but no hidden services have been published yet.`);
    log.info('Tor needs ~30-90s after first start to generate keys and publish HSes.');
    log.info(`Try 'docker logs ${container}' to see bootstrap progress.`);
    return;
  }

  const lines: string[] = [];
  for (const e of entries) {
    if (!e.onion) {
      lines.push(`${prism.yellow('?')} ${prism.bold(e.service)}: ${prism.dim('not yet generated')}`);
      continue;
    }
    lines.push(`${prism.green('●')} ${prism.bold(e.service)}: ${prism.cyan(e.onion)}`);
  }
  box(lines.join('\n'), 'Tor Hidden Services');
}
