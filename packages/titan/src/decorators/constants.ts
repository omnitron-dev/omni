/**
 * Decorator Metadata Constants
 *
 * The keys the decorators in `core.ts` actually write, re-exported under the
 * names this module has always used, plus the few that only exist here.
 *
 * It used to declare its own values, and all twenty-one names it shares with
 * METADATA_KEYS disagreed with it — every single one. `INJECTABLE` was
 * 'titan:di:injectable' here and 'nexus:injectable' there; METHOD_AUTH was
 * 'titan:method:auth' against 'method:auth'. Since DECORATOR_METADATA is part
 * of this package's public surface, any consumer reading metadata through it
 * found nothing, for every key, with no error to show for it: two registries
 * for one thing, both looking canonical, and the decorators writing to only
 * one.
 *
 * Deriving the shared names removes the possibility rather than the instance.
 * The remaining entries — the `titan:inject:*` family read by
 * nexus/container/injection-plan.ts, and TypeScript's own `design:*` — have no
 * counterpart in METADATA_KEYS and keep their literals.
 *
 * @module decorators/constants
 */

import { METADATA_KEYS } from './core.js';

export const DECORATOR_METADATA = {
  // ============================================================================
  // DI Metadata (titan:di:*)
  // ============================================================================

  /**
   * Marks a class as injectable
   * @constant {string}
   */
  INJECTABLE: METADATA_KEYS.INJECTABLE,

  /**
   * Stores constructor parameter injection tokens
   * @constant {string}
   */
  CONSTRUCTOR_PARAMS: METADATA_KEYS.CONSTRUCTOR_PARAMS,

  /**
   * Stores property injection tokens
   * @constant {string}
   */
  PROPERTY_PARAMS: METADATA_KEYS.PROPERTY_PARAMS,

  /**
   * Stores method parameter injection tokens
   * @constant {string}
   */
  METHOD_PARAMS: METADATA_KEYS.METHOD_PARAMS,

  /**
   * Stores the scope of an injectable (singleton, transient, scoped, request)
   * @constant {string}
   */
  SCOPE: METADATA_KEYS.SCOPE,

  /**
   * Stores the injection token for a class
   * @constant {string}
   */
  TOKEN: METADATA_KEYS.TOKEN,

  /**
   * Marks a dependency as optional
   * @constant {string}
   */
  OPTIONAL: METADATA_KEYS.OPTIONAL,

  /**
   * Marks a parameter for multi-provider injection
   * @constant {string}
   */
  INJECT_ALL: METADATA_KEYS.INJECT_ALL,

  /**
   * Marks a class as a module
   * @constant {string}
   */
  MODULE: METADATA_KEYS.MODULE,

  /**
   * Marks a module or provider as global
   * @constant {string}
   */
  GLOBAL: METADATA_KEYS.GLOBAL,

  /**
   * Stores the service name
   * @constant {string}
   */
  SERVICE_NAME: METADATA_KEYS.SERVICE_NAME,

  // ============================================================================
  // Lifecycle Metadata (titan:lifecycle:*)
  // ============================================================================

  /**
   * Marks a method to be called after construction
   * @constant {string}
   */
  POST_CONSTRUCT: METADATA_KEYS.POST_CONSTRUCT,

  /**
   * Marks a method to be called before destruction
   * @constant {string}
   */
  PRE_DESTROY: METADATA_KEYS.PRE_DESTROY,

  // ============================================================================
  // Netron/Service Metadata (titan:service:*)
  // ============================================================================

  /**
   * Stores service annotation metadata
   * @constant {string}
   */
  SERVICE_ANNOTATION: METADATA_KEYS.SERVICE_ANNOTATION,

  /**
   * Marks a method as public in the service
   * @constant {string}
   */
  METHOD_ANNOTATION: METADATA_KEYS.METHOD_ANNOTATION,

  // ============================================================================
  // Method Configuration Metadata (titan:method:*)
  // ============================================================================

  /**
   * Stores method authentication configuration
   * @constant {string}
   */
  METHOD_AUTH: METADATA_KEYS.METHOD_AUTH,

  /**
   * Stores method rate limit configuration
   * @constant {string}
   */
  METHOD_RATE_LIMIT: METADATA_KEYS.METHOD_RATE_LIMIT,

  /**
   * Stores method cache configuration
   * @constant {string}
   */
  METHOD_CACHE: METADATA_KEYS.METHOD_CACHE,

  /**
   * Stores method prefetch configuration
   * @constant {string}
   */
  METHOD_PREFETCH: METADATA_KEYS.METHOD_PREFETCH,

  /**
   * Stores method audit configuration
   * @constant {string}
   */
  METHOD_AUDIT: METADATA_KEYS.METHOD_AUDIT,

  /**
   * Stores general method options
   * @constant {string}
   */
  METHOD_OPTIONS: METADATA_KEYS.METHOD_OPTIONS,

  // ============================================================================
  // Injection Metadata (titan:inject:*)
  // ============================================================================

  /**
   * Stores value injection configuration
   * @constant {string}
   */
  VALUES: 'titan:inject:values',

  /**
   * Stores environment variable injection configuration
   * @constant {string}
   */
  ENV: 'titan:inject:env',

  /**
   * Stores configuration injection paths
   * @constant {string}
   */
  CONFIG: 'titan:inject:config',

  /**
   * Stores conditional injection configuration
   * @constant {string}
   */
  CONDITIONAL: 'titan:inject:conditional',

  /**
   * Stores injection container reference
   * @constant {string}
   */
  CONTAINER: 'titan:inject:container',

  // ============================================================================
  // TypeScript Design Metadata (design:*)
  // ============================================================================

  /**
   * TypeScript design-time parameter types
   * @constant {string}
   */
  DESIGN_PARAMTYPES: 'design:paramtypes',

  /**
   * Custom parameter types (overrides design:paramtypes)
   * @constant {string}
   */
  DESIGN_PARAMTYPES_CUSTOM: 'design:paramtypes:custom',

  /**
   * TypeScript design-time return type
   * @constant {string}
   */
  DESIGN_RETURNTYPE: 'design:returntype',

  /**
   * TypeScript design-time property type
   * @constant {string}
   */
  DESIGN_TYPE: 'design:type',
} as const;

/**
 * Type for metadata key values
 */
export type DecoratorMetadataKey = (typeof DECORATOR_METADATA)[keyof typeof DECORATOR_METADATA];
