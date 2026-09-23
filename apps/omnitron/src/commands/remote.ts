/**
 * omnitron remote add|remove|list|status — Manage remote daemon servers
 *
 * Remote communication uses TCP transport (cross-server fleet RPC).
 *
 * `add` and `remove` edit `servers.json`, the registry this command owns.
 * `list` and `status` read BOTH registries, as `fleet` does: they read
 * `servers.json` alone until 2026-09-23, and on an installation whose remote
 * machine lives in the node registry — daos-test, running six apps — `remote
 * list` printed «No remote servers registered» and `remote status daos-test`
 * printed «Server 'daos-test' not found», exit 0.
 */

import { log, table } from '@xec-sh/kit';
import { ServerRegistry } from '../infrastructure/server-registry.js';
import { NO_MACHINES_MESSAGE, type KnownMachine } from '../infrastructure/known-machines.js';
import { createRemoteDaemonClient } from '../daemon/daemon-client.js';
import { formatStatus, formatUptime } from '../shared/format.js';
import { MeshAsker, askMachine, knownMachines } from './fleet-asking.js';
import { formatCheckedAt, formatDaemon } from './node.js';

export async function remoteAddCommand(
  alias: string,
  host: string,
  opts: { port?: string; tags?: string }
): Promise<void> {
  const registry = new ServerRegistry();
  const port = opts.port ? parseInt(opts.port, 10) : 9700;
  const tags = opts.tags ? opts.tags.split(',').map((t) => t.trim()) : [];

  registry.add({
    alias,
    host,
    port,
    tags,
    status: 'unknown',
    lastSeen: 0,
  });

  log.success(`Added remote server '${alias}' at ${host}:${port}`);
}

export async function remoteRemoveCommand(alias: string): Promise<void> {
  const registry = new ServerRegistry();
  const removed = registry.remove(alias);

  if (removed) {
    log.success(`Removed remote server '${alias}'`);
    return;
  }
  // Not ours to remove — but if it is the other registry's, say where it is.
  const { machines } = await knownMachines();
  const elsewhere = findMachine(alias, machines);
  log.error(
    elsewhere?.nodeId
      ? `'${alias}' is in the node registry, not servers.json — remove it with \`omnitron node remove ${elsewhere.nodeId}\`.`
      : `Server '${alias}' not found in servers.json.`,
  );
  process.exitCode = 1;
}

/**
 * Which known machine a name refers to: its name exactly, its name ignoring
 * case, then its address — `host` or `host:port` — when that is unique.
 */
export function findMachine(name: string, machines: readonly KnownMachine[]): KnownMachine | null {
  const wanted = name.trim();
  const steps: Array<(m: KnownMachine) => boolean> = [
    (m) => m.name === wanted,
    (m) => m.name.toLowerCase() === wanted.toLowerCase(),
    (m) => `${m.host}:${m.port}` === wanted,
    (m) => m.host === wanted,
  ];
  for (const matches of steps) {
    const found = machines.filter(matches);
    if (found.length === 1) return found[0]!;
    if (found.length > 1) return null;
  }
  return null;
}

export async function remoteListCommand(): Promise<void> {
  const { machines, nodes, servers, nodesUnavailable } = await knownMachines();
  if (nodesUnavailable) log.warn(`  ${nodesUnavailable}`);

  if (machines.length === 0) {
    log.info(NO_MACHINES_MESSAGE);
    if (nodesUnavailable) process.exitCode = 1;
    return;
  }

  table({
    width: 'auto',
    data: machines.map((m) => {
      // The freshest reading each registry has: the health monitor's for a
      // node, the last `fleet status` probe for a `servers.json` entry.
      const node = m.nodeId ? nodes.find((n) => n.id === m.nodeId) : undefined;
      const server = servers.find((s) => s.host === m.host && s.port === m.port);
      return {
        alias: m.name,
        host: `${m.host}:${m.port}`,
        registry: m.sources.join(' + '),
        tags: m.tags.join(', ') || '-',
        status: node ? formatDaemon(node.status) : formatStatus(server?.status ?? 'unknown'),
        checked: node
          ? formatCheckedAt(node.status?.checkedAt)
          : server?.lastSeen
            ? formatCheckedAt(new Date(server.lastSeen).toISOString())
            : 'never',
      };
    }),
    columns: [
      { key: 'alias', header: 'NAME' },
      { key: 'host', header: 'HOST' },
      { key: 'registry', header: 'REGISTERED IN' },
      { key: 'tags', header: 'TAGS' },
      { key: 'status', header: 'DAEMON' },
      { key: 'checked', header: 'CHECKED' },
    ],
  });
}

