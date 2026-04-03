/**
 * Layout Context
 *
 * Provides layout configuration and state management across the layout system.
 *
 * @module @omnitron-dev/prism/layouts/core/context
 */

import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';
import type {
  LayoutConfig,
  LayoutContextValue,
  NavigationMenuType,
  SidenavVariant,
  NavColorMode,
  LayoutNavItem,
} from '../types.js';
import { DRAWER_WIDTHS } from '../types.js';
import { useSettingsStore } from '../../state/stores/settings.js';

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

/**
 * Default layout configuration.
 */
export const defaultLayoutConfig: LayoutConfig = {
  navigationMenuType: 'sidenav',
  sidenavVariant: 'default',
  sidenavCollapsed: false,
  topnavVariant: 'default',
  navColor: 'default',
  drawerOpen: false,
  drawerWidth: DRAWER_WIDTHS.full,
  compactLayout: false,
};

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * Layout context.
 */
export const LayoutContext = createContext<LayoutContextValue | null>(null);

LayoutContext.displayName = 'LayoutContext';

// =============================================================================
// PROVIDER
// =============================================================================

export interface LayoutProviderProps {
  /** Child components */
  children: ReactNode;
  /** Initial configuration overrides */
  initialConfig?: Partial<LayoutConfig>;
  /**
   * Persistence key for sidebar collapsed state.
   * When provided, sidebar collapsed state is saved to localStorage
   * via the settings store and restored on mount.
   * Use different keys for different layouts (e.g., 'main', 'admin').
   */
  persistKey?: string;
}

/**
 * Layout provider component.
 * Manages layout configuration and navigation state.
 */
