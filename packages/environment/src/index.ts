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

// Phase 3: Distribution
export * from './sync/index.js';
export * from './crdt/index.js';

// Phase 4: Cognitive Layer
export * from './cognitive/index.js';

// Phase 5: Production Features
export * from './security/index.js';
export * from './monitoring/index.js';