/**
 * Restart an app on a registered remote daemon.
 *
 * This behaviour existed already — as the body of `omnitron deploy`, which
 * announced `Deployed '<app>' to <alias>` after doing nothing but this. The
 * capability is legitimate and had no other home in the CLI: `fleet` only
 * reads, `remote` only managed the registry. So it moves here, under a name
 * that says what it does, rather than being deleted along with the lie.
 *
 * Deployment — building an artifact, shipping it, installing it — is a STACK
 * operation: `omnitron stack start <project> <stack>`.
 *
 * `servers.json` entries only, dialled directly: the master relays reads to a
 * node over the mesh (`getNodeDaemonStatus` and its two siblings) and, by
 * design, no writes — so a node reachable only through the mesh cannot be
 * restarted from here, and is told so rather than timed out against.
 */
export async function remoteRestartCommand(alias: string, app: string): Promise<void> {
  const registry = new ServerRegistry();
  const server = registry.get(alias);

  if (!server) {
    const { machines } = await knownMachines();
    const elsewhere = findMachine(alias, machines);
    log.error(
      elsewhere?.nodeId
        ? `'${alias}' is in the node registry, not servers.json. \`remote restart\` dials a servers.json entry's ` +
            'daemon directly; nothing relays a restart to a node through the mesh.'
        : `Server '${alias}' is not registered. Add it with \`omnitron remote add\`.`,
    );
    process.exitCode = 1;
    return;
  }

  const client = createRemoteDaemonClient(server.host, server.port);
  try {
    // The target is named by host:port, not by alias. An alias is a local
    // label; what an operator needs to see before a write is which machine
    // actually received it.
    log.info(`Restarting '${app}' on ${alias} (${server.host}:${server.port})...`);
    const daemon = await client.service<import('../shared/dto/services.js').IDaemonService>('OmnitronDaemon');
    const result = await daemon.restartApp({ name: app });
    log.success(`'${app}' restarted on ${alias} — ${result.status}${result.pid ? ` (PID: ${result.pid})` : ''}`);
  } catch (err) {
    log.error(`Failed to restart '${app}' on ${alias}: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

/**
 * Ask one known machine's daemon what it is running.
 *
 * The same asking as `fleet status` — direct, or over the master's mesh for
 * a node whose daemon port is shut to this master — and a READ: it used to
 * write `servers.json` with the result, which for a node-registry name
 * created the duplicate entry `known-machines.ts` exists to prevent, and it
 * dialled only directly, so a hardened node was always «offline».
 */
export async function remoteStatusCommand(alias: string): Promise<void> {
  const { machines, nodesUnavailable } = await knownMachines();
  const machine = findMachine(alias, machines);

  if (!machine) {
    log.error(`No machine '${alias}' in servers.json or the node registry.`);
    if (nodesUnavailable) log.warn(`  ${nodesUnavailable}`);
    if (machines.length > 0) log.info(`Known: ${machines.map((m) => `${m.name} (${m.host}:${m.port})`).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const mesh = new MeshAsker();
  try {
    const answer = await askMachine<import('../shared/dto/services.js').DaemonStatusDto>(machine, 'status', mesh);
    const where = `${machine.name} (${machine.host}:${machine.port})`;
    if (!answer.value) {
      log.error(`${where} — no answer: ${answer.error ?? 'unknown reason'}`);
      process.exitCode = 1;
      return;
    }

    const status = answer.value;
    log.success(`${where} — online${answer.via === 'mesh' ? ', through the master\'s mesh' : ''}`);
    log.info(`  PID: ${status.pid}  |  Version: ${status.version}  |  Uptime: ${formatUptime(status.uptime)}`);
    if (status.apps.length > 0) {
      log.info(`  Apps: ${status.apps.map((a) => `${a.name}(${a.status})`).join(', ')}`);
    }
  } finally {
    await mesh.close();
  }
}
