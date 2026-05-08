/**
 * Titan lifecycle module — phased shutdown with hard exit guarantee.
 *
 * @module @omnitron-dev/titan/lifecycle
 */

export {
  LifecycleController,
  LifecycleTimeoutError,
  bucketOf,
  type LifecycleControllerOptions,
  type LifecycleLogger,
  type LifecyclePhase,
  type LifecyclePhaseEvent,
} from './lifecycle-controller.js';
