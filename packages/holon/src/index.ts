/**
 * @holon/runtime - Flow-Machine Runtime
 *
 * Complete runtime infrastructure for Flow-Machine with:
 * - Advanced execution engine
 * - Service mesh
 * - Distributed execution
 * - Visualization and debugging
 * - External integrations
 *
 * @packageDocumentation
 */

// Re-export Flow types for convenience
export type { Flow, FlowChain, FlowInput, FlowMeta, FlowOptions, FlowOutput, Maybe, Result } from '@holon/flow';

// Export all types
export type {
  // Resource Management
  ResourceLimits,
  ResourceUsage,
  // Execution
  ExecutionOptions,
  ExecutionResult,
  ExecutionTrace,
  TraceSpan,
  // Error Recovery
  ErrorRecoveryConfig,
  RetryConfig,
  // Monitoring
  MonitoringConfig,
  FlowMetrics,
  // Scheduling
  SchedulerConfig,
  RateLimitConfig,
  Task,
  // Service Mesh
  MeshNodeConfig,
  ServiceRegistration,
  RouteTarget,
  DiscoveryConfig,
  HealthCheckConfig,
  TLSConfig,
  // Routing
  RouterConfig,
  CircuitBreakerConfig,
  // Distributed
  CoordinatorConfig,
  WorkerConfig,
  WorkerStatus,
  JobConfig,
  FailoverConfig,
  ConsensusConfig,
  // Visualization
  VisualizationConfig,
  VisualizationStyle,
  FlowGraph,
  GraphNode,
  GraphEdge,
  // Debugging
  DebuggerConfig,
  Breakpoint,
  DebugState,
  // Integration
  HttpServerConfig,
  CorsConfig,
  HttpMiddleware,
  KafkaConfig,
  RedisConfig,
} from './types.js';

// Runtime exports
export { Engine, createEngine, type EngineConfig, type EngineEvents } from './runtime/engine.js';

export {
  Executor,
  createExecutor,
  type ExecutorConfig,
  type ExecutorEvents,
  type ExecutorStats,
} from './runtime/executor.js';

export { Scheduler, createScheduler, type SchedulerEvents, type SchedulerStats } from './runtime/scheduler.js';

// Mesh exports
export {
  MeshNode,
  createMeshNode,
  type MeshNodeEvents,
  type HealthStatus,
  type HealthCheck,
  type NodeMetrics,
} from './mesh/node.js';

export { Router, createRouter, type RouterEvents, type RouterStats } from './mesh/router.js';

export {
  Discovery,
  createDiscovery,
  type DiscoveryEvents,
  type DiscoveryStats,
  type ServiceInfo,
} from './mesh/discovery.js';

// Distributed exports
export { Coordinator, createCoordinator, type CoordinatorEvents, type JobStats } from './distributed/coordinator.js';

export { Worker, createWorker, type WorkerEvents } from './distributed/worker.js';

export { Consensus, createConsensus, type ConsensusEvents } from './distributed/consensus.js';

// Visualization exports
export { visualizeFlow, exportFlowGraph } from './viz/graph.js';

export {
  MetricsCollector,
  analyzeTrace,
  generatePerformanceReport,
  metricsCollector,
  type TraceAnalysis,
} from './viz/metrics.js';

export { Debugger, createDebugger, debugFlow, type DebuggerEvents } from './viz/debugger.js';

// Integration exports
export { HttpServer, createHttpServer, type HttpServerEvents, type ServerInfo } from './integrations/http.js';

export { GrpcServer, createGrpcServer, type GrpcServerConfig, type GrpcService } from './integrations/grpc.js';

export { KafkaClient, createKafkaClient } from './integrations/kafka.js';

export { RedisClient, createRedisClient } from './integrations/redis.js';
