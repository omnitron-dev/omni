# Studio responsibilities and model selection

A Studio assignment belongs to a project and optionally a stack. Its responsibility determines the proposed result: analyst → analysis, engineer → patch, reviewer → review, operator → runbook. These are agent responsibilities, not replacements for Omnitron access roles. They grant no deployment, process control, file mutation or credential access. The service must separately authorize the user's project/stack scope; a result still needs the platform's ordinary admission before any operation.

`shared/dto/studio-policy.ts` is the shared, browser-safe contract. UI, CLI and the service use `assertStudioAssignment`, `selectStudioModel` and `studioUsageReport`. The trusted service retains the exact connector catalog revision, requirements and selection. A client-supplied catalog is not authority to spend or elevate access.

Apply `studioRoleRequirements(role, requirements, pinned)` before selection in both UI and server. Automatic choices must match the responsibility's task classes: analyst general/reasoning, engineer code, reviewer reasoning/code, operator general/reasoning. Explicit class constraints are intersected with those defaults; an empty intersection is refused. Capabilities, minimum quality and budget remain unchanged. A manually pinned model receives no inferred class requirement, but every explicit task constraint still applies. Passing an unknown model name cannot bypass a required capability, hardware feature or quality tier.

Each connector owns its available model catalog. Class, quality tier, cost tier and price are explicit facts or reviewed operator calibration. A model name does not establish any of them. For example, the observed `agy models` listing provides identifiers and labels, but no prices or quality/cost metadata. `studioCatalogFromListing` therefore leaves those fields unknown, including for Carbon and Argon. A manual pin may select an available opaque model when the task has no contradictory requirements; its estimated cost stays unknown.

Automatic selection requires an explicit ceiling (`maxPrice` or `maxCostTier`) and the requested class, quality and capabilities. It chooses the lowest comparable declared price; if numeric prices are unavailable or incomparable, it can choose the lowest known declared tier only with an approved tier ceiling. Ties use model ID in code-point order, independent of machine locale or catalog order. Quotes are comparable only within the same declared unit: an input-token rate cannot be compared with a request price. A quote is not actual invoiced usage.

This is an illustrative **local calibration**, not a claim about a provider or real model prices:

```ts
const catalog: StudioModelCatalog = {
  provider: 'agy', connector: 'local-connection', revision: 'reviewed-calibration-1',
  models: [
    { id: 'available-model-a', label: 'Model A', classes: ['code'], qualityTier: 'advanced',
      costTier: 'economy', capabilities: ['text'], price: null },
    { id: 'available-model-b', label: 'Model B', classes: ['code'], qualityTier: 'advanced',
      costTier: 'premium', capabilities: ['text'], price: null },
  ],
};
// The operator has explicitly approved a standard-or-lower tier for this task.
selectStudioModel(catalog, {
  provider: 'agy', connector: 'local-connection',
  requirements: { classes: ['code'], minQualityTier: 'advanced', maxCostTier: 'standard' },
});
// Chooses Model A by declared tier. Numeric price remains unknown.
```

An explicit model never silently falls back. On retry, supply the retained `previous` selection: disappearance, a changed connector/model, an increased known price/tier or lost evidence requires review. A new selection is not permission to retry an uncertain provider request. The worker must retain its ordinary turn/request identity and establish that request's outcome first.

`createStudioProviderInput` constructs only model, user-authored prompt, the responsibility instruction and provider conversation reference. It excludes local project/stack, account, connection and catalog identities. This protects generated metadata; it does not redact information deliberately included in the prompt. Provider usage is a separate allowlist: input/output/total tokens and actual charge when reported. Missing counters and subscription charges stay `null`, not zero; totals and prices are never inferred from a model name or an advertised quote.
