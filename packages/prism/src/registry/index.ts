/**
 * Prism Registry Module
 *
 * Component and block registry system for the Prism design framework.
 * Enables shadcn/ui-style copy-paste installation with dependency resolution.
 *
 * @module @omnitron-dev/prism/registry
 */

// =============================================================================
// REGISTRY MANAGER
// =============================================================================

export { RegistryManager, registry, createRegistryManager } from './manager.js';

export type { RegistryManagerOptions, SearchOptions, ResolvedItem } from './manager.js';

// =============================================================================
// INSTALLER
// =============================================================================

export { PrismInstaller, createInstaller } from './installer.js';

export type { InstallerOptions, InstallResult } from './installer.js';

// =============================================================================
// DEFAULT REGISTRY SCHEMA
// =============================================================================

import type { RegistrySchema } from '../types/registry.js';

/**
 * Default Prism registry schema.
 * Defines the structure for the base component and block registry.
 */
export const defaultRegistrySchema: RegistrySchema = {
  $schema: 'https://prism.omnitron.dev/registry/v1/schema.json',
  name: 'prism',
  version: '1.0.0',
  description: 'Official Prism Design System Registry',
  baseUrl: 'https://registry.prism.omnitron.dev',
  components: {
    // Input Components
    button: {
      name: 'button',
      version: '1.0.0',
      category: 'inputs',
      displayName: 'Button',
      description: 'Primary action button with multiple variants',
      files: [
        { path: 'Button.tsx', type: 'component' },
        { path: 'Button.types.ts', type: 'types' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: true,
      docs: 'https://docs.prism.omnitron.dev/components/button',
    },
    'icon-button': {
      name: 'icon-button',
      version: '1.0.0',
      category: 'inputs',
      displayName: 'Icon Button',
      description: 'Compact button for icon-only actions',
      files: [
        { path: 'IconButton.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: true,
    },
    'text-field': {
      name: 'text-field',
      version: '1.0.0',
      category: 'inputs',
      displayName: 'Text Field',
      description: 'Text input with label and helper text',
      files: [
        { path: 'TextField.tsx', type: 'component' },
        { path: 'TextField.types.ts', type: 'types' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: true,
    },
    select: {
      name: 'select',
      version: '1.0.0',
      category: 'inputs',
      displayName: 'Select',
      description: 'Dropdown selection component',
      files: [
        { path: 'Select.tsx', type: 'component' },
        { path: 'Select.types.ts', type: 'types' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: true,
    },
    checkbox: {
      name: 'checkbox',
      version: '1.0.0',
      category: 'inputs',
      displayName: 'Checkbox',
      description: 'Checkbox input for boolean values',
      files: [
        { path: 'Checkbox.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },
    switch: {
      name: 'switch',
      version: '1.0.0',
      category: 'inputs',
      displayName: 'Switch',
      description: 'Toggle switch for on/off states',
      files: [
        { path: 'Switch.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },

    // Data Display
    avatar: {
      name: 'avatar',
      version: '1.0.0',
      category: 'data-display',
      displayName: 'Avatar',
      description: 'User avatar with image or initials',
      files: [
        { path: 'Avatar.tsx', type: 'component' },
        { path: 'AvatarGroup.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: true,
    },
    badge: {
      name: 'badge',
      version: '1.0.0',
      category: 'data-display',
      displayName: 'Badge',
      description: 'Badge for notifications and status',
      files: [
        { path: 'Badge.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: true,
    },
    chip: {
      name: 'chip',
      version: '1.0.0',
      category: 'data-display',
      displayName: 'Chip',
      description: 'Compact element for tags and selections',
      files: [
        { path: 'Chip.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: true,
    },
    tooltip: {
      name: 'tooltip',
      version: '1.0.0',
      category: 'data-display',
      displayName: 'Tooltip',
      description: 'Informative tooltip on hover',
      files: [
        { path: 'Tooltip.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },

    // Feedback
    alert: {
      name: 'alert',
      version: '1.0.0',
      category: 'feedback',
      displayName: 'Alert',
      description: 'Alert messages with severity levels',
      files: [
        { path: 'Alert.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: true,
    },
    snackbar: {
      name: 'snackbar',
      version: '1.0.0',
      category: 'feedback',
      displayName: 'Snackbar',
      description: 'Brief notification messages',
      files: [
        { path: 'Snackbar.tsx', type: 'component' },
        { path: 'SnackbarProvider.tsx', type: 'component' },
        { path: 'useSnackbar.ts', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material', 'notistack'],
        components: [],
      },
      hasVariants: false,
    },
    dialog: {
      name: 'dialog',
      version: '1.0.0',
      category: 'feedback',
      displayName: 'Dialog',
      description: 'Modal dialog with actions',
      files: [
        { path: 'Dialog.tsx', type: 'component' },
        { path: 'ConfirmDialog.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: ['button'],
      },
      hasVariants: false,
    },
    progress: {
      name: 'progress',
      version: '1.0.0',
      category: 'feedback',
      displayName: 'Progress',
      description: 'Progress indicators (linear and circular)',
      files: [
        { path: 'LinearProgress.tsx', type: 'component' },
        { path: 'CircularProgress.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },

    // Surfaces
    card: {
      name: 'card',
      version: '1.0.0',
      category: 'surfaces',
      displayName: 'Card',
      description: 'Content card with header, content, and actions',
      files: [
        { path: 'Card.tsx', type: 'component' },
        { path: 'Card.types.ts', type: 'types' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: true,
    },
    paper: {
      name: 'paper',
      version: '1.0.0',
      category: 'surfaces',
      displayName: 'Paper',
      description: 'Basic surface with elevation',
      files: [
        { path: 'Paper.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },
    accordion: {
      name: 'accordion',
      version: '1.0.0',
      category: 'surfaces',
      displayName: 'Accordion',
      description: 'Expandable content panels',
      files: [
        { path: 'Accordion.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },

    // Navigation
    tabs: {
      name: 'tabs',
      version: '1.0.0',
      category: 'navigation',
      displayName: 'Tabs',
      description: 'Tabbed navigation component',
      files: [
        { path: 'Tabs.tsx', type: 'component' },
        { path: 'TabPanel.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: true,
    },
    breadcrumbs: {
      name: 'breadcrumbs',
      version: '1.0.0',
      category: 'navigation',
      displayName: 'Breadcrumbs',
      description: 'Navigation breadcrumb trail',
      files: [
        { path: 'Breadcrumbs.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },
    menu: {
      name: 'menu',
      version: '1.0.0',
      category: 'navigation',
      displayName: 'Menu',
      description: 'Dropdown menu for actions',
      files: [
        { path: 'Menu.tsx', type: 'component' },
        { path: 'MenuItem.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },

    // Layout
    stack: {
      name: 'stack',
      version: '1.0.0',
      category: 'layout',
      displayName: 'Stack',
      description: 'Vertical/horizontal flex layout',
      files: [
        { path: 'Stack.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },
    grid: {
      name: 'grid',
      version: '1.0.0',
      category: 'layout',
      displayName: 'Grid',
      description: 'Responsive grid layout',
      files: [
        { path: 'Grid.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },
    container: {
      name: 'container',
      version: '1.0.0',
      category: 'layout',
      displayName: 'Container',
      description: 'Centered content container',
      files: [
        { path: 'Container.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },
    divider: {
      name: 'divider',
      version: '1.0.0',
      category: 'layout',
      displayName: 'Divider',
      description: 'Visual separator',
      files: [
        { path: 'Divider.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },

    // Data
    'data-table': {
      name: 'data-table',
      version: '1.0.0',
      category: 'data',
      displayName: 'Data Table',
      description: 'Full-featured data table with sorting, filtering, pagination',
      files: [
        { path: 'DataTable.tsx', type: 'component' },
        { path: 'DataTable.types.ts', type: 'types' },
        { path: 'DataTableToolbar.tsx', type: 'component' },
        { path: 'DataTablePagination.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material', '@tanstack/react-table'],
        components: ['button', 'text-field', 'select', 'checkbox', 'menu'],
      },
      hasVariants: true,
      docs: 'https://docs.prism.omnitron.dev/components/data-table',
    },
    table: {
      name: 'table',
      version: '1.0.0',
      category: 'data',
      displayName: 'Table',
      description: 'Basic table component',
      files: [
        { path: 'Table.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },
    list: {
      name: 'list',
      version: '1.0.0',
      category: 'data',
      displayName: 'List',
      description: 'Vertical list of items',
      files: [
        { path: 'List.tsx', type: 'component' },
        { path: 'ListItem.tsx', type: 'component' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material'],
        components: [],
      },
      hasVariants: false,
    },
  },
  blocks: {
    // Dashboard blocks
    'dashboard-layout': {
      name: 'dashboard-layout',
      version: '1.0.0',
      category: 'layouts',
      displayName: 'Dashboard Layout',
      description: 'Complete dashboard layout with sidebar and header',
      files: [
        { path: 'DashboardLayout.tsx', type: 'component' },
        { path: 'DashboardLayout.types.ts', type: 'type' },
        { path: 'Sidebar.tsx', type: 'component' },
        { path: 'Header.tsx', type: 'component' },
        { path: 'NavSection.tsx', type: 'component' },
        { path: 'NavItem.tsx', type: 'component' },
        { path: 'useDashboard.ts', type: 'hook' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material', 'framer-motion'],
        components: ['avatar', 'menu', 'icon-button', 'tooltip'],
        blocks: [],
      },
      defaultConfig: {
        sidebarWidth: 280,
        headerHeight: 64,
        collapsedWidth: 72,
      },
      docs: 'https://docs.prism.omnitron.dev/blocks/dashboard-layout',
    },
    'auth-forms': {
      name: 'auth-forms',
      version: '1.0.0',
      category: 'auth',
      displayName: 'Authentication Forms',
      description: 'Login, register, forgot password, and verify forms',
      files: [
        { path: 'LoginForm.tsx', type: 'component' },
        { path: 'RegisterForm.tsx', type: 'component' },
        { path: 'ForgotPasswordForm.tsx', type: 'component' },
        { path: 'VerifyCodeForm.tsx', type: 'component' },
        { path: 'auth.schema.ts', type: 'schema' },
        { path: 'useAuthForm.ts', type: 'hook' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material', 'react-hook-form', '@hookform/resolvers', 'zod'],
        components: ['button', 'text-field', 'checkbox', 'alert'],
        blocks: [],
      },
      defaultConfig: {
        showSocialLogin: true,
        showRememberMe: true,
      },
    },
    'settings-panel': {
      name: 'settings-panel',
      version: '1.0.0',
      category: 'settings',
      displayName: 'Settings Panel',
      description: 'Theme settings panel with live preview',
      files: [
        { path: 'SettingsPanel.tsx', type: 'component' },
        { path: 'SettingsDrawer.tsx', type: 'component' },
        { path: 'ThemePreview.tsx', type: 'component' },
        { path: 'useSettings.ts', type: 'hook' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material', 'framer-motion'],
        components: ['button', 'switch', 'select', 'icon-button'],
        blocks: [],
      },
      defaultConfig: {
        position: 'right',
      },
    },
    'user-profile': {
      name: 'user-profile',
      version: '1.0.0',
      category: 'data',
      displayName: 'User Profile',
      description: 'User profile page with avatar, info, and settings',
      files: [
        { path: 'ProfilePage.tsx', type: 'component' },
        { path: 'ProfileHeader.tsx', type: 'component' },
        { path: 'ProfileTabs.tsx', type: 'component' },
        { path: 'AccountTab.tsx', type: 'component' },
        { path: 'SecurityTab.tsx', type: 'component' },
        { path: 'NotificationsTab.tsx', type: 'component' },
        { path: 'useProfile.ts', type: 'hook' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material', 'react-hook-form'],
        components: ['avatar', 'button', 'tabs', 'card', 'text-field', 'switch'],
        blocks: [],
      },
      defaultConfig: {},
    },
    'data-grid': {
      name: 'data-grid',
      version: '1.0.0',
      category: 'data',
      displayName: 'Data Grid',
      description: 'Advanced data grid with server-side features',
      files: [
        { path: 'DataGrid.tsx', type: 'component' },
        { path: 'DataGrid.types.ts', type: 'type' },
        { path: 'GridToolbar.tsx', type: 'component' },
        { path: 'GridFilters.tsx', type: 'component' },
        { path: 'GridExport.tsx', type: 'component' },
        { path: 'useDataGrid.ts', type: 'hook' },
        { path: 'index.ts', type: 'barrel' },
      ],
      dependencies: {
        npm: ['@mui/material', '@tanstack/react-table', '@tanstack/react-virtual'],
        components: ['button', 'text-field', 'select', 'checkbox', 'menu', 'chip'],
        blocks: [],
      },
      defaultConfig: {
        pageSize: 25,
        enableColumnResize: true,
        enableColumnReorder: true,
      },
    },
  },
  themes: {},
};
