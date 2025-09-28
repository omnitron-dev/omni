/**
 * Enterprise Features Module Exports
 *
 * Advanced enterprise capabilities for the Process Manager
 */

// ============================================================================
// Multi-tenancy
// ============================================================================

export {
  MultiTenancyManager,
  TenantProcessPool,
  TenantAware,
  TenantContext,
  type ITenantContext,
  type IResourceQuota,
  type IMultiTenancyConfig,
  type ITenantProcessPool
} from './multi-tenancy.js';

// ============================================================================
// Saga and Distributed Transactions
// ============================================================================

export {
  SagaOrchestrator,
  DistributedTransactionManager,
  type ISagaConfig,
  type ISagaStep,
  type ISagaContext,
  type ISagaStepResult
} from './saga.js';

// ============================================================================
// Event Sourcing and CQRS
// ============================================================================

export {
  AggregateRoot,
  EventSourcedRepository,
  InMemoryEventStore,
  ReadModelProjection,
  CommandBus,
  QueryBus,
  EventSourced,
  Command,
  EventHandler,
  Query,
  ReadModel,
  Projection,
  type IDomainEvent,
  type IEventMetadata,
  type IEventStore,
  type ISnapshot,
  type ICommand,
  type IQuery,
  type ICommandHandler,
  type IQueryHandler
} from './event-sourcing.js';

// ============================================================================
// Service Mesh
// ============================================================================

export {
  ServiceMeshProxy,
  type IServiceMeshConfig,
  type IRateLimitConfig,
  type ICircuitBreakerConfig,
  type IRetryConfig,
  type IBulkheadConfig,
  type ILoadBalancingConfig
} from './service-mesh.js';

// ============================================================================
// Actor Model
// ============================================================================

export {
  Actor,
  ActorSystem,
  RoundRobinRouter,
  BroadcastRouter,
  ConsistentHashRouter,
  OneForOneStrategy,
  AllForOneStrategy,
  createActorSystem,
  SupervisorAction,
  type ActorMessage,
  type ActorRef,
  type ActorContext,
  type ActorBehavior,
  type SupervisorStrategy
} from './actor-model.js';

// ============================================================================
// Time-Travel Debugging
// ============================================================================

export {
  TimeTravelDebugger,
  TimeTravelManager,
  createTimeTravelProxy,
  TimeTravel,
  type StateSnapshot,
  type ActionRecord,
  type TimelineEvent,
  type TimeTravelOptions
} from './time-travel.js';

// ============================================================================
// Adaptive Scaling
// ============================================================================

export {
  AdaptiveScalingController,
  MovingAveragePredictionModel,
  ExponentialSmoothingModel,
  type ScalingMetrics,
  type ScalingPolicy,
  type ScalingDecision,
  type PredictionModel
} from './adaptive-scaling.js';

// ============================================================================
// Chaos Engineering
// ============================================================================

export {
  ChaosMonkey,
  ChaosOrchestrator,
  ChaosTestingFramework,
  ChaosType,
  type ChaosExperiment,
  type SteadyStateDefinition,
  type MetricCondition,
  type ChaosMethod,
  type ChaosTarget,
  type ChaosResult
} from './chaos-engineering.js';

// ============================================================================
// Feature Flags
// ============================================================================

export {
  FeatureFlagManager,
  ABTestingFramework,
  FeatureFlag as FeatureFlagDecorator,
  type FeatureFlag,
  type FlagCondition,
  type FlagVariant,
  type VariantOverride,
  type RolloutConfig,
  type RolloutStage,
  type EvaluationContext,
  type EvaluationResult
} from './feature-flags.js';