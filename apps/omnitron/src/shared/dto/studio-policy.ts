export const STUDIO_PROVIDERS = ['codex', 'agy'] as const;
export type StudioProvider = typeof STUDIO_PROVIDERS[number];

/** Studio responsibilities constrain the proposed result, never grant infrastructure authority. */
export const STUDIO_ROLES = ['analyst', 'engineer', 'reviewer', 'operator'] as const;
export type StudioRole = typeof STUDIO_ROLES[number];
export type StudioResultClass = 'analysis' | 'patch' | 'review' | 'runbook';
export const STUDIO_ROLE_POLICY: Readonly<Record<StudioRole, {
  result: StudioResultClass; canDeploy: false; instruction: string;
}>> = {
  analyst: { result: 'analysis', canDeploy: false, instruction: 'Analyze the supplied evidence. Return findings, uncertainties and proposed next steps.' },
  engineer: { result: 'patch', canDeploy: false, instruction: 'Propose an implementation with validation and explicit limitations. Do not deploy it.' },
  reviewer: { result: 'review', canDeploy: false, instruction: 'Review the supplied change. Return concrete findings and evidence; do not approve or deploy on behalf of the operator.' },
  operator: { result: 'runbook', canDeploy: false, instruction: 'Prepare a reviewable operational runbook with checks, scope, failure conditions and recovery. Do not execute infrastructure changes.' },
};

export interface StudioAssignment {
  scope: { project: string; stack?: string };
  role: StudioRole;
  result: StudioResultClass;
}

export function assertStudioAssignment(value: StudioAssignment): void {
  if (!value || !value.scope || typeof value.scope.project !== 'string' || !value.scope.project.trim() ||
      (value.scope.stack !== undefined && (typeof value.scope.stack !== 'string' || !value.scope.stack.trim())) ||
      !Object.hasOwn(STUDIO_ROLE_POLICY, value.role) || STUDIO_ROLE_POLICY[value.role].result !== value.result)
    throw new Error('Invalid Studio responsibility, scope or result class');
}

export type StudioModelClass = 'general' | 'code' | 'reasoning' | 'multimodal';
export type StudioQualityTier = 'standard' | 'advanced' | 'frontier';
export type StudioCostTier = 'economy' | 'standard' | 'premium';
/** A connector-declared comparable quote, not a prediction of actual invoiced usage. */
export interface StudioPriceQuote { amount: number; unit: string }
export interface StudioModelDescriptor {
  id: string;
  label: string;
  classes: StudioModelClass[];
  qualityTier: StudioQualityTier | 'unknown';
  costTier: StudioCostTier | 'unknown';
  capabilities: string[];
  price: StudioPriceQuote | null;
}
export interface StudioModelCatalog {
  provider: StudioProvider;
  /** Identifies this connection's catalog locally; never forwarded to the provider. */
  connector: string;
  revision: string;
  models: StudioModelDescriptor[];
}
export interface StudioModelRequirements {
  classes?: StudioModelClass[];
  minQualityTier?: StudioQualityTier;
  capabilities?: string[];
  /** Explicit approval ceiling; an unknown tier cannot satisfy it. */
  maxCostTier?: StudioCostTier;
  maxPrice?: StudioPriceQuote;
}
export interface StudioModelSelection {
  provider: StudioProvider;
  connector: string;
  catalogRevision: string;
  model: string;
  mode: 'explicit' | 'automatic';
  basis: 'explicit' | 'declared-price' | 'declared-tier';
  qualityTier: StudioQualityTier | 'unknown';
  costTier: StudioCostTier | 'unknown';
  price: StudioPriceQuote | null;
}
export interface StudioModelRequest {
  provider: StudioProvider;
  connector: string;
  requirements: StudioModelRequirements;
  model?: string;
  /** Re-observation of the same approved choice; never authorizes a fallback. */
  previous?: StudioModelSelection;
}
export type StudioModelRefusal = 'invalid-catalog' | 'invalid-requirements' | 'connector-mismatch' |
  'missing-model' | 'no-compatible-model' | 'budget-required' | 'unknown-cost' | 'incomparable-prices' | 'review-required';
export type StudioModelDecision = { ok: true; selection: StudioModelSelection } |
  { ok: false; reason: StudioModelRefusal; message: string };

