/**
 * Custom Formatters - Chrome DevTools custom object formatters
 *
 * Provides custom formatters for Aether reactive primitives in Chrome DevTools
 * console for better debugging experience.
 *
 * @module devtools/formatter
 */

import type { Signal, WritableSignal } from '../core/reactivity/types.js';

/**
 * Chrome DevTools formatter API types
 */
interface Formatter {
  header: (obj: any, config?: any) => any[] | null;
  hasBody: (obj: any, config?: any) => boolean;
  body: (obj: any, config?: any) => any[] | null;
}

/**
 * Check if custom formatters are supported
 */
export function isFormatterSupported(): boolean {
  return typeof window !== 'undefined' && 'devtoolsFormatters' in window;
}

/**
 * Install custom formatters
 *
 * Call this once during app initialization to enable custom formatters.
 *
 * @example
 * ```typescript
 * if (import.meta.env.DEV) {
 *   installFormatters();
 * }
 * ```
 */
export function installFormatters(): void {
  if (!isFormatterSupported()) {
    console.warn('[Aether DevTools] Custom formatters not supported in this browser');
    return;
  }

  // Get or create formatters array
  const win = window as any;
  if (!win.devtoolsFormatters) {
    win.devtoolsFormatters = [];
  }

  // Add Aether formatters
  win.devtoolsFormatters.push(signalFormatter);
  win.devtoolsFormatters.push(storeFormatter);
  win.devtoolsFormatters.push(componentFormatter);

  console.log('[Aether DevTools] Custom formatters installed');
}

/**
 * Uninstall custom formatters
 */
export function uninstallFormatters(): void {
  if (!isFormatterSupported()) return;

  const win = window as any;
  if (!win.devtoolsFormatters) return;

  // Remove Aether formatters
  win.devtoolsFormatters = win.devtoolsFormatters.filter(
    (f: Formatter) => f !== signalFormatter && f !== storeFormatter && f !== componentFormatter,
  );
}

/**
 * Check if value is a Signal
 */
function isSignal(obj: any): boolean {
  return (
    obj != null &&
    typeof obj === 'function' &&
    typeof obj.peek === 'function' &&
    typeof obj.subscribe === 'function'
  );
}

/**
 * Check if value is a WritableSignal
 */
function isWritableSignal(obj: any): boolean {
  return isSignal(obj) && typeof obj.set === 'function';
}

/**
 * Signal formatter
 */
const signalFormatter: Formatter = {
  header(obj: any): any[] | null {
    if (!isSignal(obj)) return null;

    const value = obj.peek();
    const isWritable = isWritableSignal(obj);
    const type = isWritable ? 'WritableSignal' : 'Signal';

    return [
      'span',
      { style: 'color: #0066cc; font-weight: bold' },
      [
        'span',
        {},
        `${type} `,
        ['span', { style: 'color: #666' }, '{ '],
        formatValue(value),
        ['span', { style: 'color: #666' }, ' }'],
      ],
    ];
  },

  hasBody(obj: any): boolean {
    return isSignal(obj);
  },

  body(obj: any): any[] | null {
    if (!isSignal(obj)) return null;

    const value = obj.peek();
    const isWritable = isWritableSignal(obj);

    const properties = [
      ['li', {}, ['span', { style: 'color: #881391' }, 'value: '], ['object', { object: value }]],
      ['li', {}, ['span', { style: 'color: #881391' }, 'writable: '], isWritable ? 'true' : 'false'],
    ];

    // Add internal metadata if available
    const internal = (obj as any).__internal;
    if (internal) {
      const computations = internal.getComputations?.();
      if (computations) {
        properties.push([
          'li',
          {},
          ['span', { style: 'color: #881391' }, 'dependents: '],
          computations.size.toString(),
        ]);
      }
    }

    return ['ol', { style: 'list-style: none; padding-left: 0; margin: 0' }, ...properties];
  },
};

/**
 * Store formatter
 */
