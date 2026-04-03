/**
 * omnitron node — Node management commands
 *
 * Manages infrastructure nodes (machines) that omnitron controls.
 * Only works on master omnitron.
 */

import { log, table } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

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

    const rows = list.map((n: any) => ({
      ID: n.isLocal ? n.id : n.id.slice(0, 8),
      Name: n.name,
      Host: n.host,
      'SSH Port': n.sshPort,
      'Daemon Port': n.daemonPort,
      Runtime: n.runtime,
      SSH: n.isLocal ? '-' : (n.status?.sshConnected ? '● connected' : '○ disconnected'),
      Omnitron: n.status?.omnitronConnected ? `● v${n.status.omnitronVersion ?? '?'}` : '○ offline',
      Tags: n.tags.join(', ') || '-',
    }));

    table(rows);
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

    const rows = keys.map((k: any) => ({
      Name: k.name,
      Type: k.type,
      Path: k.path,
    }));

    table(rows);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}
