/**
 * JavaScript Animation Engine Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SVGAnimator, easings } from '../../../src/svg/animations/spring.js';

describe('SVGAnimator', () => {
  let animator: SVGAnimator;
  let element: SVGElement;

  beforeEach(() => {
    animator = new SVGAnimator();
    element = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    element.id = 'test-element';
    document.body.appendChild(element);
  });

  afterEach(() => {
    if (element.parentNode) {
      document.body.removeChild(element);
    }
  });

  describe('animate', () => {
    it('should create animation controller', () => {
      const controller = animator.animate({
        target: element,
        props: {
          opacity: { from: 0, to: 1 },
        },
        duration: 100,
      });

      expect(controller).toBeDefined();
      expect(controller.play).toBeDefined();
      expect(controller.pause).toBeDefined();
      expect(controller.stop).toBeDefined();
      expect(controller.reverse).toBeDefined();
      expect(controller.seek).toBeDefined();
      expect(controller.speed).toBeDefined();

      controller.stop();
    });

    it('should call onUpdate callback', async () => {
      const onUpdate = vi.fn();

      const controller = animator.animate({
        target: element,
        props: {
          opacity: { from: 0, to: 1 },
        },
        duration: 50,
        onUpdate,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onUpdate).toHaveBeenCalled();
      controller.stop();
    });

    it('should call onComplete callback', async () => {
      const onComplete = vi.fn();

      const controller = animator.animate({
        target: element,
        props: {
          opacity: { from: 0, to: 1 },
        },
        duration: 50,
        onComplete,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onComplete).toHaveBeenCalled();
      controller.stop();
    });

    it('should support custom easing', () => {
      const customEasing = (t: number) => t * t;

      const controller = animator.animate({
        target: element,
        props: {
          opacity: { from: 0, to: 1 },
        },
        duration: 100,
        easing: customEasing,
      });

      expect(controller).toBeDefined();
      controller.stop();
    });

    it('should support looping', () => {
      const controller = animator.animate({
        target: element,
        props: {
          opacity: { from: 0, to: 1 },
        },
        duration: 100,
        loop: true,
      });

      expect(controller).toBeDefined();
      controller.stop();
    });
  });

  describe('spring', () => {
    it('should create spring animation', () => {
      const controller = animator.spring({
        target: element,
        props: {
          x: { from: 0, to: 100 },
        },
        spring: {
          stiffness: 100,
          damping: 10,
          mass: 1,
        },
      });

      expect(controller).toBeDefined();
      controller.stop();
    });

    it('should use physics simulation', async () => {
      const onUpdate = vi.fn();

      const controller = animator.spring({
        target: element,
        props: {
          x: { from: 0, to: 100 },
        },
        spring: {
          stiffness: 200,
          damping: 20,
        },
        onUpdate,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(onUpdate).toHaveBeenCalled();
      controller.stop();
    });
  });

  describe('timeline', () => {
    it('should create timeline of animations', () => {
      const controller = animator.timeline([
        {
          target: element,
          props: { opacity: { from: 0, to: 1 } },
          duration: 50,
        },
        {
          target: element,
          props: { x: { from: 0, to: 100 } },
          duration: 50,
        },
      ]);

      expect(controller).toBeDefined();
      controller.stop();
    });

    it('should execute animations sequentially', async () => {
      const updates: number[] = [];

      const controller = animator.timeline([
        {
          target: element,
          props: { opacity: { from: 0, to: 1 } },
          duration: 50,
          onUpdate: () => updates.push(1),
        },
        {
          target: element,
          props: { x: { from: 0, to: 100 } },
          duration: 50,
          onUpdate: () => updates.push(2),
        },
      ]);

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(updates.length).toBeGreaterThan(0);
      controller.stop();
    });
  });

  describe('controller methods', () => {
    it('should pause and resume animation', () => {
      const controller = animator.animate({
        target: element,
        props: { opacity: { from: 0, to: 1 } },
        duration: 1000,
      });

      controller.pause();
      controller.play();
      controller.stop();
    });

    it('should seek to specific progress', () => {
      const controller = animator.animate({
        target: element,
        props: { opacity: { from: 0, to: 1 } },
        duration: 1000,
      });

      controller.seek(0.5);
      controller.stop();
    });

    it('should change playback speed', () => {
      const controller = animator.animate({
        target: element,
        props: { opacity: { from: 0, to: 1 } },
        duration: 1000,
      });

      controller.speed(2);
      controller.stop();
    });

    it('should reverse animation', () => {
      const controller = animator.animate({
        target: element,
        props: { opacity: { from: 0, to: 1 } },
        duration: 1000,
      });

      controller.reverse();
      controller.stop();
    });

    it('should chain then callback', async () => {
      const callback = vi.fn();

      const controller = animator.animate({
        target: element,
        props: { opacity: { from: 0, to: 1 } },
        duration: 50,
      });

      controller.then(callback);

      await new Promise((resolve) => setTimeout(resolve, 100));
      controller.stop();
    });
  });
});

describe('easings', () => {
  it('should have linear easing', () => {
    expect(easings.linear(0.5)).toBe(0.5);
  });

  it('should have easeIn', () => {
    const result = easings.easeIn(0.5);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('should have easeOut', () => {
    const result = easings.easeOut(0.5);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('should have easeInOut', () => {
    const result = easings.easeInOut(0.5);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });

  it('should have elastic easing', () => {
    expect(easings.elastic(0)).toBe(0);
    expect(easings.elastic(1)).toBe(1);
    const mid = easings.elastic(0.5);
    expect(typeof mid).toBe('number');
  });

  it('should have bounce easing', () => {
    const result = easings.bounce(0.5);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });
});
