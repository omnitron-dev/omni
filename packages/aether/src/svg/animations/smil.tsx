/**
 * SMIL Animations
 *
 * SVG SMIL (Synchronized Multimedia Integration Language) animation support
 */

import { defineComponent } from '../../index.js';
import type { Signal } from '../../index.js';
import type { SMILAnimationProps, SMILMotionProps, SMILTransformProps } from './types.js';

// Utility to resolve signal values
const resolveValue = <T,>(value: T | Signal<T> | undefined): T | undefined => {
  if (value === undefined) return undefined;
  return typeof value === 'function' ? (value as Signal<T>)() : value;
};

const getNumericValue = (value: string | number | Signal<string | number> | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const resolved = resolveValue(value);
  return typeof resolved === 'number' ? `${resolved}` : resolved;
};

/**
 * Animate element - animates a single attribute or property
 */
export const Animate = defineComponent<SMILAnimationProps>((props) => () => (
  <animate
    attributeName={props.attributeName}
    attributeType={props.attributeType}
    begin={getNumericValue(props.begin)}
    dur={getNumericValue(props.dur)}
    end={getNumericValue(props.end)}
    min={getNumericValue(props.min)}
    max={getNumericValue(props.max)}
    repeatCount={props.repeatCount}
    repeatDur={getNumericValue(props.repeatDur)}
    fill={props.fill}
    calcMode={props.calcMode}
    keyTimes={props.keyTimes}
    keySplines={props.keySplines}
    from={getNumericValue(props.from)}
    to={getNumericValue(props.to)}
    by={getNumericValue(props.by)}
    values={props.values}
    additive={props.additive}
    accumulate={props.accumulate}
  />
));

/**
 * AnimateMotion element - animates an element along a path
 */
export const AnimateMotion = defineComponent<SMILMotionProps>((props) => () => (
  // @ts-expect-error - SVG animation elements are valid but not in default JSX types
  <animateMotion
    begin={getNumericValue(props.begin)}
    dur={getNumericValue(props.dur)}
    end={getNumericValue(props.end)}
    min={getNumericValue(props.min)}
    max={getNumericValue(props.max)}
    repeatCount={props.repeatCount}
    repeatDur={getNumericValue(props.repeatDur)}
    fill={props.fill}
    calcMode={props.calcMode}
    keyTimes={props.keyTimes}
    keySplines={props.keySplines}
    keyPoints={props.keyPoints}
    path={props.path}
    rotate={typeof props.rotate === 'number' ? `${props.rotate}` : props.rotate}
    from={getNumericValue(props.from)}
    to={getNumericValue(props.to)}
    by={getNumericValue(props.by)}
    values={props.values}
    additive={props.additive}
    accumulate={props.accumulate}
  />
));

/**
 * AnimateTransform element - animates transform attributes
 */
export const AnimateTransform = defineComponent<SMILTransformProps>((props) => () => (
  // @ts-expect-error - SVG animation elements are valid but not in default JSX types
  <animateTransform
    attributeName={props.attributeName}
    attributeType={props.attributeType}
    type={props.type}
    begin={getNumericValue(props.begin)}
    dur={getNumericValue(props.dur)}
    end={getNumericValue(props.end)}
    min={getNumericValue(props.min)}
    max={getNumericValue(props.max)}
    repeatCount={props.repeatCount}
    repeatDur={getNumericValue(props.repeatDur)}
    fill={props.fill}
    calcMode={props.calcMode}
    keyTimes={props.keyTimes}
    keySplines={props.keySplines}
    from={getNumericValue(props.from)}
    to={getNumericValue(props.to)}
    by={getNumericValue(props.by)}
    values={props.values}
    additive={props.additive}
    accumulate={props.accumulate}
  />
));

/**
 * AnimateColor element - animates color attributes (deprecated but still supported)
 */
export const AnimateColor = defineComponent<SMILAnimationProps>((props) => () => (
  // @ts-expect-error - SVG animation elements are valid but not in default JSX types
  <animateColor
    attributeName={props.attributeName}
    attributeType={props.attributeType}
    begin={getNumericValue(props.begin)}
    dur={getNumericValue(props.dur)}
    end={getNumericValue(props.end)}
    min={getNumericValue(props.min)}
    max={getNumericValue(props.max)}
    repeatCount={props.repeatCount}
    repeatDur={getNumericValue(props.repeatDur)}
    fill={props.fill}
    calcMode={props.calcMode}
    keyTimes={props.keyTimes}
    keySplines={props.keySplines}
    from={getNumericValue(props.from)}
    to={getNumericValue(props.to)}
    by={getNumericValue(props.by)}
    values={props.values}
    additive={props.additive}
    accumulate={props.accumulate}
  />
));

