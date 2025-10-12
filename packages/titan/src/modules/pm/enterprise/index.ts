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
  type ITenantProcessPool,
} from './multi-tenancy.js';

// ============================================================================
// Saga and Distributed Transactions
// ============================================================================

export { SagaOrchestrator, type ISagaConfig, type ISagaStep, type ISagaContext, type ISagaStepResult } from './saga.js';

export {
  DistributedTransactionCoordinator,
  TransactionParticipant,
  TransactionPhase,
  type ITransactionParticipant,
  type ITransactionContext,
  type IDistributedTransactionConfig,
  type ITransactionLog,
} from './distributed-transactions.js';

// ============================================================================
// Event Sourcing and CQRS
// ============================================================================

export {
  AggregateRoot as EventSourcedAggregateRoot,
  EventSourcedRepository,
  InMemoryEventStore as EventSourcedEventStore,
  ReadModelProjection,
  EventSourced,
  EventHandler,
  ReadModel,
  Projection,
  type IDomainEvent as IEventSourcedDomainEvent,
  type IEventMetadata as IEventSourcedMetadata,
  type IEventStore as IEventSourcedStore,
  type ISnapshot,
} from './event-sourcing.js';

export {
  CommandBus,
  QueryBus,
  AggregateRoot,
  ProjectionManager,
  InMemoryEventStore,
  InMemorySnapshotStore,
  InMemoryReadModelStore,
  Command,
  Query,
  type ICommand,
  type IQuery,
  type ICommandHandler,
  type IQueryHandler,
  type ICommandMetadata,
  type IQueryMetadata,
  type IDomainEvent,
  type IEventMetadata,
  type IAggregateRoot,
  type IReadModel,
  type IProjection,
  type ICQRSConfig,
  type IEventStore,
  type ISnapshotStore,
  type IReadModelStore,
} from './cqrs.js';

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
  type ILoadBalancingConfig,
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
  type SupervisorStrategy,
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
  type TimeTravelOptions,
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
  type PredictionModel,
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
  type ChaosResult,
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
  type EvaluationResult,
} from './feature-flags.js';

// ============================================================================
// Advanced Patterns
// ============================================================================

export {
  DistributedLock,
  GeoSpatialQuery,
  RealtimeMatch,
  MessageBus,
  ResourcePool,
  type IDistributedLockConfig,
  type ILockHandle,
  type IGeoPoint,
  type IGeoSpatialConfig,
  type IMatchingConfig,
  type IMatch,
  type IMessageBusConfig,
  type IOrderedMessage,
  type IResourcePoolConfig,
  type IPooledResource,
} from './advanced-patterns.js';

// ============================================================================
// Geo-Distribution
// ============================================================================

export {
  GlobalLoadBalancer,
  GCounter,
  LWWRegister,
  RaftConsensus,
  GeoRoutingStrategy,
  ReplicationStrategy,
  ConsistencyLevel,
  ConflictResolution,
  type GeoRegion,
  type GeoLocation,
  type GeoServiceConfig,
  type EdgeCacheConfig,
  type FailoverConfig,
  type HealthCheckConfig,
  type GeoRequestContext,
} from './geo-distribution.js';

// ============================================================================
// Compliance and Audit
// ============================================================================

export {
  AuditLogger,
  ComplianceManager,
  ComplianceStandard,
  DataClassification,
  type AuditEvent,
  type AuditActor,
  type AuditResource,
  type AuditConfig,
  type GDPRRights,
  type DataInventoryItem,
  type ConsentRecord,
  type DataSubject,
  type DataSubjectRequest,
  type DataSubjectResponse,
  type ComplianceReport,
} from './compliance.js';

// ============================================================================
// Data Streaming and CDC
// ============================================================================

export {
  CDCConnector,
  StreamProcessor,
  StreamPipeline,
  KafkaSource,
  DatabaseSink,
  EnrichmentProcessor,
  DeduplicationProcessor,
  createDataPipeline,
  type ChangeEvent,
  type StreamCheckpoint,
  type StreamConfig,
  type WatermarkStrategy,
  type WindowConfig,
  type CDCConfig,
  type CDCSource,
  type ProcessContext,
  type Window,
  type StreamSource,
  type StreamSink,
} from './data-streaming.js';

// ============================================================================
// GraphQL Federation
// ============================================================================

export {
  GraphQLService,
  GraphQLFederationGateway,
  APIGateway,
  GraphQLServiceDecorator,
  Query as GraphQLQuery,
  Mutation,
  Subscription,
  FieldResolver,
  type GraphQLServiceConfig,
  type GraphQLDirective,
  type GraphQLResolver,
  type GraphQLSubscriptionResolver,
} from './graphql-federation.js';

// ============================================================================
// Cost Optimization
// ============================================================================

export {
  CostOptimizer,
  type CostConfig,
  type BudgetConfig,
  type OptimizationConfig,
  type ServerlessConfig,
  type ResourceUsage,
  type CostMetrics,
  type InstanceType,
  type Recommendation,
  type BatchOptimization,
  type CostReport,
} from './cost-optimization.js';

// ============================================================================
// Self-Healing
// ============================================================================

export {
  SelfHealingManager,
  AnomalyDetector,
  PlaybookExecutor,
  IncidentResponder,
  type SelfHealingConfig,
  type HealingAction,
  type Symptom,
  type Playbook,
  type Incident,
  type HealthIndicator,
} from './self-healing.js';
