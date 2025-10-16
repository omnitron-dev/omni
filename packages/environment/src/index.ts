/**
 * Environment - Universal configuration and workspace management
 */

// Core
export * from './core/index.js';

// Configuration
export * from './config/index.js';

// Storage
export * from './storage/index.js';

// Types
export * from './types/index.js';
export * from './types/layers.js';

// Utils
export * from './utils/index.js';

// Phase 2: Advanced Layers
export * from './secrets/index.js';
export { VariablesLayer, ComputedRegistry, ComputedVariable, Interpolator, detectCircularDependencies } from './variables/index.js';
export * from './tasks/index.js';
export * from './targets/index.js';
