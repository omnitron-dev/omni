/**
 * Aether DevTools - Browser extension DevTools for debugging
 *
 * Provides comprehensive debugging and inspection capabilities for Aether
 * applications through a browser extension.
 *
 * @module devtools
 *
 * @example
 * ```typescript
 * // Enable DevTools in development
 * import { enableDevTools } from '@omnitron-dev/aether/devtools';
 *
 * if (import.meta.env.DEV) {
 *   enableDevTools({
 *     trackSignals: true,
 *     trackComponents: true,
 *     enableTimeTravel: true,
 *     enableProfiler: true,
 *     enableNetwork: true
 *   });
 * }
 * ```
 *
 * Features:
 * - State inspection for signals, computed, effects, and stores
 * - Time-travel debugging with undo/redo
 * - Performance profiling with bottleneck detection
 * - Network inspection for netron-browser requests
 * - Custom Chrome DevTools formatters
 * - Component tree visualization
 */

import type { DevTools, DevToolsOptions } from './types.js';
import { createInspector } from './inspector.js';
import { createRecorder } from './recorder.js';
import { createProfiler } from './profiler.js';
import { createNetworkInspector } from './network.js';
import { createBridge, isDevToolsAvailable } from './bridge.js';
import { setGlobalDevTools, clearGlobalDevTools } from './hooks.js';
import { installFormatters, uninstallFormatters } from './formatter.js';

// Re-export types
export type * from './types.js';

// Re-export hooks
export * from './hooks.js';

// Re-export formatter utilities
export { installFormatters, uninstallFormatters, formatSignal, formatStore, formatComponent } from './formatter.js';

// Re-export individual creators
export { createInspector } from './inspector.js';
export { createRecorder } from './recorder.js';
export { createProfiler } from './profiler.js';
export { createNetworkInspector } from './network.js';
export { createBridge, isDevToolsAvailable } from './bridge.js';

/**
 * Global DevTools instance
 */
let devToolsInstance: DevTools | null = null;

/**
 * Default options
 */
const DEFAULT_OPTIONS: DevToolsOptions = {
  trackSignals: true,
  trackComputed: true,
  trackEffects: true,
  trackComponents: true,
  enableTimeTravel: false,
  enableProfiler: false,
  enableNetwork: true,
  maxHistorySize: 1000,
  verbose: false,
};

/**
 * Enable DevTools
 *
 * Initializes and enables DevTools with the specified configuration.
 * This should be called once during application initialization.
 *
 * @param options - DevTools configuration options
 * @returns DevTools instance
 *
 * @example
 * ```typescript
 * // Basic usage
 * enableDevTools();
 *
 * // With options
 * enableDevTools({
 *   trackSignals: true,
 *   enableTimeTravel: true,
 *   enableProfiler: true,
 *   verbose: true
 * });
 * ```
 */
export function enableDevTools(options: Partial<DevToolsOptions> = {}): DevTools {
  // If already enabled, return existing instance
  if (devToolsInstance?.isEnabled()) {
    return devToolsInstance;
  }

  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  // Create instances
  const inspector = createInspector();
  const recorder = createRecorder(mergedOptions.maxHistorySize);
  const profiler = createProfiler();
  const networkInspector = createNetworkInspector();
  const bridge = createBridge();

  // Create DevTools instance
  devToolsInstance = {
    inspector,
    recorder,
    profiler,
    networkInspector,
    bridge,
    options: mergedOptions,
    enable() {
      // Set global instances for hooks
      setGlobalDevTools(inspector, profiler, recorder);

      // Install custom formatters
      installFormatters();

      // Connect to extension
      if (isDevToolsAvailable()) {
        bridge.connect().catch(err => {
          if (mergedOptions.verbose) {
            console.warn('[Aether DevTools] Failed to connect to extension:', err);
          }
        });
      }

      // Start recording if enabled
      if (mergedOptions.enableTimeTravel) {
        recorder.startRecording();
      }

      if (mergedOptions.verbose) {
        console.log('[Aether DevTools] Enabled with options:', mergedOptions);
      }
    },
    disable() {
      // Clear global instances
      clearGlobalDevTools();

      // Uninstall formatters
      uninstallFormatters();

      // Disconnect bridge
      bridge.disconnect();

      // Stop recording
      recorder.stopRecording();

      if (mergedOptions.verbose) {
        console.log('[Aether DevTools] Disabled');
      }
    },
    isEnabled() {
      return bridge.isConnected();
    },
  };

  // Enable immediately
  devToolsInstance.enable();

  // Expose to window for extension access
  if (typeof window !== 'undefined') {
    (window as any).__AETHER_DEVTOOLS__ = devToolsInstance;
  }

  return devToolsInstance;
}

/**
 * Disable DevTools
 *
 * Disables DevTools and cleans up resources.
 *
 * @example
 * ```typescript
 * disableDevTools();
 * ```
 */
export function disableDevTools(): void {
  if (!devToolsInstance) return;

  devToolsInstance.disable();
  devToolsInstance = null;

  // Remove from window
  if (typeof window !== 'undefined') {
    delete (window as any).__AETHER_DEVTOOLS__;
  }
}

/**
 * Get DevTools instance
 *
 * Returns the current DevTools instance if enabled.
 *
 * @returns DevTools instance or null if not enabled
 *
 * @example
 * ```typescript
 * const devtools = getDevTools();
 * if (devtools) {
 *   console.log(devtools.inspector.getState());
 * }
 * ```
 */
export function getDevTools(): DevTools | null {
  return devToolsInstance;
}

/**
 * Check if DevTools is enabled
 *
 * @returns true if DevTools is enabled
 *
 * @example
 * ```typescript
 * if (isEnabled()) {
 *   // DevTools is active
 * }
 * ```
 */
export function isEnabled(): boolean {
  return devToolsInstance?.isEnabled() ?? false;
}

/**
 * Tree-shakeable DevTools integration
 *
 * This module is designed to be completely tree-shakeable in production builds.
 * If you don't import or call any DevTools functions, they will be removed
 * from the bundle.
 *
 * For best results, use with:
 * ```typescript
 * if (import.meta.env.DEV) {
 *   const { enableDevTools } = await import('@omnitron-dev/aether/devtools');
 *   enableDevTools();
 * }
 * ```
 */
