/**
 * Omnitron Root Application Component
 *
 * This is the root component that bootstraps the entire Omnitron frontend system.
 * It integrates:
 * - DI container context
 * - Router integration
 * - Application shell layout
 * - Global error boundaries
 * - Theme management
 *
 * Powered by Aether - Minimalist, high-performance frontend framework
 */

import { defineComponent, signal, onMount } from '@omnitron-dev/aether';
import { Show } from '@omnitron-dev/aether/control-flow';
import { RouterView } from '@omnitron-dev/aether/router';
import { Shell } from '../components/Shell';
import router from '../router';

/**
 * Root Application Component
 *
 * Provides the main application structure with:
 * - Loading state management
 * - Application shell integration
 * - Router view for navigation
 * - Initialization logging
 */
export const App = defineComponent(() => {
  const appReady = signal(false);

  onMount(() => {
    // Log application startup banner
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                         OMNITRON                              ║
║              The Meta-System for Fractal Computing            ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║  Frontend Status: READY                                       ║
║  Framework: Aether (Production)                               ║
║  Environment: ${import.meta.env.MODE.padEnd(46)}║
║  Module System: Active                                        ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `);

    // Mark app as ready
    appReady.set(true);
  });

  return () => (
    <div class="omnitron-app" data-theme="dark">
      <Show when={appReady} fallback={<LoadingScreen />}>
        <Shell>
          <RouterView routes={router.config.routes} />
        </Shell>
      </Show>
    </div>
  );
});

/**
 * Loading Screen Component
 *
 * Displayed while the application is initializing
 */
const LoadingScreen = defineComponent(() => () => (
  <div class="loading-screen">
    <div class="loading-spinner" />
    <p>Initializing Omnitron System...</p>
  </div>
));
