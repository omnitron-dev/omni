import { decomposeColor, getContrastRatio, hslToRgb } from '@mui/material/styles';
import { blend } from '@mui/system/colorManipulator';
import type { CSSObject, CssVarsTheme, Theme } from '@mui/material/styles';

type SemanticColor = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';
type Tone = 'dark' | 'light' | 'darker' | 'lighter';

/** MUI blend expects opaque sRGB channels, even when the theme uses HSL. */
function opaqueRgb(color: string): string {
  const rgb = color.startsWith('hsl') ? hslToRgb(color) : color;
  const { type, values } = decomposeColor(rgb);
  if (!['rgb', 'rgba'].includes(type) || !values.every(Number.isFinite) || (values[3] ?? 1) !== 1) {
    throw new Error('Semantic contrast requires an opaque sRGB surface');
  }
  return rgb;
}

/** Choose a readable tone on the composited surface, retaining the scheme's CSS token. */
export function semanticTextColor(
  theme: Theme,
  color: SemanticColor,
  mode: 'light' | 'dark',
  opacity: number,
  surface: 'paper' | 'white' = 'paper'
): string {
  const palette = theme.vars?.palette ?? theme.palette;
  const schemes = (theme as Theme & Partial<Pick<CssVarsTheme, 'colorSchemes'>>).colorSchemes;
  const source = schemes?.[mode]?.palette ?? theme.palette;
  const fallback = surface === 'white' ? palette.grey[800] : palette.text.primary;
  try {
    const tones = source[color] as Partial<Record<Tone, string>>;
    const background = surface === 'white'
      ? opaqueRgb(source.common.white)
      : blend(opaqueRgb(source.background.paper), opaqueRgb(source[color].main), opacity);
    // Prism's dark presets invert tonal roles; custom MUI palettes need not.
    // Prefer the usual tones, then the extended Prism scale when present.
    for (const pair of [['dark', 'light'], ['darker', 'lighter']] as const) {
      const tone = pair
        .filter((key) => tones[key])
        .sort((a, b) => getContrastRatio(tones[b]!, background) - getContrastRatio(tones[a]!, background))[0];
      if (tone && getContrastRatio(tones[tone]!, background) >= 4.5) {
        return (palette[color] as Partial<Record<Tone, string>>)[tone] ?? fallback;
      }
    }
  } catch {
    // Browser-resolved colours cannot be compared in JavaScript. Use semantic text.
  }
  return fallback;
}

/** Shared translucent status surface for labels, alerts and chips. */
export function semanticSurfaceStyles(
  theme: Theme,
  color: SemanticColor,
  lightOpacity = 0.16,
  darkOpacity = lightOpacity
): CSSObject {
  const palette = theme.vars?.palette ?? theme.palette;
  return {
    backgroundColor: theme.alpha(palette[color].main, lightOpacity),
    color: semanticTextColor(theme, color, 'light', lightOpacity),
    ...theme.applyStyles('dark', {
      color: semanticTextColor(theme, color, 'dark', darkOpacity),
      ...(darkOpacity !== lightOpacity && { backgroundColor: theme.alpha(palette[color].main, darkOpacity) }),
    }),
  };
}
