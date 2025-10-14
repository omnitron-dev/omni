/**
 * JavaScript Animation Engine
 *
 * Spring-based and easing-based animation system for SVG elements
 */

import type {
  JSAnimationConfig,
  AnimationController,
  EasingFunction,
  MorphOptions,
  DrawOptions,
} from './types.js';
import { interpolatePath, animatePathDraw } from './path.js';

/**
 * Main SVG animation engine
 */
export class SVGAnimator {
  /**
   * Create a standard easing-based animation
   */
  animate(config: JSAnimationConfig): AnimationController {
    const target = this.resolveTarget(config.target);
    if (!target) {
      throw new Error('Animation target not found');
    }

    const duration = config.duration ?? 1000;
    const delay = config.delay ?? 0;
    const easing = normalizeEasing(config.easing ?? 'ease');
    const loop = config.loop ?? false;
    const loopCount = typeof loop === 'number' ? loop : loop ? Infinity : 1;

    let startTime: number | null = null;
    let animationId: number | null = null;
    let isPaused = false;
    let pausedTime = 0;
    let currentIteration = 0;
    let speedFactor = 1;
    let isReversed = false;

    const animate = (timestamp: number) => {
      if (isPaused) return;

      if (!startTime) {
        startTime = timestamp - pausedTime;
      }

      const elapsed = timestamp - startTime - delay;

      if (elapsed < 0) {
        animationId = requestAnimationFrame(animate);
        return;
      }

      let progress = Math.min((elapsed * speedFactor) / duration, 1);
      if (isReversed) progress = 1 - progress;

      const easedProgress = easing(progress);

      // Apply property changes
      const values: Record<string, any> = {};
      for (const [prop, propConfig] of Object.entries(config.props)) {
        const from = propConfig.from ?? 0;
        const to = propConfig.to ?? 1;
        const value = from + (to - from) * easedProgress;
        values[prop] = value;

        // Apply to element
        this.applyProperty(target, prop, value);
      }

      config.onUpdate?.(easedProgress, values);

      if (progress >= 1) {
        currentIteration++;
        if (currentIteration < loopCount) {
          // Continue looping
          startTime = timestamp;
          if (config.alternate) {
            isReversed = !isReversed;
          }
          animationId = requestAnimationFrame(animate);
        } else {
          // Complete
          config.onComplete?.();
        }
      } else {
        animationId = requestAnimationFrame(animate);
      }
    };

    animationId = requestAnimationFrame(animate);

    // Return controller
    return this.createController(
      () => animationId,
      (id) => (animationId = id),
      () => isPaused,
      (paused) => (isPaused = paused),
      () => startTime,
      (time) => (startTime = time),
      () => pausedTime,
      (time) => (pausedTime = time),
      (factor) => (speedFactor = factor),
      () => (isReversed = !isReversed)
    );
  }

