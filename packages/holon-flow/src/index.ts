/**
 * @holon/flow - Minimal Flow Core
 *
 * The heart of Holon: a single, universal abstraction for all computation.
 * Everything is a Flow, and Flows compose to create complex systems.
 *
 * This is the minimal core export. For additional functionality, use:
 * - `@holon/flow/context` - Context system for state management
 * - `@holon/flow/module` - Module system for extensibility
 * - `@holon/flow/core` - Core module definition with all Flow utilities
 *
 * @packageDocumentation
 */

// Core Flow utilities
export {
  batch,
  compose,
  constant,
  debounce,
  fallback,
  filter,
  flow,
  identity,
  map,
  maybe,
  memoize,
  merge,
  parallel,
  race,
  reduce,
  repeat,
  result,
  retry,
  split,
  tap,
  throttle,
  timeout,
  validate,
  when,
} from './flow.js';

// Core Flow types
export type {
  Flow,
  FlowChain,
  FlowInput,
  FlowMeta,
  FlowOptions,
  FlowOutput,
  Maybe,
  Result,
  TypeValidator,
} from './types.js';

// Note: compose can be used as pipe since they have the same functionality
// Users can import { compose as pipe } if they prefer the pipe naming
