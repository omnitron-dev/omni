/**
 * Tests for Cognitive Flow
 */

import { describe, it, expect } from 'vitest';
import { cognitiveFlow, type Example } from '../../src/cognitive/index.js';

describe('CognitiveFlow', () => {
  describe('Basic Operations', () => {
    it('should create a cognitive flow', () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      expect(cf).toBeDefined();
      expect(cf.knowledge).toBeDefined();
      expect(cf.beliefs).toBeDefined();
      expect(cf.goals).toBeDefined();
    });

    it('should execute and return result', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      const result = await cf(5);

      expect(result).toBe(10);
    });

    it('should support async functions', async () => {
      const cf = cognitiveFlow<number, number>(async (x) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return x * 3;
      });

      const result = await cf(7);

      expect(result).toBe(21);
    });
  });

  describe('Learning', () => {
    it('should learn from examples', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      const examples: Example<number, number>[] = [
        { input: 1, output: 2 },
        { input: 2, output: 4 },
        { input: 3, output: 6 },
      ];

      await cf.learn(examples);

      // Knowledge should have been updated
      expect(cf.knowledge.size()).toBeGreaterThan(0);
    });

    it('should extract patterns during learning', async () => {
      const cf = cognitiveFlow<string, number>((s) => s.length);

      const examples: Example<string, number>[] = [
        { input: 'a', output: 1 },
        { input: 'ab', output: 2 },
        { input: 'abc', output: 3 },
        { input: 'a', output: 1 }, // Duplicate
      ];

      await cf.learn(examples);

      const patterns = cf.knowledge.getPatterns();
      expect(patterns.length).toBeGreaterThan(0);
    });
  });

  describe('Memory', () => {
    it('should remember and recall values', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      cf.remember('test_key', 42);
      const value = cf.recall('test_key');

      expect(value).toBe(42);
    });

    it('should remember multiple values', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      cf.remember('key1', 'value1');
      cf.remember('key2', 'value2');
      cf.remember('key3', 'value3');

      expect(cf.recall('key1')).toBe('value1');
      expect(cf.recall('key2')).toBe('value2');
      expect(cf.recall('key3')).toBe('value3');
    });
  });

  describe('Beliefs', () => {
    it('should update beliefs based on input', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      await cf(5);

      expect(cf.beliefs.get('last_input')).toBe(5);
      expect(cf.beliefs.get('execution_count')).toBe(1);
    });

    it('should track execution count', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      await cf(1);
      await cf(2);
      await cf(3);

      expect(cf.beliefs.get('execution_count')).toBe(3);
    });
  });

  describe('Reasoning', () => {
    it('should generate reasoning chain', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      // Add some premises
      cf.beliefs.add('premise1', 'x > 0', 1.0);
      cf.beliefs.add('premise2', 'x < 100', 1.0);

      const chain = cf.reason();

      expect(chain).toBeDefined();
      expect(chain.steps).toBeDefined();
      expect(chain.conclusion).toBeDefined();
    });

    it('should have high confidence for simple reasoning', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      cf.beliefs.add('fact1', 'true', 1.0);

      const chain = cf.reason();

      expect(chain.confidence).toBeGreaterThan(0);
    });
  });

  describe('Planning', () => {
    it('should create a plan for a goal', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      const goal = {
        name: 'reach_10',
        conditions: ['value=10'],
        achieved: false,
      };

      const plan = await cf.plan(goal);

      expect(plan).toBeDefined();
      expect(plan.goal).toBe(goal);
      expect(plan.actions).toBeDefined();
    });
  });

  describe('Explanation', () => {
    it('should generate explanation', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      await cf(5);
      await cf(10);

      const explanation = cf.explain();

      expect(explanation).toBeDefined();
      expect(explanation.summary).toBeDefined();
      expect(explanation.details).toBeDefined();
      expect(Array.isArray(explanation.details)).toBe(true);
    });

    it('should include examples in explanation', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      await cf(5);
      await cf(10);

      const explanation = cf.explain();

      expect(explanation.examples).toBeDefined();
      expect(explanation.examples.length).toBeGreaterThan(0);
    });
  });

  describe('Self-Assessment', () => {
    it('should evaluate quality metrics', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      await cf(5);
      await cf(10);

      const metrics = cf.evaluate();

      expect(metrics).toBeDefined();
      expect(metrics.accuracy).toBeGreaterThanOrEqual(0);
      expect(metrics.accuracy).toBeLessThanOrEqual(1);
      expect(metrics.performance).toBeGreaterThanOrEqual(0);
      expect(metrics.performance).toBeLessThanOrEqual(1);
    });
  });

  describe('Composition', () => {
    it('should compose with other flows', async () => {
      const cf1 = cognitiveFlow<number, number>((x) => x * 2);
      const cf2 = cognitiveFlow<number, number>((x) => x + 10);

      const composed = cf1.pipe(cf2);

      const result = await composed(5);

      expect(result).toBe(20); // (5 * 2) + 10
    });
  });

  describe('Knowledge Graph Integration', () => {
    it('should build knowledge graph during execution', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      await cf(5);
      await cf(10);
      await cf(15);

      // Knowledge graph should have relations
      expect(cf.knowledge.size()).toBeGreaterThan(0);
    });

    it('should access knowledge concepts', async () => {
      const cf = cognitiveFlow<number, number>((x) => x * 2);

      await cf(5);

      const concepts = cf.knowledge.getConcepts();
      expect(Array.isArray(concepts)).toBe(true);
    });
  });
});
