/**
 * KubernetesService — Kubernetes cluster management via @xec-sh/core KubernetesAdapter
 *
 * Wraps @xec-sh/core KubernetesAdapter for managing K8s workloads:
 * - Pod lifecycle management (list, get, delete, logs, exec)
 * - Deployment management (list, scale, restart)
 * - Service/Ingress introspection
 * - Port forwarding
 *
 * Uses dynamic import for @xec-sh/core. Falls back to kubectl subprocess
 * when the adapter is not installed.
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';

// =============================================================================
// Types
// =============================================================================

export interface K8sPod {
  name: string;
  namespace: string;
  status: string;
  ready: boolean;
  restarts: number;
  age: string;
  node: string;
  labels: Record<string, string>;
}

export interface K8sDeployment {
  name: string;
  namespace: string;
  replicas: number;
  available: number;
  ready: number;
  age: string;
}

export interface K8sService {
  name: string;
  namespace: string;
  type: string;
  clusterIP: string;
  ports: Array<{ port: number; targetPort: number; protocol: string }>;
}

export interface PortForwardHandle {
  localPort: number;
  remotePort: number;
  pod: string;
  namespace: string;
  close: () => void;
}

// =============================================================================
// @xec-sh/core KubernetesAdapter — loaded dynamically
// =============================================================================

import { loadXecCore } from '../shared/xec-loader.js';

// =============================================================================
// kubectl fallback — subprocess-based K8s interaction
// =============================================================================

async function kubectl(args: string[]): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout } = await execFileAsync('kubectl', args, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err: any) {
    throw new Error(`kubectl ${args.join(' ')} failed: ${err.stderr ?? err.message}`, { cause: err });
  }
}

async function kubectlJson<T>(args: string[]): Promise<T> {
  const output = await kubectl([...args, '-o', 'json']);
  return JSON.parse(output) as T;
}

function computeAge(creationTimestamp: string): string {
  const diff = Date.now() - new Date(creationTimestamp).getTime();
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

// =============================================================================
// Service
// =============================================================================

export class KubernetesService {
  private adapter: any | null = null;

  constructor(private readonly logger: ILogger) {}

  private async getAdapter(): Promise<any | null> {
    if (this.adapter) return this.adapter;
    const xec = await loadXecCore();
    if (xec?.KubernetesAdapter) {
      this.adapter = new xec.KubernetesAdapter();
      return this.adapter;
    }
    return null;
  }

  // ===========================================================================
  // Pod management
  // ===========================================================================

  async listPods(namespace?: string, labelSelector?: string): Promise<K8sPod[]> {
    const adapter = await this.getAdapter();
    if (adapter?.listPods) {
      try {
        const pods = await adapter.listPods({ namespace, labelSelector });
        return pods.map((p: any) => this.mapPod(p));
      } catch (err) {
        this.logger.warn({ error: (err as Error).message }, 'KubernetesAdapter.listPods failed — falling back to kubectl');
      }
    }

    // kubectl fallback
    const args = ['get', 'pods'];
    if (namespace) args.push('-n', namespace);
    else args.push('--all-namespaces');
    if (labelSelector) args.push('-l', labelSelector);

    const result = await kubectlJson<any>(args);
    const items: any[] = result.items ?? [];
    return items.map((item) => this.mapKubectlPod(item));
  }

  async getPod(name: string, namespace = 'default'): Promise<K8sPod | null> {
    try {
      const result = await kubectlJson<any>(['get', 'pod', name, '-n', namespace]);
      return this.mapKubectlPod(result);
    } catch {
      return null;
    }
  }

  async deletePod(name: string, namespace = 'default'): Promise<void> {
    await kubectl(['delete', 'pod', name, '-n', namespace, '--grace-period=30']);
    this.logger.info({ pod: name, namespace }, 'Pod deleted');
  }

  async getPodLogs(
    name: string,
    namespace = 'default',
    options?: { tail?: number; follow?: boolean }
  ): Promise<string> {
    const args = ['logs', name, '-n', namespace];
    if (options?.tail) args.push('--tail', String(options.tail));
    // Note: follow mode not supported in subprocess mode — would need streaming
    return kubectl(args);
  }

  // ===========================================================================
  // Deployment management
  // ===========================================================================

  async listDeployments(namespace?: string): Promise<K8sDeployment[]> {
    const args = ['get', 'deployments'];
    if (namespace) args.push('-n', namespace);
    else args.push('--all-namespaces');

    const result = await kubectlJson<any>(args);
    const items: any[] = result.items ?? [];
    return items.map((item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace,
      replicas: item.spec?.replicas ?? 0,
      available: item.status?.availableReplicas ?? 0,
      ready: item.status?.readyReplicas ?? 0,
      age: computeAge(item.metadata.creationTimestamp),
    }));
  }

  async scaleDeployment(name: string, replicas: number, namespace = 'default'): Promise<void> {
    await kubectl(['scale', 'deployment', name, `--replicas=${replicas}`, '-n', namespace]);
    this.logger.info({ deployment: name, replicas, namespace }, 'Deployment scaled');
  }

  async restartDeployment(name: string, namespace = 'default'): Promise<void> {
    await kubectl(['rollout', 'restart', 'deployment', name, '-n', namespace]);
    this.logger.info({ deployment: name, namespace }, 'Deployment restarted');
  }

  // ===========================================================================
  // Service info
  // ===========================================================================

  async listServices(namespace?: string): Promise<K8sService[]> {
    const args = ['get', 'services'];
    if (namespace) args.push('-n', namespace);
    else args.push('--all-namespaces');

    const result = await kubectlJson<any>(args);
    const items: any[] = result.items ?? [];
    return items.map((item) => ({
      name: item.metadata.name,
      namespace: item.metadata.namespace,
      type: item.spec?.type ?? 'ClusterIP',
      clusterIP: item.spec?.clusterIP ?? '',
      ports: (item.spec?.ports ?? []).map((p: any) => ({
        port: p.port,
        targetPort: typeof p.targetPort === 'number' ? p.targetPort : p.port,
        protocol: p.protocol ?? 'TCP',
      })),
    }));
  }

  // ===========================================================================
  // Port forwarding
  // ===========================================================================

  async portForward(
    pod: string,
    localPort: number,
    remotePort: number,
    namespace = 'default'
  ): Promise<PortForwardHandle> {
    const { spawn } = await import('node:child_process');
    const child = spawn('kubectl', ['port-forward', pod, `${localPort}:${remotePort}`, '-n', namespace], {
      stdio: 'pipe',
    });

    // Wait for port-forward to be established
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Port-forward timed out')), 10_000);
      child.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString();
        if (msg.includes('Forwarding from')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('exit', (code) => {
        if (code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`kubectl port-forward exited with code ${code}`));
        }
      });
    });

    this.logger.info({ pod, localPort, remotePort, namespace }, 'Port-forward established');

    return {
      localPort,
      remotePort,
      pod,
      namespace,
      close: () => {
        child.kill('SIGTERM');
        this.logger.info({ pod, localPort }, 'Port-forward closed');
      },
    };
  }

  // ===========================================================================
  // Exec into pod
  // ===========================================================================

  async exec(pod: string, command: string[], namespace = 'default'): Promise<string> {
    return kubectl(['exec', pod, '-n', namespace, '--', ...command]);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private mapPod(p: any): K8sPod {
    return {
      name: p.name ?? p.metadata?.name ?? '',
      namespace: p.namespace ?? p.metadata?.namespace ?? 'default',
      status: p.status ?? 'Unknown',
      ready: p.ready ?? false,
      restarts: p.restarts ?? 0,
      age: p.age ?? '',
      node: p.node ?? '',
      labels: p.labels ?? p.metadata?.labels ?? {},
    };
  }

  private mapKubectlPod(item: any): K8sPod {
    const containers = item.status?.containerStatuses ?? [];
    const totalRestarts = containers.reduce((sum: number, c: any) => sum + (c.restartCount ?? 0), 0);
    const allReady = containers.length > 0 && containers.every((c: any) => c.ready);

    return {
      name: item.metadata.name,
      namespace: item.metadata.namespace,
      status: item.status?.phase ?? 'Unknown',
      ready: allReady,
      restarts: totalRestarts,
      age: computeAge(item.metadata.creationTimestamp),
      node: item.spec?.nodeName ?? '',
      labels: item.metadata?.labels ?? {},
    };
  }
}
