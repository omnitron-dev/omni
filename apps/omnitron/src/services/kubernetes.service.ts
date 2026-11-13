import { KubernetesAdapter } from '@xec-sh/core';
import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule, type ILogger } from '@omnitron-dev/titan/module/logger';
import type { K8sPod, K8sDeployment, K8sService, PortForwardHandle } from '../shared/dto/kubernetes.js';

interface ResourceMetadata {
  name: string;
  namespace: string;
  creationTimestamp: string;
  labels?: Record<string, string>;
}

interface PodResource {
  metadata: ResourceMetadata;
  spec?: { nodeName?: string };
  status?: { phase?: string; containerStatuses?: Array<{ ready: boolean; restartCount: number }> };
}

interface DeploymentResource {
  metadata: ResourceMetadata;
  spec?: { replicas?: number };
  status?: { availableReplicas?: number; readyReplicas?: number };
}

interface ServiceResource {
  metadata: ResourceMetadata;
  spec?: {
    type?: string;
    clusterIP?: string;
    ports?: Array<{ port: number; targetPort?: number | string; protocol?: string }>;
  };
}

function resourceName(value: string, field: string, limit = 253): void {
  if (typeof value !== 'string' || value.length > limit ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) ||
      (field === 'namespace' && value.includes('.'))) {
    throw new Error('Invalid Kubernetes ' + field);
  }
}

function namespaceArgs(namespace?: string): string[] {
  if (namespace === undefined) return ['--all-namespaces'];
  resourceName(namespace, 'namespace', 63);
  return ['--namespace', namespace];
}

function computeAge(creationTimestamp: string): string {
  const diff = Math.max(0, Date.now() - new Date(creationTimestamp).getTime());
  if (!Number.isFinite(diff)) return '';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor(diff / 3_600_000);
  if (days > 0) return days + 'd';
  if (hours > 0) return hours + 'h';
  return Math.floor(diff / 60_000) + 'm';
}

/** Kubernetes projections for Console; Xec owns every command and forwarding session. */
@Injectable()
export class KubernetesService {
  private readonly adapter = new KubernetesAdapter({ kubectlTimeout: 30_000 });
  private readonly logger: ILogger;

  constructor(@Inject(LOGGER_SERVICE_TOKEN) loggerModule: ILoggerModule) {
    this.logger = loggerModule.logger;
  }

  async listPods(namespace?: string, labelSelector?: string): Promise<K8sPod[]> {
    const args = ['get', 'pods', ...namespaceArgs(namespace)];
    if (labelSelector !== undefined) {
      if (typeof labelSelector !== 'string' || labelSelector.includes('\0')) throw new Error('Invalid Kubernetes label selector');
      args.push('--selector', labelSelector);
    }
    const result = await this.json<{ items: PodResource[] }>(args);
    return result.items.map(item => this.mapPod(item));
  }

  async getPod(name: string, namespace = 'default'): Promise<K8sPod | null> {
    resourceName(name, 'pod');
    const output = await this.run(['get', 'pod', name, ...namespaceArgs(namespace), '--ignore-not-found', '-o', 'json']);
    return output.trim() ? this.mapPod(JSON.parse(output) as PodResource) : null;
  }

  async deletePod(name: string, namespace = 'default'): Promise<void> {
    resourceName(name, 'pod');
    await this.run(['delete', 'pod', name, ...namespaceArgs(namespace), '--grace-period=30']);
    this.logger.info({ pod: name, namespace }, 'Pod deleted');
  }

  async getPodLogs(name: string, namespace = 'default', options?: { tail?: number }): Promise<string> {
    resourceName(name, 'pod');
    const args = ['logs', name, ...namespaceArgs(namespace)];
    if (options?.tail !== undefined) {
      if (!Number.isSafeInteger(options.tail) || options.tail < -1) throw new Error('Log tail must be -1 or a nonnegative integer');
      args.push('--tail', String(options.tail));
    }
    return this.run(args);
  }

