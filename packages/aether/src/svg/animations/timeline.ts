/**
 * Timeline Controller
 *
 * Controls timeline-based animations with stagger and overlap support
 */

import type { AnimationConfig, TimelineController as ITimelineController } from './types.js';
import { SVGAnimator } from './spring.js';

export class TimelineController implements ITimelineController {
  private animations: Array<{
    config: AnimationConfig;
    position: number;
    controller?: any;
  }> = [];

  private currentTime = 0;
  private duration = 0;
  private isPlaying = false;
  private isPausedState = false;
  private speedFactor = 1;
  private startTime: number | null = null;
  private pausedTime = 0;
  private animationId: number | null = null;
  private stagger = 0;
  private overlap = 0;

  private animator = new SVGAnimator();

  constructor(config?: { stagger?: number; overlap?: number }) {
    this.stagger = config?.stagger ?? 0;
    this.overlap = config?.overlap ?? 0;
  }

  /**
   * Add animation to timeline
   */
  add(animation: AnimationConfig, position?: number | string): void {
    let pos: number;

    if (position === undefined) {
      // Add at end
      pos = this.duration;
    } else if (typeof position === 'number') {
      pos = position;
    } else {
      // Parse position string (e.g., "+=100", "-=50", "50%")
      if (position.startsWith('+=')) {
        pos = this.duration + parseFloat(position.slice(2));
      } else if (position.startsWith('-=')) {
        pos = this.duration - parseFloat(position.slice(2));
      } else if (position.endsWith('%')) {
        const percent = parseFloat(position) / 100;
        pos = this.duration * percent;
      } else {
        pos = parseFloat(position);
      }
    }

    // Apply stagger
    if (this.animations.length > 0 && this.stagger > 0) {
      pos = this.duration + this.stagger;
    }

    // Apply overlap
    if (this.overlap > 0 && this.animations.length > 0) {
      pos = Math.max(0, this.duration - this.overlap);
    }

    this.animations.push({ config: animation, position: pos });

    // Recalculate total duration
    const animDuration = animation.duration ?? 1000;
    this.duration = Math.max(this.duration, pos + animDuration);
  }

  /**
   * Remove animation from timeline
   */
  remove(animation: AnimationConfig): void {
    const index = this.animations.findIndex((a) => a.config === animation);
    if (index !== -1) {
      this.animations.splice(index, 1);
      this.recalculateDuration();
    }
  }

  /**
   * Clear all animations
   */
  clear(): void {
    this.stop();
    this.animations = [];
    this.duration = 0;
    this.currentTime = 0;
  }

  /**
   * Play timeline
   */
  play(): void {
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.isPausedState = false;

    const animate = (timestamp: number) => {
      if (!this.isPlaying || this.isPausedState) return;

      if (!this.startTime) {
        this.startTime = timestamp - this.pausedTime;
      }

      const elapsed = timestamp - this.startTime;
      this.currentTime = Math.min((elapsed * this.speedFactor), this.duration);

      // Update active animations
      this.updateAnimations(this.currentTime);

      if (this.currentTime < this.duration) {
        this.animationId = requestAnimationFrame(animate);
      } else {
        // Timeline complete
        this.isPlaying = false;
        this.onComplete();
      }
    };

    this.animationId = requestAnimationFrame(animate);
  }

  /**
   * Pause timeline
   */
  pause(): void {
    this.isPausedState = true;
    if (this.startTime) {
      this.pausedTime = performance.now() - this.startTime;
    }
  }

  /**
   * Stop timeline
   */
  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.isPlaying = false;
    this.isPausedState = false;
    this.currentTime = 0;
    this.startTime = null;
    this.pausedTime = 0;

    // Stop all active controllers
    this.animations.forEach((anim) => {
      if (anim.controller) {
        anim.controller.stop();
      }
    });
  }

  /**
   * Reverse timeline
   */
  reverse(): void {
    // Reverse all animations
    this.animations.reverse();
    this.recalculateDuration();

    // If playing, restart
    if (this.isPlaying) {
      this.stop();
      this.play();
    }
  }

  /**
   * Seek to specific time in timeline
   */
  seek(progress: number): void {
    const targetTime = this.duration * progress;
    this.currentTime = targetTime;
    this.pausedTime = targetTime;
    this.updateAnimations(targetTime);
  }

  /**
   * Set playback speed
   */
  speed(factor: number): void {
    this.speedFactor = factor;
  }

  /**
   * Chain callback to execute after timeline completes
   */
  then(callback: () => void): ITimelineController {
    this.onComplete = callback;
    return this;
  }

  // Private methods

  private updateAnimations(currentTime: number): void {
    for (const anim of this.animations) {
      const animStart = anim.position;
      const animDuration = anim.config.duration ?? 1000;
      const animEnd = animStart + animDuration;

      // Check if animation should be active at current time
      if (currentTime >= animStart && currentTime <= animEnd) {
        const localProgress = (currentTime - animStart) / animDuration;

        // Trigger animation if not started
        if (!anim.controller) {
          anim.config.onStart?.();
          // In a real implementation, we'd create and manage individual animation controllers
          // For now, we just call the update callback
        }

        anim.config.onUpdate?.(localProgress);
      }

      // Complete animation if past its end time
      if (currentTime > animEnd && anim.controller) {
        anim.config.onComplete?.();
        anim.controller = null;
      }
    }
  }

  private recalculateDuration(): void {
    this.duration = 0;
    for (const anim of this.animations) {
      const animDuration = anim.config.duration ?? 1000;
      const end = anim.position + animDuration;
      this.duration = Math.max(this.duration, end);
    }
  }

  private onComplete: () => void = () => {};
}

/**
 * Create a timeline with stagger effect
 */
export function createStaggerTimeline(
  animations: AnimationConfig[],
  staggerDelay: number
): TimelineController {
  const timeline = new TimelineController({ stagger: staggerDelay });
  animations.forEach((anim) => timeline.add(anim));
  return timeline;
}

/**
 * Create a timeline with overlap
 */
export function createOverlapTimeline(
  animations: AnimationConfig[],
  overlapAmount: number
): TimelineController {
  const timeline = new TimelineController({ overlap: overlapAmount });
  animations.forEach((anim) => timeline.add(anim));
  return timeline;
}

/**
 * Create a parallel timeline (all animations start together)
 */
export function createParallelTimeline(
  animations: AnimationConfig[]
): TimelineController {
  const timeline = new TimelineController();
  animations.forEach((anim) => timeline.add(anim, 0));
  return timeline;
}

/**
 * Create a sequential timeline (animations play one after another)
 */
export function createSequentialTimeline(
  animations: AnimationConfig[]
): TimelineController {
  const timeline = new TimelineController();
  let position = 0;
  animations.forEach((anim) => {
    timeline.add(anim, position);
    position += anim.duration ?? 1000;
  });
  return timeline;
}
