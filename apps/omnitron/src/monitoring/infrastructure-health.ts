/** Local desired state, read without provisioning or contacting remote nodes. */
export interface InfrastructureHealthContext {
  stacks: Array<{ project: string; stack: string; intent: 'running' | 'inactive' | 'unknown' }>;
  requiredContainers: string[];
  unresolvedStacks: string[];
}
