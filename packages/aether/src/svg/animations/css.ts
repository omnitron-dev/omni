/**
 * CSS Animations
 *
 * CSS-based animation utilities for SVG elements
 */

import type { CSSAnimationConfig } from './types.js';

// Counter for unique animation names
let animationCounter = 0;

/**
 * Creates a CSS animation and injects it into the stylesheet
 */
export function createCSSAnimation(name: string | undefined, config: CSSAnimationConfig): string {
  const animationName = name || `aether-svg-anim-${++animationCounter}`;

  // Generate keyframes CSS
  const keyframesCSS = Object.entries(config.keyframes)
    .map(([key, styles]) => {
      const styleString = Object.entries(styles)
        .map(([prop, value]) => `${camelToKebab(prop)}: ${value}`)
        .join('; ');
      return `${key} { ${styleString} }`;
    })
    .join('\n  ');

  const css = `@keyframes ${animationName} {\n  ${keyframesCSS}\n}`;

  // Inject into stylesheet
  if (typeof document !== 'undefined') {
    let styleSheet = document.querySelector<HTMLStyleElement>('#aether-svg-animations');
    if (!styleSheet) {
      styleSheet = document.createElement('style');
      styleSheet.id = 'aether-svg-animations';
      document.head.appendChild(styleSheet);
    }

    // Append to existing content
    styleSheet.textContent += `\n${css}`;
  }

  return animationName;
}

/**
 * Applies a CSS animation to an SVG element
 */
export function applyCSSAnimation(element: SVGElement, animation: string | CSSAnimationConfig): void {
  if (typeof animation === 'string') {
    // Simple animation name
    element.style.animation = animation;
  } else {
    // Full config
    const name = createCSSAnimation(undefined, animation);
    const duration = formatDuration(animation.duration);
    const delay = formatDuration(animation.delay);
    const timingFunction = animation.timingFunction || 'ease';
    const iterationCount = animation.iterationCount ?? 1;
    const direction = animation.direction || 'normal';
    const fillMode = animation.fillMode || 'none';
    const playState = animation.playState || 'running';

    element.style.animation = [name, duration, timingFunction, delay, iterationCount, direction, fillMode, playState]
      .filter(Boolean)
      .join(' ');
  }
}

/**
 * Removes animation from an element
 */
export function removeAnimation(element: SVGElement): void {
  element.style.animation = '';
}

/**
 * Pauses animation
 */
export function pauseAnimation(element: SVGElement): void {
  element.style.animationPlayState = 'paused';
}

/**
 * Resumes animation
 */
export function resumeAnimation(element: SVGElement): void {
  element.style.animationPlayState = 'running';
}

/**
 * Gets the current animation state
 */
export function getAnimationState(element: SVGElement): {
  isRunning: boolean;
  isPaused: boolean;
  currentTime: number;
} {
  const animations = element.getAnimations();
  const animation = animations[0] as Animation | undefined;

  return {
    isRunning: animation ? animation.playState === 'running' : false,
    isPaused: animation ? animation.playState === 'paused' : false,
    currentTime: (animation?.currentTime as number) ?? 0,
  };
}

// Helper functions

/**
 * Converts camelCase to kebab-case
 */
function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Formats duration value
 */
function formatDuration(value: number | string | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return `${value}ms`;
  return value;
}

/**
 * Generate keyframes string from configuration
 *
 * Utility function to generate CSS keyframes string without injecting it.
 * Useful for SSR or custom stylesheet management.
 *
 * @param name - Animation name
 * @param keyframes - Keyframes configuration
 * @returns CSS keyframes string
 *
 * @example
 * ```typescript
 * const css = generateKeyframes('myAnimation', {
 *   '0%': { opacity: 0 },
 *   '100%': { opacity: 1 }
 * });
 * ```
 */
export function generateKeyframes(name: string, keyframes: Record<string, Record<string, string | number>>): string {
  const keyframesCSS = Object.entries(keyframes)
    .map(([key, styles]) => {
      const styleString = Object.entries(styles)
        .map(([prop, value]) => `${camelToKebab(prop)}: ${value}`)
        .join('; ');
      return `  ${key} { ${styleString}; }`;
    })
    .join('\n');

  return `@keyframes ${name} {\n${keyframesCSS}\n}`;
}

/**
 * Compose multiple animations into a single animation string
 *
 * @param animations - Array of animation configurations
 * @returns Combined animation string
 *
 * @example
 * ```typescript
 * const element = document.querySelector('circle');
 * element.style.animation = cssAnimation([
 *   { name: 'spin', duration: '2s' },
 *   { name: 'pulse', duration: '1s', delay: '0.5s' }
 * ]);
 * ```
 */
