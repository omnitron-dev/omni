/**
 * omnitron k8s pods [namespace] — List Kubernetes pods
 * omnitron k8s deploy scale <name> <replicas> [namespace] — Scale a deployment
 */

import { log } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IOmnitronKubernetesService } from '../shared/dto/services.js';

/**
 * One call to the daemon's Kubernetes service, through `client.service()`.
 *
 * The same walk `pipeline.ts` had, with the same end: it asked
 * `netron.getPeers`, which Netron does not have (its peers are the `peers`
 * Map), walked the `[]` the guard substituted, and printed
 *
 *     ■  Failed: OmnitronKubernetes service not available
 *
 * with exit 0. Measured 2026-09-23 on the development daemon: through
 * `client.service()` the same daemon answered `listPods()` with 9 pods of its
 * kind cluster.
 */
async function withKubernetes<T>(call: (svc: IOmnitronKubernetesService) => Promise<T>): Promise<T> {
  const client = createDaemonClient();
  try {
    return await call(await client.service<IOmnitronKubernetesService>('OmnitronKubernetes'));
  } finally {
    await client.disconnect();
  }
}

export async function k8sPodsCommand(namespace?: string): Promise<void> {
  try {
    const pods = await withKubernetes((svc) => svc.listPods(namespace ? { namespace } : undefined));

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
    // Printed «Failed» and left with exit 0; a failure has to say so to the
    // shell as well.
    process.exitCode = 1;
  }
}

export async function k8sDeployScaleCommand(name: string, replicas: string, namespace?: string): Promise<void> {
  const count = parseInt(replicas, 10);
  if (isNaN(count) || count < 0) {
    log.error(`Invalid replicas count: '${replicas}'`);
    // A refused argument is a failed command — it scaled nothing.
    process.exitCode = 1;
    return;
  }

  try {
    log.info(`Scaling deployment '${name}' to ${count} replicas...`);
    await withKubernetes((svc) =>
      svc.scaleDeployment({ name, replicas: count, ...(namespace ? { namespace } : {}) }),
    );
    log.success(`Deployment '${name}' scaled to ${count} replicas`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
