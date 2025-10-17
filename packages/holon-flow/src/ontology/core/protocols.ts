/**
 * Protocol System - Type-Level Protocol Matching
 *
 * Protocols define communication contracts between components.
 * Only components implementing compatible protocols can be connected.
 *
 * Philosophy:
 * - Protocols are more than interfaces - they define semantic contracts
 * - Protocol matching happens at type-level
 * - Runtime validation ensures protocol compliance
 *
 * @module ontology/core/protocols
 */

import type { Brand } from './brand-types.js';

/**
 * Protocol<T, P> - A value of type T that implements protocol P
 *
 * This ensures that only values implementing the correct protocol can be used.
 */
export type Protocol<T, P extends string> = T & { readonly __protocol: P };

/**
 * GetProtocol<T> - Extract the protocol from a protocol-typed value
 */
export type GetProtocol<T> = T extends Protocol<any, infer P> ? P : never;

/**
 * ImplementsProtocol<T, P> - Check if T implements protocol P
 */
export type ImplementsProtocol<T, P extends string> = T extends Protocol<any, P> ? true : false;

/**
 * Protocol Registry - Defines well-known protocols
 */
export const Protocols = {
  // Data Protocols
  JSON: 'protocol:data:json',
  MSGPACK: 'protocol:data:msgpack',
  PROTOBUF: 'protocol:data:protobuf',
  AVRO: 'protocol:data:avro',

  // Communication Protocols
  HTTP: 'protocol:comm:http',
  WEBSOCKET: 'protocol:comm:websocket',
  GRPC: 'protocol:comm:grpc',
  MQTT: 'protocol:comm:mqtt',
  AMQP: 'protocol:comm:amqp',

  // Stream Protocols
  REACTIVE: 'protocol:stream:reactive',
  ASYNC_ITERABLE: 'protocol:stream:async-iterable',
  NODE_STREAM: 'protocol:stream:node',
  WEB_STREAM: 'protocol:stream:web',

  // RPC Protocols
  NETRON: 'protocol:rpc:netron',
  JSON_RPC: 'protocol:rpc:json-rpc',
  TRPC: 'protocol:rpc:trpc',

  // Event Protocols
  EVENT_EMITTER: 'protocol:event:emitter',
  EVENT_BUS: 'protocol:event:bus',
  PUBSUB: 'protocol:event:pubsub',

  // State Protocols
  OBSERVABLE: 'protocol:state:observable',
  SIGNAL: 'protocol:state:signal',
  ATOM: 'protocol:state:atom',
} as const;

export type ProtocolName = (typeof Protocols)[keyof typeof Protocols];

/**
 * Protocol Definitions - Structural contracts for each protocol
 */

// Data Protocols
export interface JSONProtocol {
  readonly __protocol: typeof Protocols.JSON;
  serialize(data: any): string;
  deserialize(json: string): any;
}

export interface MessagePackProtocol {
  readonly __protocol: typeof Protocols.MSGPACK;
  encode(data: any): Uint8Array;
  decode(bytes: Uint8Array): any;
}

// Communication Protocols
export interface HTTPProtocol {
  readonly __protocol: typeof Protocols.HTTP;
  request(config: HTTPRequestConfig): Promise<HTTPResponse>;
  get(url: string, config?: HTTPRequestConfig): Promise<HTTPResponse>;
  post(url: string, data: any, config?: HTTPRequestConfig): Promise<HTTPResponse>;
}

export interface WebSocketProtocol {
  readonly __protocol: typeof Protocols.WEBSOCKET;
  send(data: any): void;
  on(event: string, handler: (data: any) => void): void;
  close(): void;
}

// Stream Protocols
export interface ReactiveProtocol<T> {
  readonly __protocol: typeof Protocols.REACTIVE;
  subscribe(observer: {
    next: (value: T) => void;
    error?: (error: Error) => void;
    complete?: () => void;
  }): { unsubscribe: () => void };
}

export interface AsyncIterableProtocol<T> {
  readonly __protocol: typeof Protocols.ASYNC_ITERABLE;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}

// RPC Protocols
export interface NetronProtocol {
  readonly __protocol: typeof Protocols.NETRON;
  call<T = any>(method: string, params?: any): Promise<T>;
  notify(method: string, params?: any): void;
}

