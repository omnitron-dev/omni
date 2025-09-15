/**
 * Comprehensive error handling for Nexus DI Container
 */

import { getTokenName } from '../token/token';
import { InjectionToken } from '../types/core';

/**
 * Base error class for all Nexus errors
 */
export abstract class NexusError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when a dependency cannot be resolved
 */
export class ResolutionError extends NexusError {
  constructor(
    public readonly token: InjectionToken<any>,
    public readonly chain: InjectionToken<any>[] = [],
    public override readonly cause?: Error
  ) {
    super(ResolutionError.formatMessage(token, chain, cause), 'RESOLUTION_ERROR');
  }

  private static formatMessage(
    token: InjectionToken<any>,
    chain: InjectionToken<any>[],
    cause?: Error
  ): string {
    const tokenName = getTokenName(token);
    const chainStr = chain.length > 0
      ? chain.map(t => `  → ${getTokenName(t)}`).join('\n')
      : '  (no dependency chain)';

    return `
Failed to resolve: ${tokenName}

Resolution chain:
${chainStr}

${cause ? `Cause: ${cause.message}` : 'Token not registered in container'}

Suggestions:
• Check if '${tokenName}' is registered in the container
• Verify all dependencies are properly registered
• Look for circular dependencies in the resolution chain
• If using async providers, use resolveAsync() instead of resolve()
• Check if the token scope matches the resolution context
    `.trim();
  }
}

/**
 * Error thrown when a circular dependency is detected
 */
export class CircularDependencyError extends NexusError {
  constructor(public readonly chain: InjectionToken<any>[]) {
    super(CircularDependencyError.formatMessage(chain), 'CIRCULAR_DEPENDENCY');
  }

  private static formatMessage(chain: InjectionToken<any>[]): string {
    const chainStr = chain.map(t => `  → ${getTokenName(t)}`).join('\n');
    const circular = getTokenName(chain[chain.length - 1]);

    return `
Circular dependency detected: ${circular}

Dependency chain:
${chainStr}
  → ${circular} (circular reference)

Suggestions:
• Refactor to break the circular dependency
• Use lazy loading with factory providers
• Consider using property injection instead of constructor injection
• Use interfaces or abstract classes to invert dependencies
    `.trim();
  }
}

/**
 * Error thrown when registration fails
 */
export class RegistrationError extends NexusError {
  constructor(
    public readonly token: InjectionToken<any>,
    public readonly reason: string
  ) {
    super(
      `Failed to register '${getTokenName(token)}': ${reason}`,
      'REGISTRATION_ERROR'
    );
  }
}

/**
 * Error thrown when a token is already registered
 */
export class DuplicateRegistrationError extends NexusError {
  constructor(public readonly token: InjectionToken<any>) {
    super(
      `Token '${getTokenName(token)}' is already registered. Use replace() to override.`,
      'DUPLICATE_REGISTRATION'
    );
  }
}

/**
 * Error thrown when a required dependency is not found
 */
export class DependencyNotFoundError extends NexusError {
  constructor(
    public readonly token: InjectionToken<any>,
    public readonly dependent?: InjectionToken<any>
  ) {
    const message = dependent
      ? `Dependency '${getTokenName(token)}' required by '${getTokenName(dependent)}' not found`
      : `Dependency '${getTokenName(token)}' not found`;
    
    super(message, 'DEPENDENCY_NOT_FOUND');
  }
}

/**
 * Error thrown when a scope mismatch occurs
 */
export class ScopeMismatchError extends NexusError {
  constructor(
    public readonly token: InjectionToken<any>,
    public readonly expectedScope: string,
    public readonly actualScope: string
  ) {
    super(
      `Scope mismatch for '${getTokenName(token)}': expected '${expectedScope}' but got '${actualScope}'`,
      'SCOPE_MISMATCH'
    );
  }
}

/**
 * Error thrown when a provider is invalid
 */
export class InvalidProviderError extends NexusError {
  constructor(
    public readonly token: InjectionToken<any>,
    public readonly reason: string
  ) {
    super(
      `Invalid provider for '${getTokenName(token)}': ${reason}`,
      'INVALID_PROVIDER'
    );
  }
}

/**
 * Error thrown when async resolution is used incorrectly
 */
export class AsyncResolutionError extends NexusError {
  constructor(public readonly token: InjectionToken<any>) {
    super(
      `Token '${getTokenName(token)}' is registered as async. Use resolveAsync() instead of resolve().`,
      'ASYNC_RESOLUTION_ERROR'
    );
  }
}

/**
 * Error thrown when disposal fails
 */
export class DisposalError extends NexusError {
  constructor(
    public readonly token: InjectionToken<any>,
    public override readonly cause: Error
  ) {
    super(
      `Failed to dispose '${getTokenName(token)}': ${cause.message}`,
      'DISPOSAL_ERROR'
    );
  }
}

/**
 * Error thrown when a module operation fails
 */
export class ModuleError extends NexusError {
  constructor(
    public readonly moduleName: string,
    public readonly operation: string,
    public readonly reason: string
  ) {
    super(
      `Module '${moduleName}' ${operation} failed: ${reason}`,
      'MODULE_ERROR'
    );
  }
}

/**
 * Error thrown when initialization fails
 */
export class InitializationError extends NexusError {
  constructor(
    public readonly token: InjectionToken<any>,
    public override readonly cause: Error
  ) {
    super(
      `Failed to initialize '${getTokenName(token)}': ${cause.message}`,
      'INITIALIZATION_ERROR'
    );
  }
}

/**
 * Error thrown when container is already disposed
 */
export class ContainerDisposedError extends NexusError {
  constructor() {
    super(
      'Container has been disposed and cannot be used',
      'CONTAINER_DISPOSED'
    );
  }
}

/**
 * Error thrown when a token is not injectable
 */
export class NotInjectableError extends NexusError {
  constructor(public readonly target: any) {
    const name = target?.name || target?.constructor?.name || 'Unknown';
    super(
      `Class '${name}' is not injectable. Ensure it's decorated with @Injectable() or registered explicitly.`,
      'NOT_INJECTABLE'
    );
  }
}

/**
 * Error aggregator for multiple errors
 */
export class AggregateError extends NexusError {
  constructor(public readonly errors: Error[]) {
    const message = `Multiple errors occurred:\n${errors.map((e, i) => `  ${i + 1}. ${e.message}`).join('\n')}`;
    super(message, 'AGGREGATE_ERROR');
  }
}

/**
 * Helper to determine if an error is a Nexus error
 */
export function isNexusError(error: any): error is NexusError {
  return error instanceof NexusError;
}

/**
 * Helper to extract root cause from error chain
 */
export function getRootCause(error: Error): Error {
  let current = error;
  while ((current as any).cause) {
    current = (current as any).cause;
  }
  return current;
}

/**
 * Error handler for better error reporting
 */
export class ErrorHandler {
  private static handlers = new Map<string, (error: NexusError) => void>();

  /**
   * Register a custom error handler
   */
  static register(code: string, handler: (error: NexusError) => void): void {
    this.handlers.set(code, handler);
  }

  /**
   * Handle an error
   */
  static handle(error: Error): void {
    if (isNexusError(error)) {
      const handler = this.handlers.get(error.code);
      if (handler) {
        handler(error);
        return;
      }
    }

    // Default handling
    console.error('[Nexus Error]', error.message);
    if (process.env.NODE_ENV === 'development' && error.stack) {
      console.error(error.stack);
    }
  }

  /**
   * Clear all handlers
   */
  static clear(): void {
    this.handlers.clear();
  }
}