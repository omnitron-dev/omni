/** Omnitron's visual contract, shared by Console and Lumen's server-rendered shell. */
export const omnitronTokens = {
  font: {
    sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
  },
  radius: 6,
  color: {
    light: {
      background: '#F3F6F7', surface: '#FFFFFF', raised: '#E9EFF1',
      text: '#162026', muted: '#53646D', disabled: '#6C7D86',
      border: '#D2DCE1', controlBorder: '#71818A',
      accent: '#006D75', onAccent: '#FFFFFF',
      success: '#226742', warning: '#8A5700', error: '#B43A44', info: '#2C609A',
    },
    dark: {
      background: '#0B0F12', surface: '#13191D', raised: '#1B2328',
      text: '#E6EDF0', muted: '#A5B5BD', disabled: '#83959F',
      border: '#2D3B43', controlBorder: '#61757F',
      accent: '#71DDE3', onAccent: '#0B2528',
      success: '#7BCB9B', warning: '#E8C36A', error: '#F2969A', info: '#8FBDF4',
    },
  },
} as const;

export type OmnitronColorMode = keyof typeof omnitronTokens.color;

/** Apply on the server-rendered root; the palette never depends on hydration. */
export function omnitronCssVariables(mode: OmnitronColorMode): Record<string, string> {
  const color = omnitronTokens.color[mode];
  return {
    '--omni-bg': color.background,
    '--omni-surface': color.surface,
    '--omni-surface-raised': color.raised,
    '--omni-text': color.text,
    '--omni-text-muted': color.muted,
    '--omni-border': color.border,
    '--omni-control-border': color.controlBorder,
    '--omni-accent': color.accent,
    '--omni-on-accent': color.onAccent,
    '--omni-success': color.success,
    '--omni-warning': color.warning,
    '--omni-error': color.error,
    '--omni-info': color.info,
    '--omni-font-sans': omnitronTokens.font.sans,
    '--omni-font-mono': omnitronTokens.font.mono,
    '--omni-radius': `${omnitronTokens.radius}px`,
    '--omni-focus-ring': `2px solid ${color.accent}`,
  };
}
