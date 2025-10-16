/**
 * Core Module
 *
 * Core infrastructure and singleton services for the Omnitron application.
 * This module provides essential services that are used across all feature modules.
 */

// Services
export { StorageService } from './services/storage.service';
export { EventBusService } from './services/event-bus.service';
export { ThemeService } from './services/theme.service';
export { RouterService } from './services/router.service';

// Stores
export { useAppStore } from './stores/app.store';
export { useUserStore } from './stores/user.store';

// Constants
export * from './constants';

// Tokens
export * from './tokens';

// Types
export type { IStorageService } from './services/storage.service';
export type { EventHandler } from './services/event-bus.service';
export type { AppState } from './stores/app.store';
export type { UserState, UserPreferences } from './stores/user.store';

/**
 * Core Module Services
 *
 * All core services are singletons provided in root scope.
 * They can be injected into any component or service using inject().
 *
 * @example
 * ```typescript
 * import { inject } from '@omnitron-dev/aether/di';
 * import { ThemeService, EventBusService, useAppStore } from './core/core.module';
 *
 * // In a component or service
 * const themeService = inject(ThemeService);
 * const eventBus = inject(EventBusService);
 * const appStore = useAppStore();
 *
 * // Use the services
 * themeService.toggleTheme();
 * eventBus.emit('custom:event', { data: 'value' });
 * appStore.setLoading(true);
 * ```
 */

/**
 * Initialize Core Module
 *
 * Call this function to initialize all core services.
 * This should be called once at application startup.
 *
 * @param options - Initialization options
 */
export async function initializeCoreModule(options?: { router?: any }): Promise<void> {
  console.log('[CoreModule] Initializing...');

  // Services are automatically initialized via DI
  // This function can be used for additional setup if needed

  if (options?.router) {
    // Router will be set up when the app starts
    console.log('[CoreModule] Router provided');
  }

  console.log('[CoreModule] Initialization complete');
}

/**
 * Core Module Metadata
 */
export const CoreModuleMetadata = {
  id: 'core',
  version: '1.0.0',
  name: 'Core Module',
  description: 'Core infrastructure and singleton services',
  author: 'Omnitron Team',
};
