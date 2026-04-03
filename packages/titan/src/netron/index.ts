/**
 * Netron - Distributed RPC and Service Communication Framework
 *
 * @packageDocumentation
 *
 * ## API Stability Markers
 *
 * - `@stable` - Part of the public API, follows semantic versioning
 * - `@experimental` - API may change in minor versions
 * - `@internal` - Not intended for public use
 * - `@deprecated` - Will be removed in a future version
 *
 * @since 0.1.0
 */

import 'reflect-metadata';

// ============================================================================
// Pure Type Interfaces (No circular dependencies)
// ============================================================================

/**
 * Core type interfaces used to break circular dependencies.
 * These are pure types with no class imports.
 *
 * @internal
 * @since 0.5.0
 */
export * from './interfaces/index.js';

// ============================================================================
// Basic Types and Utilities
// ============================================================================

/**
 * Unique identifier generation utilities.
 *
 * @stable
 * @since 0.1.0
 */
export * from './uid.js';

/**
 * Core type definitions for Netron.
 * Re-exports types from interfaces plus class-dependent types.
 *
 * @stable
 * @since 0.1.0
 */
export * from './types.js';

/**
 * Utility functions for common operations.
 *
 * @stable
 * @since 0.1.0
 */
export * from './utils.js';

/**
 * Constants used throughout the Netron system.
 *
 * @stable
 * @since 0.1.0
 */
export * from './constants.js';

// ============================================================================
// Core Classes - Order Matters for Initialization
// ============================================================================

/**
 * Service definition class containing metadata and interface specification.
 *
 * @internal
 * @since 0.1.0
 */
export * from './definition.js';

/**
 * Reference system for remote service proxying.
 *
 * @stable
 * @since 0.1.0
 */
export * from './reference.js';

/**
 * Stream reference for handling async streaming data.
 *
 * @stable
 * @since 0.1.0
 */
export * from './streams/index.js';

// Abstract peer MUST come before Interface and LocalPeer to avoid circular dependency
/**
 * Abstract base class for peer implementations.
 *
 * @stable
 * @since 0.1.0
 */
export * from './abstract-peer.js';

// ============================================================================
// Interfaces and Decorators
// ============================================================================

/**
 * Interface system for service contracts.
 *
 * @stable
 * @since 0.1.0
 */
export * from './interface.js';

// ============================================================================
// Peer Classes
// ============================================================================

/**
 * Local peer implementation representing the current node.
 *
 * @stable
 * @since 0.1.0
 */
export * from './local-peer.js';

/**
 * Remote peer implementation for communicating with other nodes.
 *
 * @stable
 * @since 0.1.0
 */
export * from './remote-peer.js';

// Predicates - exported after all classes they depend on
/**
 * Type predicates for runtime type checking.
 *
 * @stable
 * @since 0.1.0
 */
export * from './predicates.js';

// ============================================================================
// Stream Classes (now exported from ./streams/index.js above)
// ============================================================================

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Connection manager for industrial-grade connection handling.
 * Provides connection pooling, health monitoring, and reconnection.
 *
 * @stable
 * @since 0.5.0
 */
export * from './connection-manager.js';

// ============================================================================
// Other Components
// ============================================================================

/**
 * Task manager for coordinating distributed operations.
 *
 * @stable
 * @since 0.1.0
 */
export * from './task-manager.js';

/**
 * Service stub for local service proxying.
 * Provides transparent interaction with services.
 *
 * @stable
 * @since 0.1.0
 */
export * from './service-stub.js';

// ============================================================================
// Packet System (includes serializer)
// ============================================================================

/**
 * Packet serialization and deserialization system.
 *
 * @stable
 * @since 0.1.0
 */
export * from './packet/index.js';

// ============================================================================
// Main Netron Class
// ============================================================================

/**
 * The main Netron class for managing distributed communication.
 * This is the primary entry point for creating RPC servers and clients.
 *
 * @stable
 * @since 0.1.0
 */
export * from './netron.js';

// ============================================================================
// Decorators
// ============================================================================

/**
 * Service decorator for marking classes as Netron services.
 *
 * @stable
 * @since 0.1.0
 */
export { Service } from '../decorators/core.js';

/**
 * Public decorator for exposing methods and properties on services.
 *
 * @stable
 * @since 0.1.0
 */
export { Public } from '../decorators/core.js';

// ============================================================================
// Multi-Backend Client System
// ============================================================================

/**
 * Multi-backend client for intelligent routing across multiple Netron servers.
 * Provides load balancing, health monitoring, and automatic failover.
 *
 * @stable
 * @since 0.6.0
 */
export * from './multi-backend/index.js';
