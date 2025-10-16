/**
 * Core types for @holon/runtime
 */

import type { Flow } from '@holon/flow';

// ============================================================================
// Resource Management
// ============================================================================

export interface ResourceLimits {
  /** CPU usage limit (0.0 to 1.0) */
  cpu?: number;
  /** Memory limit (e.g., '512MB', '1GB', '2GB') */
  memory?: string;
  /** Global timeout in milliseconds */
  timeout?: number;
}

export interface ResourceUsage {
  cpu: number;
  memory: number;
  uptime: number;
  timestamp: number;
}

// ============================================================================
// Execution
// ============================================================================

export interface ExecutionOptions {
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Execution priority */
  priority?: 'low' | 'normal' | 'high';
  /** Enable distributed tracing */
  trace?: boolean;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Execution context metadata */
  metadata?: Record<string, unknown>;
}

export interface ExecutionResult<Out> {
  /** Result value */
  value: Out;
  /** Execution duration in milliseconds */
  duration: number;
  /** Resource usage during execution */
  resourceUsage: ResourceUsage;
  /** Execution trace (if enabled) */
  trace?: ExecutionTrace;
  /** Metadata from execution */
  metadata?: Record<string, unknown>;
}

export interface ExecutionTrace {
  id: string;
  flowId: string;
  startTime: number;
  endTime: number;
  duration: number;
  spans: TraceSpan[];
}

export interface TraceSpan {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Error Recovery
// ============================================================================

export interface ErrorRecoveryConfig {
  /** Maximum number of retries */
  maxRetries?: number;
  /** Backoff strategy */
  backoff?: 'fixed' | 'linear' | 'exponential';
  /** Initial delay in milliseconds */
  initialDelay?: number;
  /** Maximum delay in milliseconds */
  maxDelay?: number;
  /** Multiplier for exponential backoff */
  multiplier?: number;
}

export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  delay: number;
  /** Backoff strategy */
  backoff?: 'fixed' | 'linear' | 'exponential';
  /** Whether to retry on specific errors */
  retryOn?: (error: Error) => boolean;
}

// ============================================================================
// Monitoring
// ============================================================================

export interface MonitoringConfig {
  /** Enable performance monitoring */
  enabled?: boolean;
  /** Sampling rate (0.0 to 1.0) */
  samplingRate?: number;
  /** Export metrics endpoint */
  endpoint?: string;
  /** Metrics labels */
  labels?: Record<string, string>;
}

export interface FlowMetrics {
  flowId: string;
  flowName: string;
  executions: number;
  successCount: number;
  errorCount: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  lastExecution: number;
  resourceUsage: ResourceUsage;
}

// ============================================================================
// Scheduling
// ============================================================================

export interface SchedulerConfig {
  /** Maximum concurrent tasks */
  maxConcurrency?: number;
  /** Priority queue enabled */
  priorityQueue?: boolean;
  /** Work stealing enabled */
  workStealing?: boolean;
  /** Rate limiting */
  rateLimit?: RateLimitConfig;
}

export interface RateLimitConfig {
  /** Maximum requests per interval */
  maxRequests: number;
  /** Interval in milliseconds */
  interval: number;
  /** Burst size */
  burst?: number;
}

