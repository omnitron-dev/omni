import type { ISeedProject } from '../config/types.js';
import type { InfrastructureDefinition } from '../infrastructure/infrastructure-definition.js';
import { LOCAL_INFRA_HOST } from '../shared/local-infra-host.js';
import type { StackExecutionScope } from '../shared/dto/stack-execution.js';
import { stackDefinitionFingerprint } from './node-stack-stop.js';

/** Derived from the owner's provisioned definition at stop and from verified native bindings at backup. */
export function retainedDatabaseBinding(scope: StackExecutionScope, stopId: string, revision: number, registration: ISeedProject,
  definition: InfrastructureDefinition, inventory: readonly { name: string; id: string }[]) {
  const postgres = definition.normalizedServices['postgres'];
  const databases = postgres?._presetConfig?.['databases'];
  if (postgres?._preset !== 'postgres' || !databases || typeof databases !== 'object' || Array.isArray(databases)) return null;
  const ids = new Map(inventory.map(({ name, id }) => [name, id]));
  if (!Number.isSafeInteger(revision) || revision < 1 || !registration.registeredAt || !registration.path || registration.name !== scope.project ||
      ids.size !== inventory.length || new Set(ids.values()).size !== ids.size || ids.size !== definition.containers.length ||
      inventory.some(({ id }) => !/^[a-f0-9]{64}$/.test(id)) ||
      definition.containers.some(({ name, labels }) => !ids.has(name) || labels['omnitron.managed'] !== 'true' ||
        labels['omnitron.project'] !== scope.project || labels['omnitron.stack'] !== scope.stack)) return null;
  const candidates = definition.containers.filter(({ labels }) => labels['omnitron.service'] === 'postgres');
  const container = candidates[0];
  if (candidates.length !== 1 || !container || container.labels['omnitron.app'] || container.labels['omnitron.internal']) return null;
  const port = container.ports.find(binding => binding.container === 5432)?.host;
  const user = container.environment['POSTGRES_USER'], password = container.environment['POSTGRES_PASSWORD'];
  if (!port || !user || typeof password !== 'string') return null;
  const names = Object.keys(databases).sort();
  if (!names.length) return null;
  const source = registration.configuration;
  if (source && !Object.hasOwn(source.stacks, scope.stack)) return null;
  const digest = stackDefinitionFingerprint(['omnitron/retained-database-backup/v1', stopId, revision, scope.project, scope.stack,
    registration.path, registration.registeredAt, source ? [source.project, source.name, source.stacks[scope.stack]] : null, container.name, names,
    [...ids.keys()].sort().map(name => [name, ids.get(name)])]);
  return { digest, names, containerName: container.name, id: ids.get(container.name)!,
    connection: { host: LOCAL_INFRA_HOST, port, user, password } };
}
