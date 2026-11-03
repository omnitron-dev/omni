import type { ServiceMetadata } from './types.js';
import { normalizeTransportPolicy } from './transport-policy.js';

/** Publish declarative restrictions, never live transport instances or schemas. */
export function publicServiceMetadata(meta: ServiceMetadata): ServiceMetadata {
  const { contract: _contract, _transports, transportConfig: _config, ...rest } = meta as ServiceMetadata & {
    contract?: unknown; _transports?: unknown; transportConfig?: unknown;
  };
  const transports = normalizeTransportPolicy(meta.transports);
  const members = <T extends { transports?: string[] }>(values: Record<string, T>) =>
    Object.fromEntries(Object.entries(values).map(([name, value]) => {
      const restriction = normalizeTransportPolicy(value.transports);
      return [name, { ...value, ...(restriction !== undefined ? { transports: restriction } : {}) }];
    }));
  return {
    ...rest,
    ...(transports !== undefined ? { transports } : {}),
    methods: members(meta.methods ?? {}),
    properties: members(meta.properties ?? {}),
  };
}
