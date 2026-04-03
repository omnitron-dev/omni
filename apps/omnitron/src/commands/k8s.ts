/**
 * omnitron k8s pods [namespace] — List Kubernetes pods
 * omnitron k8s deploy scale <name> <replicas> [namespace] — Scale a deployment
 */

import { log } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

async function invokeRpc(method: string, data?: any): Promise<any> {
  const client = createDaemonClient();
  try {
    await (client as any).ensureConnected();
    const netron = (client as any).netron;
    const peers = netron.getPeers ? netron.getPeers() : [];
    for (const peer of peers) {
      try {
        const svc = await peer.queryInterface('OmnitronKubernetes');
        if (svc && typeof svc[method] === 'function') {
          return data ? await svc[method](data) : await svc[method]();
        }
      } catch {
        continue;
      }
    }
    throw new Error('OmnitronKubernetes service not available');
  } finally {
    await client.disconnect();
  }
}

export async function k8sPodsCommand(namespace?: string): Promise<void> {
  try {
    const pods: any[] = await invokeRpc('listPods', namespace ? { namespace } : undefined);

    if (pods.length === 0) {
      log.info('No pods found');
      return;
    }

    log.info(`Found ${pods.length} pod(s):\n`);
    const header = ['Name', 'Namespace', 'Status', 'Ready', 'Restarts', 'Age', 'Node']
      .map((h) => h.padEnd(18))
      .join('');
    log.info(header);
    log.info('-'.repeat(126));

    for (const pod of pods) {
      log.info([
        (pod.name ?? '').slice(0, 17).padEnd(18),
        (pod.namespace ?? '').padEnd(18),
        (pod.status ?? '').padEnd(18),
        (pod.ready ? 'Yes' : 'No').padEnd(18),
        String(pod.restarts ?? 0).padEnd(18),
        (pod.age ?? '').padEnd(18),
        (pod.node ?? '').slice(0, 17).padEnd(18),
      ].join(''));
    }
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}

export async function k8sDeployScaleCommand(name: string, replicas: string, namespace?: string): Promise<void> {
  const count = parseInt(replicas, 10);
  if (isNaN(count) || count < 0) {
    log.error(`Invalid replicas count: '${replicas}'`);
    return;
  }

  try {
    log.info(`Scaling deployment '${name}' to ${count} replicas...`);
    await invokeRpc('scaleDeployment', { name, replicas: count, namespace });
    log.success(`Deployment '${name}' scaled to ${count} replicas`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}
