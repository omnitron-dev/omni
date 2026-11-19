import { describe, expect, it } from 'vitest';
import {
  assertStudioAssignment, createStudioProviderInput, selectStudioModel, studioCatalogFromListing,
  studioRoleRequirements, studioUsageReport, STUDIO_ROLE_POLICY, STUDIO_ROLES, isStudioProvider, isBuiltinStudioProvider,
  type StudioAssignment, type StudioModelCatalog, type StudioModelDescriptor, type StudioModelRequest,
} from '../../src/shared/dto/studio-policy.js';

const model = (id: string, extra: Partial<StudioModelDescriptor> = {}): StudioModelDescriptor => ({
  id, label: id, classes: ['code'], qualityTier: 'advanced', costTier: 'standard',
  capabilities: ['text'], price: { amount: 2, unit: 'catalog-credits/request' }, ...extra,
});
const catalog = (...models: StudioModelDescriptor[]): StudioModelCatalog => ({ provider: 'agy', connector: 'local-connector', revision: 'r1', models });
const request = (extra: Partial<StudioModelRequest> = {}): StudioModelRequest => ({ provider: 'agy', connector: 'local-connector',
  requirements: { classes: ['code'], minQualityTier: 'advanced', capabilities: ['text'], maxCostTier: 'standard' }, ...extra });
const assignment: StudioAssignment = { scope: { project: 'private-project', stack: 'production' }, role: 'engineer', result: 'patch' };

describe('Studio responsibility and privacy policy', () => {
  it('separates built-in command drivers from qualified third-party catalog names', () => {
    expect(isBuiltinStudioProvider('codex')).toBe(true);
    expect(isStudioProvider('kimi')).toBe(true);
    expect(isBuiltinStudioProvider('example.org/research')).toBe(false);
    expect(isStudioProvider('tools.example.org/research-2')).toBe(true);
    for (const id of ['research', 'Example.org/research', 'example.org/research/', 'example.org/.',
      '.example.org/test', 'one..example/test', 'example.org/-test', 'https://example.org/test',
      '/usr/local/tool', 'example.org/tool name', 'example.org/' + 'a'.repeat(130), null])
      expect(isStudioProvider(id)).toBe(false);
  });

  it('limits every scoped responsibility to its own proposed result without deployment authority', () => {
    for (const role of STUDIO_ROLES) {
      expect(STUDIO_ROLE_POLICY[role].canDeploy).toBe(false);
      expect(() => assertStudioAssignment({ scope: { project: 'example', stack: 'test' }, role, result: STUDIO_ROLE_POLICY[role].result })).not.toThrow();
    }
    expect(() => assertStudioAssignment({ ...assignment, role: 'operator', result: 'patch' })).toThrow('Invalid Studio');
    expect(() => assertStudioAssignment({ ...assignment, scope: { project: ' ' } })).toThrow();
    expect(() => assertStudioAssignment({ ...assignment, scope: { project: 'example', stack: '' } })).toThrow();
  });

  it('forwards an allowlist only, never the internal scope, catalog or account identity', () => {
    const selected = selectStudioModel(catalog(model('opaque')), request({ model: 'opaque' }));
    if (!selected.ok) throw Error(selected.message);
    const input = { assignment, selection: selected.selection, prompt: 'Review these public inputs', conversation: 'provider-conversation',
      account: 'local-account', connection: 'local-connection', secret: 'must-not-propagate' };
    const wire = createStudioProviderInput(input);
    expect(Object.keys(wire).sort()).toEqual(['conversation', 'instructions', 'model', 'prompt']);
    expect(wire.model).toBe('opaque');
    expect(wire.conversation).toBe('provider-conversation');
    for (const privateValue of ['private-project', 'production', 'local-connector', 'local-account', 'local-connection', 'must-not-propagate'])
      expect(JSON.stringify(wire)).not.toContain(privateValue);
  });
});