/**
 * Set element - sets the value of an attribute for a duration
 */
export interface SetProps
  extends Omit<SMILAnimationProps, 'from' | 'by' | 'values' | 'calcMode' | 'keyTimes' | 'keySplines'> {
  to: string | number;
}

export const Set = defineComponent<SetProps>((props) => () => (
  // @ts-expect-error - SVG animation elements are valid but not in default JSX types
  <set
    attributeName={props.attributeName}
    attributeType={props.attributeType}
    to={getNumericValue(props.to)}
    begin={getNumericValue(props.begin)}
    dur={getNumericValue(props.dur)}
    end={getNumericValue(props.end)}
    min={getNumericValue(props.min)}
    max={getNumericValue(props.max)}
    repeatCount={props.repeatCount}
    repeatDur={getNumericValue(props.repeatDur)}
    fill={props.fill}
  />
));

/**
 * Helper function to create SMIL animation programmatically
 *
 * Creates and attaches a SMIL animation element to a target SVG element.
 * Useful for creating animations dynamically at runtime.
 *
 * @param target - Target SVG element to animate
 * @param config - Animation configuration
 * @returns The created animation element
 *
 * @example
 * ```typescript
 * const circle = document.querySelector('circle');
 * const animation = createSMILAnimation(circle, {
 *   attributeName: 'r',
 *   from: 20,
 *   to: 40,
 *   dur: 1000,
 *   repeatCount: 'indefinite'
 * });
 * animation.beginElement(); // Start animation
 * ```
 */
export function createSMILAnimation(target: SVGElement | null, config: SMILAnimationProps): SVGAnimateElement | null {
  if (!target) return null;
  if (typeof document === 'undefined') return null;

  const animate = document.createElementNS('http://www.w3.org/2000/svg', 'animate');

  // Set required attributes
  if (config.attributeName) {
    animate.setAttribute('attributeName', config.attributeName);
  }

  // Set optional attributes
  if (config.attributeType) animate.setAttribute('attributeType', config.attributeType);
  if (config.from !== undefined) animate.setAttribute('from', String(config.from));
  if (config.to !== undefined) animate.setAttribute('to', String(config.to));
  if (config.by !== undefined) animate.setAttribute('by', String(config.by));
  if (config.values) animate.setAttribute('values', config.values);

  // Timing attributes
  if (config.begin !== undefined) animate.setAttribute('begin', String(config.begin));
  if (config.dur !== undefined) animate.setAttribute('dur', String(config.dur));
  if (config.end !== undefined) animate.setAttribute('end', String(config.end));
  if (config.min !== undefined) animate.setAttribute('min', String(config.min));
  if (config.max !== undefined) animate.setAttribute('max', String(config.max));
  if (config.repeatCount !== undefined) animate.setAttribute('repeatCount', String(config.repeatCount));
  if (config.repeatDur !== undefined) animate.setAttribute('repeatDur', String(config.repeatDur));
  if (config.fill) animate.setAttribute('fill', config.fill);

  // Animation behavior
  if (config.calcMode) animate.setAttribute('calcMode', config.calcMode);
  if (config.keyTimes) animate.setAttribute('keyTimes', config.keyTimes);
  if (config.keySplines) animate.setAttribute('keySplines', config.keySplines);
  if (config.additive) animate.setAttribute('additive', config.additive);
  if (config.accumulate) animate.setAttribute('accumulate', config.accumulate);

  target.appendChild(animate);
  return animate;
}

/**
 * Create a transform animation programmatically
 *
 * @param target - Target SVG element to animate
 * @param config - Transform animation configuration
 * @returns The created animateTransform element
 *
 * @example
 * ```typescript
 * const rect = document.querySelector('rect');
 * createTransformAnimation(rect, {
 *   attributeName: 'transform',
 *   type: 'rotate',
 *   from: '0 50 50',
 *   to: '360 50 50',
 *   dur: 2000,
 *   repeatCount: 'indefinite'
 * });
 * ```
 */
