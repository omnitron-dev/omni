/**
 * omnitron remote add|remove|list|status — Manage remote daemon servers
 *
 * Remote communication uses TCP transport (cross-server fleet RPC).
 */

import { log, table } from '@xec-sh/kit';
import { ServerRegistry } from '../infrastructure/server-registry.js';
import { createRemoteDaemonClient } from '../daemon/daemon-client.js';
import { formatStatus, formatUptime } from '../shared/format.js';

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
  } else {
    log.warn(`Server '${alias}' not found`);
  }
}

export async function remoteListCommand(): Promise<void> {
  const registry = new ServerRegistry();
  const servers = registry.list();

  if (servers.length === 0) {
    log.info('No remote servers registered');
    return;
  }

  table({
    data: servers.map((s) => ({
      alias: s.alias,
      host: `${s.host}:${s.port}`,
      tags: s.tags.join(', ') || '-',
      status: formatStatus(s.status),
      lastSeen: s.lastSeen ? new Date(s.lastSeen).toLocaleString() : 'never',
    })),
    columns: [
      { key: 'alias', header: 'ALIAS' },
      { key: 'host', header: 'HOST' },
      { key: 'tags', header: 'TAGS' },
      { key: 'status', header: 'STATUS' },
      { key: 'lastSeen', header: 'LAST SEEN' },
    ],
  });
}

export async function remoteStatusCommand(alias: string): Promise<void> {
  const registry = new ServerRegistry();
  const server = registry.get(alias);

  if (!server) {
    log.error(`Server '${alias}' not found`);
    return;
  }

  const client = createRemoteDaemonClient(server.host, server.port);

  try {
    const ping = await client.ping();

    // Update registry with last seen
    server.status = 'online';
    server.lastSeen = Date.now();
    registry.add(server);

    log.success(`${alias} (${server.host}:${server.port}) — online`);
    log.info(`  PID: ${ping.pid}  |  Version: ${ping.version}  |  Uptime: ${formatUptime(ping.uptime)}`);

    // Get app list from remote
    const rd = await client.service<import("../shared/dto/services.js").IDaemonService>("OmnitronDaemon"); const apps = await rd.list();
    if (apps.length > 0) {
      log.info(`  Apps: ${apps.map((a) => `${a.name}(${a.status})`).join(', ')}`);
    }
  } catch {
    server.status = 'offline';
    registry.add(server);
    log.error(`${alias} (${server.host}:${server.port}) — offline`);
  }

  await client.disconnect();
}