describe('Studio model assignment', () => {
  it('applies role classes without loosening explicit requirements or the approved budget', () => {
    const requirements = { classes: ['reasoning', 'code'] as const, minQualityTier: 'advanced' as const,
      capabilities: ['tool-contract-v2'], maxCostTier: 'economy' as const, maxPrice: { amount: 2, unit: 'credits' } };
    const selected = studioRoleRequirements('engineer', { ...requirements, classes: [...requirements.classes] }, false);
    expect(selected).toEqual({ ...requirements, classes: ['code'] });
    expect(studioRoleRequirements('operator', {}, false).classes).toEqual(['general', 'reasoning']);
    expect(() => studioRoleRequirements('engineer', { classes: ['general'] }, false)).toThrow('Task classes');
    expect(selected.capabilities).not.toBe(requirements.capabilities);
    expect(selected.maxPrice).not.toBe(requirements.maxPrice);
  });

  it('allows an opaque explicitly pinned model only when all mandatory requirements can be satisfied', () => {
    const opaque = studioCatalogFromListing('agy', 'local-connector', 'listing', [{ id: 'opaque', label: 'Opaque' }]);
    const pinned = (requirements: StudioModelRequest['requirements']) => request({ model: 'opaque', requirements: studioRoleRequirements('engineer', requirements, true) });
    expect(selectStudioModel(opaque, pinned({}))).toMatchObject({ ok: true });
    const mandatory: StudioModelRequest['requirements'][] = [
      { classes: ['code'] }, { capabilities: ['local-gpu'] }, { minQualityTier: 'advanced' },
    ];
    for (const requirements of mandatory) {
      expect(selectStudioModel(opaque, pinned(requirements))).toMatchObject({ ok: false, reason: 'no-compatible-model' });
    }
    expect(selectStudioModel(opaque, request({ requirements: studioRoleRequirements('engineer', { maxCostTier: 'standard' }, false) })))
      .toMatchObject({ ok: false, reason: 'no-compatible-model' });
  });

  it('keeps names from a real listing opaque and allows only an explicit choice when cost is unknown', () => {
    const opaque = studioCatalogFromListing('agy', 'local-connector', 'listing-1', [
      { id: 'gemini-4-carbon-high', label: 'Gemini 4 Carbon (High)' },
      { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
    ]);
    expect(opaque.models.every(item => item.classes.length === 0 && item.qualityTier === 'unknown' && item.costTier === 'unknown' && item.price === null)).toBe(true);
    const manual = selectStudioModel(opaque, request({ model: 'gemini-4-carbon-high', requirements: {} }));
    expect(manual).toMatchObject({ ok: true, selection: { mode: 'explicit', price: null, qualityTier: 'unknown', costTier: 'unknown' } });
    expect(selectStudioModel(opaque, request({ requirements: {} }))).toMatchObject({ ok: false, reason: 'budget-required' });
    expect(selectStudioModel(opaque, request({ model: 'gemini-4-carbon-high' }))).toMatchObject({ ok: false, reason: 'no-compatible-model' });
  });

  it('selects the lowest comparable declared price subject to task constraints and budget', () => {
    const models = catalog(model('higher', { price: { amount: 3, unit: 'catalog-credits/request' } }),
      model('lower'), model('wrong-class', { classes: ['general'], price: { amount: 0, unit: 'catalog-credits/request' } }),
      model('low-quality', { qualityTier: 'standard', price: { amount: 0, unit: 'catalog-credits/request' } }),
      model('wrong-capability', { capabilities: [], price: { amount: 0, unit: 'catalog-credits/request' } }));
    expect(selectStudioModel(models, request())).toMatchObject({ ok: true, selection: { model: 'lower', basis: 'declared-price', mode: 'automatic' } });
    expect(selectStudioModel(models, request({ requirements: { classes: ['code'], minQualityTier: 'advanced', capabilities: ['text'],
      maxPrice: { amount: 1, unit: 'catalog-credits/request' } } }))).toMatchObject({ ok: false, reason: 'no-compatible-model' });
  });

  it('allows calibrated known cost tiers with an explicit ceiling when no numeric price is available', () => {
    const models = catalog(model('standard', { price: null }), model('economy', { costTier: 'economy', price: null }),
      model('premium', { costTier: 'premium', price: null }));
    expect(selectStudioModel(models, request())).toMatchObject({ ok: true, selection: { model: 'economy', basis: 'declared-tier', price: null } });
    expect(selectStudioModel(models, request({ requirements: { classes: ['code'] } }))).toMatchObject({ ok: false, reason: 'budget-required' });
  });

  it('does not compare different price units and never substitutes a missing quoted budget', () => {
    const models = catalog(model('a'), model('b', { price: { amount: 0.001, unit: 'USD/1M-tokens' } }));
    // An explicitly approved tier comparison remains meaningful; it does not claim price equivalence.
    expect(selectStudioModel(models, request())).toMatchObject({ ok: true, selection: { model: 'a', basis: 'declared-tier' } });
    expect(selectStudioModel(models, request({ requirements: { maxPrice: { amount: 4, unit: 'catalog-credits/request' } } })))
      .toMatchObject({ ok: true, selection: { model: 'a', basis: 'declared-price' } });
    expect(selectStudioModel(catalog(model('a', { price: null })), request({ requirements: { maxPrice: { amount: 4, unit: 'catalog-credits/request' } } })))
      .toMatchObject({ ok: false, reason: 'no-compatible-model' });
  });

  it('has a deterministic, locale-independent tie break and leaves caller arrays untouched', () => {
    const entries = [model('z'), model('a')];
    const before = JSON.stringify(entries);
    expect(selectStudioModel(catalog(...entries), request())).toMatchObject({ ok: true, selection: { model: 'a' } });
    expect(JSON.stringify(entries)).toBe(before);
    expect(selectStudioModel(catalog(...entries.toReversed()), request())).toEqual(selectStudioModel(catalog(...entries), request()));
  });

  it('honors an explicit model even when a cheaper model is available and never falls back', () => {
    const models = catalog(model('pinned', { price: { amount: 3, unit: 'catalog-credits/request' } }), model('cheap'));
    expect(selectStudioModel(models, request({ model: 'pinned' }))).toMatchObject({ ok: true, selection: { model: 'pinned', mode: 'explicit' } });
    expect(selectStudioModel(models, request({ model: 'missing' }))).toMatchObject({ ok: false, reason: 'missing-model' });
    expect(selectStudioModel(models, request({ model: 'pinned', requirements: { classes: ['multimodal'] } })))
      .toMatchObject({ ok: false, reason: 'no-compatible-model' });
  });

  it('binds a catalog to the exact provider and connector', () => {
    expect(selectStudioModel(catalog(model('a')), request({ provider: 'codex' }))).toMatchObject({ ok: false, reason: 'connector-mismatch' });
    expect(selectStudioModel(catalog(model('a')), request({ connector: 'another-account-connector' }))).toMatchObject({ ok: false, reason: 'connector-mismatch' });
  });

  it('pins the approved result across retries and refuses changed cost or unavailable evidence', () => {
    const first = selectStudioModel(catalog(model('chosen')), request());
    if (!first.ok) throw Error(first.message);
    const repeat = request({ previous: first.selection });
    expect(selectStudioModel(catalog(model('new-cheaper', { price: { amount: 1, unit: 'catalog-credits/request' } }), model('chosen')), repeat))
      .toMatchObject({ ok: true, selection: { model: 'chosen', mode: 'automatic' } });
    for (const next of [model('chosen', { price: { amount: 3, unit: 'catalog-credits/request' } }),
      model('chosen', { price: null }), model('chosen', { price: { amount: 2, unit: 'other-unit' } })])
      expect(selectStudioModel(catalog(next), repeat)).toMatchObject({ ok: false, reason: 'review-required' });
    expect(selectStudioModel(catalog(model('alternative')), repeat)).toMatchObject({ ok: false, reason: 'missing-model' });
    expect(selectStudioModel(catalog(model('alternative')), { ...repeat, model: 'alternative' })).toMatchObject({ ok: false, reason: 'review-required' });
  });

  it('requires review for a higher tier even when its numeric price is unchanged', () => {
    const first = selectStudioModel(catalog(model('a', { costTier: 'economy', price: null })), request());
    if (!first.ok) throw Error(first.message);
    expect(selectStudioModel(catalog(model('a', { price: null })), request({ previous: first.selection })))
      .toMatchObject({ ok: false, reason: 'review-required' });
  });

  it('rejects duplicate model IDs, non-finite prices and invalid task ceilings', () => {
    expect(selectStudioModel(catalog(model('a'), model('a')), request())).toMatchObject({ ok: false, reason: 'invalid-catalog' });
    expect(selectStudioModel(catalog(model('a', { price: { amount: Infinity, unit: 'credits' } })), request()))
      .toMatchObject({ ok: false, reason: 'invalid-catalog' });
    expect(selectStudioModel(catalog(model('a')), request({ requirements: { maxPrice: { amount: -1, unit: 'credits' } } })))
      .toMatchObject({ ok: false, reason: 'invalid-requirements' });
  });

  it('retains only the quote allowlist and refuses a malformed previous selection', () => {
    const quoted = { amount: 2, unit: 'catalog-credits/request', account: 'private' };
    const first = selectStudioModel(catalog(model('a', { price: quoted })), request());
    if (!first.ok) throw Error(first.message);
    expect(first.selection.price).toEqual({ amount: 2, unit: 'catalog-credits/request' });
    expect(selectStudioModel(catalog(model('a')), request({ previous: { ...first.selection, catalogRevision: '' } })))
      .toMatchObject({ ok: false, reason: 'review-required' });
  });
});

describe('Studio observed usage', () => {
  it('preserves actual counters and charges without inventing missing totals or subscription prices', () => {
    expect(studioUsageReport()).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null, charge: null });
    expect(studioUsageReport({ inputTokens: 3, outputTokens: 4 })).toEqual({ inputTokens: 3, outputTokens: 4, totalTokens: null, charge: null });
    expect(studioUsageReport({ totalTokens: 10, charge: { amount: 0, currency: 'USD' } }))
      .toEqual({ inputTokens: null, outputTokens: null, totalTokens: 10, charge: { amount: 0, currency: 'USD' } });
  });

  it('does not turn malformed counters into free usage and does not forward provider metadata', () => {
    const raw = { inputTokens: -1, outputTokens: 0.5, totalTokens: NaN, charge: { amount: 3, currency: 'USD', account: 'private' }, userId: 'private' };
    expect(studioUsageReport(raw)).toEqual({ inputTokens: null, outputTokens: null, totalTokens: null, charge: { amount: 3, currency: 'USD' } });
  });
});
