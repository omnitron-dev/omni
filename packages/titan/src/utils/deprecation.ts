/**
 * Deprecation utilities for managing API transitions in Titan
 *
 * Provides tools for:
 * - Runtime deprecation warnings
 * - Creating deprecated aliases
 * - Decorator-based deprecation
 * - Migration guide generation
 *
 * @packageDocumentation
 * @since 0.1.0
 */

import type { ILogger } from '../modules/logger/logger.types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Entry in the deprecation registry
 *
 * @stable
 * @since 0.1.0
 */
export interface DeprecationEntry {
  /** The old/deprecated name or path */
  old: string;
  /** The new/replacement name or path */
  new: string;
  /** Version when deprecation was introduced */
  since: string;
  /** Version when the deprecated API will be removed */
  removeIn: string;
  /** Additional migration notes */
  notes?: string;
}

/**
 * Options for deprecation warnings
 *
 * @stable
 * @since 0.1.0
 */
export interface DeprecationOptions {
  /** Only log in non-production environments */
  devOnly?: boolean;
  /** Log stack trace */
  showStack?: boolean;
  /** Custom logger function (legacy) or ILogger instance */
  logger?: ((message: string) => void) | ILogger;
}

// ============================================================================
// State Management
// ============================================================================

/** Track which deprecations have already been warned about (warn once) */
const warnedDeprecations = new Set<string>();

/** Global deprecation options */
let globalOptions: DeprecationOptions = {
  devOnly: true,
  showStack: false,
};

/**
 * Configure global deprecation behavior
 *
 * @param options - Global options for deprecation warnings
 *
 * @stable
 * @since 0.1.0
 */
export function configureDeprecation(options: Partial<DeprecationOptions>): void {
  globalOptions = { ...globalOptions, ...options };
}

/**
 * Reset the warned deprecations set (useful for testing)
 *
 * @internal
 * @since 0.1.0
 */
