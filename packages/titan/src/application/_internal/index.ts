/**
 * Internal collaborator barrel — Application orchestration helpers.
 *
 * Not part of the public surface. Imports from this barrel go through
 * the relative `./_internal/...` path so the deep refactor stays
 * contained — no consumer should reach in here. Exported for cross-
 * collaborator wiring only.
 *
 * @internal
 */

export { EventBus, WILDCARD_EVENT } from './event-bus.js';
export {
  LifecycleStateMachine,
  DEFAULT_HOOK_PRIORITY,
  DEFAULT_HOOK_TIMEOUT_MS,
} from './lifecycle-state.js';
export { ConfigStore } from './config-store.js';
export {
  ModuleRegistry,
  isDynamicModule,
  makeRootContextModule,
  ROOT_CONTEXT_NAME,
} from './module-registry.js';
export { ModuleDiscovery } from './module-discovery.js';
export {
  ShutdownCoordinator,
  INTERNAL_TASK_DI_STOP,
  INTERNAL_TASK_CLEANUP,
} from './shutdown-coordinator.js';
export {
  ProcessHost,
  hookTimeoutError,
} from './process-host.js';
export { HealthAggregator } from './health-aggregator.js';
export { ServiceExposer } from './service-exposer.js';