const storeFormatter: Formatter = {
  header(obj: any): any[] | null {
    // Check if it's a store (has get, set, subscribe methods)
    if (
      !obj ||
      typeof obj !== 'object' ||
      typeof obj.get !== 'function' ||
      typeof obj.subscribe !== 'function'
    ) {
      return null;
    }

    // Additional check to avoid false positives
    if (!('getState' in obj)) return null;

    const state = obj.getState?.();
    const name = obj.name || 'Store';

    return [
      'span',
      { style: 'color: #0066cc; font-weight: bold' },
      [
        'span',
        {},
        `${name} `,
        ['span', { style: 'color: #666' }, '{ '],
        formatValue(state),
        ['span', { style: 'color: #666' }, ' }'],
      ],
    ];
  },

  hasBody(obj: any): boolean {
    return (
      obj &&
      typeof obj === 'object' &&
      typeof obj.get === 'function' &&
      typeof obj.subscribe === 'function' &&
      'getState' in obj
    );
  },

  body(obj: any): any[] | null {
    const state = obj.getState?.();
    if (!state) return null;

    const properties = Object.entries(state).map(([key, value]) => [
      'li',
      {},
      ['span', { style: 'color: #881391' }, `${key}: `],
      ['object', { object: value }],
    ]);

    return ['ol', { style: 'list-style: none; padding-left: 0; margin: 0' }, ...properties];
  },
};

/**
 * Component formatter
 */
const componentFormatter: Formatter = {
  header(obj: any): any[] | null {
    // Check if it's a component instance
    if (
      !obj ||
      typeof obj !== 'object' ||
      !('__AETHER_COMPONENT__' in obj) ||
      !obj.__AETHER_COMPONENT__
    ) {
      return null;
    }

    const name = obj.name || obj.constructor?.name || 'Component';
    const props = obj.props || {};

    return [
      'span',
      { style: 'color: #0066cc; font-weight: bold' },
      [
        'span',
        {},
        `<${name}> `,
        ['span', { style: 'color: #666' }, '{ '],
        `${Object.keys(props).length} props`,
        ['span', { style: 'color: #666' }, ' }'],
      ],
    ];
  },

  hasBody(obj: any): boolean {
    return obj && typeof obj === 'object' && '__AETHER_COMPONENT__' in obj;
  },

  body(obj: any): any[] | null {
    const props = obj.props || {};
    const state = obj.state || {};

    const properties = [
      ['li', {}, ['span', { style: 'color: #881391; font-weight: bold' }, 'Props']],
      ...Object.entries(props).map(([key, value]) => [
        'li',
        { style: 'padding-left: 20px' },
        ['span', { style: 'color: #881391' }, `${key}: `],
        ['object', { object: value }],
      ]),
      ['li', {}, ['span', { style: 'color: #881391; font-weight: bold' }, 'State']],
      ...Object.entries(state).map(([key, value]) => [
        'li',
        { style: 'padding-left: 20px' },
        ['span', { style: 'color: #881391' }, `${key}: `],
        ['object', { object: value }],
      ]),
    ];

    return ['ol', { style: 'list-style: none; padding-left: 0; margin: 0' }, ...properties];
  },
};

/**
 * Format value for display
 */
function formatValue(value: any): any {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = typeof value;

  switch (type) {
    case 'string':
      return ['span', { style: 'color: #c41a16' }, `"${value}"`];
    case 'number':
      return ['span', { style: 'color: #1c00cf' }, String(value)];
    case 'boolean':
      return ['span', { style: 'color: #1c00cf' }, String(value)];
    case 'function':
      return ['span', { style: 'color: #666; font-style: italic' }, 'ƒ'];
    case 'object':
      if (Array.isArray(value)) {
        return ['span', { style: 'color: #666' }, `Array(${value.length})`];
      }
      return ['span', { style: 'color: #666' }, 'Object'];
    default:
      return String(value);
  }
}

/**
 * Format signal for console output
 *
 * @example
 * ```typescript
 * const count = signal(0);
 * console.log(formatSignal(count));
 * // Output: "Signal { value: 0, writable: true, dependents: 0 }"
 * ```
 */
export function formatSignal(signal: Signal<any> | WritableSignal<any>): string {
  if (!isSignal(signal)) return String(signal);

  const value = signal.peek();
  const isWritable = isWritableSignal(signal);

  const internal = (signal as any).__internal;
  const dependents = internal?.getComputations?.()?.size || 0;

  // Safely stringify value with circular reference handling
  let valueStr: string;
  try {
    valueStr = JSON.stringify(value);
  } catch (e) {
    valueStr = '[Circular]';
  }

  return `Signal { value: ${valueStr}, writable: ${isWritable}, dependents: ${dependents} }`;
}

/**
 * Format store for console output
 */
export function formatStore(store: any): string {
  if (!store || typeof store.getState !== 'function') return String(store);

  const state = store.getState();
  const name = store.name || 'Store';

  return `${name} ${JSON.stringify(state)}`;
}

/**
 * Format component for console output
 */
export function formatComponent(component: any): string {
  if (!component || !component.__AETHER_COMPONENT__) return String(component);

  const name = component.name || 'Component';
  const props = component.props || {};

  return `<${name}> { ${Object.keys(props).length} props }`;
}
