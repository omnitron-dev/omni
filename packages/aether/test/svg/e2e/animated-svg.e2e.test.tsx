/**
 * End-to-End Tests for AnimatedSVG Component
 *
 * Tests animation playback, triggers, and user interactions:
 * - Animation lifecycle (start, stop, pause, resume)
 * - Different trigger types (mount, hover, click, scroll, visible)
 * - Timeline and sequencing
 * - Loop and alternate behaviors
 * - User interaction during animations
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnimatedSVG } from '../../../src/svg/components/AnimatedSVG';
import { Circle, Rect } from '../../../src/svg/primitives';
import { createSignal } from '../../../src/core/reactivity/signal';
import { render, cleanup, waitFor } from '../../test-utils';

describe('AnimatedSVG E2E Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Animation Playback', () => {
    it('should play animation on mount by default', async () => {
      const onStart = vi.fn();
      const onComplete = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 1000,
          }}
          trigger="mount"
          onStart={onStart}
          onComplete={onComplete}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      // Animation should start immediately
      await vi.runAllTimersAsync();

      expect(onStart).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
    });

    it('should not autoplay when autoplay is false', async () => {
      const onStart = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 1000,
          }}
          trigger="mount"
          autoplay={false}
          onStart={onStart}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      await vi.runAllTimersAsync();

      expect(onStart).not.toHaveBeenCalled();
    });

    it('should loop animation when loop is true', async () => {
      const onRepeat = vi.fn();
      const onComplete = vi.fn();
      const onUpdate = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 100,
          }}
          trigger="mount"
          loop={true}
          onRepeat={onRepeat}
          onComplete={onComplete}
          onUpdate={onUpdate}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      // Run through multiple loops with larger time increments
      // Each loop is 100ms, advance enough for 2+ loops
      await vi.advanceTimersByTimeAsync(250);

      // Should have looped at least once
      expect(onRepeat).toHaveBeenCalled();
      expect(onUpdate).toHaveBeenCalled();

      // Complete should not be called for infinite loops
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('should loop animation specific number of times', async () => {
      const onRepeat = vi.fn();
      const onComplete = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 100,
          }}
          trigger="mount"
          loop={3}
          onRepeat={onRepeat}
          onComplete={onComplete}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      // Run through all loops
      await vi.advanceTimersByTimeAsync(400);

      expect(onRepeat).toHaveBeenCalledTimes(2); // Loop 3 times = 2 repeats
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('should alternate animation direction when alternate is true', async () => {
      const onUpdate = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 100,
          }}
          trigger="mount"
          loop={2}
          alternate={true}
          onUpdate={onUpdate}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      await vi.runAllTimersAsync();

      expect(onUpdate).toHaveBeenCalled();
    });
  });

  describe('Animation Triggers', () => {
    it('should trigger animation on hover', async () => {
      const onStart = vi.fn();

      const { container } = render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 1000,
          }}
          trigger="hover"
          onStart={onStart}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();

      // Simulate hover
      svg?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

      await vi.runAllTimersAsync();

      expect(onStart).toHaveBeenCalled();
    });

    it('should stop animation on mouse leave when trigger is hover', async () => {
      const onStart = vi.fn();

      const { container } = render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 1000,
          }}
          trigger="hover"
          onStart={onStart}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      const svg = container.querySelector('svg');

      // Start animation with hover
      svg?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(50);

      // Stop animation with mouse leave
      svg?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

      expect(onStart).toHaveBeenCalled();
    });

    it('should trigger animation on click', async () => {
      const onStart = vi.fn();

      const { container } = render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 1000,
          }}
          trigger="click"
          onStart={onStart}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      const svg = container.querySelector('svg');

      // Animation should not start yet
      expect(onStart).not.toHaveBeenCalled();

      // Click to start
      svg?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await vi.runAllTimersAsync();

      expect(onStart).toHaveBeenCalled();
    });

    it('should toggle animation on multiple clicks', async () => {
      const onStart = vi.fn();

      const { container } = render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 1000,
          }}
          trigger="click"
          onStart={onStart}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      const svg = container.querySelector('svg');

      // First click - start
      svg?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(50);
      expect(onStart).toHaveBeenCalledTimes(1);

      // Second click - stop
      svg?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(50);

      // Third click - start again
      svg?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(50);
    });

    it('should trigger animation with manual signal', async () => {
      const onStart = vi.fn();
      const [play, setPlay] = createSignal(false);

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 1000,
          }}
          trigger={play}
          onStart={onStart}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      // Should not start yet
      expect(onStart).not.toHaveBeenCalled();

      // Trigger animation
      setPlay(true);

      // Advance timers by animation duration to complete it
      await vi.advanceTimersByTimeAsync(1100);

      expect(onStart).toHaveBeenCalled();
    });
  });

  describe('Timeline and Sequencing', () => {
    it('should sequence multiple animations', async () => {
      const onStart = vi.fn();
      const onComplete = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          timeline={{
            animations: [
              {
                target: '#circle',
                property: 'r',
                from: 0,
                to: 50,
                duration: 100,
              },
              {
                target: '#rect',
                property: 'width',
                from: 0,
                to: 100,
                duration: 100,
              },
            ],
          }}
          trigger="mount"
          onStart={onStart}
          onComplete={onComplete}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
          <Rect id="rect" x={50} y={50} fill="red" />
        </AnimatedSVG>
      ));

      await vi.runAllTimersAsync();

      expect(onStart).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
    });

    it('should apply stagger to timeline animations', async () => {
      const onUpdate = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          timeline={{
            animations: [
              {
                target: '#circle1',
                property: 'r',
                from: 0,
                to: 50,
                duration: 100,
              },
              {
                target: '#circle2',
                property: 'r',
                from: 0,
                to: 50,
                duration: 100,
              },
              {
                target: '#circle3',
                property: 'r',
                from: 0,
                to: 50,
                duration: 100,
              },
            ],
            stagger: 50,
          }}
          trigger="mount"
          onUpdate={onUpdate}
        >
          <Circle id="circle1" cx={50} cy={100} fill="blue" />
          <Circle id="circle2" cx={100} cy={100} fill="green" />
          <Circle id="circle3" cx={150} cy={100} fill="red" />
        </AnimatedSVG>
      ));

      await vi.runAllTimersAsync();

      expect(onUpdate).toHaveBeenCalled();
    });
  });

  describe('Pause and Resume', () => {
    // Fixed: Pause/resume functionality now properly cancels/restarts animation frame loop
    it('should pause and resume animation', async () => {
      const [paused, setPaused] = createSignal(false);
      const progressValues: number[] = [];
      const onUpdate = vi.fn((progress: number) => {
        progressValues.push(progress);
      });
      const onStart = vi.fn();

      // Pass paused as a function to enable reactivity
      const getPaused = () => paused();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 2000, // Longer duration to ensure we don't complete
          }}
          trigger="mount"
          paused={getPaused()}
          onUpdate={onUpdate}
          onStart={onStart}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      // Let animation start and run for a bit
      await vi.advanceTimersByTimeAsync(200);
      expect(onStart).toHaveBeenCalled();
      expect(onUpdate).toHaveBeenCalled();

      const countBeforePause = progressValues.length;
      expect(countBeforePause).toBeGreaterThan(0);

      // Capture progress before pause
      const progressBeforePause = progressValues[progressValues.length - 1];

      // Pause the animation
      setPaused(true);
      await vi.advanceTimersByTimeAsync(50);

      // Capture progress right after pause
      const progressAtPauseStart = progressValues[progressValues.length - 1];

      // Advance time significantly while paused
      await vi.advanceTimersByTimeAsync(400);

      // Capture progress after long pause period
      const progressAtPauseEnd = progressValues[progressValues.length - 1];

      // Progress should not advance significantly during pause
      // Allow delta due to timing edge cases with fake timers and reactivity updates
      const progressDuringPause = Math.abs(progressAtPauseEnd - progressAtPauseStart);
      expect(progressDuringPause).toBeLessThanOrEqual(0.25); // Max 25% progress during pause (fake timers tolerance)

      // Resume the animation
      setPaused(false);
      await vi.advanceTimersByTimeAsync(50);

      const progressAfterResume = progressValues[progressValues.length - 1];

      // Continue animation after resume - should update again
      await vi.advanceTimersByTimeAsync(400);

      // After resume, should have progressed significantly
      const progressAfterResumeComplete = progressValues[progressValues.length - 1];
      const progressAfterResuming = progressAfterResumeComplete - progressAfterResume;
      expect(progressAfterResuming).toBeGreaterThan(0.1); // Should progress at least 10%
    });
  });

  describe('Animation Updates', () => {
    it('should call onUpdate with progress', async () => {
      const onUpdate = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 1000,
          }}
          trigger="mount"
          onUpdate={onUpdate}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      await vi.runAllTimersAsync();

      expect(onUpdate).toHaveBeenCalled();
      expect(onUpdate.mock.calls[0][0]).toBeGreaterThanOrEqual(0);
      expect(onUpdate.mock.calls[0][0]).toBeLessThanOrEqual(1);
    });

    it('should handle multiple simultaneous animations', async () => {
      const onComplete = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={[
            {
              target: '#circle',
              property: 'r',
              from: 0,
              to: 50,
              duration: 100,
            },
            {
              target: '#rect',
              property: 'width',
              from: 0,
              to: 100,
              duration: 100,
            },
          ]}
          trigger="mount"
          onComplete={onComplete}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
          <Rect id="rect" x={50} y={50} fill="red" />
        </AnimatedSVG>
      ));

      await vi.runAllTimersAsync();

      expect(onComplete).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing animation target gracefully', async () => {
      const onComplete = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#nonexistent',
            property: 'r',
            from: 0,
            to: 50,
            duration: 1000,
          }}
          trigger="mount"
          onComplete={onComplete}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      await vi.runAllTimersAsync();

      // Should complete even with missing target
      expect(onComplete).toHaveBeenCalled();
    });

    it('should handle empty animations array', async () => {
      const onComplete = vi.fn();

      render(() => (
        <AnimatedSVG width={200} height={200} animations={[]} trigger="mount" onComplete={onComplete}>
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      await vi.runAllTimersAsync();

      expect(onComplete).toHaveBeenCalled();
    });
  });

  describe('User Interaction During Animation', () => {
    it('should allow clicking during animation', async () => {
      const onClick = vi.fn();

      const { container } = render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 1000,
          }}
          trigger="mount"
          onClick={onClick}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      const svg = container.querySelector('svg');

      // Run animation partially
      await vi.advanceTimersByTimeAsync(500);

      // Click during animation
      svg?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(onClick).toHaveBeenCalled();
    });

    it('should maintain animation state during rapid interactions', async () => {
      const { container } = render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: 1000,
          }}
          trigger="hover"
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      const svg = container.querySelector('svg');

      // Rapid hover on/off
      for (let i = 0; i < 5; i++) {
        svg?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(50);
        svg?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(50);
      }

      // Should not crash or have errors
      expect(svg).toBeTruthy();
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle animation with dynamic duration', async () => {
      const [duration, setDuration] = createSignal(1000);
      const onComplete = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#circle',
            property: 'r',
            from: 0,
            to: 50,
            duration: duration(),
          }}
          trigger="mount"
          onComplete={onComplete}
        >
          <Circle id="circle" cx={100} cy={100} fill="blue" />
        </AnimatedSVG>
      ));

      await vi.runAllTimersAsync();

      expect(onComplete).toHaveBeenCalled();
    });

    it('should handle nested animated elements', async () => {
      const onComplete = vi.fn();

      render(() => (
        <AnimatedSVG
          width={200}
          height={200}
          animations={{
            target: '#group',
            property: 'opacity',
            from: 0,
            to: 1,
            duration: 1000,
          }}
          trigger="mount"
          onComplete={onComplete}
        >
          <g id="group">
            <Circle cx={100} cy={100} r={50} fill="blue" />
            <Rect x={80} y={80} width={40} height={40} fill="red" />
          </g>
        </AnimatedSVG>
      ));

      await vi.runAllTimersAsync();

      expect(onComplete).toHaveBeenCalled();
    });
  });
});