export function createTransformAnimation(
  target: SVGElement | null,
  config: SMILTransformProps
): SVGAnimateTransformElement | null {
  if (!target) return null;
  if (typeof document === 'undefined') return null;

  const animateTransform = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'animateTransform'
  ) as SVGAnimateTransformElement;

  // Required attributes
  if (config.attributeName) {
    animateTransform.setAttribute('attributeName', config.attributeName);
  }
  animateTransform.setAttribute('type', config.type);

  // Animation values
  if (config.from !== undefined) animateTransform.setAttribute('from', String(config.from));
  if (config.to !== undefined) animateTransform.setAttribute('to', String(config.to));
  if (config.by !== undefined) animateTransform.setAttribute('by', String(config.by));
  if (config.values) animateTransform.setAttribute('values', config.values);

  // Timing attributes
  if (config.begin !== undefined) animateTransform.setAttribute('begin', String(config.begin));
  if (config.dur !== undefined) animateTransform.setAttribute('dur', String(config.dur));
  if (config.end !== undefined) animateTransform.setAttribute('end', String(config.end));
  if (config.repeatCount !== undefined) animateTransform.setAttribute('repeatCount', String(config.repeatCount));
  if (config.repeatDur !== undefined) animateTransform.setAttribute('repeatDur', String(config.repeatDur));
  if (config.fill) animateTransform.setAttribute('fill', config.fill);

  // Animation behavior
  if (config.calcMode) animateTransform.setAttribute('calcMode', config.calcMode);
  if (config.keyTimes) animateTransform.setAttribute('keyTimes', config.keyTimes);
  if (config.keySplines) animateTransform.setAttribute('keySplines', config.keySplines);
  if (config.additive) animateTransform.setAttribute('additive', config.additive);
  if (config.accumulate) animateTransform.setAttribute('accumulate', config.accumulate);

  target.appendChild(animateTransform);
  return animateTransform;
}

/**
 * Create a motion animation along a path
 *
 * @param target - Target SVG element to animate
 * @param config - Motion animation configuration
 * @returns The created animateMotion element
 *
 * @example
 * ```typescript
 * const circle = document.querySelector('circle');
 * createMotionAnimation(circle, {
 *   path: 'M20,50 C20,-50 180,150 180,50 z',
 *   dur: 3000,
 *   repeatCount: 'indefinite',
 *   rotate: 'auto'
 * });
 * ```
 */
export function createMotionAnimation(
  target: SVGElement | null,
  config: SMILMotionProps
): SVGAnimateMotionElement | null {
  if (!target) return null;
  if (typeof document === 'undefined') return null;

  const animateMotion = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'animateMotion'
  ) as SVGAnimateMotionElement;

  // Path or values
  if (config.path) animateMotion.setAttribute('path', config.path);
  if (config.keyPoints) animateMotion.setAttribute('keyPoints', config.keyPoints);
  if (config.rotate !== undefined) {
    animateMotion.setAttribute('rotate', String(config.rotate));
  }

  // Values
  if (config.from !== undefined) animateMotion.setAttribute('from', String(config.from));
  if (config.to !== undefined) animateMotion.setAttribute('to', String(config.to));
  if (config.by !== undefined) animateMotion.setAttribute('by', String(config.by));
  if (config.values) animateMotion.setAttribute('values', config.values);

  // Timing attributes
  if (config.begin !== undefined) animateMotion.setAttribute('begin', String(config.begin));
  if (config.dur !== undefined) animateMotion.setAttribute('dur', String(config.dur));
  if (config.end !== undefined) animateMotion.setAttribute('end', String(config.end));
  if (config.repeatCount !== undefined) animateMotion.setAttribute('repeatCount', String(config.repeatCount));
  if (config.repeatDur !== undefined) animateMotion.setAttribute('repeatDur', String(config.repeatDur));
  if (config.fill) animateMotion.setAttribute('fill', config.fill);

  // Animation behavior
  if (config.calcMode) animateMotion.setAttribute('calcMode', config.calcMode);
  if (config.keyTimes) animateMotion.setAttribute('keyTimes', config.keyTimes);
  if (config.keySplines) animateMotion.setAttribute('keySplines', config.keySplines);

  target.appendChild(animateMotion);
  return animateMotion;
}

/**
 * Check if browser supports SMIL animations
 *
 * @returns true if SMIL animations are supported
 *
 * @example
 * ```typescript
 * if (supportsSMIL()) {
 *   // Use SMIL animations
 * } else {
 *   // Fallback to CSS or JS animations
 * }
 * ```
 */
export function supportsSMIL(): boolean {
  // Check if we're in a browser environment
  if (typeof document === 'undefined') return false;
  if (typeof SVGElement === 'undefined') return false;

  // Check for SVG and animation support
  try {
    const _svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const animate = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    return animate instanceof SVGAnimateElement;
  } catch {
    return false;
  }
}
