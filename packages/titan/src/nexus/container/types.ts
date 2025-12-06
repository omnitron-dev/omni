/**
 * Internal types for Container implementation
 *
 * @internal
 * @since 0.1.0
 */

import type {
  InjectionToken,
  ProviderDefinition,
  RegistrationOptions,
  Scope,
  IModule,
} from '../types.js';

/**
 * Registration metadata for container.
 * Stores information about how a dependency should be resolved.
 *
 * @internal
 * @since 0.1.0
 */
export interface Registration {
  token: InjectionToken<any>;
  provider: ProviderDefinition<any>;
  options: RegistrationOptions;
  scope: Scope;
  instance?: any;
  factory?: (...args: any[]) => any;
  dependencies?: InjectionToken<any>[];
  isAsync?: boolean;
}

/**
 * Module provider info for tracking module exports.
 *
 * @internal
 * @since 0.1.0
 */
export interface ModuleProviderInfo {
  token: InjectionToken<any>;
  exported: boolean;
  global: boolean;
}

/**
 * Options for resolving a module import.
 *
 * @internal
 * @since 0.1.0
 */
export interface ResolvedModule {
  module: IModule;
  isForwardRef: boolean;
}
