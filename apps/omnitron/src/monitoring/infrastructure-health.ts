/** Local desired state, read without provisioning or contacting remote nodes. */
export interface InfrastructureHealthContext {
  stacks: Array<{ project: string; stack: string; intent: 'running' | 'inactive' | 'unknown'; containers?: string[] }>;
  requiredContainers: string[];
  unresolvedStacks: string[];
  /** Setup observations from the same stack reconcilers that own readiness. */
  observedServices?: ContainerState[];
}
import type { ContainerState } from '../infrastructure/types.js';
