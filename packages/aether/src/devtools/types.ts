/**
 * DevTools Type Definitions
 * Core types for Aether's browser extension DevTools
 *
 * @module devtools/types
 */

import type { Signal, WritableSignal, Computed } from '../core/reactivity/types.js';

/**
 * DevTools configuration options
 */
export interface DevToolsOptions {
  /** Enable signal tracking */
  trackSignals?: boolean;
  /** Enable computed tracking */
  trackComputed?: boolean;
  /** Enable effect tracking */
  trackEffects?: boolean;
  /** Enable component tracking */
  trackComponents?: boolean;
  /** Enable time-travel debugging */
  enableTimeTravel?: boolean;
  /** Enable performance profiling */
  enableProfiler?: boolean;
  /** Enable network inspection for netron-browser */
  enableNetwork?: boolean;
  /** Maximum history entries for time-travel */
  maxHistorySize?: number;
  /** Bridge connection URL (for custom extension) */
  bridgeUrl?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Signal metadata tracked by DevTools
 */
export interface SignalMetadata {
  /** Unique identifier */
  id: string;
  /** Signal type */
  type: 'signal' | 'computed' | 'writable';
  /** Current value (serialized) */
  value: any;
  /** Debug name */
  name?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Number of dependents */
  dependentCount: number;
  /** Dependencies (for computed) */
  dependencies: string[];
  /** Component that created this signal */
  componentId?: string;
  /** Call stack trace */
  stack?: string;
}

/**
 * Computed signal metadata
 */
export interface ComputedMetadata extends SignalMetadata {
  type: 'computed';
  /** Computation function source */
  source?: string;
  /** Execution count */
  executionCount: number;
  /** Average execution time (ms) */
  avgExecutionTime: number;
  /** Whether it's currently stale */
  isStale: boolean;
}

/**
 * Effect metadata
 */
export interface EffectMetadata {
  /** Unique identifier */
  id: string;
  /** Debug name */
  name?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last execution timestamp */
  lastExecutedAt: number;
  /** Execution count */
  executionCount: number;
  /** Dependencies */
  dependencies: string[];
  /** Average execution time (ms) */
  avgExecutionTime: number;
  /** Component that created this effect */
  componentId?: string;
  /** Effect function source */
  source?: string;
  /** Whether it's active */
  isActive: boolean;
  /** Call stack trace */
  stack?: string;
}

/**
 * Component metadata
 */
export interface ComponentMetadata {
  /** Unique identifier */
  id: string;
  /** Component name */
  name: string;
  /** Component type (function/class) */
  type: 'function' | 'class';
  /** Parent component ID */
  parentId?: string;
  /** Child component IDs */
  children: string[];
  /** Props (serialized) */
  props: Record<string, any>;
  /** Creation timestamp */
  createdAt: number;
  /** Last render timestamp */
  lastRenderedAt: number;
  /** Render count */
  renderCount: number;
  /** Average render time (ms) */
  avgRenderTime: number;
  /** Signals created by this component */
  signals: string[];
  /** Effects created by this component */
  effects: string[];
  /** Is mounted */
  isMounted: boolean;
  /** Call stack trace */
  stack?: string;
}

/**
 * State tree node (for inspector)
 */
export interface StateNode {
  /** Node ID */
  id: string;
  /** Node label */
  label: string;
  /** Node type */
  type: 'signal' | 'computed' | 'effect' | 'component' | 'store';
  /** Current value */
  value: any;
  /** Children nodes */
  children: StateNode[];
  /** Metadata */
  metadata: SignalMetadata | ComputedMetadata | EffectMetadata | ComponentMetadata | StoreMetadata;
}

/**
 * Store metadata
 */
export interface StoreMetadata {
  /** Unique identifier */
  id: string;
  /** Store name */
  name: string;
  /** Current state (serialized) */
  state: Record<string, any>;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Update count */
  updateCount: number;
  /** Subscribers count */
  subscriberCount: number;
  /** Component that owns this store */
  componentId?: string;
}

/**
 * History entry for time-travel debugging
 */
export interface HistoryEntry {
  /** Entry ID */
  id: string;
  /** Timestamp */
  timestamp: number;
  /** Mutation type */
  type: 'signal' | 'store' | 'effect';
  /** Target ID */
  targetId: string;
  /** Previous value */
  prevValue: any;
  /** New value */
  newValue: any;
  /** Mutation description */
  description: string;
  /** Call stack */
  stack?: string;
}

/**
 * Inspector state
 */
export interface InspectorState {
  /** All tracked signals */
  signals: Map<string, SignalMetadata>;
  /** All tracked computed */
  computed: Map<string, ComputedMetadata>;
  /** All tracked effects */
  effects: Map<string, EffectMetadata>;
  /** All tracked components */
  components: Map<string, ComponentMetadata>;
  /** All tracked stores */
  stores: Map<string, StoreMetadata>;
  /** State tree root */
  stateTree: StateNode[];
  /** Component tree root */
  componentTree: StateNode[];
}

/**
 * Recorder state
 */
export interface RecorderState {
  /** Is recording active */
  isRecording: boolean;
  /** History entries */
  history: HistoryEntry[];
  /** Current position in history */
  currentIndex: number;
  /** Maximum history size */
  maxSize: number;
  /** Session start time */
  sessionStartTime: number;
}

/**
 * Performance measurement
 */
export interface PerformanceMeasurement {
  /** Measurement ID */
  id: string;
  /** Measurement type */
  type: 'component' | 'effect' | 'computed';
  /** Target ID */
  targetId: string;
  /** Target name */
  name: string;
  /** Start time */
  startTime: number;
  /** Duration (ms) */
  duration: number;
  /** Memory delta (bytes) */
  memoryDelta?: number;
  /** Call stack */
  stack?: string;
}

/**
 * Performance profile
 */
export interface PerformanceProfile {
  /** Profile ID */
  id: string;
  /** Start time */
  startTime: number;
  /** End time */
  endTime: number;
  /** Duration (ms) */
  duration: number;
  /** All measurements */
  measurements: PerformanceMeasurement[];
  /** Summary statistics */
  summary: {
    totalComponents: number;
    totalEffects: number;
    totalComputed: number;
    slowestComponent?: PerformanceMeasurement;
    slowestEffect?: PerformanceMeasurement;
    slowestComputed?: PerformanceMeasurement;
  };
}

/**
 * Profiler state
 */
export interface ProfilerState {
  /** Is profiling active */
  isProfiling: boolean;
  /** Current profile */
  currentProfile?: PerformanceProfile;
  /** All measurements */
  measurements: PerformanceMeasurement[];
  /** Bottlenecks */
  bottlenecks: PerformanceMeasurement[];
}

/**
 * Network request metadata (for netron-browser)
 */
export interface NetworkEvent {
  /** Request ID */
  id: string;
  /** Request type */
  type: 'request' | 'response' | 'error' | 'websocket';
  /** Timestamp */
  timestamp: number;
  /** Service name */
  service?: string;
  /** Method name */
  method?: string;
  /** Request payload */
  request?: any;
  /** Response payload */
  response?: any;
  /** Error details */
  error?: {
    message: string;
    stack?: string;
  };
  /** Duration (ms) */
  duration?: number;
  /** Was cached */
  cached?: boolean;
  /** Cache key */
  cacheKey?: string;
  /** WebSocket connection ID */
  connectionId?: string;
  /** WebSocket event type */
  wsEvent?: 'open' | 'close' | 'message' | 'error';
}

/**
 * Network inspector state
 */
export interface NetworkState {
  /** All network events */
  events: NetworkEvent[];
  /** Active WebSocket connections */
  connections: Map<string, WebSocketConnection>;
  /** Cache statistics */
  cacheStats: {
    hits: number;
    misses: number;
    hitRate: number;
  };
}

/**
 * WebSocket connection metadata
 */
export interface WebSocketConnection {
  /** Connection ID */
  id: string;
  /** URL */
  url: string;
  /** State */
  state: 'connecting' | 'open' | 'closing' | 'closed';
  /** Connected at */
  connectedAt: number;
  /** Message count */
  messageCount: number;
  /** Bytes sent */
  bytesSent: number;
  /** Bytes received */
  bytesReceived: number;
}

/**
 * DevTools message types
 */
export type DevToolsMessageType =
  | 'init'
  | 'state-update'
  | 'history-update'
  | 'profile-update'
  | 'network-event'
  | 'time-travel'
  | 'ping'
  | 'pong';

/**
 * DevTools message structure
 */
export interface DevToolsMessage {
  /** Message type */
  type: DevToolsMessageType;
  /** Message payload */
  payload?: any;
  /** Timestamp */
  timestamp: number;
  /** Message ID (for request/response) */
  id?: string;
}

/**
 * State update message
 */
export interface StateUpdateMessage extends DevToolsMessage {
  type: 'state-update';
  payload: {
    signals?: SignalMetadata[];
    computed?: ComputedMetadata[];
    effects?: EffectMetadata[];
    components?: ComponentMetadata[];
    stores?: StoreMetadata[];
  };
}

/**
 * History update message
 */
export interface HistoryUpdateMessage extends DevToolsMessage {
  type: 'history-update';
  payload: {
    entries: HistoryEntry[];
    currentIndex: number;
  };
}

/**
 * Time-travel message
 */
export interface TimeTravelMessage extends DevToolsMessage {
  type: 'time-travel';
  payload: {
    action: 'jump' | 'undo' | 'redo';
    index?: number;
  };
}

/**
 * Profile update message
 */
export interface ProfileUpdateMessage extends DevToolsMessage {
  type: 'profile-update';
  payload: {
    profile: PerformanceProfile;
    measurements: PerformanceMeasurement[];
  };
}

/**
 * Network event message
 */
export interface NetworkEventMessage extends DevToolsMessage {
  type: 'network-event';
  payload: {
    event: NetworkEvent;
  };
}

/**
 * DevTools inspector interface
 */
export interface Inspector {
  /** Track signal */
  trackSignal<T>(signal: Signal<T> | WritableSignal<T>, metadata?: Partial<SignalMetadata>): void;
  /** Track computed */
  trackComputed<T>(computed: Computed<T>, deps: Signal<any>[], metadata?: Partial<ComputedMetadata>): void;
  /** Track effect */
  trackEffect(effect: () => void, deps: Signal<any>[], metadata?: Partial<EffectMetadata>): void;
  /** Track component */
  trackComponent(component: any, props: Record<string, any>, metadata?: Partial<ComponentMetadata>): void;
  /** Get state tree */
  getStateTree(): StateNode[];
  /** Get component tree */
  getComponentTree(): StateNode[];
  /** Get dependency graph */
  getDependencyGraph(): { nodes: any[]; edges: any[] };
  /** Get current state */
  getState(): InspectorState;
  /** Clear tracking data */
  clear(): void;
  /** Dispose inspector */
  dispose(): void;
}

/**
 * DevTools recorder interface
 */
export interface Recorder {
  /** Start recording */
  startRecording(): void;
  /** Stop recording */
  stopRecording(): void;
  /** Get history */
  getHistory(): HistoryEntry[];
  /** Jump to state */
  jumpToState(index: number): void;
  /** Undo */
  undo(): void;
  /** Redo */
  redo(): void;
  /** Diff states */
  diff(indexA: number, indexB: number): StateDiff;
  /** Export session */
  exportSession(): string;
  /** Import session */
  importSession(data: string): void;
  /** Clear history */
  clear(): void;
  /** Get current state */
  getState(): RecorderState;
}

/**
 * State diff result
 */
export interface StateDiff {
  /** Timestamp A */
  timestampA: number;
  /** Timestamp B */
  timestampB: number;
  /** Changes */
  changes: {
    type: 'added' | 'removed' | 'changed';
    path: string;
    oldValue?: any;
    newValue?: any;
  }[];
}

/**
 * DevTools profiler interface
 */
export interface Profiler {
  /** Start profiling */
  startProfiling(): void;
  /** Stop profiling */
  stopProfiling(): PerformanceProfile;
  /** Start measuring component */
  startMeasuringComponent(componentId: string, name: string): void;
  /** End measuring component */
  endMeasuringComponent(componentId: string): void;
  /** Start measuring effect */
  startMeasuringEffect(effectId: string, name: string): void;
  /** End measuring effect */
  endMeasuringEffect(effectId: string): void;
  /** Start measuring computed */
  startMeasuringComputed(computedId: string, name: string): void;
  /** End measuring computed */
  endMeasuringComputed(computedId: string): void;
  /** Measure component */
  measureComponent(component: any, fn: () => void): void;
  /** Measure effect */
  measureEffect(effect: () => void, fn: () => void): void;
  /** Get performance report */
  getPerformanceReport(): PerformanceProfile | undefined;
  /** Get profile (alias for backward compatibility) */
  getProfile(): (PerformanceProfile & { samples: PerformanceMeasurement[] }) | undefined;
  /** Identify bottlenecks */
  identifyBottlenecks(threshold?: number): PerformanceMeasurement[];
  /** Get current state */
  getState(): ProfilerState;
  /** Clear measurements */
  clear(): void;
}

/**
 * Network inspector interface
 */
export interface NetworkInspector {
  /** Intercept netron request */
  interceptRequest(request: any): void;
  /** Log response */
  logResponse(response: any): void;
  /** Track WebSocket */
  trackWebSocket(connection: WebSocket, url: string): void;
  /** Get cache stats */
  getCacheStats(): NetworkState['cacheStats'];
  /** Get network timeline */
  getNetworkTimeline(): NetworkEvent[];
  /** Get current state */
  getState(): NetworkState;
  /** Clear events */
  clear(): void;
}

/**
 * DevTools bridge interface
 */
export interface Bridge {
  /** Connect to extension */
  connect(): Promise<void>;
  /** Disconnect from extension */
  disconnect(): void;
  /** Send message */
  send(message: DevToolsMessage): void;
  /** Receive message handler */
  receive(handler: (message: DevToolsMessage) => void): () => void;
  /** Is connected */
  isConnected(): boolean;
}

/**
 * DevTools main interface
 */
export interface DevTools {
  /** Inspector instance */
  inspector: Inspector;
  /** Recorder instance */
  recorder: Recorder;
  /** Profiler instance */
  profiler: Profiler;
  /** Network inspector instance */
  networkInspector: NetworkInspector;
  /** Bridge instance */
  bridge: Bridge;
  /** Options */
  options: DevToolsOptions;
  /** Enable DevTools */
  enable(): void;
  /** Disable DevTools */
  disable(): void;
  /** Is enabled */
  isEnabled(): boolean;
}