export function cssAnimation(
  animations: Array<{
    name: string;
    duration?: string | number;
    delay?: string | number;
    timingFunction?: string;
    iterationCount?: number | 'infinite';
    direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
    fillMode?: 'none' | 'forwards' | 'backwards' | 'both';
  }>
): string {
  return animations
    .map((anim) => {
      const parts = [
        anim.name,
        formatDuration(anim.duration),
        anim.timingFunction || '',
        formatDuration(anim.delay),
        anim.iterationCount !== undefined ? String(anim.iterationCount) : '',
        anim.direction || '',
        anim.fillMode || '',
      ].filter(Boolean);
      return parts.join(' ');
    })
    .join(', ');
}

/**
 * Predefined animation presets
 *
 * Collection of common SVG animation patterns ready to use.
 * Each preset returns a CSSAnimationConfig that can be passed to
 * createCSSAnimation() or applyCSSAnimation().
 *
 * @example
 * ```typescript
 * // Use a preset
 * applyCSSAnimation(element, animationPresets.spin(2000));
 *
 * // Customize a preset
 * const customPulse = animationPresets.pulse(1000);
 * customPulse.timingFunction = 'cubic-bezier(0.4, 0, 0.6, 1)';
 * applyCSSAnimation(element, customPulse);
 * ```
 */
export const animationPresets = {
  /**
   * Continuous rotation animation
   */
  spin: (duration = 2000): CSSAnimationConfig => ({
    keyframes: {
      '0%': { transform: 'rotate(0deg)' },
      '100%': { transform: 'rotate(360deg)' },
    },
    duration,
    iterationCount: 'infinite',
    timingFunction: 'linear',
  }),

  /**
   * Pulsing opacity animation
   */
  pulse: (duration = 2000): CSSAnimationConfig => ({
    keyframes: {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.5 },
    },
    duration,
    iterationCount: 'infinite',
    timingFunction: 'ease-in-out',
  }),

  /**
   * Bouncing animation
   */
  bounce: (duration = 1000): CSSAnimationConfig => ({
    keyframes: {
      '0%, 100%': { transform: 'translateY(0)' },
      '50%': { transform: 'translateY(-10px)' },
    },
    duration,
    iterationCount: 'infinite',
    timingFunction: 'ease-in-out',
  }),

  /**
   * Fade in or out animation
   */
  fade: (duration = 500, direction: 'in' | 'out' = 'in'): CSSAnimationConfig => ({
    keyframes:
      direction === 'in'
        ? {
            '0%': { opacity: 0 },
            '100%': { opacity: 1 },
          }
        : {
            '0%': { opacity: 1 },
            '100%': { opacity: 0 },
          },
    duration,
    fillMode: 'forwards',
  }),

  /**
   * Scale animation
   */
  scale: (duration = 500, from = 0, to = 1): CSSAnimationConfig => ({
    keyframes: {
      '0%': { transform: `scale(${from})` },
      '100%': { transform: `scale(${to})` },
    },
    duration,
    fillMode: 'forwards',
  }),

  /**
   * Shake animation (horizontal)
   */
  shake: (duration = 500): CSSAnimationConfig => ({
    keyframes: {
      '0%, 100%': { transform: 'translateX(0)' },
      '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-5px)' },
      '20%, 40%, 60%, 80%': { transform: 'translateX(5px)' },
    },
    duration,
  }),

  /**
   * Slide animation
   */
  slide: (
    duration = 500,
    direction: 'left' | 'right' | 'up' | 'down' = 'left',
    distance = '100%'
  ): CSSAnimationConfig => {
    const transforms: Record<string, string> = {
      left: `translateX(-${distance})`,
      right: `translateX(${distance})`,
      up: `translateY(-${distance})`,
      down: `translateY(${distance})`,
    };

    return {
      keyframes: {
        '0%': { transform: transforms[direction] || 'translate(0, 0)' },
        '100%': { transform: 'translate(0, 0)' },
      },
      duration,
      fillMode: 'forwards',
      timingFunction: 'ease-out',
    };
  },

  /**
   * Wiggle animation
   */
  wiggle: (duration = 500): CSSAnimationConfig => ({
    keyframes: {
      '0%, 100%': { transform: 'rotate(0deg)' },
      '25%': { transform: 'rotate(-5deg)' },
      '75%': { transform: 'rotate(5deg)' },
    },
    duration,
    iterationCount: 3,
  }),
};
