/**
 * Comprehensive error handling for Nexus DI Container
 * 
 * All errors are designed to be actionable - they tell developers
 * not just what went wrong, but HOW to fix the issue.
 */

import { getTokenName } from './token.js';
import { InjectionToken } from './types.js';
import { buildActionableMessage, formatSuggestions, DOC_LINKS } from '../errors/formatting.js';

/**
 * Base error class for all Nexus errors
 */
export abstract class NexusError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
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

  private static formatMessage(token: InjectionToken<any>, chain: InjectionToken<any>[], cause?: Error): string {
    const tokenName = getTokenName(token);
    const chainNames = chain.map((t) => getTokenName(t));
    
    // Determine the most likely issue and provide targeted suggestions
    const suggestions: string[] = [];
    
    if (cause) {
      // Factory or initialization error
      suggestions.push('Check the factory function or class constructor for errors');
      suggestions.push('Ensure all injected dependencies are available');
      if (cause.message.includes('async') || cause.message.includes('Promise')) {
        suggestions.push('For async providers, use resolveAsync() instead of resolve()');
      }
    } else {
      // Token not registered
      suggestions.push("Register the provider: container.register(" + tokenName + ", { useClass: " + tokenName + "Impl })");
      suggestions.push("Check import: import { " + tokenName + " } from './" + tokenName.toLowerCase() + "'");
      suggestions.push('Verify the module exports this provider');
      suggestions.push('If using a token, ensure the token is the same instance (not recreated)');
    }

    return buildActionableMessage({
      title: "Cannot resolve '" + tokenName + "'" + (cause ? ': Factory or initialization failed' : ': Token is not registered'),
      description: cause ? cause.message : 'The requested dependency was not found in the container or any parent containers.',
      context: {
        'Token': tokenName,
        'Chain length': chainNames.length > 0 ? String(chainNames.length) : undefined,
      },
      chain: chainNames.length > 0 ? chainNames : undefined,
      suggestions,
      docLink: DOC_LINKS.DI_PROVIDERS,
    });
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
    const chainNames = chain.map((t) => getTokenName(t));
    const circular = chainNames[chainNames.length - 1] ?? 'unknown';
    const cycleStart = chainNames.indexOf(circular);
    const cyclePath = chainNames.slice(cycleStart).concat(circular);

    return buildActionableMessage({
      title: "Circular dependency detected: " + circular,
      description: "The dependency chain forms a cycle: " + cyclePath.join(' -> '),
      chain: chainNames,
      suggestions: [
        'Break the cycle by extracting shared logic into a separate service',
        'Use lazy injection: inject(() => container.resolve(Token)) in the factory',
        'Consider using property injection instead of constructor injection for one of the dependencies',
        'Use the forwardRef() helper to defer resolution',
        'Review if both services really need to depend on each other - often one direction can be removed',
      ],
      docLink: DOC_LINKS.DI_CIRCULAR_DEPS,
    });
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
    const tokenName = getTokenName(token);
    const message = buildActionableMessage({
      title: "Failed to register '" + tokenName + "'",
      description: reason,
      context: {
        'Token': tokenName,
      },
      suggestions: [
        'Ensure the provider definition is valid (useClass, useValue, useFactory, or useToken)',
        'Check that the class exists and is properly exported',
        'Verify constructor parameters are correctly decorated with @Inject()',
      ],
      docLink: DOC_LINKS.DI_PROVIDERS,
    });
    super(message, 'REGISTRATION_ERROR');
  }
}

/**
 * Error thrown when a token is already registered
 */
export class DuplicateRegistrationError extends NexusError {
  constructor(public readonly token: InjectionToken<any>) {
    const tokenName = getTokenName(token);
    const message = buildActionableMessage({
      title: "Token '" + tokenName + "' is already registered",
      description: 'A provider for this token has already been registered in the container.',
      context: {
        'Token': tokenName,
      },
      suggestions: [
        'Use container.register(token, provider, { override: true }) to replace the existing registration',
        'Check if this token is registered in a parent container or imported module',
        'Consider using a multi-token if you need multiple implementations',
        'Use createToken() to create a unique token if this is a different service',
      ],
    });
    super(message, 'DUPLICATE_REGISTRATION');
  }
}

