import { stackExecutionKey } from '../shared/dto/stack-execution.js';
import type { IStackConfig } from '../config/types.js';

/** Requirement discovery describes dependencies; only the owning stack may provision or migrate them. */
export function infrastructureOwnership(stack: IStackConfig): 'stack' | 'controller' | 'external' {
  if (stack.managedOrigin && stack.infrastructureOwnership === undefined)
    throw new Error(
      'A bound node allocation requires an explicit infrastructure ownership mode; migrate its registration before starting'
    );
  const mode = stack.infrastructureOwnership ?? 'stack';
  if (!['stack', 'controller', 'external'].includes(mode)) throw new Error('Invalid infrastructure ownership mode');
  if (mode !== 'stack' && stack.type !== 'local')
    throw new Error(
      'Non-owning infrastructure mode applies to local application allocations; configure remote service bindings on the controller'
    );
  if (mode === 'controller') {
    const origin = stack.managedOrigin;
    if (!origin) throw new Error('Controller-owned infrastructure requires an explicit source project/stack binding on a local node allocation');
    stackExecutionKey(origin);
  }
  return mode;
}

export function ownsStackInfrastructure(stack: IStackConfig): boolean {
  const mode = infrastructureOwnership(stack);
  if (
    mode !== 'stack' &&
    (Object.keys(stack.infrastructure ?? {}).length || Object.keys(stack.serviceOverrides ?? {}).length)
  )
    throw new Error(
      'A non-owning stack must use explicit application connection configuration, without provisioning declarations or service overrides'
    );
  return mode === 'stack';
}