const QUALITY: readonly StudioQualityTier[] = ['standard', 'advanced', 'frontier'];
const COST: readonly StudioCostTier[] = ['economy', 'standard', 'premium'];
const CLASSES: readonly StudioModelClass[] = ['general', 'code', 'reasoning', 'multimodal'];
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const unique = (values: unknown): values is string[] => Array.isArray(values) && values.every(text) && new Set(values).size === values.length;
const price = (value: StudioPriceQuote | undefined | null): value is StudioPriceQuote => !!value &&
  Number.isFinite(value.amount) && value.amount >= 0 && text(value.unit);
const knownCost = (value: StudioModelDescriptor): value is StudioModelDescriptor & { costTier: StudioCostTier } => COST.includes(value.costTier as StudioCostTier);
const fail = (reason: StudioModelRefusal, message: string): StudioModelDecision => ({ ok: false, reason, message });
const order = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** Listing names do not imply capability, quality or price (including opaque model families). */
export function studioCatalogFromListing(provider: StudioProvider, connector: string, revision: string,
  models: Array<{ id: string; label: string }>): StudioModelCatalog {
  return { provider, connector, revision, models: models.map(({ id, label }) => ({ id, label,
    classes: [], qualityTier: 'unknown', costTier: 'unknown', capabilities: [], price: null })) };
}

/** Pure, deterministic selection within one trusted connector's current catalog. */
export function selectStudioModel(catalog: StudioModelCatalog, request: StudioModelRequest): StudioModelDecision {
  if (!catalog || !STUDIO_PROVIDERS.includes(catalog.provider) || !text(catalog.connector) || !text(catalog.revision) ||
      !Array.isArray(catalog.models) || new Set(catalog.models.map(model => model?.id)).size !== catalog.models.length ||
      catalog.models.some(model => !model || !text(model.id) || !text(model.label) || !unique(model.classes) ||
        !model.classes.every(value => CLASSES.includes(value)) || !unique(model.capabilities) ||
        (model.qualityTier !== 'unknown' && !QUALITY.includes(model.qualityTier)) ||
        (model.costTier !== 'unknown' && !COST.includes(model.costTier)) || (model.price !== null && !price(model.price))))
    return fail('invalid-catalog', 'The connector model catalog is incomplete or invalid');
  if (!request || request.provider !== catalog.provider || request.connector !== catalog.connector)
    return fail('connector-mismatch', 'The model catalog belongs to another connector');
  const requirements = request.requirements;
  if (!requirements || (requirements.classes !== undefined && (!unique(requirements.classes) || !requirements.classes.every(value => CLASSES.includes(value)))) ||
      (requirements.capabilities !== undefined && !unique(requirements.capabilities)) ||
      (requirements.minQualityTier !== undefined && !QUALITY.includes(requirements.minQualityTier)) ||
      (requirements.maxCostTier !== undefined && !COST.includes(requirements.maxCostTier)) ||
      (requirements.maxPrice !== undefined && !price(requirements.maxPrice)) ||
      (request.model !== undefined && !text(request.model))) return fail('invalid-requirements', 'The task model requirements are invalid');
  const previous = request.previous;
  if (previous && (previous.provider !== catalog.provider || previous.connector !== catalog.connector ||
      !text(previous.model) || !text(previous.catalogRevision) || !['explicit', 'automatic'].includes(previous.mode) ||
      !['explicit', 'declared-price', 'declared-tier'].includes(previous.basis) ||
      (previous.qualityTier !== 'unknown' && !QUALITY.includes(previous.qualityTier)) ||
      (previous.costTier !== 'unknown' && !COST.includes(previous.costTier)) ||
      (previous.price !== null && !price(previous.price)) ||
      (request.model !== undefined && request.model !== previous.model)))
    return fail('review-required', 'Changing the approved model or connector requires a new review');
  const pinned = request.model ?? previous?.model;
  const available = pinned ? catalog.models.filter(model => model.id === pinned) : catalog.models;
  if (pinned && !available.length) return fail('missing-model', 'The explicitly selected model is unavailable; no fallback was selected');
  const eligible = available.filter(model =>
    (!requirements.classes?.length || requirements.classes.some(value => model.classes.includes(value))) &&
    (!requirements.minQualityTier || (model.qualityTier !== 'unknown' && QUALITY.indexOf(model.qualityTier) >= QUALITY.indexOf(requirements.minQualityTier))) &&
    (!requirements.maxCostTier || (knownCost(model) && COST.indexOf(model.costTier) <= COST.indexOf(requirements.maxCostTier))) &&
    (!requirements.capabilities?.length || requirements.capabilities.every(value => model.capabilities.includes(value))) &&
    (!requirements.maxPrice || (price(model.price) && model.price.unit === requirements.maxPrice.unit && model.price.amount <= requirements.maxPrice.amount)));
  if (!eligible.length) return fail('no-compatible-model', 'No available model satisfies the declared task constraints');
  let basis: StudioModelSelection['basis'] = 'explicit';
  if (!pinned) {
    if (!requirements.maxPrice && !requirements.maxCostTier)
      return fail('budget-required', 'Automatic selection requires an explicit price or tier ceiling');
    if (eligible.every(model => price(model.price))) {
      const units = new Set(eligible.map(model => model.price!.unit));
      if (units.size !== 1 && !requirements.maxCostTier)
        return fail('incomparable-prices', 'The declared prices use different units');
      basis = units.size === 1 ? 'declared-price' : 'declared-tier';
    } else basis = 'declared-tier';
    if (basis === 'declared-tier' && (!requirements.maxCostTier || !eligible.every(knownCost)))
      return fail('unknown-cost', 'Automatic selection requires comparable declared costs or an approved known tier');
    eligible.sort((left, right) => (basis === 'declared-price'
      ? left.price!.amount - right.price!.amount
      : COST.indexOf(left.costTier as StudioCostTier) - COST.indexOf(right.costTier as StudioCostTier)) || order(left.id, right.id));
  }
  const selected = eligible[0]!;
  if (previous && ((previous.price !== null && (!price(previous.price) || !price(selected.price) ||
      previous.price.unit !== selected.price.unit || selected.price.amount > previous.price.amount)) ||
      (previous.costTier !== 'unknown' && (!knownCost(selected) || COST.indexOf(selected.costTier) > COST.indexOf(previous.costTier)))))
    return fail('review-required', 'The approved cost increased or can no longer be verified; no request was sent');
  return { ok: true, selection: { provider: catalog.provider, connector: catalog.connector, catalogRevision: catalog.revision,
    model: selected.id, mode: previous?.mode ?? (request.model ? 'explicit' : 'automatic'), basis: previous?.basis ?? basis,
    qualityTier: selected.qualityTier, costTier: selected.costTier,
    price: selected.price ? { amount: selected.price.amount, unit: selected.price.unit } : null } };
}

