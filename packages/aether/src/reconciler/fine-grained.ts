/**
 * Fine-Grained Reactivity System
 *
 * Optimizes effect-based updates for fine-grained reactivity.
 * Provides optimized reactive node creators that attach effects directly
 * to specific DOM nodes without full VNode tree traversal.
 *
 * Features:
 * - Lazy effect initialization
 * - Minimal tracking overhead
 * - Optimized effect creation and batching
 * - Direct DOM mutation for reactive values
 *
 * @module reconciler/fine-grained
 */

import { effect } from '../core/reactivity/effect.js';
import type { EffectImpl } from '../core/reactivity/effect.js';
import { isSignal } from '../core/reactivity/signal.js';
import type { VNode } from './vnode.js';

/**
 * Style value type - can be string, object, or null
 */
export type StyleValue = string | Record<string, any> | null | undefined;

/**
 * Effect pool for reusing effect instances (optimization)
 */
class EffectPool {
  private pool: EffectImpl[] = [];
  private maxSize = 100;

  /**
   * Get an effect from the pool or create a new one
   */
  acquire(fn: () => void): EffectImpl {
    // For now, always create new effects
    // Pool optimization can be added later if profiling shows benefit
    return effect(fn) as EffectImpl;
  }

  /**
   * Return an effect to the pool
   */
  release(eff: EffectImpl): void {
    if (this.pool.length < this.maxSize) {
      eff.dispose();
      // Pool optimization disabled for now - effects have internal state
      // that makes reuse complex
    } else {
      eff.dispose();
    }
  }

  /**
   * Clear the pool
   */
  clear(): void {
    for (const eff of this.pool) {
      eff.dispose();
    }
    this.pool = [];
  }
}

/**
 * Global effect pool instance
 */
const effectPool = new EffectPool();

/**
 * Converts a camelCase string to kebab-case.
 * Used for converting JavaScript style property names to CSS property names.
 *
 * @param str - The camelCase string to convert
 * @returns The kebab-case string
 *
 * @example
 * ```typescript
 * camelToKebab('backgroundColor') // returns 'background-color'
 * camelToKebab('fontSize') // returns 'font-size'
 * ```
 */
function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * Creates a text node with reactive content.
 * The text node automatically updates when the signal changes.
 *
 * @param getValue - Function that returns the text value (can read signals)
 * @returns Text node that updates reactively
 *
 * @example
 * ```typescript
 * const [count, setCount] = signal(0);
 * const textNode = createReactiveTextNode(() => `Count: ${count()}`);
 * document.body.appendChild(textNode);
 * setCount(1); // textNode automatically updates to "Count: 1"
 * ```
 */
export function createReactiveTextNode(getValue: () => any): Text {
  const textNode = document.createTextNode('');

  // Create effect that updates text content
  const eff = effectPool.acquire(() => {
    const value = getValue();
    textNode.textContent = String(value != null ? value : '');
  });

  // Store effect reference on the node for cleanup
  (textNode as any).__effect = eff;

  return textNode;
}

/**
 * Attaches a reactive attribute to an HTML element.
 * The attribute automatically updates when the signal changes.
 * Null/undefined values remove the attribute.
 *
 * @param element - The HTML element to attach the attribute to
 * @param attr - The attribute name
 * @param getValue - Function that returns the attribute value (can read signals)
 *
 * @example
 * ```typescript
 * const [isDisabled, setDisabled] = signal(false);
 * const button = document.createElement('button');
 * createReactiveAttribute(button, 'disabled', () => isDisabled() ? '' : null);
 * setDisabled(true); // button.disabled is now set
 * ```
 */
export function createReactiveAttribute(element: HTMLElement, attr: string, getValue: () => any): void {
  // Create effect that updates attribute
  const eff = effectPool.acquire(() => {
    const value = getValue();
    if (value == null) {
      element.removeAttribute(attr);
    } else {
      element.setAttribute(attr, String(value));
    }
  });

  // Store effect reference on the element for cleanup
  if (!(element as any).__effects) {
    (element as any).__effects = [];
  }
  (element as any).__effects.push(eff);
}

/**
 * Attaches a reactive property to an HTML element.
 * The property automatically updates when the signal changes.
 * Directly sets element[prop] = value.
 *
 * @param element - The HTML element to attach the property to
 * @param prop - The property name
 * @param getValue - Function that returns the property value (can read signals)
 *
 * @example
 * ```typescript
 * const [isChecked, setChecked] = signal(false);
 * const checkbox = document.createElement('input');
 * checkbox.type = 'checkbox';
 * createReactiveProperty(checkbox, 'checked', () => isChecked());
 * setChecked(true); // checkbox.checked is now true
 * ```
 */