  /**
   * Create a spring-based animation with physics
   */
  spring(config: JSAnimationConfig): AnimationController {
    const target = this.resolveTarget(config.target);
    if (!target) {
      throw new Error('Animation target not found');
    }

    const spring = config.spring ?? {};
    const stiffness = spring.stiffness ?? 100;
    const damping = spring.damping ?? 10;
    const mass = spring.mass ?? 1;
    const velocity = spring.velocity ?? 0;
    const delay = config.delay ?? 0;

    let animationId: number | null = null;
    let isPaused = false;
    let startTime: number | null = null;

    // Spring simulation state
    const state: Record<string, { position: number; velocity: number; target: number }> = {};

    // Initialize state for each property
    for (const [prop, propConfig] of Object.entries(config.props)) {
      state[prop] = {
        position: propConfig.from ?? 0,
        velocity,
        target: propConfig.to ?? 1,
      };
    }

    const animate = (timestamp: number) => {
      if (isPaused) return;

      if (!startTime) {
        startTime = timestamp;
      }

      const elapsed = timestamp - startTime;

      if (elapsed < delay) {
        animationId = requestAnimationFrame(animate);
        return;
      }

      // Fixed timestep for physics simulation
      const dt = 0.016; // ~60fps
      let hasSettled = true;

      const values: Record<string, any> = {};
      for (const [prop, propState] of Object.entries(state)) {
        // Spring physics calculation
        const springForce = -stiffness * (propState.position - propState.target);
        const dampingForce = -damping * propState.velocity;
        const acceleration = (springForce + dampingForce) / mass;

        propState.velocity += acceleration * dt;
        propState.position += propState.velocity * dt;

        values[prop] = propState.position;

        // Apply to element
        this.applyProperty(target, prop, propState.position);

        // Check if settled (position close to target and velocity near zero)
        const positionDelta = Math.abs(propState.position - propState.target);
        const velocityMagnitude = Math.abs(propState.velocity);
        if (positionDelta > 0.001 || velocityMagnitude > 0.001) {
          hasSettled = false;
        }
      }

      const progress = hasSettled ? 1 : 0.5; // Approximate progress
      config.onUpdate?.(progress, values);

      if (hasSettled) {
        config.onComplete?.();
      } else {
        animationId = requestAnimationFrame(animate);
      }
    };

    animationId = requestAnimationFrame(animate);

    return this.createController(
      () => animationId,
      (id) => (animationId = id),
      () => isPaused,
      (paused) => (isPaused = paused),
      () => startTime,
      (time) => (startTime = time),
      () => 0,
      () => {},
      () => {},
      () => {}
    );
  }

  /**
   * Create a timeline of sequential/parallel animations
   */
  timeline(configs: JSAnimationConfig[]): AnimationController {
    const controllers: AnimationController[] = [];
    let currentIndex = 0;

    const playNext = () => {
      if (currentIndex >= configs.length) return;

      const config = configs[currentIndex];
      if (!config) return;

      const controller = this.animate(config);
      controllers.push(controller);

      controller.then(() => {
        currentIndex++;
        playNext();
      });
    };

    playNext();

    // Return aggregate controller
    const aggregateController: AnimationController = {
      play: () => controllers.forEach((c) => c.play()),
      pause: () => controllers.forEach((c) => c.pause()),
      stop: () => controllers.forEach((c) => c.stop()),
      reverse: () => controllers.forEach((c) => c.reverse()),
      seek: (progress: number) => controllers.forEach((c) => c.seek(progress)),
      speed: (factor: number) => controllers.forEach((c) => c.speed(factor)),
      then: (callback: () => void) => {
        const lastController = controllers[controllers.length - 1];
        if (lastController) {
          lastController.then(callback);
        }
        return aggregateController;
      },
    };

    return aggregateController;
  }

  /**
   * Morph one path into another
   */
  morph(from: string, to: string, options?: MorphOptions): AnimationController {
    const _precision = options?.precision ?? 100;
    const duration = 1000;

    let animationId: number | null = null;
    let startTime: number | null = null;
    let isPaused = false;

    const animate = (timestamp: number) => {
      if (isPaused) return;

      if (!startTime) {
        startTime = timestamp;
      }

      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const _interpolated = interpolatePath(from, to, progress);

      // This would typically update a path element
      // For now, we just track the interpolated value

      if (progress < 1) {
        animationId = requestAnimationFrame(animate);
      }
    };

    animationId = requestAnimationFrame(animate);

    return this.createController(
      () => animationId,
      (id) => (animationId = id),
      () => isPaused,
      (paused) => (isPaused = paused),
      () => startTime,
      (time) => (startTime = time),
      () => 0,
      () => {},
      () => {},
      () => {}
    );
  }

  /**
   * Animate path drawing (stroke-dashoffset technique)
   */
  draw(path: string | SVGPathElement, options?: DrawOptions): AnimationController {
    if (typeof path === 'string') {
      throw new Error('Path element required for draw animation');
    }

    const controller = animatePathDraw(path, options);

    const animController: AnimationController = {
      play: () => controller.resume(),
      pause: controller.pause,
      stop: controller.stop,
      reverse: () => {},
      seek: () => {},
      speed: () => {},
      then: (callback: () => void) => {
        callback();
        return animController;
      },
    };

    return animController;
  }

