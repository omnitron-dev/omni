import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { HandoffTicket } from '@omnitron-dev/titan-pm';
import type { IEcosystemConfig, IDaemonConfig } from '../config/types.js';
import { expandPath } from '../shared/paths.js';
import { PidManager } from './pid-manager.js';
import { ExecutionClient } from './execution-client.js';
import { ExecutionJournal } from './execution-journal.js';
import { residentOwnerRefusal } from './execution-platform.js';

export function executionDirectory(dc: IDaemonConfig): string {
  return expandPath(dc.executionHost?.directory ?? path.join(path.dirname(expandPath(dc.pidFile)), 'execution'));
}

export async function connectExecutionOwner(
  config: IEcosystemConfig, dc: IDaemonConfig, logger: ILogger, ticket?: HandoffTicket,
): Promise<{ client: ExecutionClient; reused: boolean }> {
  const refusal = residentOwnerRefusal();
  if (refusal) throw new Error(refusal);
  const directory = executionDirectory(dc);
  if (Buffer.byteLength(path.join(directory, `c-${randomUUID()}.sock`)) > 100) {
    throw new Error('Execution directory is too long for a private control socket; configure a shorter executionHost.directory');
  }
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) throw new Error('Execution directory must be private and owned by this user');
  const marker = new PidManager(path.join(directory, 'owner.pid'));
  const reused = marker.isRunning();
  if (!reused) {
    if (ticket) throw new Error('The execution owner died during handoff; refusing to restart or adopt applications silently');
    const entry = fileURLToPath(new URL('./execution-entry.js', import.meta.url));
    await fs.access(entry);
    const boot = path.join(directory, `boot-${randomUUID()}.json`);
    await fs.writeFile(boot, JSON.stringify({ directory, cwd: process.cwd(), config, daemonConfig: dc }, (_key, value: unknown) => {
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
        throw new Error('Execution configuration must be serializable; keep application code in its bootstrap module');
      }
      return value;
    }), { flag: 'wx', mode: 0o600 });
    const output = await fs.open(path.join(directory, 'owner.log'), 'a', 0o600);
    try {
      const child = fork(entry, [boot], { cwd: process.cwd(), detached: true, execArgv: [],
        stdio: ['ignore', output.fd, output.fd, 'ipc'] });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error(`Execution owner did not become ready; inspect ${directory}/owner.log. No running owner was terminated.`)), 30_000);
        const finish = (error?: Error) => {
          clearTimeout(timer);
          child.off('error', onError); child.off('exit', onExit); child.off('message', onMessage);
          if (error) reject(error); else resolve();
        };
        const onError = (error: Error) => finish(error);
        const onExit = (code: number | null) => finish(new Error(`Execution owner exited ${code}; inspect ${directory}/owner.log`));
        const onMessage = (message: unknown) => {
          const record = message as { type?: string; owner?: { pid?: number } };
          if (record.type === 'execution-ready' && record.owner?.pid === child.pid) finish();
        };
        child.once('error', onError); child.once('exit', onExit); child.on('message', onMessage);
      });
      child.unref();
    } finally { await output.close(); await fs.unlink(boot); }
  }
  const client = new ExecutionClient(path.join(directory, 'owner.sock'), logger, ticket?.to.controllerId);
  try {
    const snapshot = await client.connect();
    const durable = await new ExecutionJournal(path.join(directory, 'controller.json')).read();
    if (!durable || durable.owner.id !== snapshot.status.owner.id || durable.owner.pid !== marker.getPid()) {
      throw new Error('Execution socket, process marker and journal disagree; adoption is refused');
    }
    if (ticket) {
      if (ticket.ownerId !== durable.owner.id) throw new Error('The handoff belongs to a different execution owner');
      await client.accept(ticket, snapshot.inventoryDigest);
    } else {
      if (reused && snapshot.apps.length > 0) throw new Error('Resident applications are already running. Restore the saved backend handoff instead of running startup reconciliation.');
      await client.acquire();
    }
    return { client, reused };
  } catch (error) { await client.close(); throw error; }
}
