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