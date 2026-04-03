/**
 * omnitron discover — Scan Docker + SSH for Omnitron-managed targets
 *
 * Discovers:
 * - Docker containers with 'omnitron.managed=true' label
 * - SSH-reachable hosts from fleet node registry
 */

import { box, log, prism, table } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

export async function discoverCommand(): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    // Offline mode: basic Docker discovery without daemon
    log.warn('Daemon is not running — performing local Docker discovery only');
    await localDockerDiscovery();
    await client.disconnect();
    return;
  }

  try {
    // Use OmnitronDiscovery RPC service via daemon
    // The daemon-client only exposes IDaemonService, so we use exec to call
    // the OmnitronDiscovery service methods via the generic exec RPC
    const result = await client.exec({
      name: '__daemon__',
      service: 'OmnitronDiscovery',
      method: 'scanAll',
      args: [],
    } as any);

    const scan = result as any;

    const lines: string[] = [];

    // Docker containers
    if (scan.docker?.length > 0) {
      lines.push(prism.bold('Docker Containers'));
      lines.push('');

      table({
        data: scan.docker.map((t: any) => ({
          name: t.name,
          status: t.status === 'running' ? prism.green(t.status) : prism.red(t.status),
          address: t.address,
          port: t.port ?? '-',
          id: t.id.slice(0, 12),
        })),
        columns: [
          { key: 'name', header: 'NAME' },
          { key: 'status', header: 'STATUS' },
          { key: 'address', header: 'ADDRESS' },
          { key: 'port', header: 'PORT' },
          { key: 'id', header: 'ID' },
        ],
      });
    } else {
      lines.push(prism.dim('No Docker containers found with omnitron.managed=true'));
    }

    lines.push('');

    // SSH nodes
    if (scan.ssh?.length > 0) {
      lines.push(prism.bold('SSH Nodes'));
      lines.push('');

      table({
        data: scan.ssh.map((t: any) => ({
          name: t.name,
          status: t.status === 'reachable' ? prism.green(t.status) : prism.red(t.status),
          address: t.address,
          port: t.port ?? 9700,
        })),
        columns: [
          { key: 'name', header: 'HOST' },
          { key: 'status', header: 'STATUS' },
          { key: 'address', header: 'ADDRESS' },
          { key: 'port', header: 'PORT' },
        ],
      });
    } else {
      lines.push(prism.dim('No SSH nodes registered (use `omnitron remote add` to register nodes)'));
    }

    lines.push('');
    lines.push(prism.dim(`Scan completed in ${scan.duration ?? 0}ms`));

    box(lines.join('\n'), 'Discovery Scan');
  } catch (err) {
    // Fallback: direct scan if exec to OmnitronDiscovery fails
    log.warn(`RPC discovery unavailable: ${(err as Error).message}`);
    log.info('Falling back to local Docker discovery');
    await localDockerDiscovery();
  }

  await client.disconnect();
}

/**
 * Fallback: scan Docker directly without daemon.
 */
async function localDockerDiscovery(): Promise<void> {
  try {
    const { execSync } = await import('node:child_process');
    const output = execSync(
      'docker ps --filter "label=omnitron.managed=true" --format "{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
      { encoding: 'utf-8', timeout: 10_000 }
    ).trim();

    if (!output) {
      log.info('No Docker containers found with omnitron.managed=true label');
      return;
    }

    const containers = output.split('\n').map((line) => {
      const [id = '', name = '', status = '', ports = ''] = line.split('\t');
      return {
        id: id.slice(0, 12),
        name,
        status: status.includes('Up') ? prism.green('running') : prism.red('stopped'),
        ports: ports || '-',
      };
    });

    table({
      data: containers,
      columns: [
        { key: 'name', header: 'NAME' },
        { key: 'status', header: 'STATUS' },
        { key: 'ports', header: 'PORTS' },
        { key: 'id', header: 'ID' },
      ],
    });
  } catch {
    log.error('Docker is not available or not running');
  }
}
