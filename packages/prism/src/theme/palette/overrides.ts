import { darken, lighten, getContrastRatio } from '@mui/material/styles';
import { colorChannel, hslToRgb } from '@mui/system';
import type { PaletteOptions } from '@mui/material/styles';

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const owns = (value: RecordValue, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const roles = ['primary', 'secondary', 'success', 'info', 'warning', 'error'] as const;
const shades = ['light', 'dark', 'lighter', 'darker', 'contrastText'] as const;

type RoleColour = Partial<NonNullable<PaletteOptions['primary']>> &
  Partial<Record<'main' | typeof shades[number] | `${'main' | typeof shades[number]}Channel`, string>>;

/** Application colours merge over a complete preset, so a main colour is not
 * required when changing a single shade. Include Prism's additional channels.
 */
export type PaletteOverrides = Omit<PaletteOptions, typeof roles[number] | 'text'> & {
  [Role in typeof roles[number]]?: RoleColour;
} & {
  text?: PaletteOptions['text'] & Partial<Record<'primaryChannel' | 'secondaryChannel' | 'disabledChannel', string>>;
};
const colourKeys = new Set(['main', ...shades, 'primary', 'secondary', 'disabled', 'default', 'paper', 'neutral', 'divider', 'active', 'selected', 'hover', 'focus', 'disabledBackground', 'background', 'onBackground', 'black', 'white']);

/** Only return numeric sRGB channels when the JS colour parser can resolve them.
 * CSS variables, modern space-separated rgb(), wide-gamut colours and named
 * colours must remain browser expressions; fabricating numbers loses meaning.
 */
function staticChannel(value: string): string | undefined {
  if (!/^(#[\da-f]{3,8}$|rgba?\(|hsla?\()/i.test(value)) return undefined;
  if (/^rgba?\(/i.test(value) && value.includes('%')) return undefined;
  try {
    const channel = colorChannel(/^hsl/i.test(value) ? hslToRgb(value) : value);
    const components = channel.split(' ');
    return components.length === 3 && components.every(part => part !== '' && Number.isFinite(Number(part))) ? channel : undefined;
  } catch {
    return undefined;
  }
}

function channelFor(value: string): string {
  return staticChannel(value) ?? `from ${value} r g b`;
}

/** Regenerate overridden channels, including Prism extensions that MUI does not
 * augment (text.disabled, lighter/darker, custom colours). Explicit channels,
 * including undefined, retain precedence. Unrelated preset values stay intact.
 */
function reconcileChannels(merged: RecordValue, supplied: RecordValue): RecordValue {
  const result = { ...merged };
  for (const [key, value] of Object.entries(supplied)) {
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = reconcileChannels(result[key], value);
    } else if (typeof value === 'string' && !key.endsWith('Channel') && !owns(supplied, `${key}Channel`)) {
      const channel = staticChannel(value);
      if (channel !== undefined || owns(merged, `${key}Channel`) || colourKeys.has(key)) {
        result[`${key}Channel`] = channel ?? channelFor(value);
      }
    }
  }
  return result;
}

interface PaletteReconciliationOptions {
  nativeColor?: boolean;
  cssVarPrefix?: string;
}

/** A changed main colour starts a new tonal family. Caller-supplied shades and
 * channels always win. Static colours use sRGB arithmetic; native MUI palettes
 * retain browser-resolved colour expressions and native contrast calculation.
 */
export function reconcilePaletteOverrides(
  merged: PaletteOptions,
  supplied?: PaletteOverrides,
  { nativeColor = false, cssVarPrefix = 'prism' }: PaletteReconciliationOptions = {},
): PaletteOptions {
  if (!supplied) return merged;
  const result = reconcileChannels(merged as RecordValue, supplied as RecordValue);
  for (const name of roles) {
    const input: unknown = supplied[name];
    if (!isRecord(input) || typeof input.main !== 'string') continue;
    const role = { ...(result[name] as RecordValue) };
    const numeric = staticChannel(input.main) !== undefined;
    for (const shade of shades) {
      if (!owns(input, shade)) {
        delete role[shade];
        if (!owns(input, `${shade}Channel`)) delete role[`${shade}Channel`];
      }
    }
    // MUI's JS augmenter cannot interpret runtime colour values. Native colour
    // mode can; in legacy mode the application must supply the standard tones.
    if (!nativeColor && !numeric && ['light', 'dark', 'contrastText'].some(shade => typeof role[shade] !== 'string' || !role[shade])) {
      throw new Error(`Prism: palette.${name}.main cannot be resolved in JavaScript. Enable overrides.cssVariables.nativeColor or supply light, dark and contrastText explicitly.`);
    }
    const dark = result.mode === 'dark';
    const mix = (colour: string, amount: number) => `color-mix(in oklch, ${input.main}, ${colour} ${amount * 100}%)`;
    role.lighter ??= numeric && !nativeColor
      ? dark ? darken(input.main, 0.75) : lighten(input.main, 0.9)
      : dark ? mix('#000', 0.75) : mix('#fff', 0.9);
    role.darker ??= numeric && !nativeColor
      ? dark ? lighten(input.main, 0.85) : darken(input.main, 0.7)
      : dark ? mix('#fff', 0.85) : mix('#000', 0.7);
    if (numeric && !nativeColor) {
      role.contrastText ??= getContrastRatio(input.main, '#fff') >= getContrastRatio(input.main, '#000') ? '#fff' : '#000';
    }
    for (const shade of shades) {
      if (owns(input, `${shade}Channel`)) continue;
      if (typeof role[shade] === 'string') {
        role[`${shade}Channel`] = channelFor(role[shade]);
      } else if (nativeColor) {
        // MUI generates the tone after reconciliation. Refer to that token so
        // channels follow tonalOffset and native contrast instead of guessing.
        const prefix = cssVarPrefix ? `${cssVarPrefix}-` : '';
        role[`${shade}Channel`] = `from var(--${prefix}palette-${name}-${shade}) r g b`;
      }
    }
    result[name] = role;
  }
  return result as PaletteOptions;
}
