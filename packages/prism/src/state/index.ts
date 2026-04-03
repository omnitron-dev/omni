/**
 * Prism State Management
 *
 * Zustand-based state management with patterns inspired by Portal's easy-peasy.
 *
 * @example
 * ```tsx
 * import { useThemeStore, useAuthStore, useUIStore } from '@omnitron/prism/state';
 *
 * function App() {
 *   const { mode, toggleMode } = useThemeStore();
 *   const { isAuthenticated } = useAuthStore();
 *   const { sidebarOpen } = useUIStore();
 *
 *   return <Dashboard />;
 * }
 * ```
 *
 * @module @omnitron/prism/state
 */

// Store factory
export {
  createPrismStore,
  createUIStore,
  createPersistedStore,
  createSelectors,
  type CreateStoreOptions,
  type StoreSelector,
} from './create-store.js';

// Pre-built stores
export {
  // Theme
  useThemeStore,
  themeStore,
  type ThemeState,
  // Auth
  useAuthStore,
  authStore,
  type AuthStoreState,
  type AuthStatus,
  // UI
  useUIStore,
  uiStore,
  type UIState,
  // Settings
  useSettingsStore,
  settingsStore,
  getDefaultSettings,
  type SettingsState,
  type SettingsValues,
  type NavLayout,
  type NavColor,
} from './stores/index.js';

// Settings version management
export {
  // Migration utilities
  runMigrations,
  createVersionedStorage,
  createVersionedPersistOptions,
  // Helper functions
  checkSettingsVersion,
  clearSettings,
  exportSettings,
  importSettings,
  // Type guard factory
  createSettingsValidator,
  // Migration helpers
  createMigration,
  createRenameMigration,
  createAddFieldMigration,
  createRemoveFieldMigration,
  createTransformMigration,
  // Validation
  validateMigrations,
  getMigrationInfo,
  // Types
  type MigrationFn,
  type VersionMigration,
  type VersionedSettingsConfig,
  type VersionedPersistedState,
} from './settings-version.js';
