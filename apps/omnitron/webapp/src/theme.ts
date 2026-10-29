import type { ThemeOptions } from '@mui/material/styles';

/** Console surfaces extend Prism; density, focus, menus and forms remain shared. */
export function consoleTheme({ mode }: { mode: 'light' | 'dark' }): ThemeOptions & Record<string, unknown> {
  return {
    palette: {
      background:
        mode === 'dark'
          ? { default: '#070b16', paper: '#101827', neutral: '#162033' }
          : { default: '#f5f7fc', paper: '#ffffff', neutral: '#eef2f8' },
    },
    components: {
      MuiCard: { styleOverrides: { root: { minWidth: 0, boxShadow: 'none' } } },
      MuiCardHeader: {
        styleOverrides: {
          root: { flexWrap: 'wrap', gap: 8 },
          content: { minWidth: 0, overflowWrap: 'anywhere' },
          action: { margin: 0, alignSelf: 'center' },
        },
      },
    },
  };
}