export function resetDeprecationWarnings(): void {
  warnedDeprecations.clear();
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Emit a deprecation warning at runtime
 *
 * Only logs once per unique deprecation to avoid spam.
 * Respects NODE_ENV to suppress warnings in production.
 *
 * @param oldName - The deprecated API name
 * @param newName - The replacement API name
 * @param removeVersion - Version when deprecated API will be removed
 * @param options - Optional configuration
 *
 * @example
 * ```typescript
 * function oldMethod() {
 *   deprecate('oldMethod', 'newMethod', '1.0.0');
 *   return newMethod();
 * }
 * ```
 *
 * @stable
 * @since 0.1.0
 */
export function deprecate(
  oldName: string,
  newName: string,
  removeVersion: string = '1.0.0',
  options?: DeprecationOptions
): void {
  const opts = { ...globalOptions, ...options };

  // Skip in production if devOnly is true
  if (opts.devOnly && process.env['NODE_ENV'] === 'production') {
    return;
  }

  // Only warn once per deprecation
  const key = `${oldName}:${newName}`;
  if (warnedDeprecations.has(key)) {
    return;
  }
  warnedDeprecations.add(key);

  const message =
    `[Titan] DEPRECATION: "${oldName}" is deprecated. ` +
    `Use "${newName}" instead. Will be removed in v${removeVersion}.`;

  const logger = opts.logger;
  const stack = opts.showStack ? new Error().stack?.split('\n').slice(2).join('\n') : undefined;

  if (logger && typeof logger === 'object' && 'warn' in logger) {
    // ILogger instance
    const logContext: Record<string, any> = {
      deprecation: true,
      old: oldName,
      new: newName,
      removeVersion,
    };
    if (stack) {
      logContext['stack'] = stack;
    }
    logger.warn(logContext, message);
  } else if (logger && typeof logger === 'function') {
    // Legacy function logger
    if (stack) {
      logger(`${message}\n${stack}`);
    } else {
      logger(message);
    }
  }
}

/**
 * Create a deprecated alias that warns on first use
 *
 * Uses a Proxy to intercept access and log a deprecation warning
 * on first usage, then delegates to the original.
 *
 * @param original - The original value/class/function to alias
 * @param oldName - The deprecated name
 * @param newName - The new/replacement name
 * @param removeVersion - Version when deprecated alias will be removed
 * @returns A proxy that warns on first use then delegates to original
 *
 * @example
 * ```typescript
 * // Creating a deprecated class alias
 * export const TitanApplication = createDeprecatedAlias(
 *   Application,
 *   'TitanApplication',
 *   'Application',
 *   '1.0.0'
 * );
 *
 * // Creating a deprecated constant alias
 * export const FEATURES = createDeprecatedAlias(
 *   APP_FEATURES,
 *   'FEATURES',
 *   'APP_FEATURES',
 *   '1.0.0'
 * );
 * ```
 *
 * @stable
 * @since 0.1.0
 */
export function createDeprecatedAlias<T>(
  original: T,
  oldName: string,
  newName: string,
  removeVersion: string = '1.0.0'
): T {
  // Track if we've warned for this specific alias
  let hasWarned = false;

  const warn = () => {
    if (!hasWarned) {
      hasWarned = true;
      deprecate(oldName, newName, removeVersion);
    }
  };

  // Handle primitives and non-objects
  if (original === null || (typeof original !== 'object' && typeof original !== 'function')) {
    // For primitives, we can't use Proxy, so we just warn and return
    warn();
    return original;
  }

  // For functions (including classes), create a callable proxy
  if (typeof original === 'function') {
    const handler: ProxyHandler<T & ((...args: any[]) => any)> = {
      apply(target, thisArg, args) {
        warn();
        return Reflect.apply(target as (...args: any[]) => any, thisArg, args);
      },
      construct(target, args, newTarget) {
        warn();
        return Reflect.construct(target as new (...args: any[]) => any, args, newTarget);
      },
      get(target, prop, receiver) {
        warn();
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        warn();
        return Reflect.set(target, prop, value, receiver);
      },
    };

    return new Proxy(original as T & ((...args: any[]) => any), handler) as T;
  }

  // For objects, create a proxy that warns on any property access
  const handler: ProxyHandler<object> = {
    get(target, prop, receiver) {
      warn();
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      warn();
      return Reflect.set(target, prop, value, receiver);
    },
    has(target, prop) {
      warn();
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      warn();
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, prop) {
      warn();
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  };

  return new Proxy(original as object, handler) as T;
}

// ============================================================================
// Decorators
// ============================================================================

/**
 * Decorator to mark a class or method as deprecated
 *
 * Logs a warning on first instantiation (for classes) or first call (for methods).
 *
 * @param replacement - Optional replacement suggestion
 * @param removeVersion - Version when this will be removed
 * @returns A decorator function for classes and methods
 *
 * @example
 * ```typescript
 * // Deprecate a class
 * @Deprecated('NewService', '1.0.0')
 * class OldService {
 *   // ...
 * }
 *
 * // Deprecate a method
 * class MyService {
 *   @Deprecated('doSomethingNew', '1.0.0')
 *   doSomething() {
 *     return this.doSomethingNew();
 *   }
 * }
 * ```
 *
 * @stable
 * @since 0.1.0
 */
export function Deprecated(
  replacement?: string,
  removeVersion: string = '1.0.0'
): ClassDecorator & MethodDecorator & PropertyDecorator {
  return function <T>(
    target: object | (new (...args: any[]) => T),
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<any>
  ): any {
    // Method decorator
    if (propertyKey !== undefined && descriptor?.value !== undefined) {
      const originalMethod = descriptor.value as (...args: any[]) => any;
      const methodName = String(propertyKey);
      let hasWarned = false;

      descriptor.value = function (this: any, ...args: any[]): any {
        if (!hasWarned) {
          hasWarned = true;
          const className = this?.constructor?.name || 'Unknown';
          const oldName = `${className}.${methodName}`;
          const newName = replacement
            ? `${className}.${replacement}`
            : `an alternative method`;
          deprecate(oldName, newName, removeVersion);
        }
        return originalMethod.apply(this, args);
      };

      return descriptor;
    }

    // Property decorator (getter/setter)
    if (propertyKey !== undefined && descriptor && (descriptor.get || descriptor.set)) {
      const propName = String(propertyKey);
      let hasWarned = false;

      const warn = (instance: any) => {
        if (!hasWarned) {
          hasWarned = true;
          const className = instance?.constructor?.name || 'Unknown';
          const oldName = `${className}.${propName}`;
          const newName = replacement
            ? `${className}.${replacement}`
            : `an alternative property`;
          deprecate(oldName, newName, removeVersion);
        }
      };

      if (descriptor.get) {
        const originalGet = descriptor.get;
        descriptor.get = function (this: any) {
          warn(this);
          return originalGet.call(this);
        };
      }

      if (descriptor.set) {
        const originalSet = descriptor.set;
        descriptor.set = function (this: any, value: any) {
          warn(this);
          return originalSet.call(this, value);
        };
      }

      return descriptor;
    }

    // Class decorator
    if (typeof target === 'function') {
      const OriginalClass = target as new (...args: any[]) => T;
      const className = OriginalClass.name;
      let hasWarned = false;

      // Create a new class that extends the original
      const DeprecatedClass = class extends (OriginalClass as any) {
        constructor(...args: any[]) {
          if (!hasWarned) {
            hasWarned = true;
            const newName = replacement || 'an alternative class';
            deprecate(className, newName, removeVersion);
          }
          super(...args);
        }
      };

      // Preserve the original class name
      Object.defineProperty(DeprecatedClass, 'name', {
        value: className,
        writable: false,
      });

      // Copy static properties
      for (const key of Object.getOwnPropertyNames(OriginalClass)) {
        if (key !== 'length' && key !== 'name' && key !== 'prototype') {
          const descriptor = Object.getOwnPropertyDescriptor(OriginalClass, key);
          if (descriptor) {
            Object.defineProperty(DeprecatedClass, key, descriptor);
          }
        }
      }

      return DeprecatedClass as unknown as typeof target;
    }

    // Property decorator without descriptor (field decorator)
    // This case is less common and harder to intercept without experimental decorators
    return undefined;
  } as ClassDecorator & MethodDecorator & PropertyDecorator;
}

// ============================================================================
// Deprecation Registry
// ============================================================================

/**
 * Registry of all deprecated APIs in Titan
 *
 * This list is used for generating migration guides and tracking
 * API changes over time.
 *
 * @stable
 * @since 0.1.0
 */
export const DEPRECATIONS: DeprecationEntry[] = [
  {
    old: 'TitanApplication',
    new: 'Application',
    since: '0.1.0',
    removeIn: '1.0.0',
    notes: 'The class has been renamed for brevity. Import from "@omnitron-dev/titan".',
  },
  {
    old: 'Public',
    new: 'Method',
    since: '0.1.0',
    removeIn: '1.0.0',
    notes:
      'The @Public decorator has been renamed to @Method for clarity. ' +
      'Import from "@omnitron-dev/titan/decorators".',
  },
  {
    old: 'IOnInit',
    new: 'OnInit',
    since: '0.1.0',
    removeIn: '1.0.0',
    notes:
      'Interface naming convention changed. The "I" prefix has been dropped. ' +
      'Import from "@omnitron-dev/titan".',
  },
  {
    old: 'IOnDestroy',
    new: 'OnDestroy',
    since: '0.1.0',
    removeIn: '1.0.0',
    notes:
      'Interface naming convention changed. The "I" prefix has been dropped. ' +
      'Import from "@omnitron-dev/titan".',
  },
  {
    old: 'FEATURES',
    new: 'APP_FEATURES',
    since: '0.1.0',
    removeIn: '1.0.0',
    notes:
      'Renamed for clarity to indicate these are application-level features. ' +
      'Import from "@omnitron-dev/titan".',
  },
];

// ============================================================================
// Migration Guide Generator
// ============================================================================

/**
 * Generate a markdown migration guide from the deprecation registry
 *
 * @param deprecations - Array of deprecation entries (defaults to DEPRECATIONS)
 * @returns Markdown formatted migration guide
 *
 * @example
 * ```typescript
 * const guide = generateMigrationGuide();
 * fs.writeFileSync('MIGRATION.md', guide);
 * ```
 *
 * @stable
 * @since 0.1.0
 */
export function generateMigrationGuide(deprecations: DeprecationEntry[] = DEPRECATIONS): string {
  const lines: string[] = [
    '# Titan Migration Guide',
    '',
    'This guide documents deprecated APIs and their replacements.',
    '',
    '## Deprecation Summary',
    '',
    '| Deprecated | Replacement | Since | Remove In |',
    '|------------|-------------|-------|-----------|',
  ];

  // Add summary table
  for (const entry of deprecations) {
    lines.push(`| \`${entry.old}\` | \`${entry.new}\` | ${entry.since} | ${entry.removeIn} |`);
  }

  lines.push('', '## Detailed Migration Steps', '');

  // Add detailed sections
  for (const entry of deprecations) {
    lines.push(`### \`${entry.old}\` -> \`${entry.new}\``);
    lines.push('');
    lines.push(`**Deprecated since:** v${entry.since}`);
    lines.push(`**Will be removed in:** v${entry.removeIn}`);
    lines.push('');

    if (entry.notes) {
      lines.push(entry.notes);
      lines.push('');
    }

    lines.push('**Before:**');
    lines.push('```typescript');
    lines.push(`import { ${entry.old} } from '@omnitron-dev/titan';`);
    lines.push('```');
    lines.push('');
    lines.push('**After:**');
    lines.push('```typescript');
    lines.push(`import { ${entry.new} } from '@omnitron-dev/titan';`);
    lines.push('```');
    lines.push('');
  }

  lines.push('## Suppressing Deprecation Warnings');
  lines.push('');
  lines.push('To suppress deprecation warnings in production, ensure `NODE_ENV=production` is set.');
  lines.push('');
  lines.push('To customize deprecation behavior:');
  lines.push('');
  lines.push('```typescript');
  lines.push("import { configureDeprecation } from '@omnitron-dev/titan/utils';");
  lines.push('');
  lines.push('configureDeprecation({');
  lines.push('  devOnly: true,     // Only log in non-production (default: true)');
  lines.push('  showStack: false,  // Show stack trace (default: false)');
  lines.push('  logger: console.warn, // Custom logger function');
  lines.push('});');
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

/**
 * Find deprecation entry by old name
 *
 * @param oldName - The deprecated API name to look up
 * @returns The deprecation entry if found
 *
 * @stable
 * @since 0.1.0
 */
export function findDeprecation(oldName: string): DeprecationEntry | undefined {
  return DEPRECATIONS.find((entry) => entry.old === oldName);
}

/**
 * Check if an API is deprecated
 *
 * @param name - The API name to check
 * @returns True if the API is deprecated
 *
 * @stable
 * @since 0.1.0
 */
export function isDeprecated(name: string): boolean {
  return DEPRECATIONS.some((entry) => entry.old === name);
}

/**
 * Get the replacement for a deprecated API
 *
 * @param oldName - The deprecated API name
 * @returns The replacement name, or undefined if not deprecated
 *
 * @stable
 * @since 0.1.0
 */
export function getReplacement(oldName: string): string | undefined {
  return findDeprecation(oldName)?.new;
}
