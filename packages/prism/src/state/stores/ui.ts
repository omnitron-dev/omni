/**
 * UI Store
 *
 * Manages transient UI state (not persisted).
 *
 * @module @omnitron-dev/prism/state/stores
 */

import { createUIStore, createSelectors } from '../create-store.js';

/**
 * UI store state and actions.
 */
export interface UIState {
  /** Sidebar open state */
  sidebarOpen: boolean;
  /** Sidebar collapsed state (mini mode) */
  sidebarCollapsed: boolean;
  /** Active dialog ID */
  activeDialog: string | null;
  /** Global loading overlay */
  globalLoading: boolean;
  /** Search modal open */
  searchOpen: boolean;

  // Actions
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  openDialog: (dialogId: string) => void;
  closeDialog: () => void;
  setGlobalLoading: (loading: boolean) => void;
  toggleSearch: () => void;
  setSearchOpen: (open: boolean) => void;
}

/**
 * UI store for transient state.
 *
 * @example
 * ```tsx
 * function Sidebar() {
 *   const { sidebarOpen, sidebarCollapsed, toggleSidebar } = useUIStore();
 *
 *   return (
 *     <Drawer
 *       open={sidebarOpen}
 *       variant={sidebarCollapsed ? 'mini' : 'permanent'}
 *     >
 *       <SidebarContent />
 *     </Drawer>
 *   );
 * }
 * ```
 */
export const useUIStore = createUIStore<UIState>(
  (set) => ({
    sidebarOpen: true,
    sidebarCollapsed: false,
    activeDialog: null,
    globalLoading: false,
    searchOpen: false,

    toggleSidebar: () =>
      set((state) => {
        state.sidebarOpen = !state.sidebarOpen;
      }),

    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

    setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

    openDialog: (dialogId) => set({ activeDialog: dialogId }),

    closeDialog: () => set({ activeDialog: null }),

    setGlobalLoading: (globalLoading) => set({ globalLoading }),

    toggleSearch: () =>
      set((state) => {
        state.searchOpen = !state.searchOpen;
      }),

    setSearchOpen: (searchOpen) => set({ searchOpen }),
  }),
  'ui'
);

/**
 * UI store with auto-generated selectors.
 */
export const uiStore = createSelectors(useUIStore);
