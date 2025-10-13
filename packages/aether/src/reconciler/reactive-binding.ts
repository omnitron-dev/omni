/**
 * Reactive Binding System
 *
 * Creates reactive bindings between signals and DOM nodes.
 * Each binding automatically tracks signal dependencies and updates the DOM
 * when any tracked signal changes.
 *
 * @module reconciler/reactive-binding
 */

import { effect } from '../core/reactivity/effect.js';
import type { EffectImpl } from '../core/reactivity/effect.js';

/**
 * Represents a reactive binding between a signal and a DOM node.
 * Contains the effect that watches signals and updates the node,
 * plus cleanup function to dispose the effect.
 */
export interface ReactiveBinding {
  /** The DOM node being reactively updated */
  node: Node;
  /** The effect that tracks signal dependencies and runs updates */
  effect: EffectImpl;
  /** Optional cleanup function to dispose the effect */
  cleanup?: () => void;
}

/**
 * Binds a signal to a text node's content.
 * Creates an effect that automatically updates the text node whenever
 * the signal value changes.
 *
 * @param node - The text node to bind to
 * @param getValue - Function that reads signal(s) and returns the text value
 * @returns ReactiveBinding containing the node, effect, and cleanup function
 *
 * @example
 * ```typescript
 * const [count, setCount] = createSignal(0);
 * const textNode = document.createTextNode('');
 * const binding = bindSignalToTextNode(textNode, () => `Count: ${count()}`);
 * // textNode.textContent is now "Count: 0"
 * setCount(1);
 * // textNode.textContent is now "Count: 1"
 * binding.cleanup(); // dispose when done
 * ```
 */
export function bindSignalToTextNode(node: Text, getValue: () => any): ReactiveBinding {
  const effectInstance = effect(() => {
    const value = getValue();
    node.textContent = String(value != null ? value : '');
  }) as EffectImpl;

  return {
    node,
    effect: effectInstance,
    cleanup: () => effectInstance.dispose(),
  };
}

/**
 * Binds a signal to an HTML element's attribute.
 * Creates an effect that automatically updates the attribute whenever
 * the signal value changes. Null/undefined values remove the attribute.
 *
 * @param element - The HTML element to bind to
 * @param attr - The attribute name to update
 * @param getValue - Function that reads signal(s) and returns the attribute value
 * @returns ReactiveBinding containing the element, effect, and cleanup function
 *
 * @example
 * ```typescript
 * const [isDisabled, setDisabled] = createSignal(false);
 * const button = document.createElement('button');
 * const binding = bindSignalToAttribute(button, 'disabled', () =>
 *   isDisabled() ? '' : null
 * );
 * // button has no disabled attribute
 * setDisabled(true);
 * // button now has disabled=""
 * binding.cleanup(); // dispose when done
 * ```
 */
export function bindSignalToAttribute(element: HTMLElement, attr: string, getValue: () => any): ReactiveBinding {
  const effectInstance = effect(() => {
    const value = getValue();
    if (value == null) {
      element.removeAttribute(attr);
    } else {
      element.setAttribute(attr, String(value));
    }
  }) as EffectImpl;

  return {
    node: element,
    effect: effectInstance,
    cleanup: () => effectInstance.dispose(),
  };
}

/**
 * Binds a signal to an HTML element's property.
 * Creates an effect that automatically updates the property whenever
 * the signal value changes. Directly sets element[prop] = value.
 *
 * @param element - The HTML element to bind to
 * @param prop - The property name to update
 * @param getValue - Function that reads signal(s) and returns the property value
 * @returns ReactiveBinding containing the element, effect, and cleanup function
 *
 * @example
 * ```typescript
 * const [isChecked, setChecked] = createSignal(false);
 * const checkbox = document.createElement('input');
 * checkbox.type = 'checkbox';
 * const binding = bindSignalToProperty(checkbox, 'checked', () => isChecked());
 * // checkbox.checked is now false
 * setChecked(true);
 * // checkbox.checked is now true
 * binding.cleanup(); // dispose when done
 * ```
 */
