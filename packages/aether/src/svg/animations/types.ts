/**
 * Animation Types
 *
 * Type definitions for SVG animation system
 */

export type EasingFunction =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'cubic-bezier'
  | ((t: number) => number);

export interface AnimationConfig {
  // Target element
  target?: string; // CSS selector for target element

  // Properties to animate
  property?: string | string[];
  from?: any;
  to?: any;

  // Timing
  duration?: number;
  delay?: number;
  easing?: EasingFunction | string;

  // Animation type
  type?: 'css' | 'transform' | 'path' | 'morph' | 'draw' | 'pulse' | 'spin' | 'fade';

  // Playback
  loop?: boolean | number;
  alternate?: boolean;
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';

  // Callbacks
  onStart?: () => void;
  onComplete?: () => void;
  onUpdate?: (progress: number) => void;
}

export interface TimelineConfig {
  animations: AnimationConfig[];
  duration?: number;
  stagger?: number;
  overlap?: number;
}

export interface SpringConfig {
  stiffness?: number;
  damping?: number;
  mass?: number;
  velocity?: number;
}

export interface MorphOptions {
  precision?: number;
  optimize?: boolean;
}

export interface DrawOptions {
  duration?: number;
  delay?: number;
  easing?: EasingFunction;
  reverse?: boolean;
}

export interface AnimationController {
  play(): void;
  pause(): void;
  stop(): void;
  reverse(): void;
  seek(progress: number): void;
  speed(factor: number): void;
  then(callback: () => void): AnimationController;
}

export interface TimelineController extends AnimationController {
  add(animation: AnimationConfig, position?: number | string): void;
  remove(animation: AnimationConfig): void;
  clear(): void;
}

// SMIL Animation Types
export interface SMILAnimationProps {
  // Timing
  begin?: string | number;
  dur?: string | number;
  end?: string | number;
  min?: string | number;
  max?: string | number;
  repeatCount?: number | 'indefinite';
  repeatDur?: string | number;
  fill?: 'freeze' | 'remove';

  // Animation
  calcMode?: 'discrete' | 'linear' | 'paced' | 'spline';
  keyTimes?: string;
  keySplines?: string;
  from?: string | number;
  to?: string | number;
  by?: string | number;
  values?: string;

  // Target
  attributeName: string;
  attributeType?: 'CSS' | 'XML' | 'auto';
  additive?: 'replace' | 'sum';
  accumulate?: 'none' | 'sum';
}

export interface SMILMotionProps extends Omit<SMILAnimationProps, 'attributeName'> {
  path?: string;
  keyPoints?: string;
  rotate?: 'auto' | 'auto-reverse' | number;
}

export interface SMILTransformProps extends SMILAnimationProps {
  type: 'translate' | 'scale' | 'rotate' | 'skewX' | 'skewY';
}

// CSS Animation Types
export interface CSSAnimationConfig {
  // Keyframes
  keyframes: Record<string, Record<string, string | number>>;

  // Timing
  duration?: number | string;
  delay?: number | string;
  timingFunction?: string;
  iterationCount?: number | 'infinite';
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fillMode?: 'none' | 'forwards' | 'backwards' | 'both';
  playState?: 'running' | 'paused';
}

// JavaScript Animation Types
export interface JSAnimationConfig {
  // Target
  target: Element | string;

  // Properties to animate
  props: Record<string, {
    from?: any;
    to?: any;
    through?: any[]; // Intermediate values
  }>;

  // Timing
  duration?: number;
  delay?: number;
  easing?: EasingFunction;

  // Spring physics
  spring?: SpringConfig;

  // Playback
  loop?: boolean | number;
  alternate?: boolean;

  // Callbacks
  onUpdate?: (progress: number, values: Record<string, any>) => void;
  onComplete?: () => void;
}

// Path Animation Types
export interface PathAnimationConfig {
  // Path morphing
  morph?: {
    from: string;
    to: string;
    precision?: number;
  };

  // Path drawing
  draw?: {
    duration?: number;
    delay?: number;
    easing?: EasingFunction;
    reverse?: boolean;
  };

  // Motion along path
  motion?: {
    path: string;
    duration?: number;
    rotate?: boolean | 'auto' | 'auto-reverse';
    offset?: { x?: number; y?: number };
  };
}