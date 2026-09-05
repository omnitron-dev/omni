/**
 * omnitron node — Node management commands
 *
 * Manages infrastructure nodes (machines) that omnitron controls.
 * Only works on master omnitron.
 */

import { log, table } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

/**
 * How long ago a node's status was taken.
 *
 * `checkedAt` travels all the way from the service to the console's own type
 * declaration and is displayed nowhere, so a node that went down an hour ago
 * reads as reachable until someone re-checks it. A reachability answer
 * without its age is the reading most likely to be believed and least likely
 * to be current.
 */
export function formatCheckedAt(iso: string | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'never';
  if (ms < 0) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export async function nodeListCommand(): Promise<void> {
  const client = createDaemonClient();
  if (!(await client.isReachable())) {
    log.error('Daemon is not running. Start with `omnitron up`.');
    await client.disconnect();
    return;
  }

  try {
    const nodes = await client.service<any>('OmnitronNodes');
    const list = await nodes.listNodes();

    if (list.length === 0) {
      log.info('No nodes registered.');
      return;
    }

    // `table` takes an options object — `{ data, columns }` — and throws
    // `TypeError: Table data must be an array` on a bare array. Both calls in
    // this file passed one, so `omnitron node list` and `omnitron node
    // ssh-keys` failed every time they had something to show; the empty case
    // returns earlier, which is the only path that ever worked.
    table({
      width: 'auto',
      data: list.map((n: any) => ({
        id: n.isLocal ? n.id : n.id.slice(0, 8),
        name: n.name,
        // The SSH port rides along with the host and the daemon port is
        // left to `omnitron node show`: extra columns are the difference
        // between a readable table and one where every cell is an ellipsis.
        host: `${n.host}:${n.sshPort}`,
        ssh: n.isLocal ? '-' : n.status?.sshConnected ? '● up' : '○ down',
        omnitron: n.status?.omnitronConnected ? `● v${n.status.omnitronVersion ?? '?'}` : '○ offline',
        checked: formatCheckedAt(n.status?.checkedAt),
        tags: n.tags.join(', ') || '-',
      })),
      columns: [
        { key: 'id', header: 'ID', width: 9 },
        { key: 'name', header: 'Name', width: 16 },
        { key: 'host', header: 'Host:SSH', width: 21 },
        { key: 'ssh', header: 'SSH', width: 7 },
        { key: 'omnitron', header: 'Daemon', width: 12 },
        { key: 'checked', header: 'Seen', width: 9 },
        { key: 'tags', header: 'Tags', width: 12 },
      ],
    });
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}

export async function nodeAddCommand(options: {
  name: string;
  host: string;
  sshPort?: number;
  sshUser?: string;
  sshAuthMethod?: 'password' | 'key';
  sshPrivateKey?: string;
  runtime?: 'node' | 'bun';
  daemonPort?: number;
  tags?: string[];
}): Promise<void> {
  const client = createDaemonClient();
  if (!(await client.isReachable())) {
    log.error('Daemon is not running.');
    await client.disconnect();
    return;
  }

  try {
    const nodes = await client.service<any>('OmnitronNodes');
    const node = await nodes.addNode(options);
    log.success(`Node "${node.name}" added (${node.host}, id: ${node.id.slice(0, 8)})`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}

export async function nodeUpdateCommand(id: string, options: {
  name?: string;
  host?: string;
  sshPort?: number;
  sshUser?: string;
  sshAuthMethod?: 'password' | 'key';
  sshPrivateKey?: string;
  runtime?: 'node' | 'bun';
  daemonPort?: number;
  tags?: string[];
}): Promise<void> {
  const client = createDaemonClient();
  if (!(await client.isReachable())) {
    log.error('Daemon is not running.');
    await client.disconnect();
    return;
  }

  try {
    const nodes = await client.service<any>('OmnitronNodes');
    const node = await nodes.updateNode({ id, ...options });
    log.success(`Node "${node.name}" updated`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}

export async function nodeRemoveCommand(id: string): Promise<void> {
  const client = createDaemonClient();
  if (!(await client.isReachable())) {
    log.error('Daemon is not running.');
    await client.disconnect();
    return;
  }

  try {
    const nodes = await client.service<any>('OmnitronNodes');
    await nodes.removeNode({ id });
    log.success('Node removed');
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}

export async function nodeCheckCommand(id?: string): Promise<void> {
  const client = createDaemonClient();
  if (!(await client.isReachable())) {
    log.error('Daemon is not running.');
    await client.disconnect();
    return;
  }

  try {
    const nodes = await client.service<any>('OmnitronNodes');
    if (id) {
      const status = await nodes.checkNodeStatus({ id });
      log.info(`SSH: ${status.sshConnected ? '● connected' : '○ disconnected'}${status.sshLatencyMs != null ? ` (${status.sshLatencyMs}ms)` : ''}`);
      log.info(`Omnitron: ${status.omnitronConnected ? `● v${status.omnitronVersion}` : '○ offline'}`);
      if (status.os) {
        log.info(`OS: ${status.os.platform} ${status.os.arch} (${status.os.hostname})`);
      }
      if (status.sshError) {
        log.warn(`SSH error: ${status.sshError}`);
      }
      if (status.omnitronError) {
        log.warn(`Omnitron error: ${status.omnitronError}`);
      }
    } else {
      const statuses = await nodes.checkAllNodes();
      for (const s of statuses) {
        const node = await nodes.getNode({ id: s.nodeId });
        const name = node?.name ?? s.nodeId;
        const ssh = s.sshConnected ? '●' : '○';
        const omn = s.omnitronConnected ? '●' : '○';
        log.info(`${name}: SSH ${ssh}  Omnitron ${omn}`);
      }
    }
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}

export async function nodeSshKeysCommand(): Promise<void> {
  const client = createDaemonClient();
  if (!(await client.isReachable())) {
    log.error('Daemon is not running.');
    await client.disconnect();
    return;
  }

  try {
    const nodes = await client.service<any>('OmnitronNodes');
    const keys = await nodes.listSshKeys();

    if (keys.length === 0) {
      log.info('No SSH private keys found in ~/.ssh/');
      return;
    }

    table({
      width: 'auto',
      data: keys.map((k: any) => ({ name: k.name, type: k.type, path: k.path })),
      columns: [
        { key: 'name', header: 'Name', width: 24 },
        { key: 'type', header: 'Type', width: 12 },
        { key: 'path', header: 'Path', width: 48 },
      ],
    });
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}
