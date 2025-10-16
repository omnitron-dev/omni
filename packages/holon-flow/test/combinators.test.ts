/**
 * Tests for new Flow combinators (loop, conditional)
 */

import { describe, it, expect } from 'vitest';
import { flow, loop, conditional } from '../src/index.js';

describe('Flow Combinators', () => {
  describe('loop', () => {
    it('should loop until condition is met', async () => {
      const double = flow((x: number) => x * 2);
      const condition = flow((x: number) => x < 100);

      const loopFlow = loop(condition, double);

      const result = await loopFlow(1);
      expect(result).toBe(128); // 1 → 2 → 4 → 8 → 16 → 32 → 64 → 128
    });

    it('should handle immediate false condition', async () => {
      const increment = flow((x: number) => x + 1);
      const condition = flow(() => false);

      const loopFlow = loop(condition, increment);

      const result = await loopFlow(5);
      expect(result).toBe(5); // No iterations
    });

    it('should throw on max iterations', async () => {
      const increment = flow((x: number) => x + 1);
      const alwaysTrue = flow(() => true);

      const loopFlow = loop(alwaysTrue, increment, 10);

      await expect(loopFlow(0)).rejects.toThrow('Loop exceeded maximum iterations: 10');
    });

    it('should work with async flows', async () => {
      const asyncDouble = flow(async (x: number) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return x * 2;
      });

      const condition = flow((x: number) => x < 50);

      const loopFlow = loop(condition, asyncDouble);

      const result = await loopFlow(3);
      expect(result).toBe(96); // 3 → 6 → 12 → 24 → 48 → 96
    });
  });

  describe('conditional', () => {
    it('should execute ifTrue branch when condition is true', async () => {
      const predicate = flow((x: number) => x > 0);
      const ifTrue = flow((x: number) => x * 2);
      const ifFalse = flow((x: number) => x * -1);

      const conditionalFlow = conditional(predicate, ifTrue, ifFalse);

      const result = await conditionalFlow(5);
      expect(result).toBe(10);
    });

    it('should execute ifFalse branch when condition is false', async () => {
      const predicate = flow((x: number) => x > 0);
      const ifTrue = flow((x: number) => x * 2);
      const ifFalse = flow((x: number) => x * -1);

      const conditionalFlow = conditional(predicate, ifTrue, ifFalse);

      const result = await conditionalFlow(-5);
      expect(result).toBe(5);
    });

    it('should work with async predicates', async () => {
      const asyncPredicate = flow(async (x: number) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return x > 0;
      });

      const ifTrue = flow((x: number) => 'positive');
      const ifFalse = flow((x: number) => 'negative');

      const conditionalFlow = conditional(asyncPredicate, ifTrue, ifFalse);

      expect(await conditionalFlow(5)).toBe('positive');
      expect(await conditionalFlow(-5)).toBe('negative');
    });

    it('should work with async branches', async () => {
      const predicate = flow((x: number) => x > 0);

      const asyncIfTrue = flow(async (x: number) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return x * 2;
      });

      const asyncIfFalse = flow(async (x: number) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return x * -1;
      });

      const conditionalFlow = conditional(predicate, asyncIfTrue, asyncIfFalse);

      expect(await conditionalFlow(5)).toBe(10);
      expect(await conditionalFlow(-5)).toBe(5);
    });

    it('should handle complex conditional logic', async () => {
      // Absolute value using conditional
      const isPositive = flow((x: number) => x >= 0);
      const identity = flow((x: number) => x);
      const negate = flow((x: number) => -x);

      const absolute = conditional(isPositive, identity, negate);

      expect(await absolute(5)).toBe(5);
      expect(await absolute(-5)).toBe(5);
      expect(await absolute(0)).toBe(0);
    });
  });

  describe('combined usage', () => {
    it('should combine loop and conditional', async () => {
      // Loop that doubles if even, increments if odd, until > 100
      const condition = flow((x: number) => x <= 100);

      const isEven = flow((x: number) => x % 2 === 0);
      const double = flow((x: number) => x * 2);
      const increment = flow((x: number) => x + 1);

      const body = conditional(isEven, double, increment);
      const loopFlow = loop(condition, body);

      const result = await loopFlow(3);
      // 3 → 4 → 8 → 16 → 32 → 64 → 128
      expect(result).toBe(128);
    });
  });
});
