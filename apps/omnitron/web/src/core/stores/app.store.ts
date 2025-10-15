/**
 * Core Module - App Store
 *
 * Global application state management
 */

import { defineStore, signal, computed, readonly } from '@omnitron-dev/aether/store';

/**
 * Application state interface
 */
export interface AppState {
  /**
   * Is application initialized
   */
  initialized: boolean;

  /**
   * Is application loading
   */
  loading: boolean;

  /**
   * Application error (if any)
   */
  error: Error | null;

  /**
   * Current view/module
   */
  currentView: string | null;

  /**
   * Sidebar collapsed state
   */
  sidebarCollapsed: boolean;

  /**
   * Panel sizes (for split layouts)
   */
  panelSizes: {
    left: number;
    main: number;
    right: number;
  };

  /**
   * Active modals
   */
  activeModals: string[];

  /**
   * Global notifications
   */
  notifications: Array<{
    id: string;
    type: 'info' | 'success' | 'warning' | 'error';
    message: string;
    timestamp: number;
  }>;

  /**
   * Application metadata
   */
  metadata: {
    version: string;
    buildDate: string;
  };
}

/**
 * App Store
 *
 * Global application state store with reactive properties.
 * Use this store for app-wide state that needs to be accessed
 * across multiple modules.
 *
 * @example
 * ```typescript
 * const appStore = useAppStore();
 *
 * // Check if app is initialized
 * if (appStore.initialized()) {
 *   console.log('App is ready');
 * }
 *
 * // Set loading state
 * appStore.setLoading(true);
 *
 * // Toggle sidebar
 * appStore.toggleSidebar();
 *
 * // Add notification
 * appStore.addNotification('success', 'Operation completed');
 * ```
 */
export const useAppStore = defineStore('app', () => {
  // State signals
  const initialized = signal(false);
  const loading = signal(false);
  const error = signal<Error | null>(null);
  const currentView = signal<string | null>(null);
  const sidebarCollapsed = signal(false);
  const panelSizes = signal({
    left: 20,
    main: 60,
    right: 20,
  });
  const activeModals = signal<string[]>([]);
  const notifications = signal<
    Array<{
      id: string;
      type: 'info' | 'success' | 'warning' | 'error';
      message: string;
      timestamp: number;
    }>
  >([]);
  const metadata = signal({
    version: '0.1.0',
    buildDate: new Date().toISOString(),
  });

  // Computed values
  const state = computed(() => ({
    initialized: initialized(),
    loading: loading(),
    error: error(),
    currentView: currentView(),
    sidebarCollapsed: sidebarCollapsed(),
    panelSizes: panelSizes(),
    activeModals: activeModals(),
    notifications: notifications(),
    metadata: metadata(),
  }));

  // Actions

  /**
   * Mark app as initialized
   */
  const markInitialized = () => {
    initialized.set(true);
    loading.set(false);
  };

  /**
   * Set loading state
   */
  const setLoading = (value: boolean) => {
    loading.set(value);
  };

  /**
   * Set error
   */
  const setError = (err: Error | null) => {
    error.set(err);
  };

  /**
   * Clear error
   */
  const clearError = () => {
    error.set(null);
  };

  /**
   * Set current view
   */
  const setCurrentView = (view: string) => {
    currentView.set(view);
  };

  /**
   * Toggle sidebar
   */
  const toggleSidebar = () => {
    sidebarCollapsed.set(!sidebarCollapsed());
  };

  /**
   * Set panel sizes
   */
  const setPanelSizes = (sizes: Partial<AppState['panelSizes']>) => {
    panelSizes.set({
      ...panelSizes(),
      ...sizes,
    });
  };

  /**
   * Open modal
   */
  const openModal = (modalId: string) => {
    const modals = activeModals();
    if (!modals.includes(modalId)) {
      activeModals.set([...modals, modalId]);
    }
  };

  /**
   * Close modal
   */
  const closeModal = (modalId: string) => {
    activeModals.set(activeModals().filter((id) => id !== modalId));
  };

  /**
   * Close all modals
   */
  const closeAllModals = () => {
    activeModals.set([]);
  };

  /**
   * Add notification
   */
  const addNotification = (
    type: 'info' | 'success' | 'warning' | 'error',
    message: string,
  ): string => {
    const id = crypto.randomUUID();
    const notification = {
      id,
      type,
      message,
      timestamp: Date.now(),
    };

    notifications.set([...notifications(), notification]);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      removeNotification(id);
    }, 5000);

    return id;
  };

  /**
   * Remove notification
   */
  const removeNotification = (id: string) => {
    notifications.set(notifications().filter((n) => n.id !== id));
  };

  /**
   * Clear all notifications
   */
  const clearNotifications = () => {
    notifications.set([]);
  };

  /**
   * Reset store to initial state
   */
  const reset = () => {
    initialized.set(false);
    loading.set(false);
    error.set(null);
    currentView.set(null);
    sidebarCollapsed.set(false);
    panelSizes.set({
      left: 20,
      main: 60,
      right: 20,
    });
    activeModals.set([]);
    notifications.set([]);
    metadata.set({
      version: '0.1.0',
      buildDate: new Date().toISOString(),
    });
  };

  return {
    // State (readonly)
    initialized: readonly(initialized),
    loading: readonly(loading),
    error: readonly(error),
    currentView: readonly(currentView),
    sidebarCollapsed: readonly(sidebarCollapsed),
    panelSizes: readonly(panelSizes),
    activeModals: readonly(activeModals),
    notifications: readonly(notifications),
    metadata: readonly(metadata),

    // Computed
    state,

    // Actions
    markInitialized,
    setLoading,
    setError,
    clearError,
    setCurrentView,
    toggleSidebar,
    setPanelSizes,
    openModal,
    closeModal,
    closeAllModals,
    addNotification,
    removeNotification,
    clearNotifications,
    reset,
  };
});
