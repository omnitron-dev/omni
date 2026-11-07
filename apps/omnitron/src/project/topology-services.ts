import type { IStackConfig } from '../config/types.js';
import type { InfrastructureConfig } from '../infrastructure/types.js';
import type { ProjectDependency } from '../shared/dto/project.js';
import type { TopologyWorkspace } from '../shared/dto/topology.js';
import { expandServiceDeclarations } from '../infrastructure/config-normalizer.js';
import { createDefaultRegistry } from '../infrastructure/presets/index.js';
import { bindService } from '../infrastructure/service-binding.js';

/** Describe explicit declarations with the provisioner's resolver; never expose credentials or infer recovery safety. */
export function topologyServices(
  infrastructure: InfrastructureConfig | undefined,
  stack: IStackConfig,
  dependencies: ProjectDependency[]
): TopologyWorkspace['services'] {
  const services: TopologyWorkspace['services'] = [];
  for (const [name, requirement] of Object.entries(
    expandServiceDeclarations(infrastructure ?? {}, createDefaultRegistry())
  )) {
    const binding = bindService(requirement, stack.serviceOverrides?.[name]);
    if (binding.provisioning === 'disabled') continue;
    services.push({
      name,
      runtime:
        binding.provisioning === 'bareMetal'
          ? 'host'
          : binding.provisioning === 'docker' || binding.provisioning === 'external'
            ? binding.provisioning
            : 'configured',
      stateful:
        requirement.type === 'database' ||
        requirement.type === 'storage' ||
        Object.keys(requirement.docker?.volumes ?? {}).length > 0
          ? true
          : 'unknown',
    });
  }
  // These legacy sections are handled separately by the actual provisioner too.
  if (infrastructure?.tor && !services.some((service) => service.name === 'tor'))
    services.push({ name: 'tor', runtime: 'docker', stateful: true });
  for (const [name, container] of Object.entries(infrastructure?.containers ?? {}))
    if (!services.some((service) => service.name === name))
      services.push({ name, runtime: 'docker', stateful: container.volumes?.length ? true : 'unknown' });
  for (const dependency of dependencies)
    if (dependency.service && !services.some((service) => service.name === dependency.service))
      services.push({ name: dependency.service, runtime: 'configured', stateful: 'unknown' });
  return services;
}