export function bindSignalToProperty(element: HTMLElement, prop: string, getValue: () => any): ReactiveBinding {
  const effectInstance = effect(() => {
    const value = getValue();
    (element as any)[prop] = value;
  }) as EffectImpl;

  return {
    node: element,
    effect: effectInstance,
    cleanup: () => effectInstance.dispose(),
  };
}

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
 * Binds a signal to an HTML element's style properties.
 * Creates an effect that automatically updates multiple style properties
 * whenever the signal value changes. Handles camelCase to kebab-case conversion.
 *
 * @param element - The HTML element to bind to
 * @param getStyle - Function that reads signal(s) and returns a style object
 * @returns ReactiveBinding containing the element, effect, and cleanup function
 *
 * @example
 * ```typescript
 * const [color, setColor] = createSignal('red');
 * const [size, setSize] = createSignal(16);
 * const div = document.createElement('div');
 * const binding = bindSignalToStyle(div, () => ({
 *   color: color(),
 *   fontSize: `${size()}px`,
 *   backgroundColor: '#f0f0f0'
 * }));
 * // div.style.color is 'red', fontSize is '16px', backgroundColor is '#f0f0f0'
 * setColor('blue');
 * setSize(20);
 * // style automatically updates
 * binding.cleanup(); // dispose when done
 * ```
 */
export function bindSignalToStyle(element: HTMLElement, getStyle: () => Record<string, any>): ReactiveBinding {
  const effectInstance = effect(() => {
    const styleObj = getStyle();
    if (styleObj && typeof styleObj === 'object') {
      for (const [key, value] of Object.entries(styleObj)) {
        if (value == null) {
          // Remove style property if value is null/undefined
          element.style.removeProperty(camelToKebab(key));
        } else {
          element.style.setProperty(camelToKebab(key), String(value));
        }
      }
    }
  }) as EffectImpl;

  return {
    node: element,
    effect: effectInstance,
    cleanup: () => effectInstance.dispose(),
  };
}

/**
 * Binds a signal to an HTML element's class list.
 * Creates an effect that automatically updates className whenever
 * the signal value changes. Supports string, array, or object formats.
 *
 * @param element - The HTML element to bind to
 * @param getClasses - Function that reads signal(s) and returns classes
 * @returns ReactiveBinding containing the element, effect, and cleanup function
 *
 * @example
 * ```typescript
 * // String format
 * const [classes, setClasses] = createSignal('foo bar');
 * const div = document.createElement('div');
 * let binding = bindSignalToClass(div, () => classes());
 * // div.className is 'foo bar'
 *
 * // Array format
 * const [classList, setClassList] = createSignal(['foo', 'bar', 'baz']);
 * binding = bindSignalToClass(div, () => classList());
 * // div.className is 'foo bar baz'
 *
 * // Object format (conditional classes)
 * const [isActive, setActive] = createSignal(true);
 * const [isDisabled, setDisabled] = createSignal(false);
 * binding = bindSignalToClass(div, () => ({
 *   active: isActive(),
 *   disabled: isDisabled()
 * }));
 * // div.className is 'active'
 * setDisabled(true);
 * // div.className is 'active disabled'
 *
 * binding.cleanup(); // dispose when done
 * ```
 */
export function bindSignalToClass(element: HTMLElement, getClasses: () => any): ReactiveBinding {
  const effectInstance = effect(() => {
    const classes = getClasses();

    if (classes == null) {
      element.className = '';
    } else if (typeof classes === 'string') {
      element.className = classes;
    } else if (Array.isArray(classes)) {
      element.className = classes.filter(Boolean).join(' ');
    } else if (typeof classes === 'object') {
      // Object format: { className: boolean }
      const classNames = Object.entries(classes)
        .filter(([_, value]) => value)
        .map(([key]) => key);
      element.className = classNames.join(' ');
    } else {
      element.className = String(classes);
    }
  }) as EffectImpl;

  return {
    node: element,
    effect: effectInstance,
    cleanup: () => effectInstance.dispose(),
  };
}
