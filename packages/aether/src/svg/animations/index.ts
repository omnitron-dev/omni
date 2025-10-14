/**
 * Animation System Index
 *
 * Comprehensive animation system for Aether SVG module.
 * Provides SMIL, CSS, JavaScript spring-based, path, and timeline animations.
 *
 * @module svg/animations
 *
 * @example
 * ```typescript
 * // SMIL animations (declarative)
 * import { Animate, AnimateTransform } from '@omnitron-dev/aether/svg/animations';
 *
 * // CSS animations
 * import { applyCSSAnimation, animationPresets } from '@omnitron-dev/aether/svg/animations';
 *
 * // JavaScript animations
 * import { SVGAnimator, easings } from '@omnitron-dev/aether/svg/animations';
 *
 * // Path animations
 * import { animatePathDraw, getPathLength } from '@omnitron-dev/aether/svg/animations';
 *
 * // Timeline animations
 * import { TimelineController, createStaggerTimeline } from '@omnitron-dev/aether/svg/animations';
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export * from './types.js';

// ============================================================================
// SMIL Animations (Declarative, Browser-native)
// ============================================================================

/**
 * SMIL animation components for declarative SVG animations.
 * These are browser-native and work without JavaScript execution.
 *
 * Features:
 * - Animate - Basic attribute animation
 * - AnimateTransform - Transform animations (rotate, scale, translate)
 * - AnimateMotion - Path-based motion animation
 * - AnimateColor - Color transition animations
 * - Set - Set attribute value for duration
 * - Programmatic creation helpers
 * - Signal integration for reactive updates
 */
export {
  Animate,
  AnimateMotion,
  AnimateTransform,
  AnimateColor,
  Set,
  type SetProps,
  createSMILAnimation,
  createTransformAnimation,
  createMotionAnimation,
  supportsSMIL,
} from './smil.js';

// ============================================================================
// CSS Animations (Style-based, GPU-accelerated)
// ============================================================================

/**
 * CSS animation utilities for style-based animations.
 * Leverages CSS animations for GPU-accelerated performance.
 *
 * Features:
 * - Keyframe generation and injection
 * - Animation composition
 * - Preset animations (spin, pulse, bounce, fade, etc.)
 * - Play/pause/resume controls
 * - Animation state inspection
 */
export {
  createCSSAnimation,
  applyCSSAnimation,
  generateKeyframes,
  cssAnimation,
  removeAnimation,
  pauseAnimation,
  resumeAnimation,
  getAnimationState,
  animationPresets,
} from './css.js';

// ============================================================================
// Path Animations (SVG path-specific effects)
// ============================================================================

/**
 * Path-specific animation utilities.
 * Specialized functions for SVG path manipulation and animation.
 *
 * Features:
 * - Path morphing (shape transitions)
 * - Path drawing animations (stroke-dashoffset technique)
 * - Motion along path
 * - Path length calculation
 * - Path interpolation
 * - Path manipulation (split, reverse)
 */
export {
  getPathLength,
  getPointAtLength,
  interpolatePath,
  splitPath,
  reversePath,
  animatePathDraw,
  animateMotionAlongPath,
} from './path.js';

// ============================================================================
// JavaScript Animation Engine (Spring-based physics)
// ============================================================================

/**
 * JavaScript-based animation engine with spring physics.
 * Provides fine-grained control over animations with physics-based motion.
 *
 * Features:
 * - Spring-based animations (physics simulation)
 * - Easing-based animations
 * - Path morphing
 * - Timeline support
 * - Rich easing library
 * - Full animation lifecycle control
 */
export { SVGAnimator, easings } from './spring.js';

// ============================================================================
// Timeline Controller (Complex animation orchestration)
// ============================================================================

/**
 * Timeline controller for orchestrating complex animation sequences.
 * Provides advanced timing control with stagger, overlap, and sequencing.
 *
 * Features:
 * - Sequential animations
 * - Parallel animations
 * - Stagger effects
 * - Overlap control
 * - Timeline scrubbing (seek)
 * - Playback control (play, pause, reverse, speed)
 * - Position-based animation insertion
 */
export {
  TimelineController,
  createStaggerTimeline,
  createOverlapTimeline,
  createParallelTimeline,
  createSequentialTimeline,
} from './timeline.js';

// ============================================================================
// Re-export common types for convenience
// ============================================================================

export type {
  AnimationConfig,
  AnimationController,
  TimelineController as ITimelineController,
  EasingFunction,
  SpringConfig,
  MorphOptions,
  DrawOptions,
  SMILAnimationProps,
  SMILMotionProps,
  SMILTransformProps,
  CSSAnimationConfig,
  JSAnimationConfig,
  PathAnimationConfig,
} from './types.js';
