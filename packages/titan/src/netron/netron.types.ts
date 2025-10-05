/**
 * Netron interface types to break circular dependencies
 * This file should not import any implementation files
 */

import type { ILogger } from '../modules/logger/logger.types.js';
import type { NetronOptions, Abilities, EventSubscriber } from './types.js';
import type { ITransportServer, ITransportConnection } from './transport/types.js';

/**
 * Core Netron interface without implementation details
 * Used to break circular dependency between Netron and AbstractPeer
 */
export interface INetron {
  /** Unique identifier for this Netron instance */
  readonly uuid: string;

  /** Logger instance */
  readonly logger: ILogger;

  /** Configuration options */
  readonly options?: NetronOptions;

  /** Services map */
  services: Map<string, any>;

  /** Local peer instance */
  peer: ILocalPeer;

  /** Remote peers map */
  peers: Map<string, any>;

  /** Transport server if available */
  transportServer?: ITransportServer;

  /** Get local peer */
  getLocalPeer(): ILocalPeer;

  /** Find peer by ID */
  findPeer(peerId: string): IPeer | undefined;

  /** Track task execution */
  trackTask(task: any): Promise<any>;

  /** Run task */
  runTask?(peer: any, name: string, ...args: any[]): Promise<any>;

  /** Emit special event */
  emitSpecial(eventId: string, eventName: string, data?: any): void;

  /** Get service names */
  getServiceNames(): string[];

  /** Emit event */
  emit(event: string | symbol, ...args: any[]): boolean;

  /** Add event listener */
  on(event: string | symbol, handler: Function): this;

  /** Remove event listener */
  off(event: string | symbol, handler: Function): this;

  /** Remove event listener (alias) */
  removeListener(event: string | symbol, handler: Function): this;

  /** Get event name for peer events */
  getPeerEventName?(peerId: string, event: string): string;
}

/**
 * Core peer interface
 */
export interface IPeer {
  /** Peer identifier */
  id: string;

  /** Associated Netron instance */
  netron: INetron;

  /** Peer abilities */
  abilities: Abilities;

  /** Query interface by name */
  queryInterface<T = any>(name: string | T, version?: string): Promise<T>;

  /** Subscribe to events */
  subscribe(event: string, handler: EventSubscriber): Promise<void> | void;

  /** Unsubscribe from events */
  unsubscribe(event: string, handler: EventSubscriber): Promise<void> | void;

  /** Emit events */
  emit?(event: string, data?: any): Promise<void>;

  /** Close peer connection */
  close?(): Promise<void>;

  /** Set property or call method */
  set(defId: string, name: string, value: any): Promise<void>;

  /** Get property value */
  get(defId: string, name: string): Promise<any>;

  /** Call method with arguments */
  call(defId: string, name: string, args: any[]): Promise<any>;

  /** Check if peer has ability */
  hasAbility?(ability: string): boolean;
}

/**
 * Local peer interface
 */
export interface ILocalPeer extends IPeer {
  /** Logger instance */
  logger: ILogger;

  /** Map of service stubs */
  stubs: Map<string, any>;

  /** Map of service instances */
  serviceInstances: Map<any, any>;

  /** Expose a service instance */
  expose(service: any, name?: string): Promise<void>;

  /** Unexpose a service */
  unexpose(service: any, name?: string): Promise<void>;

  /** Expose remote service - LocalPeer specific method */
  exposeRemoteService(peer: any, meta: any): any;

  /** Unexpose remote service - LocalPeer specific method */
  unexposeRemoteService(peer: any, serviceName: string): void;

  /** Reference a service */
  refService(instance: any, parentDef: any): any;

  /** Unref service */
  unrefService(defId?: string): void;

  /** Get stub by definition ID */
  getStubByDefinitionId(defId: string): any;

  /** Query interface by definition ID */
  queryInterfaceByDefId<T = any>(defId: string, def?: any): T;
}

/**
 * Remote peer interface
 */
export interface IRemotePeer extends IPeer {
  /** Connection to remote peer */
  connection?: ITransportConnection;

  /** Connect to remote peer */
  connect?(): Promise<void>;

  /** Check if connected */
  isConnected?(): boolean;
}