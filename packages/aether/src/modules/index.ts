/**
 * Module System
 *
 * Central module system for Aether framework
 */

export { ModuleManager } from './manager.js';
export { ModuleGraph } from './graph.js';
export type { ModuleManagerOptions, DynamicModule, LazyModule } from './manager.js';
export type { LoadStrategy } from './graph.js';

// Module helpers
export {
  lazy,
  remote,
  dynamic,
  useModule,
  useStore,
  useModuleLoaded,
  preloadModule,
  conditional,
  compose,
  withProviders,
  extractStores,
  extractRoutes,
  withModuleContext,
  withIslandContext,
  setCurrentModuleContext,
  setCurrentIslandContext,
  clearCurrentModuleContext,
  clearCurrentIslandContext,
} from './helpers.js';
export type { PreloadStrategy, RemoteModuleConfig } from './helpers.js';