export function createReactiveProperty(element: HTMLElement, prop: string, getValue: () => any): void {
  // Create effect that updates property
  const eff = effectPool.acquire(() => {
    const value = getValue();
    (element as any)[prop] = value;
  });

  // Store effect reference on the element for cleanup
  if (!(element as any).__effects) {
    (element as any).__effects = [];
  }
  (element as any).__effects.push(eff);
}

/**
 * Attaches reactive styles to an HTML element.
 * The styles automatically update when the signal changes.
 * Handles camelCase to kebab-case conversion.
 *
 * @param element - The HTML element to attach styles to
 * @param getValue - Function that returns a style object (can read signals)
 *
 * @example
 * ```typescript
 * const [color, setColor] = signal('red');
 * const [size, setSize] = signal(16);
 * const div = document.createElement('div');
 * createReactiveStyle(div, () => ({
 *   color: color(),
 *   fontSize: `${size()}px`
 * }));
 * setColor('blue'); // div.style.color automatically updates to 'blue'
 * ```
 */
export function createReactiveStyle(element: HTMLElement, getValue: () => StyleValue): void {
  // Track previously set style properties for cleanup
  let previousKeys: string[] = [];

  // Create effect that updates styles
  const eff = effectPool.acquire(() => {
    const styleObj = getValue();

    // Clear previous styles that are not in the new style object
    for (const key of previousKeys) {
      if (!styleObj || typeof styleObj === 'string' || !(key in styleObj)) {
        element.style.removeProperty(camelToKebab(key));
      }
    }

    // Apply new styles
    if (styleObj && typeof styleObj === 'object' && !Array.isArray(styleObj)) {
      const newKeys: string[] = [];
      for (const [key, value] of Object.entries(styleObj as Record<string, any>)) {
        newKeys.push(key);
        if (value == null) {
          element.style.removeProperty(camelToKebab(key));
        } else {
          element.style.setProperty(camelToKebab(key), String(value));
        }
      }
      previousKeys = newKeys;
    } else if (typeof styleObj === 'string') {
      // Handle string style (cssText)
      element.style.cssText = styleObj;
      previousKeys = [];
    } else {
      // Clear all styles
      element.style.cssText = '';
      previousKeys = [];
    }
  });

  // Store effect reference on the element for cleanup
  if (!(element as any).__effects) {
    (element as any).__effects = [];
  }
  (element as any).__effects.push(eff);
}

/**
 * Detects if a value contains signals by checking if it's callable
 * and has signal-like properties
 */
function containsSignal(value: any): boolean {
  // Direct signal check
  if (isSignal(value)) {
    return true;
  }

  // Check if it's a function (might be accessing signals)
  if (typeof value === 'function') {
    return true;
  }

  // Check objects for signal properties
  if (value && typeof value === 'object') {
    return Object.values(value).some((v) => containsSignal(v));
  }

  return false;
}

/**
 * Attaches reactivity to a VNode tree.
 * Walks the VNode tree and detects signals in props/children,
 * then attaches fine-grained effects to specific DOM nodes.
 *
 * Effects are stored on vnode.effects for cleanup.
 *
 * @param vnode - The VNode to attach reactivity to
 * @param dom - The actual DOM node corresponding to the VNode
 *
 * @example
 * ```typescript
 * const [count, setCount] = signal(0);
 * const vnode = createElementVNode('div', { title: () => `Count: ${count()}` });
 * const dom = document.createElement('div');
 * vnode.dom = dom;
 * attachReactivity(vnode, dom);
 * setCount(1); // div.title automatically updates to "Count: 1"
 * ```
 */
