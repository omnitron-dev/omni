/**
 * Browser-compatible Netron types
 * Simplified version without server-specific dependencies
 */

/**
 * Type definition for event subscriber functions.
 * These functions are called when events are emitted.
 */
export type EventSubscriber = (...args: any[]) => void;

// SHARED-PROTO: the service-definition shape types are defined once in
// @omnitron-dev/netron-protocol (shared with the titan server) and re-exported
// here so existing `core/types.js` importers are unchanged and the shape can't
// drift from the wire contract.
import type {
  ArgumentInfo,
  MethodInfo,
  PropertyInfo,
  ServiceMetadata,
} from '@omnitron-dev/netron-protocol';
export type { ArgumentInfo, MethodInfo, PropertyInfo, ServiceMetadata };

/**
 * Core peer interface for browser client
 */
export interface IPeer {
  /** Peer identifier */
  id: string;

  /** Query service interface by name */
  queryInterface<T = any>(name: string | T, version?: string): Promise<T>;

  /** Subscribe to events */
  subscribe(event: string, handler: EventSubscriber): Promise<void> | void;

  /** Unsubscribe from events */
  unsubscribe(event: string, handler: EventSubscriber): Promise<void> | void;

  /** Set property or call method */
  set(defId: string, name: string, value: any): Promise<void>;

  /** Get property value */
  get(defId: string, name: string): Promise<any>;

  /** Call method with arguments */
  call(defId: string, name: string, args: any[]): Promise<any>;

  /** Release interface */
  releaseInterface?<T>(iInstance: T, released?: Set<string>): Promise<void>;
}
