/**
 * Omnitron Frontend Entry Point
 *
 * The Meta-System for Fractal Computing
 *
 * This file bootstraps the Omnitron application using Aether's module system:
 * 1. Bootstraps the AppModule to initialize the DI container
 * 2. Mounts the root App component to the DOM
 * 3. Starts the router for navigation
 *
 * Powered by Aether - Minimalist, high-performance frontend framework
 */

import { bootstrapModule } from '@omnitron-dev/aether/di';
import { mount } from '@omnitron-dev/aether';
import { AppModule } from './app/app.module';
import router from './router';
import './styles/index.css';

// Get root DOM element
const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

/**
 * Bootstrap the application module system
 *
 * This initializes:
 * - DI container with all services
 * - All feature modules
 * - Global stores
 * - Route definitions
 */
const { container, component } = bootstrapModule(AppModule);

/**
 * Make container globally available in development mode
 * This allows for debugging and inspection of the DI container
 */
if (import.meta.env.DEV) {
  (window as any).__omnitron_container__ = container;
  console.log('[Omnitron] DI container available at window.__omnitron_container__');
}

/**
 * Mount the application component to the DOM
 */
mount(component, root);

/**
 * Start the router
 * This enables navigation and lazy-loading of route components
 */
router.start();

console.log('[Omnitron] Application bootstrapped successfully');
