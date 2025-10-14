/**
 * CSS Animation Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createCSSAnimation,
  applyCSSAnimation,
  removeAnimation,
  pauseAnimation,
  resumeAnimation,
  animationPresets,
} from '../../../src/svg/animations/css.js';

describe('CSS Animations', () => {
  let element: SVGElement;

  beforeEach(() => {
    element = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  });

  afterEach(() => {
    // Clean up animation styles
    const styleSheet = document.querySelector('#aether-svg-animations');
    if (styleSheet) {
      styleSheet.remove();
    }
  });

  describe('createCSSAnimation', () => {
    it('should create a CSS animation with keyframes', () => {
      const name = createCSSAnimation('test-anim', {
        keyframes: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        duration: 1000,
      });

      expect(name).toBe('test-anim');
      const styleSheet = document.querySelector('#aether-svg-animations');
      expect(styleSheet).toBeDefined();
      expect(styleSheet?.textContent).toContain('@keyframes test-anim');
    });

    it('should generate unique animation name when not provided', () => {
      const name1 = createCSSAnimation(undefined, {
        keyframes: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
      });

      const name2 = createCSSAnimation(undefined, {
        keyframes: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
      });

      expect(name1).not.toBe(name2);
      expect(name1).toMatch(/^aether-svg-anim-\d+$/);
      expect(name2).toMatch(/^aether-svg-anim-\d+$/);
    });

    it('should handle camelCase to kebab-case conversion', () => {
      const name = createCSSAnimation('camel-test', {
        keyframes: {
          '0%': { backgroundColor: 'red' },
          '100%': { backgroundColor: 'blue' },
        },
      });

      const styleSheet = document.querySelector('#aether-svg-animations');
      expect(styleSheet?.textContent).toContain('background-color');
    });
  });

  describe('applyCSSAnimation', () => {
    it('should apply animation with string name', () => {
      createCSSAnimation('fade-in', {
        keyframes: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
      });

      applyCSSAnimation(element, 'fade-in');

      expect(element.style.animation).toContain('fade-in');
    });

    it('should apply animation with config object', () => {
      applyCSSAnimation(element, {
        keyframes: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        duration: 1000,
        delay: 500,
        timingFunction: 'ease-in-out',
        iterationCount: 2,
      });

      expect(element.style.animation).toBeTruthy();
      expect(element.style.animation).toContain('1000ms');
      expect(element.style.animation).toContain('ease-in-out');
    });

    it('should handle infinite iteration count', () => {
      applyCSSAnimation(element, {
        keyframes: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        iterationCount: 'infinite',
      });

      expect(element.style.animation).toContain('infinite');
    });
  });

  describe('removeAnimation', () => {
    it('should remove animation from element', () => {
      element.style.animation = 'test 1s infinite';
      removeAnimation(element);

      expect(element.style.animation).toBe('');
    });
  });

  describe('pauseAnimation', () => {
    it('should pause animation', () => {
      pauseAnimation(element);

      expect(element.style.animationPlayState).toBe('paused');
    });
  });

  describe('resumeAnimation', () => {
    it('should resume animation', () => {
      resumeAnimation(element);

      expect(element.style.animationPlayState).toBe('running');
    });
  });

  describe('animationPresets', () => {
    it('should have spin preset', () => {
      const config = animationPresets.spin(2000);

      expect(config.keyframes).toBeDefined();
      expect(config.keyframes['0%']).toEqual({ transform: 'rotate(0deg)' });
      expect(config.keyframes['100%']).toEqual({ transform: 'rotate(360deg)' });
      expect(config.duration).toBe(2000);
      expect(config.iterationCount).toBe('infinite');
    });

    it('should have pulse preset', () => {
      const config = animationPresets.pulse(1000);

      expect(config.keyframes).toBeDefined();
      expect(config.duration).toBe(1000);
      expect(config.iterationCount).toBe('infinite');
    });

    it('should have fade preset with directions', () => {
      const fadeIn = animationPresets.fade(500, 'in');
      const fadeOut = animationPresets.fade(500, 'out');

      expect(fadeIn.keyframes['0%']).toEqual({ opacity: 0 });
      expect(fadeIn.keyframes['100%']).toEqual({ opacity: 1 });
      expect(fadeOut.keyframes['0%']).toEqual({ opacity: 1 });
      expect(fadeOut.keyframes['100%']).toEqual({ opacity: 0 });
    });

    it('should have scale preset', () => {
      const config = animationPresets.scale(500, 0, 1);

      expect(config.keyframes['0%']).toEqual({ transform: 'scale(0)' });
      expect(config.keyframes['100%']).toEqual({ transform: 'scale(1)' });
    });
  });
});
