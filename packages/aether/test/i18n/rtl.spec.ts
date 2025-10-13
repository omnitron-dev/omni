/**
 * RTL Support Tests
 */

import { describe, it, expect } from 'vitest';
import {
  isRTL,
  getDirection,
  getStartPosition,
  getEndPosition,
  flipForRTL,
  DirectionObserver,
} from '../../src/i18n/rtl.js';

describe('RTL Support', () => {
  describe('isRTL', () => {
    it('should identify RTL languages', () => {
      expect(isRTL('ar')).toBe(true);
      expect(isRTL('he')).toBe(true);
      expect(isRTL('fa')).toBe(true);
      expect(isRTL('ur')).toBe(true);
    });

    it('should identify LTR languages', () => {
      expect(isRTL('en')).toBe(false);
      expect(isRTL('fr')).toBe(false);
      expect(isRTL('es')).toBe(false);
      expect(isRTL('ja')).toBe(false);
    });

    it('should handle locale with region code', () => {
      expect(isRTL('ar-SA')).toBe(true);
      expect(isRTL('en-US')).toBe(false);
    });

    it('should handle locale with underscore separator', () => {
      expect(isRTL('ar_SA')).toBe(true);
      expect(isRTL('en_US')).toBe(false);
    });
  });

  describe('getDirection', () => {
    it('should return "rtl" for RTL languages', () => {
      expect(getDirection('ar')).toBe('rtl');
      expect(getDirection('he')).toBe('rtl');
    });

    it('should return "ltr" for LTR languages', () => {
      expect(getDirection('en')).toBe('ltr');
      expect(getDirection('fr')).toBe('ltr');
    });
  });

  describe('getStartPosition', () => {
    it('should return "left" for LTR', () => {
      expect(getStartPosition('en')).toBe('left');
    });

    it('should return "right" for RTL', () => {
      expect(getStartPosition('ar')).toBe('right');
    });
  });

  describe('getEndPosition', () => {
    it('should return "right" for LTR', () => {
      expect(getEndPosition('en')).toBe('right');
    });

    it('should return "left" for RTL', () => {
      expect(getEndPosition('ar')).toBe('left');
    });
  });

  describe('flipForRTL', () => {
    it('should return LTR value for LTR locale', () => {
      expect(flipForRTL('en', 'left', 'right')).toBe('left');
    });

    it('should return RTL value for RTL locale', () => {
      expect(flipForRTL('ar', 'left', 'right')).toBe('right');
    });
  });

  describe('DirectionObserver', () => {
    it('should initialize with correct direction', () => {
      const observer = new DirectionObserver('en');
      expect(observer.getDirection()).toBe('ltr');

      const rtlObserver = new DirectionObserver('ar');
      expect(rtlObserver.getDirection()).toBe('rtl');
    });

    it('should update direction', () => {
      const observer = new DirectionObserver('en');
      expect(observer.getDirection()).toBe('ltr');

      observer.updateDirection('ar');
      expect(observer.getDirection()).toBe('rtl');
    });

    it('should notify subscribers on direction change', () => {
      const observer = new DirectionObserver('en');
      let notified = false;
      let newDirection: 'ltr' | 'rtl' | null = null;

      observer.subscribe((dir) => {
        notified = true;
        newDirection = dir;
      });

      observer.updateDirection('ar');

      expect(notified).toBe(true);
      expect(newDirection).toBe('rtl');
    });

    it('should not notify if direction unchanged', () => {
      const observer = new DirectionObserver('en');
      let notifyCount = 0;

      observer.subscribe(() => {
        notifyCount++;
      });

      observer.updateDirection('en');
      observer.updateDirection('fr'); // Both LTR

      expect(notifyCount).toBe(0);
    });

    it('should support multiple subscribers', () => {
      const observer = new DirectionObserver('en');
      let count1 = 0;
      let count2 = 0;

      observer.subscribe(() => count1++);
      observer.subscribe(() => count2++);

      observer.updateDirection('ar');

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });

    it('should support unsubscribe', () => {
      const observer = new DirectionObserver('en');
      let count = 0;

      const unsubscribe = observer.subscribe(() => count++);

      observer.updateDirection('ar');
      expect(count).toBe(1);

      unsubscribe();
      observer.updateDirection('en');
      expect(count).toBe(1); // Should not increment
    });
  });
});
