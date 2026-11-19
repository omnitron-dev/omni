import {
  STUDIO_PROVIDERS,
  isBuiltinStudioProvider,
  type BuiltinStudioProvider,
  type StudioModelCatalog,
  type StudioProvider,
} from '@omnitron-dev/omnitron/dto/services';

const names: Record<BuiltinStudioProvider, string> = {
  codex: 'Codex',
  agy: 'Antigravity',
  claude: 'Claude Code',
  kimi: 'Kimi Code',
};

export function studioProviderName(provider: StudioProvider): string {
  return isBuiltinStudioProvider(provider) ? names[provider] : provider;
}

export function studioProviderOptions(
  catalogs: StudioModelCatalog[],
  permitted: StudioProvider[] = []
): StudioProvider[] {
  const extensions = new Set(
    [...permitted, ...catalogs.map(({ provider }) => provider)].filter((id) => !isBuiltinStudioProvider(id))
  );
  return [...STUDIO_PROVIDERS, ...Array.from(extensions).sort()];
}
