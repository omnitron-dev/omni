/**
 * omnitron node — Node management commands
 *
 * Manages infrastructure nodes (machines) that omnitron controls.
 * Only works on master omnitron.
 */

import { log, table } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { requireDaemon } from './daemon-required.js';
import type { INodeStatus, INodeWithStatus } from '../shared/dto/nodes.js';

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

/**
 * Render whether the node's daemon answered, which has three states and not
 * two — the same as `formatSsh`.
 *
 * `null` means no path reached the daemon: not the mesh, not a direct dial.
 * That is not «offline». The daemon's own check used to write `false` there,
 * and this printed `○ offline` about a node serving six apps through a mesh
 * connection the check had never asked. A node never checked at all has no
 * status, and says so rather than borrowing either answer.
 */
export function formatDaemon(
  status: Pick<INodeStatus, 'omnitronConnected' | 'omnitronVersion'> | null | undefined,
  form: 'short' | 'dot' = 'short',
): string {
  if (!status) return form === 'dot' ? '-' : '- not checked';
  if (status.omnitronConnected === true) return form === 'dot' ? '●' : `● v${status.omnitronVersion ?? '?'}`;
  if (status.omnitronConnected === false) return form === 'dot' ? '○' : '○ offline';
  return form === 'dot' ? '?' : '? unknown';
}

/** Which registered node an argument names, if exactly one. */
export type NodeResolution<T> =
  | { readonly kind: 'found'; readonly node: T }
  | { readonly kind: 'ambiguous'; readonly matches: readonly T[] }
  | { readonly kind: 'none' };

/**
 * Resolve what an operator typed to one registered node.
 *
 * `node list` prints the first eight characters of each id, and every
 * command that takes an id passed the argument through as it was typed — so
 * the id the product prints was accepted by no command. Measured
 * 2026-09-23: `node check 16f3dd5a` and `node check daos-test` both answered
 * «Node not found», exit 0.
 *
 * In order: the whole id; the name exactly; the name ignoring case; a
 * prefix of the id. An exact answer wins over a looser one, and at each
 * step more than one match is ambiguous rather than a guess — acting on the
 * first of two nodes is how a `remove` lands on the wrong machine.
 */
export function resolveNodeArgument<T extends { readonly id: string; readonly name: string }>(
  argument: string,
  nodes: readonly T[],
): NodeResolution<T> {
  const wanted = argument.trim();
  if (!wanted) return { kind: 'none' };

  const byId = nodes.find((n) => n.id === wanted);
  if (byId) return { kind: 'found', node: byId };

  const steps: Array<(n: T) => boolean> = [
    (n) => n.name === wanted,
    (n) => n.name.toLowerCase() === wanted.toLowerCase(),
    (n) => n.id.startsWith(wanted),
  ];
  for (const matches of steps) {
    const found = nodes.filter(matches);
    if (found.length === 1) return { kind: 'found', node: found[0]! };
    if (found.length > 1) return { kind: 'ambiguous', matches: found };
  }
  return { kind: 'none' };
}

/** The slice of `OmnitronNodes` these commands call. */
interface NodesService {
  listNodes(): Promise<INodeWithStatus[]>;
  getNode(data: { id: string }): Promise<INodeWithStatus | null>;
  addNode(data: Record<string, unknown>): Promise<INodeWithStatus>;
  updateNode(data: Record<string, unknown>): Promise<INodeWithStatus>;
  removeNode(data: { id: string }): Promise<void>;
  checkNodeStatus(data: { id: string }): Promise<INodeStatus>;
  checkAllNodes(): Promise<INodeStatus[]>;
  listSshKeys(): Promise<Array<{ name: string; type: string; path: string }>>;
}

/**
 * Find the node an argument names, or say why not and fail the command.
 *
 * `null` after reporting: the caller only has to return.
 */
