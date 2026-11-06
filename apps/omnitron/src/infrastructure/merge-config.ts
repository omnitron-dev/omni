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
    ...((ecosystem.infrastructure?.artifactVolumes || stack.infrastructure?.artifactVolumes) && { artifactVolumes: { ...ecosystem.infrastructure?.artifactVolumes, ...stack.infrastructure?.artifactVolumes } }),
  } as InfrastructureConfig;
}

/** Explicit settings override defaults without discarding inferred database/bucket requirements. */
export function mergeInferredInfrastructure(inferred: InfrastructureConfig, explicit?: InfrastructureConfig): InfrastructureConfig {
  return {
    ...inferred, ...explicit,
    ...((inferred.postgres || explicit?.postgres) && { postgres: {
      ...inferred.postgres, ...explicit?.postgres,
      databases: { ...inferred.postgres?.databases, ...explicit?.postgres?.databases },
    } }),
    ...((inferred.redis || explicit?.redis) && { redis: { ...inferred.redis, ...explicit?.redis } }),
    ...((inferred.minio || explicit?.minio) && { minio: {
      ...inferred.minio, ...explicit?.minio,
      buckets: [...new Set([...(inferred.minio?.buckets ?? []), ...(explicit?.minio?.buckets ?? [])])],
    } }),
  };
}
