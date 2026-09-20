/**
 * omnitron node — Node management commands
 *
 * Manages infrastructure nodes (machines) that omnitron controls.
 * Only works on master omnitron.
 */

import { log, table } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { requireDaemon } from './daemon-required.js';

/**
 * Render `sshConnected`, which has three states and not two.
 *
 * `null` means no SSH attempt was made — the answer when the daemon is
 * serving these checks itself, which it does whenever the health-monitor
 * worker is down. Printing that as `down` reports a refusal that never
 * happened, and sends an operator to debug SSH on a node whose SSH is fine.
 */
function formatSsh(connected: boolean | null | undefined, form: 'short' | 'long' | 'dot' = 'short'): string {
  if (connected == null) return form === 'long' ? '- not checked' : form === 'dot' ? '-' : '- n/a';
  if (form === 'dot') return connected ? '●' : '○';
  if (form === 'long') return connected ? '● connected' : '○ disconnected';
  return connected ? '● up' : '○ down';
}

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
  if (!(await requireDaemon(client))) {
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
        ssh: n.isLocal ? '-' : formatSsh(n.status?.sshConnected),
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

/**
 * Read an SSH secret from stdin.
 *
 * A node can be declared `--ssh-auth password` and there was no way to give
 * it one: this command handled neither a password nor a key passphrase, so
 * the row said `password` and carried none. Measured on this console — the
 * health monitor reported the node down, `fleet upgrade` could not reach it,
 * and the registry looked correct.
 *
 * From stdin rather than a flag, because an argument is visible to every
 * process on the machine for as long as the command runs, and this one is a
 * root password.
 */
export async function readSecretFromStdin(what: string): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const value = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  if (!value) throw new Error(`No ${what} on stdin — pipe it in, e.g. \`printf %s "$PW" | omnitron node …\``);
  return value;
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
  /** Read the SSH password (or key passphrase) from stdin. */
  secretFromStdin?: boolean;
}): Promise<void> {
  const client = createDaemonClient();
  if (!(await requireDaemon(client))) {
    await client.disconnect();
    return;
  }

  try {
    const { secretFromStdin, ...input } = options;
    const payload: Record<string, unknown> = { ...input };
    if (secretFromStdin) {
      const field = options.sshAuthMethod === 'password' ? 'sshPassword' : 'sshPassphrase';
      payload[field] = await readSecretFromStdin(
        options.sshAuthMethod === 'password' ? 'password' : 'key passphrase',
      );
    }
    const nodes = await client.service<any>('OmnitronNodes');
    const node = await nodes.addNode(payload);
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
  /** Read the SSH password (or key passphrase) from stdin. */
  secretFromStdin?: boolean;
}): Promise<void> {
  const client = createDaemonClient();
  if (!(await requireDaemon(client))) {
    await client.disconnect();
    return;
  }

  try {
    const { secretFromStdin, ...input } = options;
    const payload: Record<string, unknown> = { id, ...input };
    if (secretFromStdin) {
      // Whichever this row now authenticates with. Switching to `password`
      // and sending a passphrase would store a secret nothing reads.
      const field = options.sshAuthMethod === 'key' ? 'sshPassphrase' : 'sshPassword';
      payload[field] = await readSecretFromStdin(
        options.sshAuthMethod === 'key' ? 'key passphrase' : 'password',
      );
    }
    const nodes = await client.service<any>('OmnitronNodes');
    const node = await nodes.updateNode(payload);
    log.success(`Node "${node.name}" updated`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}

export async function nodeRemoveCommand(id: string): Promise<void> {
  const client = createDaemonClient();
  if (!(await requireDaemon(client))) {
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
  if (!(await requireDaemon(client))) {
    await client.disconnect();
    return;
  }

  try {
    const nodes = await client.service<any>('OmnitronNodes');
    if (id) {
      const status = await nodes.checkNodeStatus({ id });
      log.info(`SSH: ${formatSsh(status.sshConnected, 'long')}${status.sshLatencyMs != null ? ` (${status.sshLatencyMs}ms)` : ''}`);
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
        const ssh = formatSsh(s.sshConnected, 'dot');
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
  if (!(await requireDaemon(client))) {
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