async function resolveRegisteredNode(nodes: NodesService, argument: string): Promise<INodeWithStatus | null> {
  const registered = await nodes.listNodes();
  const resolution = resolveNodeArgument(argument, registered);
  if (resolution.kind === 'found') return resolution.node;

  if (resolution.kind === 'ambiguous') {
    log.error(`'${argument}' names ${resolution.matches.length} nodes — give more of the id:`);
    for (const n of resolution.matches) log.info(`  ${n.id}  ${n.name}  ${n.host}`);
  } else {
    log.error(`No node '${argument}' in the registry.`);
    if (registered.length > 0) {
      log.info(`Registered: ${registered.map((n) => `${n.name} (${n.isLocal ? n.id : n.id.slice(0, 8)})`).join(', ')}`);
    }
  }
  process.exitCode = 1;
  return null;
}

export async function nodeListCommand(): Promise<void> {
  const client = await openDaemon();
  if (!client) return;

  try {
    const nodes = await client.service<NodesService>('OmnitronNodes');
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
      data: list.map((n) => ({
        // Eight characters, and every command that takes a node resolves
        // them — see `resolveNodeArgument`.
        id: n.isLocal ? n.id : n.id.slice(0, 8),
        name: n.name,
        // The SSH port rides along with the host and the daemon port is
        // left to `omnitron node check <id>`, which prints the whole address:
        // extra columns are the difference between a readable table and one
        // where every cell is an ellipsis. (This said `omnitron node show`,
        // a command that does not exist.)
        host: `${n.host}:${n.sshPort}`,
        ssh: n.isLocal ? '-' : formatSsh(n.status?.sshConnected),
        omnitron: formatDaemon(n.status),
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
    fail(err);
  } finally {
    await client.disconnect();
  }
}

/**
 * Report a failed command, in prose AND in the exit code.
 *
 * Every command in this file printed `Failed: …` and exited 0, so a script
 * running `omnitron node check <id> && …` went on as if it had worked.
 */
function fail(err: unknown): void {
  log.error(`Failed: ${(err as Error).message}`);
  process.exitCode = 1;
}

/**
 * Open the daemon for a node command, or say why not and fail the command.
 *
 * `null` after reporting. `requireDaemon` says why the daemon did not
 * answer and leaves the exit code alone, because some of its callers can
 * carry on without one; none of these can.
 */
async function openDaemon(): Promise<ReturnType<typeof createDaemonClient> | null> {
  const client = createDaemonClient();
  if (await requireDaemon(client)) return client;
  process.exitCode = 1;
  await client.disconnect();
  return null;
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
  const client = await openDaemon();
  if (!client) return;

  try {
    const { secretFromStdin, ...input } = options;
    const payload: Record<string, unknown> = { ...input };
    if (secretFromStdin) {
      const field = options.sshAuthMethod === 'password' ? 'sshPassword' : 'sshPassphrase';
      payload[field] = await readSecretFromStdin(
        options.sshAuthMethod === 'password' ? 'password' : 'key passphrase',
      );
    }
    const nodes = await client.service<NodesService>('OmnitronNodes');
    const node = await nodes.addNode(payload);
    log.success(`Node "${node.name}" added (${node.host}, id: ${node.id.slice(0, 8)})`);
  } catch (err) {
    fail(err);
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
  const client = await openDaemon();
  if (!client) return;

  try {
    const nodes = await client.service<NodesService>('OmnitronNodes');
    const node = await resolveRegisteredNode(nodes, id);
    if (!node) return;

    const { secretFromStdin, ...input } = options;
    const payload: Record<string, unknown> = { id: node.id, ...input };
    if (secretFromStdin) {
      // Whichever this row now authenticates with. Switching to `password`
      // and sending a passphrase would store a secret nothing reads.
      const field = options.sshAuthMethod === 'key' ? 'sshPassphrase' : 'sshPassword';
      payload[field] = await readSecretFromStdin(
        options.sshAuthMethod === 'key' ? 'key passphrase' : 'password',
      );
    }
    const updated = await nodes.updateNode(payload);
    log.success(`Node "${updated.name}" updated`);
  } catch (err) {
    fail(err);
  } finally {
    await client.disconnect();
  }
}

export async function nodeRemoveCommand(id: string): Promise<void> {
  const client = await openDaemon();
  if (!client) return;

  try {
    const nodes = await client.service<NodesService>('OmnitronNodes');
    const node = await resolveRegisteredNode(nodes, id);
    if (!node) return;
    await nodes.removeNode({ id: node.id });
    // Named in full: a removal resolved from a prefix or a name must say
    // which row it deleted.
    log.success(`Node "${node.name}" (${node.id}, ${node.host}) removed`);
  } catch (err) {
    fail(err);
  } finally {
    await client.disconnect();
  }
}

export async function nodeCheckCommand(id?: string): Promise<void> {
  const client = await openDaemon();
  if (!client) return;

  try {
    const nodes = await client.service<NodesService>('OmnitronNodes');
    if (id) {
      const node = await resolveRegisteredNode(nodes, id);
      if (!node) return;

      // The whole address, daemon port included — the one place the CLI
      // prints it, and the port the direct dial goes to.
      log.info(`${node.name} (${node.id}) — ${node.host}, SSH port ${node.sshPort}, daemon port ${node.daemonPort}`);
      const status = await nodes.checkNodeStatus({ id: node.id });
      log.info(`SSH: ${formatSsh(status.sshConnected, 'long')}${status.sshLatencyMs != null ? ` (${status.sshLatencyMs}ms)` : ''}`);
      log.info(`Omnitron: ${formatDaemon(status)}`);
      if (status.os) {
        log.info(`OS: ${status.os.platform} ${status.os.arch} (${status.os.hostname})`);
      }
      if (status.sshError) {
        log.warn(`SSH error: ${status.sshError}`);
      }
      if (status.omnitronError) {
        log.warn(`Omnitron error: ${status.omnitronError}`);
      }
      log.info(`Checked ${formatCheckedAt(status.checkedAt)}`);
    } else {
      // The registry decides what is printed, and each line says how old its
      // reading is. The statuses came back keyed by id, and a status whose id
      // the registry no longer held was printed as that bare id with two
      // green dots — measured 2026-09-23 for a node removed 82 minutes
      // earlier, its reading as old as that and its age shown nowhere.
      const registered = await nodes.listNodes();
      const statuses = await nodes.checkAllNodes();
      const byId = new Map(statuses.map((s) => [s.nodeId, s]));
      for (const node of registered) {
        const s = byId.get(node.id);
        if (!s) {
          log.info(`${node.name}: not checked in this round`);
          continue;
        }
        log.info(
          `${node.name}: SSH ${formatSsh(s.sshConnected, 'dot')}  Omnitron ${formatDaemon(s, 'dot')}  checked ${formatCheckedAt(s.checkedAt)}`,
        );
      }
      const orphans = statuses.filter((s) => !registered.some((n) => n.id === s.nodeId));
      if (orphans.length > 0) {
        log.warn(`Ignored ${orphans.length} status(es) for nodes no longer in the registry: ${orphans.map((s) => s.nodeId).join(', ')}`);
      }
    }
  } catch (err) {
    fail(err);
  } finally {
    await client.disconnect();
  }
}

export async function nodeSshKeysCommand(): Promise<void> {
  const client = await openDaemon();
  if (!client) return;

  try {
    const nodes = await client.service<NodesService>('OmnitronNodes');
    const keys = await nodes.listSshKeys();

    if (keys.length === 0) {
      log.info('No SSH private keys found in ~/.ssh/');
      return;
    }

    table({
      width: 'auto',
      data: keys.map((k) => ({ name: k.name, type: k.type, path: k.path })),
      columns: [
        { key: 'name', header: 'Name', width: 24 },
        { key: 'type', header: 'Type', width: 12 },
        { key: 'path', header: 'Path', width: 48 },
      ],
    });
  } catch (err) {
    fail(err);
  } finally {
    await client.disconnect();
  }
}
