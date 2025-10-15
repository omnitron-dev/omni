/**
 * AppModule
 *
 * Root application module that integrates all feature modules for Omnitron.
 * This module orchestrates the entire application by importing and configuring
 * all necessary core and feature modules.
 *
 * Architecture:
 * - CoreModule: Singleton services and infrastructure (eager)
 * - SharedModule: Reusable UI components (eager)
 * - Feature Modules: Lazy-loaded feature implementations
 *   - CanvasModule: Flow programming canvas
 *   - EditorModule: Code editor
 *   - TerminalModule: Terminal emulator
 *   - ChatModule: AI assistant interface
 *   - SettingsModule: Application settings
 */

import { defineModule } from '@omnitron-dev/aether/di';
import { CanvasModule } from '../modules/canvas/canvas.module';
import { EditorModule } from '../modules/editor/editor.module';
import { TerminalModule } from '../modules/terminal/terminal.module';
import { ChatModule } from '../modules/chat/chat.module';
import { SettingsModule } from '../modules/settings/settings.module';
import { App } from './App';

/**
 * Application Root Module
 *
 * Bootstraps the entire Omnitron application with all feature modules.
 * The module system provides:
 * - Dependency injection
 * - Lazy loading and code splitting
 * - Modular architecture
 * - Type-safe service injection
 */
export const AppModule = defineModule({
  id: 'app',
  version: '1.0.0',

  /**
   * Import all feature modules
   *
   * Core services are provided by individual modules via providedIn: 'root'
   * Feature modules are lazy-loaded when their routes are accessed
   */
  imports: [
    CanvasModule,      // Flow programming canvas
    EditorModule,      // Code editor
    TerminalModule,    // Terminal emulator
    ChatModule,        // AI chat assistant
    SettingsModule,    // Application settings
  ],

  /**
   * Global app-level providers
   *
   * These are services that need to be instantiated at the app level
   * but aren't part of any specific feature module
   */
  providers: [],

  /**
   * Global stores
   *
   * Application-wide state stores that are not tied to a specific module
   */
  stores: [],

  /**
   * Bootstrap component
   *
   * The root component that will be rendered when the application starts
   */
  bootstrap: App,

  /**
   * Module metadata
   */
  metadata: {
    name: 'Omnitron Application',
    description: 'The Meta-System for Fractal Computing',
    version: '1.0.0',
    author: 'Omnitron Team',
  },

  /**
   * Optimization settings
   */
  optimization: {
    lazyBoundary: false, // Root module is not lazy
    splitChunk: false,   // Root module doesn't need chunking
  },
});

/**
 * Export the App component for use in main.tsx
 */
export { App } from './App';
