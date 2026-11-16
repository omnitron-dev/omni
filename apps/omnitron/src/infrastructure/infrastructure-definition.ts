import { isDeepStrictEqual } from 'node:util';
import { normalizeInfraConfig } from './config-normalizer.js';
import { containerResources, containerSpecHash } from './container-runtime.js';
import { createDefaultRegistry } from './presets/index.js';
import type { PresetRegistry } from './presets/registry.js';
import { resolveInfrastructure } from './service-resolver.js';
import type { InfrastructureConfig, IServiceOverride, IServiceRequirement, ResolvedContainer } from './types.js';

/** Desired data only: no monitor, registration, recovery fence or native authority. */
export interface InfrastructureDefinition {
  readonly config: InfrastructureConfig;
  readonly normalizedServices: Record<string, IServiceRequirement>;
  readonly serviceOverrides?: Record<string, IServiceOverride> | undefined;
  readonly containers: readonly ResolvedContainer[];
}

export interface InfrastructureDefinitionInput {
  config: InfrastructureConfig;
  normalizedServices?: Record<string, IServiceRequirement>;
  presetRegistry?: PresetRegistry;
  serviceOverrides?: Record<string, IServiceOverride> | undefined;
  configRoots?: Parameters<typeof resolveInfrastructure>[3];
  mounts?: Parameters<typeof resolveInfrastructure>[4];
  appContainers?: readonly ResolvedContainer[];
}

/** Validate and detach the complete declaration before an owner can adopt it. */
export function copyInfrastructureDefinition(definition: InfrastructureDefinition): InfrastructureDefinition {
  const containers = new Map<string, ResolvedContainer>();
  for (const container of definition.containers) {
    containerResources(container);
    const prior = containers.get(container.name);
    if (prior && (containerSpecHash(prior) !== containerSpecHash(container) || !isDeepStrictEqual(prior.labels, container.labels)))
      throw Error(`Conflicting infrastructure declarations for ${container.name}; use one shared specification or distinct service names`);
    containers.set(container.name, container);
  }
  return structuredClone({ ...definition, containers: [...containers.values()] });
}

/** CLI, local stacks and remote recipients resolve the same complete input. */
export function resolveInfrastructureDefinition(input: InfrastructureDefinitionInput): InfrastructureDefinition {
  const registry = input.presetRegistry ?? createDefaultRegistry();
  const normalizedServices = input.normalizedServices ?? normalizeInfraConfig(input.config, registry);
  return copyInfrastructureDefinition({
    config: input.config, normalizedServices,
    ...(input.serviceOverrides && { serviceOverrides: input.serviceOverrides }),
    containers: [
      ...resolveInfrastructure(input.config, normalizedServices, input.serviceOverrides, input.configRoots, input.mounts),
      ...(input.appContainers ?? []),
    ],
  });
}
