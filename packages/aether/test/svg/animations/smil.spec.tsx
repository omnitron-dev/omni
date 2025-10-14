/**
 * SMIL Animation Tests
 */

import { describe, it, expect } from 'vitest';
import {
  Animate,
  AnimateMotion,
  AnimateTransform,
  AnimateColor,
  Set,
} from '../../../src/svg/animations/smil.js';

describe('SMIL Animations', () => {
  describe('Animate', () => {
    it('should render animate element with required props', () => {
      const result = Animate({
        attributeName: 'opacity',
        from: '0',
        to: '1',
        dur: '1s',
      });

      expect(result).toBeDefined();
    });

    it('should support all timing attributes', () => {
      const result = Animate({
        attributeName: 'opacity',
        begin: '0s',
        dur: '1s',
        end: '2s',
        min: '0s',
        max: '3s',
        repeatCount: 'indefinite',
        repeatDur: '5s',
        fill: 'freeze',
      });

      expect(result).toBeDefined();
    });

    it('should support calcMode and keySplines', () => {
      const result = Animate({
        attributeName: 'opacity',
        values: '0;1;0',
        calcMode: 'spline',
        keyTimes: '0;0.5;1',
        keySplines: '0.5 0 0.5 1; 0.5 0 0.5 1',
      });

      expect(result).toBeDefined();
    });
  });

  describe('AnimateMotion', () => {
    it('should render animateMotion element', () => {
      const result = AnimateMotion({
        path: 'M 0 0 L 100 100',
        dur: '2s',
      });

      expect(result).toBeDefined();
    });

    it('should support rotate attribute', () => {
      const result = AnimateMotion({
        path: 'M 0 0 L 100 100',
        dur: '2s',
        rotate: 'auto',
      });

      expect(result).toBeDefined();
    });

    it('should support numeric rotate', () => {
      const result = AnimateMotion({
        path: 'M 0 0 L 100 100',
        dur: '2s',
        rotate: 45,
      });

      expect(result).toBeDefined();
    });
  });

  describe('AnimateTransform', () => {
    it('should render animateTransform element', () => {
      const result = AnimateTransform({
        attributeName: 'transform',
        type: 'rotate',
        from: '0',
        to: '360',
        dur: '2s',
      });

      expect(result).toBeDefined();
    });

    it('should support different transform types', () => {
      const types: Array<'translate' | 'scale' | 'rotate' | 'skewX' | 'skewY'> = [
        'translate',
        'scale',
        'rotate',
        'skewX',
        'skewY',
      ];

      types.forEach((type) => {
        const result = AnimateTransform({
          attributeName: 'transform',
          type,
          from: '0',
          to: '100',
          dur: '1s',
        });

        expect(result).toBeDefined();
      });
    });
  });

  describe('AnimateColor', () => {
    it('should render animateColor element', () => {
      const result = AnimateColor({
        attributeName: 'fill',
        from: 'red',
        to: 'blue',
        dur: '2s',
      });

      expect(result).toBeDefined();
    });

    it('should support color values', () => {
      const result = AnimateColor({
        attributeName: 'stroke',
        values: 'red;green;blue',
        dur: '3s',
      });

      expect(result).toBeDefined();
    });
  });

  describe('Set', () => {
    it('should render set element', () => {
      const result = Set({
        attributeName: 'visibility',
        to: 'hidden',
        begin: '1s',
      });

      expect(result).toBeDefined();
    });

    it('should support duration', () => {
      const result = Set({
        attributeName: 'fill',
        to: 'red',
        begin: '0s',
        dur: '2s',
      });

      expect(result).toBeDefined();
    });

    it('should require to attribute', () => {
      const result = Set({
        attributeName: 'opacity',
        to: '0',
      });

      expect(result).toBeDefined();
    });
  });
});
