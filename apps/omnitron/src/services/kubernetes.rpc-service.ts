/**
 * Kubernetes RPC Service
 *
 * Netron RPC endpoints for K8s management from webapp and CLI.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { ADMIN_ROLES } from '../shared/roles.js';
import type { KubernetesService, K8sPod, K8sDeployment, K8sService } from './kubernetes.service.js';

@Service({ name: 'OmnitronKubernetes' })
export class KubernetesRpcService {
  constructor(private readonly k8s: KubernetesService) {}

  @Public({ auth: { roles: ADMIN_ROLES } })
  async listPods(data?: { namespace?: string; labelSelector?: string }): Promise<K8sPod[]> {
    return this.k8s.listPods(data?.namespace, data?.labelSelector);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async getPod(data: { name: string; namespace?: string }): Promise<K8sPod | null> {
    return this.k8s.getPod(data.name, data.namespace);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async deletePod(data: { name: string; namespace?: string }): Promise<{ success: boolean }> {
    await this.k8s.deletePod(data.name, data.namespace);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async getPodLogs(data: { name: string; namespace?: string; tail?: number }): Promise<string> {
    return this.k8s.getPodLogs(data.name, data.namespace, data.tail != null ? { tail: data.tail } : undefined);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async listDeployments(data?: { namespace?: string }): Promise<K8sDeployment[]> {
    return this.k8s.listDeployments(data?.namespace);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async scaleDeployment(data: { name: string; replicas: number; namespace?: string }): Promise<{ success: boolean }> {
    await this.k8s.scaleDeployment(data.name, data.replicas, data.namespace);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async restartDeployment(data: { name: string; namespace?: string }): Promise<{ success: boolean }> {
    await this.k8s.restartDeployment(data.name, data.namespace);
    return { success: true };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async listServices(data?: { namespace?: string }): Promise<K8sService[]> {
    return this.k8s.listServices(data?.namespace);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async execInPod(data: { pod: string; command: string[]; namespace?: string }): Promise<string> {
    return this.k8s.exec(data.pod, data.command, data.namespace);
  }
}