export function attachReactivity(vnode: VNode, dom: Node): void {
  if (!vnode || !dom) {
    return;
  }

  // Initialize effects array if not present
  if (!vnode.effects) {
    vnode.effects = [];
  }

  // Handle text nodes
  if (vnode.type === 'text' && vnode.text !== undefined) {
    // Check if text is reactive (function or signal)
    const textValue = (vnode as any).__reactiveText;
    if (textValue && typeof textValue === 'function') {
      const textNode = dom as Text;
      const eff = effectPool.acquire(() => {
        const value = textValue();
        textNode.textContent = String(value != null ? value : '');
      });
      vnode.effects!.push(eff);
      (textNode as any).__effect = eff;
    }
  }

  // Handle element nodes
  if (vnode.type === 'element' && dom instanceof HTMLElement) {
    const element = dom as HTMLElement;

    // Check props for reactive values
    if (vnode.props) {
      for (const [key, value] of Object.entries(vnode.props)) {
        // Skip event handlers and key
        if (key.startsWith('on') || key === 'key') {
          continue;
        }

        // Handle style
        if (key === 'style' && (typeof value === 'function' || containsSignal(value))) {
          const getValue = typeof value === 'function' ? value : () => value;
          createReactiveStyle(element, getValue);
          // Copy effects from element to vnode
          if ((element as any).__effects) {
            const newEffects = (element as any).__effects.slice(-1); // Get last effect
            vnode.effects!.push(...newEffects);
          }
          continue;
        }

        // Handle class/className
        if ((key === 'class' || key === 'className') && typeof value === 'function') {
          // Use attribute binding for class
          createReactiveAttribute(element, 'class', value);
          if ((element as any).__effects) {
            const newEffects = (element as any).__effects.slice(-1);
            vnode.effects!.push(...newEffects);
          }
          continue;
        }

        // Check if value is reactive (function or contains signal)
        if (typeof value === 'function' || containsSignal(value)) {
          const getValue = typeof value === 'function' ? value : () => value;

          // Decide whether to use attribute or property
          // Properties: value, checked, selected, disabled (for form elements)
          const propertyNames = ['value', 'checked', 'selected', 'disabled', 'innerHTML', 'textContent'];
          if (propertyNames.includes(key)) {
            createReactiveProperty(element, key, getValue);
          } else {
            createReactiveAttribute(element, key, getValue);
          }

          // Copy effects from element to vnode
          if ((element as any).__effects) {
            const newEffects = (element as any).__effects.slice(-1); // Get last effect
            vnode.effects!.push(...newEffects);
          }
        }
      }
    }
  }

  // Recursively attach reactivity to children
  if (vnode.children && Array.isArray(vnode.children)) {
    for (let i = 0; i < vnode.children.length; i++) {
      const childVNode = vnode.children[i];
      if (childVNode) {
        const childDom = childVNode.dom;
        if (childDom) {
          attachReactivity(childVNode, childDom);
        }
      }
    }
  }
}

/**
 * Cleans up all effects attached to a VNode and its children.
 * Should be called when the VNode is being removed from the DOM.
 *
 * @param vnode - The VNode to clean up effects for
 *
 * @example
 * ```typescript
 * cleanupReactivity(vnode); // Disposes all effects and prevents memory leaks
 * ```
 */
export function cleanupReactivity(vnode: VNode): void {
  if (!vnode) {
    return;
  }

  // Dispose all effects on this vnode
  if (vnode.effects && Array.isArray(vnode.effects)) {
    for (const eff of vnode.effects) {
      if (eff && typeof eff.dispose === 'function') {
        effectPool.release(eff);
      }
    }
    vnode.effects = [];
  }

  // Clean up DOM node effects
  if (vnode.dom) {
    const domNode = vnode.dom as any;
    if (domNode.__effect) {
      effectPool.release(domNode.__effect);
      domNode.__effect = undefined;
    }
    if (domNode.__effects) {
      for (const eff of domNode.__effects) {
        effectPool.release(eff);
      }
      domNode.__effects = [];
    }
  }

  // Recursively clean up children
  if (vnode.children && Array.isArray(vnode.children)) {
    for (const child of vnode.children) {
      cleanupReactivity(child);
    }
  }
}

/**
 * Batch effect creation for multiple reactive nodes.
 * Optimizes effect creation when attaching reactivity to multiple nodes at once.
 *
 * @param fn - Function that creates reactive nodes
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const nodes = batchEffects(() => {
 *   return [
 *     createReactiveTextNode(() => signal1()),
 *     createReactiveTextNode(() => signal2()),
 *     createReactiveTextNode(() => signal3())
 *   ];
 * });
 * ```
 */
export function batchEffects<T>(fn: () => T): T {
  // For now, just execute the function
  // Future optimization: batch effect creation/scheduling
  return fn();
}

/**
 * Clear the effect pool (useful for testing)
 */
export function clearEffectPool(): void {
  effectPool.clear();
}
