/**
 * ApplicationShell Component (Styled)
 *
 * High-level composition component for modern web application layouts with styling.
 * Provides standard regions: Header, ActivityBar, Sidebar, Main, Panel, StatusBar.
 *
 * Features:
 * - Flexible layout system (horizontal/vertical)
 * - Collapsible sidebar and panel
 * - Signal-based state management
 * - Composable sub-components
 * - Responsive design support
 * - Theme variants
 */

import { styled } from '../../styling/styled.js';
import {
  ApplicationShell as ApplicationShellPrimitive,
  ApplicationShellHeader as ApplicationShellHeaderPrimitive,
  ApplicationShellActivityBar as ApplicationShellActivityBarPrimitive,
  ApplicationShellSidebar as ApplicationShellSidebarPrimitive,
  ApplicationShellMain as ApplicationShellMainPrimitive,
  ApplicationShellPanel as ApplicationShellPanelPrimitive,
  ApplicationShellStatusBar as ApplicationShellStatusBarPrimitive,
  type ApplicationShellProps as ApplicationShellPrimitiveProps,
  type ApplicationShellHeaderProps,
  type ApplicationShellActivityBarProps,
  type ApplicationShellSidebarProps,
  type ApplicationShellMainProps,
  type ApplicationShellPanelProps,
  type ApplicationShellStatusBarProps,
} from '../../primitives/ApplicationShell.js';

// ============================================================================
// Styled Components
// ============================================================================

/**
 * ApplicationShell Root - Styled application shell container
 */
export const ApplicationShell = styled<
  {
    theme?: 'light' | 'dark' | 'system';
  },
  ApplicationShellPrimitiveProps
>(ApplicationShellPrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100vh',
    overflow: 'hidden',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: '14px',
    lineHeight: '1.5',
    backgroundColor: '#ffffff',
    color: '#24292f',
  },
  variants: {
    theme: {
      light: {
        backgroundColor: '#ffffff',
        color: '#24292f',
      },
      dark: {
        backgroundColor: '#1e1e1e',
        color: '#cccccc',
      },
      system: {
        // Use system preference
        '@media (prefers-color-scheme: dark)': {
          backgroundColor: '#1e1e1e',
          color: '#cccccc',
        },
      },
    },
  },
  defaultVariants: {
    theme: 'light',
  },
});

/**
 * ApplicationShell Header - Styled header bar
 */
export const ApplicationShellHeader = styled<
  {
    variant?: 'default' | 'bordered' | 'elevated';
  },
  ApplicationShellHeaderProps
>(ApplicationShellHeaderPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '0 16px',
    flexShrink: '0',
    width: '100%',
    minHeight: '48px',
    backgroundColor: '#f6f8fa',
    borderBottom: '1px solid #d0d7de',
  },
  variants: {
    variant: {
      default: {
        backgroundColor: '#f6f8fa',
        borderBottom: '1px solid #d0d7de',
      },
      bordered: {
        backgroundColor: '#ffffff',
        borderBottom: '2px solid #0969da',
      },
      elevated: {
        backgroundColor: '#ffffff',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
        borderBottom: 'none',
      },
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

/**
 * ApplicationShell ActivityBar - Styled activity bar
 */
export const ApplicationShellActivityBar = styled<
  {
    position?: 'left' | 'right';
  },
  ApplicationShellActivityBarProps
>(ApplicationShellActivityBarPrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 0',
    flexShrink: '0',
    width: '48px',
    backgroundColor: '#2c2c2c',
    color: '#ffffff',
    borderRight: '1px solid #1e1e1e',
  },
  variants: {
    position: {
      left: {
        borderRight: '1px solid #1e1e1e',
        borderLeft: 'none',
      },
      right: {
        borderLeft: '1px solid #1e1e1e',
        borderRight: 'none',
      },
    },
  },
  defaultVariants: {
    position: 'left',
  },
});

/**
 * ApplicationShell Sidebar - Styled sidebar panel
 */
export const ApplicationShellSidebar = styled<
  {
    variant?: 'default' | 'bordered' | 'elevated';
  },
  ApplicationShellSidebarProps
>(ApplicationShellSidebarPrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: '0',
    backgroundColor: '#f6f8fa',
    borderRight: '1px solid #d0d7de',
    overflow: 'auto',
  },
  variants: {
    variant: {
      default: {
        backgroundColor: '#f6f8fa',
        borderRight: '1px solid #d0d7de',
      },
      bordered: {
        backgroundColor: '#ffffff',
        borderRight: '2px solid #d0d7de',
      },
      elevated: {
        backgroundColor: '#ffffff',
        boxShadow: '2px 0 8px 0 rgba(0, 0, 0, 0.1)',
        borderRight: 'none',
      },
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

/**
 * ApplicationShell Main - Styled main content area
 */
export const ApplicationShellMain = styled<
  {
    padding?: 'none' | 'sm' | 'md' | 'lg';
  },
  ApplicationShellMainProps
>(ApplicationShellMainPrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1',
    overflow: 'auto',
    minWidth: '0',
    minHeight: '0',
    backgroundColor: '#ffffff',
  },
  variants: {
    padding: {
      none: {
        padding: '0',
      },
      sm: {
        padding: '8px',
      },
      md: {
        padding: '16px',
      },
      lg: {
        padding: '24px',
      },
    },
  },
  defaultVariants: {
    padding: 'none',
  },
});

/**
 * ApplicationShell Panel - Styled bottom panel
 */
export const ApplicationShellPanel = styled<
  {
    variant?: 'default' | 'bordered' | 'elevated';
  },
  ApplicationShellPanelProps
>(ApplicationShellPanelPrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: '0',
    backgroundColor: '#f6f8fa',
    borderTop: '1px solid #d0d7de',
    overflow: 'auto',
  },
  variants: {
    variant: {
      default: {
        backgroundColor: '#f6f8fa',
        borderTop: '1px solid #d0d7de',
      },
      bordered: {
        backgroundColor: '#ffffff',
        borderTop: '2px solid #d0d7de',
      },
      elevated: {
        backgroundColor: '#ffffff',
        boxShadow: '0 -2px 8px 0 rgba(0, 0, 0, 0.1)',
        borderTop: 'none',
      },
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

/**
 * ApplicationShell StatusBar - Styled status bar
 */
export const ApplicationShellStatusBar = styled<
  {
    variant?: 'default' | 'accent' | 'minimal';
  },
  ApplicationShellStatusBarProps
>(ApplicationShellStatusBarPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 12px',
    flexShrink: '0',
    width: '100%',
    minHeight: '24px',
    fontSize: '12px',
    backgroundColor: '#0969da',
    color: '#ffffff',
  },
  variants: {
    variant: {
      default: {
        backgroundColor: '#0969da',
        color: '#ffffff',
      },
      accent: {
        backgroundColor: '#8250df',
        color: '#ffffff',
      },
      minimal: {
        backgroundColor: '#f6f8fa',
        color: '#57606a',
        borderTop: '1px solid #d0d7de',
      },
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

// ============================================================================
// Attach sub-components
// ============================================================================

(ApplicationShell as any).Header = ApplicationShellHeader;
(ApplicationShell as any).ActivityBar = ApplicationShellActivityBar;
(ApplicationShell as any).Sidebar = ApplicationShellSidebar;
(ApplicationShell as any).Main = ApplicationShellMain;
(ApplicationShell as any).Panel = ApplicationShellPanel;
(ApplicationShell as any).StatusBar = ApplicationShellStatusBar;

// ============================================================================
// Display names
// ============================================================================

ApplicationShell.displayName = 'ApplicationShell';
ApplicationShellHeader.displayName = 'ApplicationShell.Header';
ApplicationShellActivityBar.displayName = 'ApplicationShell.ActivityBar';
ApplicationShellSidebar.displayName = 'ApplicationShell.Sidebar';
ApplicationShellMain.displayName = 'ApplicationShell.Main';
ApplicationShellPanel.displayName = 'ApplicationShell.Panel';
ApplicationShellStatusBar.displayName = 'ApplicationShell.StatusBar';

// ============================================================================
// Type exports
// ============================================================================

export type {
  ApplicationShellPrimitiveProps as ApplicationShellProps,
  ApplicationShellHeaderProps,
  ApplicationShellActivityBarProps,
  ApplicationShellSidebarProps,
  ApplicationShellMainProps,
  ApplicationShellPanelProps,
  ApplicationShellStatusBarProps,
};