export interface Task<In = unknown, Out = unknown> {
  id: string;
  flowId: string;
  flow: Flow<In, Out>;
  input: In;
  priority: number;
  options?: ExecutionOptions;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

// ============================================================================
// Service Mesh
// ============================================================================

export interface MeshNodeConfig {
  /** Node name/identifier */
  name: string;
  /** Port to listen on */
  port: number;
  /** Host to bind to */
  host?: string;
  /** Service discovery configuration */
  discovery?: DiscoveryConfig;
  /** Health check configuration */
  healthCheck?: HealthCheckConfig;
  /** Metrics configuration */
  metrics?: MonitoringConfig;
  /** TLS configuration */
  tls?: TLSConfig;
}

export interface DiscoveryConfig {
  /** Discovery type */
  type: 'dns' | 'consul' | 'etcd' | 'static' | 'peer';
  /** Domain for DNS discovery */
  domain?: string;
  /** Consul/etcd endpoints */
  endpoints?: string[];
  /** Static node list */
  nodes?: string[];
  /** Discovery interval in milliseconds */
  interval?: number;
}

export interface HealthCheckConfig {
  /** Health check interval in milliseconds */
  interval?: number;
  /** Health check timeout in milliseconds */
  timeout?: number;
  /** Health check endpoint */
  endpoint?: string;
}

export interface TLSConfig {
  /** Certificate file path */
  cert: string;
  /** Private key file path */
  key: string;
  /** CA certificate file path */
  ca?: string;
}

export interface ServiceRegistration {
  name: string;
  flowId: string;
  flow: Flow<unknown, unknown>;
  metadata?: Record<string, unknown>;
  registeredAt: number;
}

// ============================================================================
// Routing
// ============================================================================

export interface RouterConfig {
  /** Load balancing strategy */
  strategy?: 'round-robin' | 'least-loaded' | 'random' | 'consistent-hash';
  /** Circuit breaker configuration */
  circuitBreaker?: CircuitBreakerConfig;
  /** Retry policy */
  retry?: RetryConfig;
  /** Timeout in milliseconds */
  timeout?: number;
}

export interface CircuitBreakerConfig {
  /** Threshold for opening circuit */
  threshold: number;
  /** Timeout before attempting reset */
  timeout: number;
  /** Half-open state duration */
  halfOpenDuration?: number;
}

export interface RouteTarget {
  nodeId: string;
  endpoint: string;
  health: 'healthy' | 'unhealthy' | 'unknown';
  load: number;
  latency: number;
}

// ============================================================================
// Distributed Execution
// ============================================================================

export interface CoordinatorConfig {
  /** Worker node endpoints */
  nodes: string[];
  /** Load balancing strategy */
  strategy?: 'round-robin' | 'least-loaded' | 'consistent-hash';
  /** Failover configuration */
  failover?: FailoverConfig;
  /** Consensus configuration */
  consensus?: ConsensusConfig;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval?: number;
}

export interface FailoverConfig {
  /** Enable automatic failover */
  enabled: boolean;
  /** Failover timeout in milliseconds */
  timeout: number;
  /** Maximum failover attempts */
  maxAttempts?: number;
}

export interface ConsensusConfig {
  /** Consensus algorithm */
  algorithm: 'raft' | 'paxos' | 'bft';
  /** Quorum size */
  quorum: number;
  /** Election timeout in milliseconds */
  electionTimeout?: number;
}

export interface WorkerConfig {
  /** Worker identifier */
  id: string;
  /** Coordinator endpoint */
  coordinator: string;
  /** Maximum concurrent tasks */
  maxConcurrency?: number;
  /** Resource limits */
  resourceLimits?: ResourceLimits;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval?: number;
}

export interface WorkerStatus {
  id: string;
  health: 'healthy' | 'unhealthy';
  activeTasks: number;
  resourceUsage: ResourceUsage;
  lastHeartbeat: number;
}

export interface JobConfig {
  /** Job identifier */
  id: string;
  /** Flow to execute */
  flow: Flow<unknown, unknown>;
  /** Input data */
  input: unknown;
  /** Execution options */
  options?: ExecutionOptions;
  /** Partitioning strategy for distributed execution */
  partition?: 'none' | 'data' | 'pipeline';
}

// ============================================================================
// Visualization
// ============================================================================

export interface VisualizationConfig {
  /** Output format */
  format: 'dot' | 'mermaid' | 'd3' | 'json';
  /** Include metadata */
  includeMetadata?: boolean;
  /** Layout algorithm */
  layout?: 'hierarchical' | 'force' | 'circular';
  /** Styling options */
  style?: VisualizationStyle;
}

export interface VisualizationStyle {
  /** Node colors */
  nodeColor?: string;
  /** Edge colors */
  edgeColor?: string;
  /** Font family */
  fontFamily?: string;
  /** Font size */
  fontSize?: number;
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'flow' | 'input' | 'output';
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface FlowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Debugging
// ============================================================================

export interface DebuggerConfig {
  /** Enable breakpoints */
  breakpoints?: boolean;
  /** Enable step-through */
  stepThrough?: boolean;
  /** Enable state inspection */
  stateInspection?: boolean;
}

export interface Breakpoint {
  id: string;
  location: string;
  condition?: (state: unknown) => boolean;
  enabled: boolean;
}

export interface DebugState {
  currentLocation: string;
  variables: Record<string, unknown>;
  callStack: string[];
  breakpoints: Breakpoint[];
}

// ============================================================================
// Integration Types
// ============================================================================

export interface HttpServerConfig {
  /** Port to listen on */
  port: number;
  /** Host to bind to */
  host?: string;
  /** Flow routes */
  flows: Record<string, Flow<unknown, unknown>>;
  /** CORS configuration */
  cors?: CorsConfig;
  /** Middleware */
  middleware?: HttpMiddleware[];
}

export interface CorsConfig {
  origin?: string | string[];
  methods?: string[];
  credentials?: boolean;
}

export type HttpMiddleware = (req: unknown, res: unknown, next: () => void) => void;

export interface KafkaConfig {
  /** Kafka brokers */
  brokers: string[];
  /** Client ID */
  clientId: string;
  /** Consumer group ID */
  groupId?: string;
  /** Topics to subscribe to */
  topics?: string[];
}

export interface RedisConfig {
  /** Redis host */
  host: string;
  /** Redis port */
  port: number;
  /** Redis password */
  password?: string;
  /** Redis database */
  db?: number;
  /** Key prefix */
  prefix?: string;
}
