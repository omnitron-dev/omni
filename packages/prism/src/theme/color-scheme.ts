import type { CSSObject, Theme } from '@mui/material/styles';
import type { PrismTheme } from '../types/theme.js';

type ThemeWithPolicy = Theme & { prism?: Pick<PrismTheme['prism'], 'mode'> };

/** Root tokens follow the native selector, including MUI's media-query strategy. */
export function rootColorSchemeStyles(theme: Theme, mode: 'light' | 'dark', styles: CSSObject): CSSObject {
  if (!theme.getColorSchemeSelector) return {};
  const selector = theme.getColorSchemeSelector(mode).replace(/ &$/, '');
  return selector.startsWith('@media')
    ? { [selector]: { [theme.rootSelector || ':root']: styles } }
    : selector === '&' ? {} : { [selector]: styles };
}

/** CSS-only system default. Explicit selectors always win, including before React loads. */
export function systemColorSchemeStyles(theme: ThemeWithPolicy, mode: 'light' | 'dark', styles: CSSObject): CSSObject {
  if (theme.prism?.mode !== 'system' || typeof theme.getColorSchemeSelector !== 'function' || theme.colorSchemeSelector === 'media') return {};
  const light = theme.getColorSchemeSelector('light').replace(/ &$/, '');
  const dark = theme.getColorSchemeSelector('dark').replace(/ &$/, '');
  if (light === '&' || dark === '&') return {};
  const root = theme.rootSelector || ':root';
  return { [`@media (prefers-color-scheme: ${mode})`]: { [`${root}:not(:is(${light}, ${dark}))`]: styles } };
}

/** Reuse MUI's emitted declarations; do not recalculate palettes or install a second mode listener. */
export function addSystemColorSchemeDefault(theme: PrismTheme): void {
  if (theme.prism.mode !== 'system' || !theme.generateStyleSheets || theme.colorSchemeSelector === 'media') return;
  const applyStyles = theme.applyStyles;
  theme.applyStyles = function applySystemStyles(mode, styles) {
    const native = applyStyles.call(this, mode, styles);
    if (mode !== 'light' && mode !== 'dark') return native;
    const fallback = systemColorSchemeStyles(this, mode, styles);
    const media = `@media (prefers-color-scheme: ${mode})`;
    const roots = fallback[media];
    if (!roots || typeof roots !== 'object') return native;
    return {
      ...native,
      // Match MUI's explicit-selector form: leading pseudo selectors otherwise
      // bind to the component itself when Emotion expands nested global styles.
      [media]: Object.fromEntries(Object.entries(roots).map(([selector, rules]) => [`*:where(${selector}) &`, rules])),
    };
  };
  const generate = theme.generateStyleSheets;
  theme.generateStyleSheets = () => {
    const sheets = generate();
    const root = theme.rootSelector || ':root';
    const systemSheets = (['light', 'dark'] as const).flatMap(mode => {
      const selector = theme.getColorSchemeSelector(mode).replace(/ &$/, '');
      const declarations: CSSObject = {};
      for (const sheet of sheets) {
        for (const [rule, value] of Object.entries(sheet)) {
          if ((rule === selector || rule === `${root}, ${selector}`) && value && typeof value === 'object') {
            Object.assign(declarations, value);
          }
        }
      }
      return Object.keys(declarations).length ? [systemColorSchemeStyles(theme, mode, declarations)] : [];
    });
    return [...sheets, ...systemSheets];
  };
}
