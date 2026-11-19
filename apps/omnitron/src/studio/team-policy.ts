import { createHash } from 'node:crypto';
import {
  assertStudioAssignment,
  selectStudioModel,
  STUDIO_ROLE_POLICY,
  studioRoleRequirements,
  type StudioModelCatalog,
  type StudioRole,
} from '../shared/dto/studio-policy.js';
import {
  STUDIO_PROVIDERS,
  type StudioDecision,
  type StudioPreferences,
  type StudioProvider,
  type StudioTeamPolicy,
} from '../shared/dto/studio.js';

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const costTiers = ['economy', 'standard', 'premium'] as const;
export function boundedText(value: unknown, limit: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > limit || value.includes('\0'))
    throw Error('Invalid ' + label);
  return value;
}
export function policyValue(input: StudioTeamPolicy, lead: StudioProvider): StudioTeamPolicy {
  if (
    !input ||
    !Array.isArray(input.providers) ||
    !input.providers.includes(lead) ||
    !input.providers.every((p) => STUDIO_PROVIDERS.includes(p)) ||
    new Set(input.providers).size !== input.providers.length ||
    !Number.isInteger(input.maxMembers) ||
    input.maxMembers < 1 ||
    input.maxMembers > 12 ||
    !Number.isInteger(input.maxDelegations) ||
    input.maxDelegations < 0 ||
    input.maxDelegations > 24 ||
    !costTiers.includes(input.maxCostTier)
  )
    throw Error('Choose the team providers, member limit, delegation budget and cost ceiling');
  return {
    providers: [...input.providers].sort(),
    maxMembers: input.maxMembers,
    maxDelegations: input.maxDelegations,
    maxCostTier: input.maxCostTier,
  };
}
export function studioPreferences(input: StudioPreferences): StudioPreferences {
  if (!input || JSON.stringify(input).length > 4096) throw Error('Invalid Studio preferences');
  const { role, result, purpose, model } = input;
  if (purpose !== undefined && (purpose !== 'project-interview' || role !== 'analyst'))
    throw Error('A project interview requires an analyst assignment');
  if (model !== undefined) boundedText(model, 240, 'selected model');
  assertStudioAssignment({ scope: { project: 'Studio' }, role, result });
  return {
    role,
    result,
    requirements: studioRoleRequirements(role, input.requirements, model !== undefined),
    ...(model !== undefined && { model }),
    ...(purpose && { purpose }),
  };
}
export function selectMember(catalog: StudioModelCatalog, preferences: StudioPreferences): StudioDecision {
  const selected = selectStudioModel(catalog, {
    provider: catalog.provider,
    connector: catalog.connector,
    requirements: preferences.requirements,
    ...(preferences.model && { model: preferences.model }),
  });
  if (!selected.ok) throw Error(selected.message);
  return { preferences, selection: selected.selection };
}
export function automaticMember(
  catalogs: StudioModelCatalog[],
  policy: StudioTeamPolicy,
  args: Record<string, unknown>
): StudioDecision {
  const role = args['role'] as StudioRole;
  if (
    !Object.hasOwn(STUDIO_ROLE_POLICY, role) ||
    (args['provider'] !== undefined && !policy.providers.includes(args['provider'] as StudioProvider))
  )
    throw Error('Select an approved provider and a team responsibility');
  if (args['model'] !== undefined) boundedText(args['model'], 240, 'selected model');
  const preferences: StudioPreferences = {
    role,
    result: STUDIO_ROLE_POLICY[role].result,
    requirements: studioRoleRequirements(role, { maxCostTier: policy.maxCostTier }, false),
    ...(args['model'] !== undefined && { model: args['model'] as string }),
  };
  const requested = catalogs.filter(
    (c) => policy.providers.includes(c.provider) && (args['provider'] === undefined || args['provider'] === c.provider)
  );
  const decisions = requested.flatMap((c) => {
    const decision = selectStudioModel(c, {
      provider: c.provider,
      connector: c.connector,
      requirements: preferences.requirements,
      ...(preferences.model && { model: preferences.model }),
    });
    return decision.ok ? [decision.selection] : [];
  });
  if (!decisions.length) throw Error('No connected model satisfies the role and approved cost ceiling');
  const quotes = decisions.every((s) => s.price && s.price.unit === decisions[0]!.price?.unit);
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  decisions.sort(
    (a, b) =>
      (quotes
        ? a.price!.amount - b.price!.amount
        : costTiers.indexOf(a.costTier as (typeof costTiers)[number]) -
          costTiers.indexOf(b.costTier as (typeof costTiers)[number])) ||
      compare(a.provider, b.provider) ||
      compare(a.model, b.model)
  );
  return { preferences, selection: decisions[0]! };
}
export const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
export function operationKey(turnId: string, request: string): string {
  const b = Buffer.from(fingerprint(turnId + '\n' + request).slice(0, 32), 'hex');
  b[6] = (b[6]! & 15) | 0x80;
  b[8] = (b[8]! & 63) | 0x80;
  const h = b.toString('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
}
