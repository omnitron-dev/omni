/**
 * Ontological Component Composition System
 *
 * A type-safe, protocol-aware, capability-constrained framework
 * for composing components like LEGO bricks.
 *
 * @module ontology
 */

// Brand Types
export {
  // Types
  Brand,
  Unbrand,
  GetBrand,
  IsBranded,
  BrandCompatible,
  // Semantic types
  UserId,
  SessionId,
  ResourceId,
  CorrelationId,
  Timestamp,
  Duration,
  Interval,
  Bytes,
  Percentage,
  Temperature,
  URL,
  IPAddress,
  Port,
  SecretToken,
  PublicKey,
  PrivateKey,
  Hash,
  JSON,
  Base64,
  Hex,
  // Functions
  brandSafe,
  Semantic,
  isBrandCompatible,
} from './core/brand-types.js';

// Protocols
export {
  // Types
  Protocol,
  GetProtocol,
  ImplementsProtocol,
  ProtocolName,
  ProtocolCompatible,
  // Interfaces
  JSONProtocol,
  MessagePackProtocol,
  HTTPProtocol,
  WebSocketProtocol,
  ReactiveProtocol,
  AsyncIterableProtocol,
  NetronProtocol,
  EventEmitterProtocol,
  HTTPRequestConfig,
  HTTPResponse,
  ProtocolAdapter,
  // Constants
  Protocols,
  ProtocolCompatibility,
  // Functions
  isProtocolCompatible,
  verifyProtocol,
  withProtocol,
  // Classes
  ProtocolTransformer,
  protocolTransformer,
} from './core/protocols.js';

// Capabilities
export {
  // Types
  Capability,
  CapabilitySet,
  CapabilityRequirements,
  CapabilityName,
  CapabilityMetadata,
  CapableComponent,
  CapableFlow,
  // Constants
  Capabilities,
  // Functions
  capability,
  capabilitySet,
  requirements,
  canCompose,
  capableFlow,
  composeCapable,
  // Classes
  CapabilityInferrer,
  CapabilityRegistry,
  capabilityRegistry,
} from './core/capabilities.js';

// Composition
export {
  // Types
  Component,
  TypeDescriptor,
  ComponentMetadata,
  ExecutionContext,
  Logger,
  MetricsCollector,
  CompositionError,
  CompositionFailureReason,
  CompositionValidationResult,
  // Classes
  CompositionValidator,
  ComponentComposer,
  ComposedComponent,
  ComponentBuilder,
  composer,
  // Functions
  component,
} from './core/composition.js';

// LLM Integration
export {
  // Types
  SemanticEmbedding,
  SemanticIndex,
  SemanticSearchOptions,
  SemanticFilters,
  SemanticSearchResult,
  LLMProvider,
  LLMCompletionOptions,
  ComponentSearchIntent,
  ComponentSuggestion,
  OntologyQueryResult,
  // Classes
  ComponentSemanticAnalyzer,
  SemanticComponentRegistry,
  OntologyQueryLanguage,
} from './llm/semantic-understanding.js';

// Examples (for documentation and demos)
export * from './examples/basic-composition.js';
export * from './examples/infrastructure-composition.js';