// Event Protocols
export interface EventEmitterProtocol {
  readonly __protocol: typeof Protocols.EVENT_EMITTER;
  on(event: string, handler: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
  off(event: string, handler: (...args: any[]) => void): void;
}

/**
 * HTTP Protocol Types
 */
export interface HTTPRequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

export interface HTTPResponse {
  status: number;
  headers: Record<string, string>;
  data: any;
}

/**
 * ProtocolAdapter - Convert between protocols
 */
export interface ProtocolAdapter<From extends string, To extends string> {
  readonly from: From;
  readonly to: To;
  adapt<T>(value: Protocol<T, From>): Protocol<T, To>;
}

/**
 * Protocol Compatibility Matrix
 *
 * Defines which protocols can be automatically converted to others
 */
export const ProtocolCompatibility: Record<ProtocolName, ProtocolName[]> = {
  // Data protocols are mostly incompatible (need explicit conversion)
  [Protocols.JSON]: [Protocols.JSON],
  [Protocols.MSGPACK]: [Protocols.MSGPACK],
  [Protocols.PROTOBUF]: [Protocols.PROTOBUF],
  [Protocols.AVRO]: [Protocols.AVRO],

  // HTTP can adapt to WebSocket for streaming
  [Protocols.HTTP]: [Protocols.HTTP],
  [Protocols.WEBSOCKET]: [Protocols.WEBSOCKET, Protocols.REACTIVE],
  [Protocols.GRPC]: [Protocols.GRPC],
  [Protocols.MQTT]: [Protocols.MQTT, Protocols.PUBSUB],
  [Protocols.AMQP]: [Protocols.AMQP, Protocols.PUBSUB],

  // Stream protocols can often convert
  [Protocols.REACTIVE]: [Protocols.REACTIVE, Protocols.ASYNC_ITERABLE],
  [Protocols.ASYNC_ITERABLE]: [Protocols.ASYNC_ITERABLE, Protocols.REACTIVE],
  [Protocols.NODE_STREAM]: [Protocols.NODE_STREAM, Protocols.ASYNC_ITERABLE],
  [Protocols.WEB_STREAM]: [Protocols.WEB_STREAM, Protocols.ASYNC_ITERABLE],

  // RPC protocols
  [Protocols.NETRON]: [Protocols.NETRON],
  [Protocols.JSON_RPC]: [Protocols.JSON_RPC],
  [Protocols.TRPC]: [Protocols.TRPC],

  // Event protocols can often convert
  [Protocols.EVENT_EMITTER]: [Protocols.EVENT_EMITTER, Protocols.EVENT_BUS],
  [Protocols.EVENT_BUS]: [Protocols.EVENT_BUS, Protocols.PUBSUB],
  [Protocols.PUBSUB]: [Protocols.PUBSUB],

  // State protocols
  [Protocols.OBSERVABLE]: [Protocols.OBSERVABLE, Protocols.SIGNAL],
  [Protocols.SIGNAL]: [Protocols.SIGNAL],
  [Protocols.ATOM]: [Protocols.ATOM, Protocols.OBSERVABLE],
};

/**
 * ProtocolCompatible<A, B> - Type-level protocol compatibility check
 */
export type ProtocolCompatible<A extends ProtocolName, B extends ProtocolName> =
  B extends (typeof ProtocolCompatibility)[A][number] ? true : false;

/**
 * Runtime protocol compatibility checker
 */
export function isProtocolCompatible(from: ProtocolName, to: ProtocolName): boolean {
  return ProtocolCompatibility[from]?.includes(to) ?? false;
}

/**
 * Protocol verification at runtime
 */
export function verifyProtocol<P extends ProtocolName>(value: any, protocol: P): value is Protocol<any, P> {
  return value && value.__protocol === protocol;
}

/**
 * Create a protocol-compliant wrapper
 */
export function withProtocol<T, P extends ProtocolName>(value: T, protocol: P): Protocol<T, P> {
  return Object.assign(value as any, { __protocol: protocol });
}

/**
 * Protocol Transformer - Transform data between protocols
 */
export class ProtocolTransformer {
  private adapters = new Map<string, ProtocolAdapter<any, any>>();

  /**
   * Register a protocol adapter
   */
  register<From extends ProtocolName, To extends ProtocolName>(adapter: ProtocolAdapter<From, To>): void {
    const key = `${adapter.from}->${adapter.to}`;
    this.adapters.set(key, adapter);
  }

  /**
   * Transform value from one protocol to another
   */
  transform<T, From extends ProtocolName, To extends ProtocolName>(
    value: Protocol<T, From>,
    targetProtocol: To
  ): Protocol<T, To> | null {
    const sourceProtocol = (value as any).__protocol as From;

    // Direct compatibility
    if (sourceProtocol === targetProtocol) {
      return value as any;
    }

    // Check compatibility matrix
    if (!isProtocolCompatible(sourceProtocol, targetProtocol)) {
      return null;
    }

    // Try to find adapter
    const key = `${sourceProtocol}->${targetProtocol}`;
    const adapter = this.adapters.get(key);

    if (adapter) {
      return adapter.adapt(value) as Protocol<T, To>;
    }

    return null;
  }

  /**
   * Check if transformation is possible
   */
  canTransform<From extends ProtocolName, To extends ProtocolName>(from: From, to: To): boolean {
    if (from === to) return true;

    const key = `${from}->${to}`;
    return this.adapters.has(key) || isProtocolCompatible(from, to);
  }
}

/**
 * Global protocol transformer instance
 */
export const protocolTransformer = new ProtocolTransformer();

/**
 * Built-in Protocol Adapters
 */

// Reactive -> AsyncIterable
protocolTransformer.register<typeof Protocols.REACTIVE, typeof Protocols.ASYNC_ITERABLE>({
  from: Protocols.REACTIVE,
  to: Protocols.ASYNC_ITERABLE,
  adapt: (observable) => {
    const asyncIterable: AsyncIterableProtocol<any> = {
      __protocol: Protocols.ASYNC_ITERABLE,
      async *[Symbol.asyncIterator]() {
        const queue: any[] = [];
        let resolve: ((value: any) => void) | null = null;
        let complete = false;
        let error: Error | null = null;

        const subscription = observable.subscribe({
          next: (value) => {
            if (resolve) {
              resolve({ value, done: false });
              resolve = null;
            } else {
              queue.push({ value, done: false });
            }
          },
          error: (err) => {
            error = err;
            if (resolve) {
              resolve({ value: undefined, done: true });
              resolve = null;
            }
          },
          complete: () => {
            complete = true;
            if (resolve) {
              resolve({ value: undefined, done: true });
              resolve = null;
            }
          },
        });

        try {
          while (true) {
            if (error) throw error;
            if (complete && queue.length === 0) break;

            if (queue.length > 0) {
              const item = queue.shift()!;
              if (item.done) break;
              yield item.value;
            } else {
              await new Promise<any>((res) => {
                resolve = res;
              });
            }
          }
        } finally {
          subscription.unsubscribe();
        }
      },
    };

    return asyncIterable as any;
  },
});
