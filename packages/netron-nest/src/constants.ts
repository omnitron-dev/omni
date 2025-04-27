/**
 * Dependency Injection (DI) tokens for Netron integration with NestJS.
 * 
 * @description
 * These constants serve as unique identifiers for dependency injection tokens
 * used throughout the Netron-NestJS integration. They enable type-safe injection
 * of Netron configuration and instance into various application components.
 * 
 * @remarks
 * The tokens are implemented using JavaScript Symbols to ensure uniqueness
 * and prevent potential naming collisions in the dependency injection container.
 * They are used in conjunction with NestJS's @Inject() decorator to provide
 * proper dependency resolution and type checking.
 */

/**
 * Token for injecting Netron configuration options.
 * 
 * @description
 * A unique symbol used as a token for injecting NetronOptions configuration
 * into NestJS components. This token is used to provide runtime configuration
 * for Netron node behavior, including network settings, timeouts, and service
 * discovery parameters.
 * 
 * @remarks
 * This token is typically used with the @Inject() decorator to inject
 * configuration options into modules and services that require Netron
 * configuration access.
 */
export const NETRON_OPTIONS = Symbol('NETRON_OPTIONS');

/**
 * Token for injecting the Netron instance.
 * 
 * @description
 * A unique symbol used as a token for injecting the Netron instance into
 * NestJS components. This token provides access to the Netron runtime
 * instance, enabling distributed service communication and task execution.
 * 
 * @remarks
 * This token is used with the @InjectNetron() decorator to provide
 * type-safe access to the Netron instance throughout the application.
 * The instance is typically a singleton managed by the NestJS dependency
 * injection container.
 */
export const NETRON_INSTANCE = Symbol('NETRON_INSTANCE');