  // Helper methods

  private resolveTarget(target: Element | string): Element | null {
    if (typeof target === 'string') {
      return document.querySelector(target);
    }
    return target;
  }

  private applyProperty(element: Element, property: string, value: any): void {
    // Handle different property types
    if (property.startsWith('attr:')) {
      // SVG attribute
      const attrName = property.slice(5);
      element.setAttribute(attrName, String(value));
    } else if (property in (element as HTMLElement).style) {
      // CSS property
      (element as HTMLElement).style[property as any] = value;
    } else {
      // Try as attribute
      element.setAttribute(property, String(value));
    }
  }

  private createController(
    getAnimationId: () => number | null,
    setAnimationId: (id: number | null) => void,
    getIsPaused: () => boolean,
    setIsPaused: (paused: boolean) => void,
    getStartTime: () => number | null,
    setStartTime: (time: number | null) => void,
    getPausedTime: () => number,
    setPausedTime: (time: number) => void,
    setSpeedFactor: (factor: number) => void,
    toggleReverse: () => void
  ): AnimationController {
    const callbacks: (() => void)[] = [];

    const controller: AnimationController = {
      play: () => {
        if (getIsPaused()) {
          setIsPaused(false);
          setAnimationId(requestAnimationFrame(() => {}));
        }
      },
      pause: () => {
        setIsPaused(true);
        const startTime = getStartTime();
        if (startTime) {
          setPausedTime(performance.now() - startTime);
        }
      },
      stop: () => {
        const id = getAnimationId();
        if (id !== null) {
          cancelAnimationFrame(id);
          setAnimationId(null);
        }
      },
      reverse: () => {
        toggleReverse();
      },
      seek: (progress: number) => {
        const duration = 1000; // Would need to track this
        setPausedTime(duration * progress);
        setStartTime(performance.now() - duration * progress);
      },
      speed: (factor: number) => {
        setSpeedFactor(factor);
      },
      then: (callback: () => void): AnimationController => {
        callbacks.push(callback);
        return controller;
      },
    };

    return controller;
  }
}

/**
 * Normalize easing function
 */
function normalizeEasing(easing: EasingFunction): (t: number) => number {
  if (typeof easing === 'function') {
    return easing;
  }

  // Predefined easing functions
  const easings: Record<string, (t: number) => number> = {
    linear: (t) => t,
    ease: (t) => cubicBezier(0.25, 0.1, 0.25, 1)(t),
    'ease-in': (t) => cubicBezier(0.42, 0, 1, 1)(t),
    'ease-out': (t) => cubicBezier(0, 0, 0.58, 1)(t),
    'ease-in-out': (t) => cubicBezier(0.42, 0, 0.58, 1)(t),
  };

  return easings[easing] ?? ((t: number) => t); // Fallback to linear
}

/**
 * Create cubic bezier easing function
 */
function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): (t: number) => number {
  return (progress: number) => {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const _ax = 1 - cx - bx;

    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;

    const sampleCurveY = (time: number) => ((ay * time + by) * time + cy) * time;

    return sampleCurveY(progress);
  };
}

/**
 * Additional easing functions
 */
export const easings = {
  linear: (t: number) => t,
  easeIn: (t: number) => t * t,
  easeOut: (t: number) => t * (2 - t),
  easeInOut: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => --t * t * t + 1,
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeInQuart: (t: number) => t * t * t * t,
  easeOutQuart: (t: number) => 1 - --t * t * t * t,
  easeInOutQuart: (t: number) =>
    t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t,
  easeInQuint: (t: number) => t * t * t * t * t,
  easeOutQuint: (t: number) => 1 + --t * t * t * t * t,
  easeInOutQuint: (t: number) =>
    t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * --t * t * t * t * t,
  elastic: (t: number) =>
    t === 0 || t === 1
      ? t
      : -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI),
  bounce: (t: number) => {
    if (t < 1 / 2.75) {
      return 7.5625 * t * t;
    } else if (t < 2 / 2.75) {
      return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    } else if (t < 2.5 / 2.75) {
      return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    } else {
      return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    }
  },
};
