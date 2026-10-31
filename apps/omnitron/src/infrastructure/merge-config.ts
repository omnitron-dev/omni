import type { InfrastructureConfig } from './types.js';

/** A stack replaces legacy sections, and merges named services with project defaults. */
export function mergeInfrastructure(
  ecosystem: { infrastructure?: InfrastructureConfig | undefined },
  stack: { infrastructure?: Partial<InfrastructureConfig> | undefined }
): InfrastructureConfig | undefined {
  if (!stack.infrastructure && !ecosystem.infrastructure) return undefined;
  return {
    ...ecosystem.infrastructure,
    ...stack.infrastructure,
    services: { ...ecosystem.infrastructure?.services, ...stack.infrastructure?.services },
  } as InfrastructureConfig;
}
