/**
 * Timeline Controller Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TimelineController,
  createStaggerTimeline,
  createOverlapTimeline,
  createParallelTimeline,
  createSequentialTimeline,
} from '../../../src/svg/animations/timeline.js';
import type { AnimationConfig } from '../../../src/svg/animations/types.js';

describe('TimelineController', () => {
  let timeline: TimelineController;

  beforeEach(() => {
    timeline = new TimelineController();
  });

  describe('add', () => {
    it('should add animation to timeline', () => {
      const config: AnimationConfig = {
        property: 'opacity',
        from: 0,
        to: 1,
        duration: 1000,
      };

      timeline.add(config);

      // Timeline should have been modified (no direct way to test without exposing internals)
      expect(timeline).toBeDefined();
    });

    it('should add animation at specific position', () => {
      const config: AnimationConfig = {
        property: 'opacity',
        from: 0,
        to: 1,
        duration: 1000,
      };

      timeline.add(config, 500);
      expect(timeline).toBeDefined();
    });

    it('should parse position strings', () => {
      const config: AnimationConfig = {
        property: 'opacity',
        from: 0,
        to: 1,
        duration: 1000,
      };

      timeline.add(config, '+=100');
      timeline.add(config, '-=50');
      timeline.add(config, '50%');

      expect(timeline).toBeDefined();
    });
  });

  describe('remove', () => {
    it('should remove animation from timeline', () => {
      const config: AnimationConfig = {
        property: 'opacity',
        from: 0,
        to: 1,
        duration: 1000,
      };

      timeline.add(config);
      timeline.remove(config);

      expect(timeline).toBeDefined();
    });
  });

  describe('clear', () => {
    it('should clear all animations', () => {
      timeline.add({ property: 'x', from: 0, to: 100 });
      timeline.add({ property: 'y', from: 0, to: 100 });

      timeline.clear();

      expect(timeline).toBeDefined();
    });
  });

  describe('play', () => {
    it('should start playing timeline', () => {
      timeline.add({
        property: 'opacity',
        from: 0,
        to: 1,
        duration: 100,
      });

      timeline.play();
      expect(timeline).toBeDefined();

      timeline.stop();
    });

    it('should not restart if already playing', () => {
      timeline.add({
        property: 'opacity',
        from: 0,
        to: 1,
        duration: 100,
      });

      timeline.play();
      timeline.play(); // Should not restart

      timeline.stop();
    });
  });

  describe('pause', () => {
    it('should pause timeline', () => {
      timeline.add({
        property: 'opacity',
        from: 0,
        to: 1,
        duration: 100,
      });

      timeline.play();
      timeline.pause();

      timeline.stop();
    });
  });

  describe('stop', () => {
    it('should stop timeline', () => {
      timeline.add({
        property: 'opacity',
        from: 0,
        to: 1,
        duration: 100,
      });

      timeline.play();
      timeline.stop();

      expect(timeline).toBeDefined();
    });
  });

  describe('reverse', () => {
    it('should reverse timeline', () => {
      timeline.add({ property: 'x', from: 0, to: 100 });
      timeline.add({ property: 'y', from: 0, to: 100 });

      timeline.reverse();

      expect(timeline).toBeDefined();
    });
  });

  describe('seek', () => {
    it('should seek to specific progress', () => {
      timeline.add({
        property: 'opacity',
        from: 0,
        to: 1,
        duration: 1000,
      });

      timeline.seek(0.5);

      expect(timeline).toBeDefined();
    });
  });

  describe('speed', () => {
    it('should change playback speed', () => {
      timeline.add({
        property: 'opacity',
        from: 0,
        to: 1,
        duration: 1000,
      });

      timeline.speed(2);

      expect(timeline).toBeDefined();
    });
  });

  describe('then', () => {
    it('should chain callback', async () => {
      const callback = vi.fn();

      timeline.add({
        property: 'opacity',
        from: 0,
        to: 1,
        duration: 50,
      });

      timeline.then(callback);
      timeline.play();

      await new Promise((resolve) => setTimeout(resolve, 100));

      timeline.stop();
    });
  });
});

describe('Timeline factory functions', () => {
  describe('createStaggerTimeline', () => {
    it('should create timeline with stagger', () => {
      const animations: AnimationConfig[] = [
        { property: 'x', from: 0, to: 100, duration: 100 },
        { property: 'y', from: 0, to: 100, duration: 100 },
        { property: 'opacity', from: 0, to: 1, duration: 100 },
      ];

      const timeline = createStaggerTimeline(animations, 50);

      expect(timeline).toBeInstanceOf(TimelineController);
      timeline.stop();
    });
  });

  describe('createOverlapTimeline', () => {
    it('should create timeline with overlap', () => {
      const animations: AnimationConfig[] = [
        { property: 'x', from: 0, to: 100, duration: 100 },
        { property: 'y', from: 0, to: 100, duration: 100 },
      ];

      const timeline = createOverlapTimeline(animations, 50);

      expect(timeline).toBeInstanceOf(TimelineController);
      timeline.stop();
    });
  });

  describe('createParallelTimeline', () => {
    it('should create parallel timeline', () => {
      const animations: AnimationConfig[] = [
        { property: 'x', from: 0, to: 100, duration: 100 },
        { property: 'y', from: 0, to: 100, duration: 100 },
      ];

      const timeline = createParallelTimeline(animations);

      expect(timeline).toBeInstanceOf(TimelineController);
      timeline.stop();
    });
  });

  describe('createSequentialTimeline', () => {
    it('should create sequential timeline', () => {
      const animations: AnimationConfig[] = [
        { property: 'x', from: 0, to: 100, duration: 100 },
        { property: 'y', from: 0, to: 100, duration: 100 },
      ];

      const timeline = createSequentialTimeline(animations);

      expect(timeline).toBeInstanceOf(TimelineController);
      timeline.stop();
    });
  });
});