  async listDeployments(namespace?: string): Promise<K8sDeployment[]> {
    const result = await this.json<{ items: DeploymentResource[] }>(['get', 'deployments', ...namespaceArgs(namespace)]);
    return result.items.map(item => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace,
      replicas: item.spec?.replicas ?? 0,
      available: item.status?.availableReplicas ?? 0,
      ready: item.status?.readyReplicas ?? 0,
      age: computeAge(item.metadata.creationTimestamp),
    }));
  }

  async scaleDeployment(name: string, replicas: number, namespace = 'default'): Promise<void> {
    resourceName(name, 'deployment');
    if (!Number.isSafeInteger(replicas) || replicas < 0 || replicas > 2_147_483_647) throw new Error('Replicas must be a nonnegative int32');
    await this.run(['scale', 'deployment', name, '--replicas=' + replicas, ...namespaceArgs(namespace)]);
    this.logger.info({ deployment: name, replicas, namespace }, 'Deployment scaled');
  }

  async restartDeployment(name: string, namespace = 'default'): Promise<void> {
    resourceName(name, 'deployment');
    await this.run(['rollout', 'restart', 'deployment', name, ...namespaceArgs(namespace)]);
    this.logger.info({ deployment: name, namespace }, 'Deployment restarted');
  }

  async listServices(namespace?: string): Promise<K8sService[]> {
    const result = await this.json<{ items: ServiceResource[] }>(['get', 'services', ...namespaceArgs(namespace)]);
    return result.items.map(item => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace,
      type: item.spec?.type ?? 'ClusterIP',
      clusterIP: item.spec?.clusterIP ?? '',
      ports: (item.spec?.ports ?? []).map(port => ({
        port: port.port,
        targetPort: port.targetPort ?? port.port,
        protocol: port.protocol ?? 'TCP',
      })),
    }));
  }

  async portForward(pod: string, localPort: number, remotePort: number, namespace = 'default'): Promise<PortForwardHandle> {
    resourceName(pod, 'pod');
    namespaceArgs(namespace);
    if (!Number.isSafeInteger(localPort) || localPort < 0 || localPort > 65535 ||
        !Number.isSafeInteger(remotePort) || remotePort < 1 || remotePort > 65535) throw new Error('Invalid forwarding ports');
    const forward = await this.adapter.portForward(pod, localPort, remotePort, { namespace, dynamicLocalPort: localPort === 0 });
    await forward.open();
    this.logger.info({ pod, localPort: forward.localPort, remotePort, namespace }, 'Port-forward established');
    return {
      localPort: forward.localPort, remotePort, pod, namespace,
      close: async () => {
        await forward.close();
        this.logger.info({ pod, localPort: forward.localPort }, 'Port-forward closed');
      },
    };
  }

  async exec(pod: string, command: string[], namespace = 'default'): Promise<string> {
    resourceName(pod, 'pod');
    if (!Array.isArray(command) || !command.length || command.some(arg => typeof arg !== 'string' || arg.includes('\0')) || !command[0])
      throw new Error('A pod command requires a nonempty executable and literal arguments');
    return this.run(['exec', pod, ...namespaceArgs(namespace), '--', ...command]);
  }

  async dispose(): Promise<void> {
    await this.adapter.dispose();
  }

  private async run(args: string[]): Promise<string> {
    const result = await this.adapter.executeKubectl(args, { timeout: 30_000, throwOnNonZeroExit: true });
    return result.stdout;
  }

  private async json<T>(args: string[]): Promise<T> {
    return JSON.parse(await this.run([...args, '-o', 'json'])) as T;
  }

  private mapPod(item: PodResource): K8sPod {
    const containers = item.status?.containerStatuses ?? [];
    return {
      name: item.metadata.name,
      namespace: item.metadata.namespace,
      status: item.status?.phase ?? 'Unknown',
      ready: containers.length > 0 && containers.every(container => container.ready),
      restarts: containers.reduce((sum, container) => sum + (container.restartCount ?? 0), 0),
      age: computeAge(item.metadata.creationTimestamp),
      node: item.spec?.nodeName ?? '',
      labels: item.metadata.labels ?? {},
    };
  }
}
