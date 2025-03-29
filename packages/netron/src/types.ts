import { Definition } from './definition';

export type Abilities = {
  // List of tasks that are exposed.
  tasks?: string[];
  // List of services that are exposed.
  services?: Map<string, Definition>;
  // Indicates whether the remote peer should subscribe to service events.
  subsribeForServices?: boolean;
};

export type NetronOptions = {
  id?: string;
  listenHost?: string;
  listenPort?: number;
  taskTimeout?: number;
  taskOverwriteStrategy?: 'replace' | 'skip' | 'throw';
  connectTimeout?: number;
  requestTimeout?: number;
  abilities?: Abilities;
  streamTimeout?: number;
};

export type EventSubscriber = (...args: any[]) => void;

/**
 * Interface representing information about a method argument.
 */
export interface ArgumentInfo {
  index: number; // The index of the argument in the method signature
  type: string; // The type of the argument
}

/**
 * Interface representing information about a method.
 */
export interface MethodInfo {
  type: string; // The return type of the method
  arguments: ArgumentInfo[]; // Array of argument information
}

/**
 * Interface representing information about a property.
 */
export interface PropertyInfo {
  type: string; // The type of the property
  readonly: boolean; // Indicates if the property is read-only
}

/**
 * Interface representing metadata for a service.
 */
export interface ServiceMetadata {
  name: string; // The name of the service
  properties: Record<string, PropertyInfo>; // Record of property information
  methods: Record<string, MethodInfo>; // Record of method information
}

export type ServiceExposeEvent = {
  name: string;
  peerId: string;
  remotePeerId?: string;
  definition: Definition;
};

export type ServiceUnexposeEvent = {
  name: string;
  peerId: string;
  remotePeerId?: string;
  defId: string;
};