/**
 * Error thrown when a required dependency is not found
 */
export class DependencyNotFoundError extends NexusError {
  constructor(
    public readonly token: InjectionToken<any>,
    public readonly dependent?: InjectionToken<any>,
    public readonly availableTokens?: string[]
  ) {
    const tokenName = getTokenName(token);
    const dependentName = dependent ? getTokenName(dependent) : undefined;
    
    const suggestions: string[] = [
      "Register the provider: container.register(" + tokenName + ", { useClass: " + tokenName + " })",
      "Check import: import { " + tokenName + " } from './" + tokenName.toLowerCase() + "'",
    ];
    
    if (dependentName) {
      suggestions.push("Verify that '" + dependentName + "' has the correct dependencies listed");
    }
    
    suggestions.push('If this is an optional dependency, use @Optional() decorator or createOptionalToken()');
    suggestions.push('Check that the module providing this token is imported');

    const message = buildActionableMessage({
      title: "Dependency '" + tokenName + "' not found",
      description: dependentName 
        ? "The service '" + dependentName + "' requires '" + tokenName + "' but it is not registered."
        : "The requested dependency '" + tokenName + "' is not registered in the container.",
      context: {
        'Missing token': tokenName,
        'Required by': dependentName,
      },
      availableItems: availableTokens && availableTokens.length > 0 
        ? { label: 'Available tokens (did you mean one of these?)', items: availableTokens }
        : undefined,
      suggestions,
      docLink: DOC_LINKS.DI_GETTING_STARTED,
    });
    
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
    const tokenName = getTokenName(token);
    const message = buildActionableMessage({
      title: "Scope mismatch for '" + tokenName + "'",
      description: "Expected scope '" + expectedScope + "' but the provider is registered with scope '" + actualScope + "'.",
      context: {
        'Token': tokenName,
        'Expected scope': expectedScope,
        'Actual scope': actualScope,
      },
      suggestions: [
        "Change the provider registration to use scope: '" + expectedScope + "'",
        'Create a scoped container using container.createScope() for request-scoped dependencies',
        'Review scope hierarchy: Singleton -> Scoped -> Transient (inner scopes cannot depend on outer)',
      ],
      docLink: DOC_LINKS.DI_SCOPES,
    });
    super(message, 'SCOPE_MISMATCH');
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
    const tokenName = token ? getTokenName(token) : 'Unknown';
    const message = buildActionableMessage({
      title: "Invalid provider for '" + tokenName + "'",
      description: reason,
      context: {
        'Token': tokenName,
      },
      suggestions: [
        'Provider must include exactly one of: useClass, useValue, useFactory, or useToken',
        'For useClass: ensure it is a valid constructor function',
        'For useFactory: ensure it is a function that returns the desired value',
        'For useValue: any value is valid (including undefined)',
        'For useToken: provide another token to alias',
      ],
      docLink: DOC_LINKS.DI_PROVIDERS,
    });
    super(message, 'INVALID_PROVIDER');
  }
}

/**
 * Error thrown when async resolution is used incorrectly
 */
export class AsyncResolutionError extends NexusError {
  constructor(public readonly token: InjectionToken<any>) {
    const tokenName = getTokenName(token);
    const message = buildActionableMessage({
      title: "Token '" + tokenName + "' requires async resolution",
      description: 'This provider uses an async factory or has async dependencies. Synchronous resolve() cannot be used.',
      context: {
        'Token': tokenName,
      },
      suggestions: [
        'Use await container.resolveAsync(' + tokenName + ') instead of container.resolve()',
        'Or change the provider to a synchronous factory if possible',
        'For module initialization, use async onModuleInit() lifecycle hook',
        'Consider if the dependency truly needs to be async - sometimes sync alternatives exist',
      ],
      docLink: DOC_LINKS.DI_ASYNC,
    });
    super(message, 'ASYNC_RESOLUTION_ERROR');
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
    const tokenName = getTokenName(token);
    const message = buildActionableMessage({
      title: "Failed to dispose '" + tokenName + "'",
      description: cause.message,
      context: {
        'Token': tokenName,
        'Error type': cause.name,
      },
      suggestions: [
        'Check the onDestroy() or dispose() method for errors',
        'Ensure cleanup logic handles edge cases (already closed connections, etc.)',
        'Consider wrapping cleanup logic in try-catch and logging instead of throwing',
        'Disposal errors are often non-critical - consider if they should be warnings instead',
      ],
    });
    super(message, 'DISPOSAL_ERROR');
  }
}

