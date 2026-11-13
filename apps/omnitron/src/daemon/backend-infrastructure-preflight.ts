import { createHash } from 'node:crypto';
import type { BackendHandoffState } from './backend-handoff-types.js';
import type { InfrastructureHandoffState } from '../infrastructure/infrastructure.service.js';
import type { ResolvedContainer } from '../infrastructure/types.js';
import { isDeepStrictEqual } from 'node:util';

const MAX_INPUT_BYTES = 16 * 1024 * 1024;

interface InfrastructurePreflightInput {
  protocol: 1;
  infrastructure: InfrastructureHandoffState[];
  managedDatabase?: boolean;
}

/** Only the infrastructure projection crosses this read-only child boundary. */
export function backendInfrastructureInput(state: Pick<BackendHandoffState, 'infrastructure' | 'projects'>, managedDatabase?: boolean): string {
  if (!state || !Array.isArray(state.projects?.infrastructure) ||
      (state.infrastructure !== null && (typeof state.infrastructure !== 'object' || Array.isArray(state.infrastructure))))
    throw new Error('Backend infrastructure snapshot is incomplete');
  const input: InfrastructurePreflightInput = { protocol: 1, infrastructure: [
    ...(state.infrastructure ? [state.infrastructure] : []), ...state.projects.infrastructure.map(entry => entry.infrastructure),
  ], ...(managedDatabase !== undefined && { managedDatabase }) };
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized) > MAX_INPUT_BYTES) throw new Error('Backend infrastructure preflight exceeds 16 MiB');
  return serialized;
}

export function backendInfrastructureDigest(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function parseInfrastructure(input: Buffer): InfrastructurePreflightInput {
  if (input.byteLength > MAX_INPUT_BYTES) throw new Error('Backend infrastructure preflight exceeds 16 MiB');
  let parsed: InfrastructurePreflightInput;
  try { parsed = JSON.parse(input.toString('utf8')) as InfrastructurePreflightInput; }
  catch { throw new Error('Invalid backend infrastructure preflight JSON'); }
  if (!parsed || parsed.protocol !== 1 || !Array.isArray(parsed.infrastructure) ||
      Object.keys(parsed).some(key => !['protocol', 'infrastructure', 'managedDatabase'].includes(key)) ||
      (parsed.managedDatabase !== undefined && typeof parsed.managedDatabase !== 'boolean')) throw new Error('Invalid backend infrastructure preflight protocol');
  return parsed;
}

/** Candidate code inspects native resources; it never constructs or starts a daemon. */
export async function validateBackendInfrastructureInput(input: Buffer): Promise<{ protocol: 1; digest: string }> {
  const parsed = parseInfrastructure(input);
  const { InfrastructureService } = await import('../infrastructure/infrastructure.service.js');
  for (const snapshot of parsed.infrastructure) await InfrastructureService.validateHandoff(snapshot);
  return { protocol: 1, digest: backendInfrastructureDigest(input) };
}

export interface ColdInfrastructurePreview {
  protocol: 1;
  digest: string;
  controlPlaneDatabase?: Awaited<ReturnType<typeof import('./control-plane-database.js').inspectControlPlaneDatabase>>;
  containers: Array<{ name: string; action: 'retain' | 'create' | 'start' | 'replace' | 'update-limits' | 'unknown';
    id?: string; changed?: string[]; reason?: string }>;
}

/** Re-expand the candidate's presets. Preserve the captured gateway and application bindings separately. */
export async function previewColdInfrastructure(input: Buffer): Promise<ColdInfrastructurePreview> {
  const { infrastructure, managedDatabase } = parseInfrastructure(input);
  const { resolveInfrastructure, withInfrastructureScope } = await import('../infrastructure/service-resolver.js');
  const { normalizeInfraConfig } = await import('../infrastructure/config-normalizer.js');
  const { createDefaultRegistry } = await import('../infrastructure/presets/index.js');
  const { getContainerState, hasLegacyContainerSpec, planContainerAction, containerSpecHash, containerSpecHashMatches } = await import('../infrastructure/container-runtime.js');
  const { assertReplacementVolumes, ownedContainerId } = await import('../infrastructure/owned-container.js');
  const { planLegacyContainer } = await import('../infrastructure/existing-containers.js');
  const containers: ColdInfrastructurePreview['containers'] = [];
  for (const snapshot of infrastructure) {
    const retained = snapshot.containers;
    const project = retained[0]?.labels['omnitron.project'], stack = retained[0]?.labels['omnitron.stack'];
    if (retained.some(container => container.labels['omnitron.project'] !== project || container.labels['omnitron.stack'] !== stack))
      throw Error('Cannot preview mixed infrastructure ownership');
    await withInfrastructureScope(project, stack, async () => {
      const fresh = normalizeInfraConfig(snapshot.config, createDefaultRegistry());
      const previouslyResolved = resolveInfrastructure(snapshot.config, snapshot.normalizedServices, snapshot.serviceOverrides);
      const next = resolveInfrastructure(snapshot.config, Object.fromEntries(Object.keys(snapshot.normalizedServices)
        .filter(key => fresh[key]).map(key => [key, fresh[key]!])), snapshot.serviceOverrides);
      for (const prior of retained) {
        const original = previouslyResolved.find(c => c.name === prior.name);
        const desired = original ? next.find(c => c.name === prior.name) : prior;
        if (!desired || (original && containerSpecHash(original) !== containerSpecHash(prior))) {
          containers.push({ name: prior.name, action: 'unknown', reason: 'The retained declaration could not be reproduced' });
          continue;
        }
        const changed = (Object.keys({ ...prior, ...desired }) as Array<keyof ResolvedContainer>)
          .filter(key => !isDeepStrictEqual(prior[key], desired[key]));
        const metadata = { name: desired.name, ...(changed.length ? { changed } : {}) };
        try {
          const actual = await getContainerState(desired.name, { orThrow: true, fullId: true });
          if (!actual) { containers.push({ ...metadata, action: 'create' }); continue; }
          const id = ownedContainerId(desired, actual);
          if (actual.status === 'running' && hasLegacyContainerSpec(desired, actual) && !containerSpecHashMatches(desired, actual)) {
            const plan = await planLegacyContainer(desired, id);
            containers.push({ ...metadata, id, action: plan.args.length ? 'update-limits' : 'retain' });
            continue;
          }
          const action = planContainerAction(desired, actual);
          if (action.type === 'recreate') {
            try { assertReplacementVolumes(desired, actual); }
            catch { containers.push({ ...metadata, id, action: 'unknown', reason: 'Replacement would require explicit volume verification or migration' }); continue; }
            containers.push({ ...metadata, id, action: 'replace', reason: action.reason });
          }
          else if (action.type === 'noop' || action.type === 'start') containers.push({ ...metadata, id, action: action.type === 'noop' ? 'retain' : 'start' });
          else throw Error('Unexpected existing container action');
        } catch {
          containers.push({ ...metadata, action: 'unknown', reason: 'Current native settings or ownership could not be verified' });
        }
      }
    });
  }
  const controlPlaneDatabase = managedDatabase ? await (await import('./control-plane-database.js')).inspectControlPlaneDatabase() : undefined;
  return { protocol: 1, digest: backendInfrastructureDigest(input), containers, ...(controlPlaneDatabase && { controlPlaneDatabase }) };
}

export async function readBackendInfrastructureInput(input: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of input) {
    bytes += chunk.byteLength;
    if (bytes > MAX_INPUT_BYTES) throw new Error('Backend infrastructure preflight exceeds 16 MiB');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, bytes);
}
