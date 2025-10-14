/**
 * Aether Build Optimizations
 * Production-ready build optimization tools
 */

export * from './critical-css.js';
export * from './tree-shaking.js';
export * from './build-performance.js';
export * from './asset-pipeline.js';
export * from './bundle-optimization.js';
export * from './vite-plugin.js';
// Re-export from module-federation, excluding ModuleFederationManager (use from build-performance)
export type { ModuleFederationConfig, ShareConfig, FederationManifest, RemoteInfo, SharedInfo, RemoteContainer } from './module-federation.js';
export { moduleFederationPlugin, loadRemoteComponent, ModuleFederationRuntime, MockModuleFederationRuntime, testUtils } from './module-federation.js';
// Re-export from worker-bundling, excluding WorkerPool and ServiceWorkerConfig (use from build-performance and pwa-manifest)
export type { WorkerBundlingConfig, WorkerBundleResult, WorkerDetectionResult, WorkerOptions, WorkerMessage, WorkerMetrics, WorkerType, WorkerFormat } from './worker-bundling.js';
export { WorkerBundler, detectWorkers, createWorkerPool } from './worker-bundling.js';
export * from './shared-chunks.js';
export * from './pwa-manifest.js';
export * from './parallel-compilation.js';
export * from './dynamic-imports.js';
export * from './css-modules.js';
export * from './persistent-cache.js';
export * from './dependency-graph.js';
// Re-export from lazy-compilation, excluding CompilationTask (use from parallel-compilation)
export type { LazyCompilationConfig, LazyCompilationPlugin } from './lazy-compilation.js';
export { LazyCompilationManager } from './lazy-compilation.js';
export * from './build-profiler.js';