/** Provider counters only. Null means not reported, never a zero-cost claim. */
export interface StudioUsageReport {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  charge: { amount: number; currency: string } | null;
}
export function studioUsageReport(value?: Partial<StudioUsageReport> | null): StudioUsageReport {
  const count = (n: unknown): number | null => Number.isSafeInteger(n) && (n as number) >= 0 ? n as number : null;
  const charge = value?.charge;
  return { inputTokens: count(value?.inputTokens), outputTokens: count(value?.outputTokens), totalTokens: count(value?.totalTokens),
    charge: charge && Number.isFinite(charge.amount) && charge.amount >= 0 && text(charge.currency)
      ? { amount: charge.amount, currency: charge.currency } : null };
}

/** Scope/account/connection/catalog identities remain local. User-authored prompt content is explicit input. */
export function createStudioProviderInput(value: {
  assignment: StudioAssignment; selection: StudioModelSelection; prompt: string; conversation?: string | null;
}): { model: string; prompt: string; instructions: string; conversation: string | null } {
  assertStudioAssignment(value.assignment);
  if (typeof value.prompt !== 'string' || !text(value.selection?.model) ||
      (value.conversation !== undefined && value.conversation !== null && !text(value.conversation))) throw new Error('Invalid Studio provider input');
  return { model: value.selection.model, prompt: value.prompt, instructions: STUDIO_ROLE_POLICY[value.assignment.role].instruction,
    conversation: value.conversation ?? null };
}
