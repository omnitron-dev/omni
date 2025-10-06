/**
 * Utilities
 *
 * Collection of utilities for template syntax enhancement,
 * providing directive-like convenience without a custom compiler
 */

// Event handler utilities
export {
  prevent,
  stop,
  stopImmediate,
  preventStop,
  self,
  trusted,
  debounce,
  throttle,
  passive,
  capture,
  once,
  compose,
} from './events.js';

// Binding utilities
export {
  bindValue,
  bindNumber,
  bindTrimmed,
  bindDebounced,
  bindThrottled,
  bindLazy,
  bindChecked,
  bindGroup,
  bindSelect,
  composeBinding,
} from './binding.js';
export type { InputBinding, CheckboxBinding } from './binding.js';

// Class utilities
export {
  classNames,
  cx,
  classes,
  reactiveClasses,
  toggleClass,
  conditionalClasses,
  variantClasses,
  mergeClasses,
} from './classes.js';
export type { ClassValue } from './classes.js';

// Style utilities
export {
  styles,
  reactiveStyles,
  mergeStyles,
  cssVar,
  cssVars,
  conditionalStyles,
  sizeStyles,
  positionStyles,
  flexStyles,
  gridStyles,
} from './styles.js';
export type { StyleValue, StyleObject, CSSProperties } from './styles.js';

// Directive utilities
export {
  createDirective,
  createUpdatableDirective,
  combineDirectives,
  autoFocus,
  clickOutside,
  intersectionObserver,
  resizeObserver,
  longPress,
  portal,
  draggable,
} from './directive.js';
export type {
  DirectiveFunction,
  DirectiveWithUpdate,
  DirectiveResult,
} from './directive.js';