export function LayoutProvider({ children, initialConfig, persistKey }: LayoutProviderProps): ReactNode {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Read persisted sidebar collapsed state
  const sidebarCollapsedMap = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsedPersist = useSettingsStore((s) => s.setSidebarCollapsed);

  // Layout configuration state — restore collapsed from persistence if available
  const [config, setConfigState] = useState<LayoutConfig>(() => {
    const persisted = persistKey ? (sidebarCollapsedMap[persistKey] ?? false) : false;
    return {
      ...defaultLayoutConfig,
      ...initialConfig,
      ...(persistKey ? { sidenavCollapsed: persisted } : {}),
    };
  });

  // Open nav items state (for nested menus)
  const [openItems, setOpenItems] = useState<string[]>([]);

  // Calculate drawer width based on sidenav variant and collapse state
  const calculatedDrawerWidth = useMemo(() => {
    if (config.sidenavVariant === 'mini' || config.sidenavCollapsed) {
      return config.sidenavVariant === 'stacked' ? DRAWER_WIDTHS.stackedCollapsed : DRAWER_WIDTHS.mini;
    }
    if (config.sidenavVariant === 'stacked') {
      return DRAWER_WIDTHS.stackedExpanded;
    }
    return DRAWER_WIDTHS.full;
  }, [config.sidenavVariant, config.sidenavCollapsed]);

  // Update config with calculated drawer width
  const effectiveConfig = useMemo(
    () => ({
      ...config,
      drawerWidth: calculatedDrawerWidth,
    }),
    [config, calculatedDrawerWidth]
  );

  // Set config (partial update)
  const setConfig = useCallback((updates: Partial<LayoutConfig>) => {
    setConfigState((prev) => ({ ...prev, ...updates }));
  }, []);

  // Toggle drawer
  const toggleDrawer = useCallback(() => {
    setConfigState((prev) => ({ ...prev, drawerOpen: !prev.drawerOpen }));
  }, []);

  // Toggle sidenav collapse (with optional persistence)
  const toggleSidenavCollapse = useCallback(() => {
    setConfigState((prev) => {
      const next = !prev.sidenavCollapsed;
      // Persist outside of React's state updater to avoid update-during-render warning
      if (persistKey) {
        queueMicrotask(() => setSidebarCollapsedPersist(persistKey, next));
      }
      return { ...prev, sidenavCollapsed: next };
    });
  }, [persistKey, setSidebarCollapsedPersist]);

  // Set navigation menu type
  const setNavigationMenuType = useCallback((type: NavigationMenuType) => {
    setConfigState((prev) => ({ ...prev, navigationMenuType: type }));
  }, []);

  // Set sidenav variant
  const setSidenavVariant = useCallback((variant: SidenavVariant) => {
    setConfigState((prev) => ({ ...prev, sidenavVariant: variant }));
  }, []);

  // Set nav color mode
  const setNavColor = useCallback((mode: NavColorMode) => {
    setConfigState((prev) => ({ ...prev, navColor: mode }));
  }, []);

  // Check if item is open
  const isItemOpen = useCallback((id: string) => openItems.includes(id), [openItems]);

  // Toggle item open state
  const toggleItem = useCallback((id: string) => {
    setOpenItems((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  // Check if a single nav item is active based on pathname
  const isNavItemActive = useCallback((item: LayoutNavItem, pathname: string): boolean => {
    // No path means not activatable
    if (!item.path) return false;

    // Strip query params, hash, and trailing slash for comparison
    const cleanPath = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

    // Exact match
    if (item.path === cleanPath) return true;

    // Selection prefix match (e.g., /products matches /products/123)
    if (item.selectionPrefix && cleanPath.startsWith(item.selectionPrefix)) {
      return true;
    }

    // Deep match (default: true) — active if path is a prefix of pathname
    // e.g., /admin/orgs stays highlighted when on /admin/orgs/list
    // Set deepMatch: false to require exact match only
    if (item.deepMatch !== false && cleanPath.startsWith(item.path)) {
      // Ensure we're matching path segments, not partial strings
      // e.g., /product should not match /products
      const nextChar = cleanPath[item.path.length];
      return !nextChar || nextChar === '/';
    }

    return false;
  }, []);

  // Check if any nested item is active (recursive)
  const isNestedItemActive = useCallback(
    (items: LayoutNavItem[] | undefined, pathname: string): boolean => {
      if (!items || items.length === 0) return false;

      const checkItem = (item: LayoutNavItem): boolean => {
        // Check if this item is active
        if (isNavItemActive(item, pathname)) {
          return true;
        }

        // Check children recursively
        if (item.children && item.children.length > 0) {
          return item.children.some(checkItem);
        }

        return false;
      };

      return items.some(checkItem);
    },
    [isNavItemActive]
  );

  // Auto-close drawer on mobile when navigating
  // This would typically be connected to router events

  // Context value
  const contextValue = useMemo<LayoutContextValue>(
    () => ({
      config: effectiveConfig,
      isMobile,
      setConfig,
      toggleDrawer,
      toggleSidenavCollapse,
      setNavigationMenuType,
      setSidenavVariant,
      setNavColor,
      openItems,
      setOpenItems,
      isItemOpen,
      toggleItem,
      isNestedItemActive,
      isNavItemActive,
    }),
    [
      effectiveConfig,
      isMobile,
      setConfig,
      toggleDrawer,
      toggleSidenavCollapse,
      setNavigationMenuType,
      setSidenavVariant,
      setNavColor,
      openItems,
      isItemOpen,
      toggleItem,
      isNestedItemActive,
      isNavItemActive,
    ]
  );

  return <LayoutContext.Provider value={contextValue}>{children}</LayoutContext.Provider>;
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Hook to access layout context.
 *
 * @returns Layout context value
 * @throws If used outside LayoutProvider
 *
 * @example
 * ```tsx
 * function NavToggle() {
 *   const { config, toggleSidenavCollapse } = useLayoutContext();
 *
 *   return (
 *     <IconButton onClick={toggleSidenavCollapse}>
 *       {config.sidenavCollapsed ? <MenuOpenIcon /> : <MenuIcon />}
 *     </IconButton>
 *   );
 * }
 * ```
 */
export function useLayoutContext(): LayoutContextValue {
  const context = useContext(LayoutContext);

  if (!context) {
    throw new Error('useLayoutContext must be used within a LayoutProvider');
  }

  return context;
}

/**
 * Hook to access only layout configuration.
 */
export function useLayoutConfig(): LayoutConfig {
  const { config } = useLayoutContext();
  return config;
}

/**
 * Hook to check if sidenav should be visible.
 */
export function useSidenavVisible(): boolean {
  const { config } = useLayoutContext();
  return config.navigationMenuType === 'sidenav' || config.navigationMenuType === 'combo';
}

/**
 * Hook to check if topnav should be visible.
 */
export function useTopnavVisible(): boolean {
  const { config } = useLayoutContext();
  return config.navigationMenuType === 'topnav' || config.navigationMenuType === 'combo';
}

/**
 * Hook to check navigation item active state with current pathname.
 * Provides utilities for building navigation components.
 *
 * @param pathname - Current pathname from router
 * @returns Object with active state checking functions
 *
 * @example
 * ```tsx
 * function NavItem({ item }: { item: LayoutNavItem }) {
 *   const { pathname } = useLocation(); // From your router
 *   const { isItemActive, isNestedActive } = useNavActive(pathname);
 *
 *   const active = isItemActive(item);
 *   const nestedActive = item.children && isNestedActive(item.children);
 *
 *   return (
 *     <ListItemButton selected={active || nestedActive}>
 *       {item.title}
 *     </ListItemButton>
 *   );
 * }
 * ```
 */
export function useNavActive(pathname: string) {
  const { isNavItemActive, isNestedItemActive } = useLayoutContext();

  return useMemo(
    () => ({
      /**
       * Check if a nav item is active.
       */
      isItemActive: (item: LayoutNavItem) => isNavItemActive(item, pathname),
      /**
       * Check if any nested item is active.
       */
      isNestedActive: (items: LayoutNavItem[] | undefined) => isNestedItemActive(items, pathname),
    }),
    [isNavItemActive, isNestedItemActive, pathname]
  );
}
