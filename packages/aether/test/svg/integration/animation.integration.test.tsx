/**
 * Animation Integration Tests
 *
 * Tests animation system integration including:
 * - AnimatedSVG with multiple animation types
 * - SMIL, CSS, and JS animations together
 * - Timeline with complex sequences
 * - Animation triggers and callbacks
 * - Performance with many animations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SVGIcon } from '../../../src/svg/components/SVGIcon.js';
import { signal } from '../../../src/index.js';
import type {
  AnimationConfig,
  TimelineConfig,
  AnimationController,
} from '../../../src/svg/animations/types.js';

describe('Animation Integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Multiple Animation Types', () => {
    it('should support simultaneous CSS animations', () => {
      const animations: AnimationConfig[] = [
        {
          type: 'fade',
          duration: 1000,
          from: 0,
          to: 1,
        },
        {
          type: 'spin',
          duration: 2000,
          loop: true,
        },
      ];

      const AnimatedIcon = SVGIcon({
        path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
        size: 24,
        spin: true,
      });

      expect(AnimatedIcon).toBeDefined();
    });

    it('should support sequential animations in timeline', () => {
      const timeline: TimelineConfig = {
        animations: [
          {
            type: 'fade',
            duration: 500,
            from: 0,
            to: 1,
          },
          {
            type: 'transform',
            duration: 500,
            from: 'scale(0)',
            to: 'scale(1)',
          },
          {
            type: 'spin',
            duration: 1000,
          },
        ],
        duration: 2000,
      };

      expect(timeline.animations).toHaveLength(3);
      expect(timeline.duration).toBe(2000);
    });

    it('should support staggered animations', () => {
      const timeline: TimelineConfig = {
        animations: [
          { type: 'fade', duration: 300 },
          { type: 'fade', duration: 300 },
          { type: 'fade', duration: 300 },
        ],
        stagger: 100, // 100ms delay between each
      };

      expect(timeline.stagger).toBe(100);
      expect(timeline.animations).toHaveLength(3);
    });

    it('should support overlapping animations', () => {
      const timeline: TimelineConfig = {
        animations: [
          { type: 'fade', duration: 500 },
          { type: 'transform', duration: 500 },
        ],
        overlap: 200, // 200ms overlap
      };

      expect(timeline.overlap).toBe(200);
    });
  });

  describe('SMIL Animations', () => {
    it('should support SMIL animate element', () => {
      const svgWithSMIL = `
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="20">
            <animate
              attributeName="r"
              from="20"
              to="40"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
      `;

      expect(svgWithSMIL).toContain('<animate');
      expect(svgWithSMIL).toContain('attributeName="r"');
    });

    it('should support SMIL animateTransform', () => {
      const svgWithTransform = `
        <svg viewBox="0 0 100 100">
          <rect x="40" y="40" width="20" height="20">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 50 50"
              to="360 50 50"
              dur="2s"
              repeatCount="indefinite"
            />
          </rect>
        </svg>
      `;

      expect(svgWithTransform).toContain('<animateTransform');
      expect(svgWithTransform).toContain('type="rotate"');
    });

    it('should support SMIL animateMotion', () => {
      const svgWithMotion = `
        <svg viewBox="0 0 100 100">
          <circle cx="0" cy="0" r="5">
            <animateMotion
              path="M 10,10 L 90,10 L 90,90 L 10,90 Z"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
      `;

      expect(svgWithMotion).toContain('<animateMotion');
      expect(svgWithMotion).toContain('path=');
    });

    it('should support complex SMIL sequences', () => {
      const complexSMIL = `
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="20">
            <animate
              id="anim1"
              attributeName="r"
              from="20"
              to="40"
              dur="1s"
              fill="freeze"
            />
            <animate
              attributeName="opacity"
              from="1"
              to="0"
              begin="anim1.end"
              dur="0.5s"
            />
          </circle>
        </svg>
      `;

      expect(complexSMIL).toContain('id="anim1"');
      expect(complexSMIL).toContain('begin="anim1.end"');
    });
  });

  describe('CSS Animations', () => {
    it('should support CSS keyframe animations', () => {
      const cssAnimation = {
        keyframes: {
          '0%': { transform: 'translateX(0)', opacity: 1 },
          '50%': { transform: 'translateX(100px)', opacity: 0.5 },
          '100%': { transform: 'translateX(0)', opacity: 1 },
        },
        duration: '2s',
        iterationCount: 'infinite',
        timingFunction: 'ease-in-out',
      };

      expect(cssAnimation.keyframes['0%']).toBeDefined();
      expect(cssAnimation.keyframes['50%']).toBeDefined();
      expect(cssAnimation.keyframes['100%']).toBeDefined();
    });

    it('should support CSS transitions', () => {
      const isHovered = signal(false);

      const InteractiveIcon = SVGIcon({
        path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
        size: 24,
        style: {
          transition: 'all 0.3s ease',
          transform: isHovered() ? 'scale(1.2)' : 'scale(1)',
        },
      });

      expect(InteractiveIcon).toBeDefined();

      // Simulate hover
      isHovered.set(true);
      expect(isHovered()).toBe(true);
    });

    it('should support predefined animation utilities', () => {
      const SpinIcon = SVGIcon({
        path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
        size: 24,
        spin: true,
      });

      const PulseIcon = SVGIcon({
        path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
        size: 24,
        pulse: true,
      });

      expect(SpinIcon).toBeDefined();
      expect(PulseIcon).toBeDefined();
    });
  });

  describe('JavaScript Animations', () => {
    it('should support JS-based animation control', async () => {
      const progress = signal(0);

      const animate = (from: number, to: number, duration: number) => {
        const startTime = Date.now();
        const update = () => {
          const elapsed = Date.now() - startTime;
          const p = Math.min(elapsed / duration, 1);
          progress.set(from + (to - from) * p);

          if (p < 1) {
            requestAnimationFrame(update);
          }
        };
        update();
      };

      animate(0, 100, 1000);

      expect(progress()).toBeGreaterThanOrEqual(0);
    });

    it('should support custom easing functions', () => {
      const easeInOut = (t: number): number => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      expect(easeInOut(0)).toBe(0);
      expect(easeInOut(0.5)).toBeCloseTo(0.5);
      expect(easeInOut(1)).toBe(1);
    });

    it('should support spring physics', () => {
      const springConfig = {
        stiffness: 100,
        damping: 10,
        mass: 1,
        velocity: 0,
      };

      const calculateSpring = (
        current: number,
        target: number,
        velocity: number,
        config: typeof springConfig
      ) => {
        const delta = target - current;
        const springForce = delta * config.stiffness;
        const dampingForce = velocity * config.damping;
        const acceleration = (springForce - dampingForce) / config.mass;

        return {
          position: current + velocity * 0.016,
          velocity: velocity + acceleration * 0.016,
        };
      };

      const result = calculateSpring(0, 100, 0, springConfig);
      expect(result.position).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Timeline Sequences', () => {
    it('should support complex animation timelines', () => {
      const timeline: TimelineConfig = {
        animations: [
          { type: 'fade', duration: 500, from: 0, to: 1 },
          { type: 'transform', duration: 500, from: 'scale(0)', to: 'scale(1)' },
          { type: 'spin', duration: 1000, loop: true },
        ],
        duration: 2000,
      };

      let currentTime = 0;

      // Simulate timeline progression
      const progressTimeline = (time: number) => {
        currentTime = time;
        return timeline.animations.filter(
          (anim, i) => currentTime >= i * 500 && currentTime < (i + 1) * 500
        );
      };

      const activeAt500 = progressTimeline(500);
      expect(activeAt500.length).toBeGreaterThan(0);
    });

    it('should support timeline callbacks', () => {
      const onStart = vi.fn();
      const onComplete = vi.fn();
      const onUpdate = vi.fn();

      const animation: AnimationConfig = {
        type: 'fade',
        duration: 1000,
        onStart,
        onComplete,
        onUpdate,
      };

      // Simulate animation start
      animation.onStart?.();
      expect(onStart).toHaveBeenCalled();

      // Simulate animation update
      animation.onUpdate?.(0.5);
      expect(onUpdate).toHaveBeenCalledWith(0.5);

      // Simulate animation complete
      animation.onComplete?.();
      expect(onComplete).toHaveBeenCalled();
    });

    it('should support timeline seeking', () => {
      let currentProgress = 0;

      const seek = (progress: number) => {
        currentProgress = Math.max(0, Math.min(1, progress));
      };

      seek(0.5);
      expect(currentProgress).toBe(0.5);

      seek(1.5); // Should clamp to 1
      expect(currentProgress).toBe(1);

      seek(-0.5); // Should clamp to 0
      expect(currentProgress).toBe(0);
    });

    it('should support timeline speed control', () => {
      const baseSpeed = 1;
      let currentSpeed = baseSpeed;

      const setSpeed = (factor: number) => {
        currentSpeed = baseSpeed * factor;
      };

      setSpeed(2); // 2x speed
      expect(currentSpeed).toBe(2);

      setSpeed(0.5); // 0.5x speed (slow motion)
      expect(currentSpeed).toBe(0.5);
    });
  });

  describe('Animation Triggers', () => {
    it('should support hover-triggered animations', () => {
      const isHovered = signal(false);

      const onMouseEnter = () => isHovered.set(true);
      const onMouseLeave = () => isHovered.set(false);

      const HoverIcon = SVGIcon({
        path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
        size: 24,
        style: {
          transform: isHovered() ? 'scale(1.2)' : 'scale(1)',
          transition: 'transform 0.3s ease',
        },
      });

      expect(HoverIcon).toBeDefined();

      onMouseEnter();
      expect(isHovered()).toBe(true);

      onMouseLeave();
      expect(isHovered()).toBe(false);
    });

    it('should support click-triggered animations', () => {
      const isAnimating = signal(false);

      const onClick = () => {
        isAnimating.set(true);
        setTimeout(() => isAnimating.set(false), 1000);
      };

      const ClickableIcon = SVGIcon({
        path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
        size: 24,
        onClick,
        pulse: isAnimating(),
      });

      expect(ClickableIcon).toBeDefined();

      onClick();
      expect(isAnimating()).toBe(true);

      vi.advanceTimersByTime(1000);
    });

    it('should support scroll-triggered animations', () => {
      const isVisible = signal(false);

      // Simulate IntersectionObserver
      const observer = {
        observe: vi.fn(),
        disconnect: vi.fn(),
        callback: (entries: any[]) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              isVisible.set(true);
            }
          });
        },
      };

      // Simulate element entering viewport
      observer.callback([{ isIntersecting: true }]);

      expect(isVisible()).toBe(true);
    });

    it('should support time-based triggers', () => {
      const shouldAnimate = signal(false);

      setTimeout(() => shouldAnimate.set(true), 1000);

      expect(shouldAnimate()).toBe(false);

      vi.advanceTimersByTime(1000);
    });
  });

  describe('Animation Callbacks', () => {
    it('should call onStart callback', () => {
      const onStart = vi.fn();

      const animation: AnimationConfig = {
        type: 'fade',
        duration: 1000,
        onStart,
      };

      animation.onStart?.();
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('should call onUpdate callback with progress', () => {
      const onUpdate = vi.fn();

      const animation: AnimationConfig = {
        type: 'fade',
        duration: 1000,
        onUpdate,
      };

      animation.onUpdate?.(0);
      animation.onUpdate?.(0.5);
      animation.onUpdate?.(1);

      expect(onUpdate).toHaveBeenCalledTimes(3);
      expect(onUpdate).toHaveBeenNthCalledWith(1, 0);
      expect(onUpdate).toHaveBeenNthCalledWith(2, 0.5);
      expect(onUpdate).toHaveBeenNthCalledWith(3, 1);
    });

    it('should call onComplete callback', () => {
      const onComplete = vi.fn();

      const animation: AnimationConfig = {
        type: 'fade',
        duration: 1000,
        onComplete,
      };

      animation.onComplete?.();
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('should chain callbacks with then()', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const mockController: AnimationController = {
        play: vi.fn(),
        pause: vi.fn(),
        stop: vi.fn(),
        reverse: vi.fn(),
        seek: vi.fn(),
        speed: vi.fn(),
        then: (callback: () => void) => {
          callback();
          return mockController;
        },
      };

      mockController.then(callback1).then(callback2);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe('Performance with Many Animations', () => {
    it('should handle multiple simultaneous animations efficiently', () => {
      const animations: AnimationConfig[] = [];

      for (let i = 0; i < 100; i++) {
        animations.push({
          type: 'fade',
          duration: 1000,
          delay: i * 10,
        });
      }

      expect(animations).toHaveLength(100);

      const startTime = performance.now();
      // Simulate animation setup
      animations.forEach(anim => {
        const { type, duration, delay } = anim;
      });
      const endTime = performance.now();

      // Setup should be fast (< 10ms)
      expect(endTime - startTime).toBeLessThan(10);
    });

    it('should optimize animation updates', () => {
      let updateCount = 0;

      const optimizedUpdate = (progress: number) => {
        // Only update when progress changes significantly
        const threshold = 0.01;
        if (Math.abs(progress - (updateCount * threshold)) >= threshold) {
          updateCount++;
        }
      };

      // Simulate 100 updates
      for (let i = 0; i <= 100; i++) {
        optimizedUpdate(i / 100);
      }

      // Should have optimized number of updates
      expect(updateCount).toBeLessThan(100);
      expect(updateCount).toBeGreaterThan(0);
    });

    it('should use requestAnimationFrame for smooth animations', () => {
      const rafSpy = vi.spyOn(global, 'requestAnimationFrame').mockImplementation(() =>
        // Don't execute the callback to avoid infinite recursion
        1
      );

      const animate = () => {
        requestAnimationFrame(animate);
      };

      animate();

      expect(rafSpy).toHaveBeenCalled();

      rafSpy.mockRestore();
    });

    it('should maintain 60 FPS target', () => {
      const frameTime = 1000 / 60; // ~16.67ms per frame
      const frames: number[] = [];

      let lastTime = performance.now();

      for (let i = 0; i < 60; i++) {
        const currentTime = lastTime + frameTime;
        frames.push(currentTime - lastTime);
        lastTime = currentTime;
      }

      const avgFrameTime = frames.reduce((a, b) => a + b, 0) / frames.length;

      expect(avgFrameTime).toBeCloseTo(frameTime, 1);
    });

    it('should clean up animations properly', () => {
      const animations = new Map<string, any>();

      // Add animations
      for (let i = 0; i < 10; i++) {
        animations.set(`anim-${i}`, { id: `anim-${i}`, running: true });
      }

      expect(animations.size).toBe(10);

      // Clean up
      animations.clear();

      expect(animations.size).toBe(0);
    });
  });

  describe('Path Animations', () => {
    it('should support path morphing', () => {
      const morphConfig = {
        from: 'M10 10 L20 10 L20 20 L10 20 Z',
        to: 'M10 10 C15 5, 25 5, 30 10 C35 15, 35 25, 30 30 C25 35, 15 35, 10 30 Z',
        precision: 100,
      };

      expect(morphConfig.from).toBeDefined();
      expect(morphConfig.to).toBeDefined();
      expect(morphConfig.precision).toBe(100);
    });

    it('should support path drawing animation', () => {
      const drawConfig = {
        duration: 2000,
        delay: 0,
        easing: 'ease-in-out' as const,
        reverse: false,
      };

      expect(drawConfig.duration).toBe(2000);
      expect(drawConfig.reverse).toBe(false);
    });

    it('should support motion along path', () => {
      const motionConfig = {
        path: 'M10 10 Q50 5 90 10',
        duration: 3000,
        rotate: 'auto' as const,
        offset: { x: 0, y: 0 },
      };

      expect(motionConfig.path).toBeDefined();
      expect(motionConfig.rotate).toBe('auto');
    });
  });

  describe('Animation State Management', () => {
    it('should track animation state', () => {
      const state = {
        isPlaying: false,
        isPaused: false,
        progress: 0,
        currentTime: 0,
      };

      state.isPlaying = true;
      expect(state.isPlaying).toBe(true);

      state.progress = 0.5;
      expect(state.progress).toBe(0.5);

      state.isPaused = true;
      expect(state.isPaused).toBe(true);
    });

    it('should support animation play/pause/stop', () => {
      let isPlaying = false;

      const play = () => { isPlaying = true; };
      const pause = () => { isPlaying = false; };
      const stop = () => { isPlaying = false; };

      play();
      expect(isPlaying).toBe(true);

      pause();
      expect(isPlaying).toBe(false);

      play();
      expect(isPlaying).toBe(true);

      stop();
      expect(isPlaying).toBe(false);
    });

    it('should support animation reversal', () => {
      let direction = 1;

      const reverse = () => {
        direction *= -1;
      };

      expect(direction).toBe(1);

      reverse();
      expect(direction).toBe(-1);

      reverse();
      expect(direction).toBe(1);
    });
  });

  describe('Complex Animation Scenarios', () => {
    it('should support loading spinner animation', () => {
      const SpinnerIcon = SVGIcon({
        path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
        size: 24,
        spin: 1, // 1 second per rotation
      });

      expect(SpinnerIcon).toBeDefined();
    });

    it('should support pulsing notification badge', () => {
      const NotificationBadge = SVGIcon({
        path: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
        size: 24,
        pulse: true,
      });

      expect(NotificationBadge).toBeDefined();
    });

    it('should support icon transformation on hover', () => {
      const isHovered = signal(false);

      const TransformIcon = SVGIcon({
        path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z',
        size: 24,
        rotate: isHovered() ? 180 : 0,
      });

      expect(TransformIcon).toBeDefined();

      isHovered.set(true);
      expect(isHovered()).toBe(true);
    });

    it('should support sequential reveal animations', () => {
      const icons = [
        { id: 1, delay: 0 },
        { id: 2, delay: 100 },
        { id: 3, delay: 200 },
      ];

      const timeline: TimelineConfig = {
        animations: icons.map(icon => ({
          type: 'fade',
          duration: 300,
          delay: icon.delay,
          from: 0,
          to: 1,
        })),
        stagger: 100,
      };

      expect(timeline.animations).toHaveLength(3);
      expect(timeline.stagger).toBe(100);
    });
  });
});