/**
 * Error thrown when a module operation fails
 */
export class ModuleError extends NexusError {
  constructor(
    public readonly moduleName: string,
    public readonly operation: string,
    public readonly reason: string,
    public readonly availableModules?: string[]
  ) {
    const suggestions: string[] = [];
    
    if (operation === 'import') {
      suggestions.push('Ensure the module is exported from its source file');
      suggestions.push('Check that the module name matches exactly (case-sensitive)');
      suggestions.push('Verify the module path is correct in the imports array');
    } else if (operation === 'load') {
      suggestions.push('Check module providers for configuration errors');
      suggestions.push('Verify all module dependencies are available');
      suggestions.push('Ensure required modules are listed in the "requires" array');
    } else {
      suggestions.push('Review the module configuration');
      suggestions.push('Check for circular module dependencies');
    }

    const message = buildActionableMessage({
      title: "Module '" + moduleName + "' " + operation + " failed",
      description: reason,
      context: {
        'Module': moduleName,
        'Operation': operation,
      },
      availableItems: availableModules && availableModules.length > 0
        ? { label: 'Available modules', items: availableModules }
        : undefined,
      suggestions,
      docLink: DOC_LINKS.DI_MODULES,
    });
    super(message, 'MODULE_ERROR');
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
    const tokenName = getTokenName(token);
    const message = buildActionableMessage({
      title: "Failed to initialize '" + tokenName + "'",
      description: cause.message,
      context: {
        'Token': tokenName,
        'Error type': cause.name,
      },
      suggestions: [
        'Check the onInit() or initialize() method for errors',
        'Ensure all required configuration is available during initialization',
        'Verify external dependencies (databases, APIs) are accessible',
        'Consider using async initialization with onModuleInit() if setup is async',
      ],
    });
    super(message, 'INITIALIZATION_ERROR');
  }
}

/**
 * Error thrown when container is already disposed
 */
export class ContainerDisposedError extends NexusError {
  constructor() {
    const message = buildActionableMessage({
      title: 'Container has been disposed',
      description: 'Cannot perform operations on a disposed container. Once disposed, the container cannot be reused.',
      suggestions: [
        'Create a new Container instance if you need to continue',
        'Ensure disposal happens at the end of application lifecycle',
        'Check for race conditions where dispose() may be called prematurely',
        'If using scoped containers, create a new scope for each request',
      ],
    });
    super(message, 'CONTAINER_DISPOSED');
  }
}

/**
 * Error thrown when a token is not injectable
 */
export class NotInjectableError extends NexusError {
  constructor(public readonly target: any) {
    const name = target?.name || target?.constructor?.name || 'Unknown';
    const message = buildActionableMessage({
      title: "Class '" + name + "' is not injectable",
      description: 'The class must be decorated with @Injectable() or registered explicitly with the container.',
      context: {
        'Class': name,
      },
      suggestions: [
        "Add the @Injectable() decorator: @Injectable() export class " + name + " { }",
        "Or register explicitly: container.register(" + name + ", { useClass: " + name + " })",
        'If using TypeScript, ensure "emitDecoratorMetadata" is enabled in tsconfig.json',
        'Verify reflect-metadata is imported at the application entry point',
      ],
    });
    super(message, 'NOT_INJECTABLE');
  }
}

/**
 * Error aggregator for multiple errors
 */
export class AggregateError extends NexusError {
  constructor(public readonly errors: Error[]) {
    const errorSummaries = errors.map((e, i) => '  ' + (i + 1) + '. [' + e.name + '] ' + e.message.split('\n')[0]);
    const message = buildActionableMessage({
      title: 'Multiple errors occurred (' + errors.length + ' total)',
      description: errorSummaries.join('\n'),
      suggestions: [
        'Address each error individually - they may be related',
        'Start with the first error as later errors may be caused by it',
        'Check for common causes like missing configuration or imports',
      ],
    });
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
    if (process.env['NODE_ENV'] === 'development' && error.stack) {
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
