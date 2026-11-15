import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { useTheme } from '@mui/material/styles';
import type { ThemeMode } from '../types/theme.js';

export interface PrismThemeScriptProps {
  /** The same preference key passed to PrismProvider. Values are light, dark or system. */
  modeStorageKey: string;
  defaultMode?: ThemeMode;
  /** Outside PrismProvider, supply the selector used by createPrismTheme. */
  attribute?: string;
  nonce?: string;
}

/** Place before visible content. MUI selects the precompiled scheme before React loads. */
export function PrismThemeScript({ modeStorageKey, defaultMode = 'system', attribute, nonce }: PrismThemeScriptProps) {
  const theme = useTheme();
  return <InitColorSchemeScript attribute={attribute ?? theme.colorSchemeSelector ?? 'data-prism-color-scheme'} modeStorageKey={modeStorageKey}
    colorSchemeStorageKey={`${modeStorageKey}-scheme`} defaultMode={defaultMode} nonce={nonce} />;
}
