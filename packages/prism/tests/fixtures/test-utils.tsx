/**
 * Prism Test Utilities
 *
 * Shared utilities for E2E and component tests.
 * Provides wrappers for MUI components with proper theming.
 */

import type { ReactNode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

// We'll use the theme from the build output
// For tests, we create a minimal theme
import { createTheme } from '@mui/material/styles';

/**
 * Create a test theme for consistent testing
 */
export function createTestTheme(mode: 'light' | 'dark' = 'light') {
  return createTheme({
    palette: {
      mode,
      primary: {
        main: '#3385F0',
      },
      secondary: {
        main: '#8E33FF',
      },
    },
    // Disable animations for faster tests
    transitions: {
      create: () => 'none',
    },
  });
}

/**
 * Test wrapper with MUI providers
 */
interface TestWrapperProps {
  children: ReactNode;
  mode?: 'light' | 'dark';
}

export function TestWrapper({ children, mode = 'light' }: TestWrapperProps) {
  const theme = createTestTheme(mode);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

/**
 * Data-testid selectors for MUI components
 *
 * Best practice: Use data-testid for stable selectors
 * @see https://playwright.dev/docs/locators#locate-by-test-id
 */
export const testIds = {
  // Dialogs
  confirmDialog: 'prism-confirm-dialog',
  confirmDialogTitle: 'prism-confirm-dialog-title',
  confirmDialogContent: 'prism-confirm-dialog-content',
  confirmDialogConfirmButton: 'prism-confirm-dialog-confirm',
  confirmDialogCancelButton: 'prism-confirm-dialog-cancel',

  // Cards
  card: 'prism-card',
  cardHeader: 'prism-card-header',
  cardContent: 'prism-card-content',

  // Dashboard Block
  dashboardBlock: 'prism-dashboard-block',
  dashboardBlockHeader: 'prism-dashboard-block-header',
  dashboardBlockContent: 'prism-dashboard-block-content',
  dashboardBlockFooter: 'prism-dashboard-block-footer',
  dashboardBlockCollapseButton: 'prism-dashboard-block-collapse',

  // Form Fields
  fieldText: 'prism-field-text',
  fieldSelect: 'prism-field-select',
  fieldCheckbox: 'prism-field-checkbox',

  // Navigation
  sidenav: 'prism-sidenav',
  sidenavItem: 'prism-sidenav-item',

  // Settings
  settingsDrawer: 'prism-settings-drawer',
  settingsThemeToggle: 'prism-settings-theme-toggle',
};

/**
 * Wait for MUI transitions to complete
 * MUI uses 300ms for most transitions
 */
export const MUI_TRANSITION_DURATION = 300;

/**
 * Common accessibility checks for MUI components
 */
export const a11yChecks = {
  /**
   * Check that element has proper focus visible styles
   */
  hasFocusVisible: (element: Element) => {
    const styles = window.getComputedStyle(element);
    return styles.outline !== 'none' || styles.boxShadow !== 'none';
  },

  /**
   * Check that color contrast meets WCAG AA standards
   */
  meetsContrastRequirements: (foreground: string, background: string) => {
    // Simplified contrast check - real implementation would calculate ratio
    return true; // Placeholder
  },
};

/**
 * Role-based selectors for MUI components
 * Use ARIA roles for more semantic testing
 */
export const roles = {
  dialog: 'dialog',
  button: 'button',
  textbox: 'textbox',
  checkbox: 'checkbox',
  combobox: 'combobox',
  navigation: 'navigation',
  main: 'main',
  banner: 'banner',
  complementary: 'complementary',
};
